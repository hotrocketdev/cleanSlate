// tests/core-test.mjs — exercises CleanSlateCore against the fixtures and proves,
// with ffmpeg/ffprobe, that the cleaned files still decode and carry no markers.
// Run: node tests/core-test.mjs            (core extracted from index.html)
//      CLEANSLATE_CORE=<file.js> node tests/core-test.mjs   (core from a source file)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { requireMediaTools } from './lib/tools.mjs';

requireMediaTools();
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const fx = resolve(here, 'fixtures');
const out = resolve(here, 'out');
mkdirSync(out, { recursive: true });

/* ---------- load the core ---------- */
const coreSrc = process.env.CLEANSLATE_CORE;
let js;
if (coreSrc) js = readFileSync(resolve(rootDir, coreSrc), 'utf8');
else {
  const html = readFileSync(resolve(rootDir, 'index.html'), 'utf8');
  const m = /\/\* ===== CLEANSLATE CORE[\s\S]*?\/\* ===== END CLEANSLATE CORE ===== \*\//.exec(html);
  if (!m) throw new Error('core block not found in index.html');
  js = m[0];
}
(0, eval)(js);
const core = globalThis.CleanSlateCore;
if (!core) throw new Error('CleanSlateCore not exported');

/* ---------- assertion plumbing ---------- */
let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

const ff = (args, opts = {}) => execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const probe = (file, entries) => ff(['ffprobe', '-v', 'error', '-show_entries', entries, '-of', 'json', file]);
const decodesClean = (file) => {
  try {
    const err = ff(['ffmpeg', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
    return { ok: true, err: err.trim() };
  } catch (e) {
    return { ok: false, err: ((e.stderr || '') + (e.stdout || '')).trim().slice(0, 300) };
  }
};
const markersIn = (bytes) => {
  const needles = ['c2pa', 'jumb', 'trainedAlgorithmicMedia', 'Veo AI clip', 'Google Veo', 'DALL-E', 'Midjourney', 'Firefly', 'ComfyUI', 'parameters', 'workflow', 'tmcd', '©too', '©nam'];
  return needles.filter((n) => Buffer.from(bytes).includes(Buffer.from(n)));
};

/* ---------- video fixtures ---------- */
const videos = readdirSync(fx).filter((f) => /\.(mp4|mov|m4v)$/.test(f));
const report = {};
for (const name of videos.sort()) {
  console.log('\n== ' + name);
  const buf = readFileSync(resolve(fx, name));
  const u8 = new Uint8Array(buf);
  const before = markersIn(u8);
  const a = core.analyseVideo(u8);
  const names = a.findings.map((f) => `${f.name}=${f.value}`.slice(0, 70));
  console.log(`  format=${a.format} brand=${a.brand} mode=${a.mode} findings=${a.findings.length} ai=${a.aiCount} dropBytes=${a.dropBytes}`);
  console.log('  ' + (names.slice(0, 8).join('\n  ') || '(no findings)'));
  report[name] = { mode: a.mode, findings: a.findings, drops: a.drops, notes: a.notes, aiCount: a.aiCount };

  const res = core.stripVideo(u8, a);
  const outPath = resolve(out, name.replace(/\.(mp4|mov|m4v)$/, '') + '.cleaned.' + name.split('.').pop());
  writeFileSync(outPath, res.bytes);
  console.log(`  stripped: mode=${res.mode} removed=${res.removedBytes}B in ${res.bytes.length}B out`);

  const dec = decodesClean(outPath);
  const after = markersIn(res.bytes);
  const isFragmented = a.mode === 'pad';
  const expectMeta = !isFragmented;

  check('output decodes with zero ffmpeg errors', dec.ok, dec.err);
  if (expectMeta) {
    check('no marker bytes remain', after.length === 0, 'left: ' + after.join(','));
    check('file shrank', res.bytes.length < u8.length, `${u8.length} → ${res.bytes.length}`);
  } else {
    check('pad mode keeps the byte length', res.bytes.length === u8.length, `${u8.length} → ${res.bytes.length}`);
    check('no marker bytes remain (metadata zeroed in place)', after.length === 0, 'left: ' + after.join(','));
  }
  // stream parameters must survive untouched
  const s1 = JSON.parse(probe(resolve(fx, name), 'stream=codec_name,codec_type,width,height,duration,nb_frames'));
  const s2 = JSON.parse(probe(outPath, 'stream=codec_name,codec_type,width,height,duration,nb_frames'));
  check('stream parameters unchanged', JSON.stringify(s1.streams) === JSON.stringify(s2.streams), `${JSON.stringify(s2.streams).slice(0, 160)}`);
  const f1 = JSON.parse(probe(resolve(fx, name), 'format=duration,size'));
  const f2 = JSON.parse(probe(outPath, 'format=duration,size'));
  check('duration unchanged', Math.abs(+f1.format.duration - +f2.format.duration) < 0.3, `${f1.format.duration} → ${f2.format.duration}`);
  // tags gone (ffprobe reports the ftyp brands as tags too — those are container fields, not metadata)
  const tags = JSON.parse(probe(outPath, 'format_tags')).format.tags || {};
  const real = Object.fromEntries(Object.entries(tags).filter(([k]) => !['major_brand', 'minor_version', 'compatible_brands'].includes(k)));
  check('ffprobe reports no residual tags', Object.keys(real).length === 0, JSON.stringify(real).slice(0, 200));
  if (name.startsWith('ai-')) check('at least one AI marker detected in the report', a.aiCount > 0, 'aiCount=' + a.aiCount);
  if (name.startsWith('clean-')) check('clean file reports no AI markers', a.aiCount === 0, 'aiCount=' + a.aiCount);
}

/* ---------- image fixtures ---------- */
for (const name of readdirSync(fx).filter((f) => /\.(jpg|png|webp)$/.test(f)).sort()) {
  console.log('\n== ' + name);
  const buf = readFileSync(resolve(fx, name));
  const a = await core.analyse(new Uint8Array(buf), 'image', name);
  a.findings.forEach((f) => console.log(`  ${f.ai ? 'AI ' : '   '}${f.where} ${f.name}: ${String(f.value).slice(0, 70)}`));
  check('image analysed as ' + a.format, !!a.format);
  if (name.startsWith('ai-')) check('AI markers found in ' + name, a.aiCount > 0, 'aiCount=' + a.aiCount);
  report[name] = { format: a.format, findings: a.findings, aiCount: a.aiCount };
}

writeFileSync(resolve(out, '..', 'last-report.json'), JSON.stringify(report, null, 2));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('FAIL: ' + f)); process.exit(1); }
