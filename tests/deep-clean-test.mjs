// tests/deep-clean-test.mjs — proves the two promises:
//   1. no machine-processed traces survive (container AND in-stream identification)
//   2. no quality loss: decoded video frames, decoded audio and decoded image pixels
//      are byte-identical before and after (framemd5 / md5 of the DECODED data)
// Run: node tests/deep-clean-test.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const fx = resolve(here, 'fixtures');
const out = resolve(here, 'out', 'deep');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const html = readFileSync(resolve(rootDir, 'index.html'), 'utf8');
const m = /\/\* ===== CLEANSLATE CORE[\s\S]*?\/\* ===== END CLEANSLATE CORE ===== \*\//.exec(html);
(0, eval)(m[0]);
const core = globalThis.CleanSlateCore;

let pass = 0; const fails = [];
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const ff = (args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryFf = (args) => { try { return ff(args); } catch (e) { return 'ERR:' + ((e.stderr || '') + (e.stdout || '')).slice(0, 160); } };

// traces of machine processing that must not survive
const TRACES = ['Lavc', 'Lavf', 'libx264', 'libx265', 'x264', 'x265', 'VideoLAN', 'options:', 'cabac=',
  'c2pa', 'jumb', 'trainedAlgorithmicMedia', 'Iptc4xmpExt', 'xmpmeta', 'ilst', 'udta', 'mdta', 'emsg',
  'Veo AI clip', 'Made with AI', 'Midjourney', 'ComfyUI', 'Firefly', 'DALL-E', 'Negative prompt', 'beach', '©too', '©nam'];
const tracesIn = (bytes) => {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return TRACES.filter((n) => buf.includes(Buffer.from(n)));
};
const decodedVideo = (f) => tryFf(['ffmpeg', '-v', 'error', '-i', f, '-map', '0:v', '-f', 'framemd5', '-']).replace(/^#.*\n/gm, '');
const decodedAudio = (f) => tryFf(['ffmpeg', '-v', 'error', '-i', f, '-map', '0:a', '-f', 'md5', '-']);
const decodedImage = (f) => tryFf(['ffmpeg', '-v', 'error', '-i', f, '-map', '0:v', '-frames:v', '1', '-f', 'framemd5', '-']).replace(/^#.*\n/gm, '');

console.log('=== VIDEO: deep clean, no traces, identical decoded output ===');
for (const name of readdirSync(fx).filter((f) => /\.(mp4|mov|m4v)$/i.test(f)).sort()) {
  const src = resolve(fx, name);
  const u8 = new Uint8Array(readFileSync(src));
  const a = core.analyseVideo(u8);
  const res = core.cleanVideo(u8, a);
  const outPath = resolve(out, name.replace(/\.(mp4|mov|m4v)$/, '') + '.deep.' + name.split('.').pop());
  writeFileSync(outPath, res.bytes);
  const before = tracesIn(u8), after = tracesIn(res.bytes);
  console.log(`\n${name}  [${res.mode}${res.deep ? ' + deep' : ''}] zeroed=${res.zeroed}B in ${res.targets} places · deepSupported=${res.deepSupported}`);
  console.log(`  traces before: ${before.join(', ') || '(none)'}`);
  console.log(`  traces after : ${after.join(', ') || '(none)'}`);
  check(`${name}: every machine trace removed`, after.length === 0, 'left: ' + after.join(','));
  check(`${name}: still decodes with zero errors`, !tryFf(['ffmpeg', '-v', 'error', '-xerror', '-i', outPath, '-f', 'null', '-']).startsWith('ERR'), tryFf(['ffmpeg', '-v', 'error', '-xerror', '-i', outPath, '-f', 'null', '-']).slice(0, 120));
  const f1 = decodedVideo(src), f2 = decodedVideo(outPath);
  check(`${name}: decoded video frames byte-identical (no quality loss)`, f1 === f2 && !f1.startsWith('ERR'), f1.slice(0, 60) + ' vs ' + f2.slice(0, 60));
  const a1 = decodedAudio(src), a2 = decodedAudio(outPath);
  check(`${name}: decoded audio byte-identical (no quality loss)`, a1 === a2 && !a1.startsWith('ERR'), a1.slice(0, 60) + ' vs ' + a2.slice(0, 60));
  const p1 = JSON.parse(tryFf(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames', '-of', 'json', src]));
  const p2 = JSON.parse(tryFf(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames', '-of', 'json', outPath]));
  check(`${name}: stream parameters unchanged`, JSON.stringify(p1) === JSON.stringify(p2), JSON.stringify(p2).slice(0, 120));
  const tags = (JSON.parse(tryFf(['ffprobe', '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', outPath])).format.tags) || {};
  const real = Object.keys(tags).filter((k) => !['major_brand', 'minor_version', 'compatible_brands'].includes(k));
  check(`${name}: ffprobe metadata empty`, real.length === 0, JSON.stringify(real));
}

console.log('\n=== IMAGES: lossless strip, no traces, identical pixels ===');
for (const name of readdirSync(fx).filter((f) => /\.(jpg|png|webp|bmp)$/i.test(f)).sort()) {
  const src = resolve(fx, name);
  const u8 = new Uint8Array(readFileSync(src));
  const a = await core.analyse(u8, 'image', name);
  const res = core.stripImageLossless(u8, a);
  const outPath = resolve(out, name.replace(/(\.[a-z0-9]+)$/i, '$1').replace(/(\.[a-z0-9]+)$/i, '-lossless$1'));
  writeFileSync(outPath, res.bytes);
  const before = tracesIn(u8), after = tracesIn(res.bytes);
  console.log(`\n${name}  [${res.removed.length} items removed, ${u8.length} → ${res.bytes.length} B]`);
  console.log(`  traces before: ${before.join(', ') || '(none)'}`);
  console.log(`  traces after : ${after.join(', ') || '(none)'}`);
  if (before.length) check(`${name}: every trace removed`, after.length === 0, 'left: ' + after.join(','));
  const d1 = decodedImage(src), d2 = decodedImage(outPath);
  check(`${name}: decoded pixels byte-identical (no quality loss)`, d1 === d2 && !d1.startsWith('ERR'), d1.slice(0, 50) + ' vs ' + d2.slice(0, 50));
  const s1 = JSON.parse(tryFf(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'json', src]));
  const s2 = JSON.parse(tryFf(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'json', outPath]));
  check(`${name}: dimensions and pixel format unchanged`, JSON.stringify(s1) === JSON.stringify(s2), JSON.stringify(s2).slice(0, 100));
  check(`${name}: file got smaller or stayed valid`, res.bytes.length > 0);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
fails.forEach((f) => console.log('FAIL: ' + f));
if (fails.length) process.exit(1);
