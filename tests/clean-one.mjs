// tests/clean-one.mjs — run any real file through the actual CleanSlate UI and verify
// the downloaded result: traces gone, decoded frames/audio/pixels byte-identical.
// Usage: node tests/clean-one.mjs "<path to file>" [--rebuild]
import { existsSync, readFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// playwright is optional: install it (npm i playwright) or point CLEANSLATE_REQUIRE at a
// tree that has it. Nothing else in the suite needs it.
const createReq = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return createReq('playwright'); // normal case: installed in this tree
  } catch (e) {
    if (!process.env.CLEANSLATE_REQUIRE) throw e; // CI installs it, so this only bites locally
    return createRequire(process.env.CLEANSLATE_REQUIRE)('playwright');
  }
}
const { chromium } = loadPlaywright();

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const args = process.argv.slice(2);
const input = resolve(args.find((a) => !a.startsWith('--')) || '');
if (!input) throw new Error('pass a file path');
const rebuild = args.includes('--rebuild');
const outDir = resolve(here, 'out', 'real');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let pass = 0; const fails = [];
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const ff = (a) => execFileSync(a[0], a.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryFf = (a) => { try { return ff(a); } catch (e) { return 'ERR:' + ((e.stderr || '') + (e.stdout || '')).slice(0, 200); } };
const frames = (f) => tryFf(['ffmpeg', '-v', 'error', '-i', f, '-map', '0:v', '-f', 'framemd5', '-']).replace(/^#.*\n/gm, '');
const audio = (f) => tryFf(['ffmpeg', '-v', 'error', '-i', f, '-map', '0:a', '-f', 'md5', '-']);
const pixels = (f) => tryFf(['ffmpeg', '-v', 'error', '-i', f, '-map', '0:v', '-frames:v', '1', '-f', 'framemd5', '-']).replace(/^#.*\n/gm, '');
const TRACES = ['Lavc', 'Lavf', 'libx264', 'libx265', 'VideoLAN', 'options:', 'cabac=', 'c2pa', 'jumb', 'trainedAlgorithmicMedia', 'xmpmeta', 'Iptc4xmpExt', 'ilst', 'udta', 'mdta', 'emsg'];
const traces = (f) => { const b = readFileSync(f); return TRACES.filter((n) => b.includes(Buffer.from(n))); };
const probe = (f, e) => JSON.parse(tryFf(['ffprobe', '-v', 'error', '-show_entries', e, '-of', 'json', f]));

const isVideo = /\.(mp4|mov|m4v)$/i.test(input);
console.log(`\nfile: ${basename(input)} (${(statSync(input).size / 1048576).toFixed(2)} MB) — ${isVideo ? 'video' : 'image'}\nbefore: traces = ${traces(input).join(', ') || '(none)'}`);

// use the installed Chrome locally, or playwright's bundled chromium (CI)
const CHROME = process.env.CLEANSLATE_CHROME
  || (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const external = [];
page.on('request', (r) => { if (!/^(file|blob|data):/.test(r.url())) external.push(r.url()); });

await page.goto('file:///' + resolve(rootDir, 'index.html').replace(/\\/g, '/'));
if (rebuild) await page.click('#modeBox button[data-mode="rebuild"]');
const t0 = Date.now();
await page.setInputFiles('#picker', [input]);
await page.waitForFunction(() => {
  const s = [...document.querySelectorAll('.card .status')].map((e) => e.textContent.trim());
  return s.length === 1 && /Ready|Failed/.test(s[0]);
}, null, { timeout: 180000 });
console.log(`analysed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('\nreport: ' + (await page.textContent('#reportSummary')).trim());
await page.click('.card .find-toggle');
const rows = await page.$$eval('.card .frow', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
rows.forEach((r) => console.log('  ' + r.slice(0, 170)));
await page.screenshot({ path: resolve(here, 'out', 'real-before.png'), fullPage: true });

const t1 = Date.now();
await page.click('#clean');
await page.waitForFunction(() => {
  const s = [...document.querySelectorAll('.card .status')].map((e) => e.textContent.trim());
  return s.length === 1 && /Cleaned|Failed/.test(s[0]);
}, null, { timeout: 600000 });
const status = (await page.textContent('.card .status')).trim();
const chips = await page.$$eval('.card .chip', (els) => els.map((e) => e.textContent.trim()));
console.log(`\ncleaned in ${((Date.now() - t1) / 1000).toFixed(1)}s · status "${status}" · chips ${JSON.stringify(chips)}`);
check('cleaned without failure', /Cleaned/.test(status), status);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('.card .icon.download')]);
const outPath = join(outDir, dl.suggestedFilename());
await dl.saveAs(outPath);
await page.screenshot({ path: resolve(here, 'out', 'real-after.png'), fullPage: true });
await browser.close();

console.log(`\noutput: ${basename(outPath)} (${(statSync(outPath).size / 1048576).toFixed(2)} MB)\nafter:  traces = ${traces(outPath).join(', ') || '(none)'}`);
check('every machine/AI trace removed', traces(outPath).length === 0, traces(outPath).join(','));
check('still decodes cleanly', !tryFf(['ffmpeg', '-v', 'error', '-xerror', '-i', outPath, '-f', 'null', '-']).startsWith('ERR'));
if (isVideo) {
  check('decoded video frames byte-identical (no quality loss)', frames(input) === frames(outPath), 'decoded frames differ');
  check('decoded audio byte-identical (no quality loss)', audio(input) === audio(outPath), 'decoded audio differs');
  const a = probe(input, 'stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames');
  const b = probe(outPath, 'stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames');
  check('streams unchanged (codec, size, frame rate, frame count)', JSON.stringify(a) === JSON.stringify(b), JSON.stringify(b).slice(0, 200));
  const ta = probe(input, 'format=duration').format.duration, tb = probe(outPath, 'format=duration').format.duration;
  check('duration unchanged', ta === tb, `${ta} → ${tb}`);
  const tags = probe(outPath, 'format_tags').format.tags || {};
  const real = Object.keys(tags).filter((k) => !['major_brand', 'minor_version', 'compatible_brands'].includes(k));
  check('ffprobe metadata empty', real.length === 0, JSON.stringify(real));
} else {
  check('decoded pixels byte-identical (no quality loss)', pixels(input) === pixels(outPath), 'decoded pixels differ');
}
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
check('no network requests', external.length === 0, external.slice(0, 2).join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
fails.forEach((f) => console.log('FAIL: ' + f));
if (fails.length) process.exit(1);
