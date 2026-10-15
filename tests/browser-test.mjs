// tests/browser-test.mjs — drives the real index.html in Chromium, cleans every
// fixture through the UI, saves the actual downloads and verifies them.
// Run: node tests/browser-test.mjs
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { requireMediaTools } from './lib/tools.mjs';

requireMediaTools();
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
const fx = resolve(here, 'fixtures');
const outDir = resolve(here, 'out', 'browser');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const ff = (args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const decodes = (file) => { try { ff(['ffmpeg', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']); return { ok: true }; } catch (e) { return { ok: false, err: ((e.stderr || '') + (e.stdout || '')).slice(0, 200) }; } };
const decodedImage = (file) => { try { return ff(['ffmpeg', '-v', 'error', '-i', file, '-map', '0:v', '-frames:v', '1', '-f', 'framemd5', '-']).replace(/^#.*\n/gm, ''); } catch (e) { return 'ERR'; } };
const fixtureFor = (file) => resolve(fx, basename(file).replace('-clean.', '.').replace(/^COV-\d+\./, ''));
const markers = (file) => {
  const b = readFileSync(file);
  return ['c2pa', 'jumb', 'trainedAlgorithmicMedia', 'Veo AI clip', 'Google Veo', 'DALL-E', 'Midjourney', 'Firefly', 'ComfyUI', '©too', '©nam', 'parameters', 'workflow'].filter((n) => b.includes(Buffer.from(n)));
};

const fixtures = readdirSync(fx).filter((f) => /\.(jpg|jpeg|png|webp|mp4|mov|m4v)$/i.test(f)).map((f) => resolve(fx, f));
console.log(`opening index.html with ${fixtures.length} fixtures`);

// use the installed Chrome locally, or playwright's bundled chromium (CI)
const CHROME = process.env.CLEANSLATE_CHROME
  || (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const page = await ctx.newPage();
const consoleErrors = [];
const externalRequests = [];
page.on('request', (r) => { if (!/^(file|blob|data):/.test(r.url())) externalRequests.push(r.url()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

await page.goto('file:///' + resolve(rootDir, 'index.html').replace(/\\/g, '/'));
await page.setInputFiles('#picker', fixtures);

const cardStatuses = () => page.$$eval('.card .status', (els) => els.map((e) => e.textContent.trim()));
await page.waitForFunction(
  (n) => {
    const s = [...document.querySelectorAll('.card .status')].map((e) => e.textContent.trim());
    return s.length === n && s.every((t) => /Ready|Failed/.test(t));
  },
  fixtures.length,
  { timeout: 60000 },
);

console.log('\n-- report shown before cleaning --');
const summary = (await page.textContent('#reportSummary')).trim();
const body = (await page.textContent('#reportBody')).trim();
console.log('  summary: ' + summary);
console.log('  ' + body.split('\n').slice(0, 4).join('\n  '));
check('report summarises the AI traces', /AI trace/.test(summary), summary);
check('report names specific markers (C2PA)', /C2PA/.test(body), body.slice(0, 120));
const chips = await page.$$eval('.card .chip.ai', (els) => els.map((e) => e.textContent.trim()));
check('per-file AI badges rendered', chips.length >= 7, chips.length + ' badges: ' + chips.slice(0, 6).join(' / '));
await page.screenshot({ path: resolve(here, 'out', 'ui-before.png'), fullPage: true });

console.log('\n-- cleaning --');
await page.click('#clean');
await page.waitForFunction(
  (n) => {
    const s = [...document.querySelectorAll('.card .status')].map((e) => e.textContent.trim());
    return s.length === n && s.every((t) => /Cleaned|Failed/.test(t));
  },
  fixtures.length,
  { timeout: 300000 },
);
const after = await cardStatuses();
console.log('  statuses: ' + after.join(' | '));
check('every file cleaned', after.every((s) => /Cleaned/.test(s)), after.join(' | '));
const methods = await page.$$eval('.card .chip', (els) => els.map((e) => e.textContent.trim()).filter((t) => /rewritten|rebuilt|in-place|lossless/.test(t)));
console.log('  methods: ' + methods.join(' | '));
check('fragmented file took the in-place route', methods.some((m) => m.startsWith('in-place clean')), methods.join(' | '));
check('videos report the deep clean', methods.filter((m) => m.includes('+ deep')).length === 8, methods.filter((m) => m.includes('+ deep')).length + ' deep chips');
check('images report a lossless strip', methods.filter((m) => m === 'lossless strip').length === 3, methods.filter((m) => m === 'lossless strip').length + ' lossless chips');
check('lossless promise shown on image cards', (await page.$$eval('.card .chip', (els) => els.map((e) => e.textContent.trim()))).filter((t) => t === 'no quality loss').length === 3);

console.log('\n-- saving the real downloads --');
const saved = [];
const buttons = await page.$$('.card .icon.download');
check('one download button per cleaned file', buttons.length === fixtures.length, buttons.length + ' buttons');
for (let i = 0; i < buttons.length; i++) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), buttons[i].click()]);
  const target = join(outDir, dl.suggestedFilename());
  await dl.saveAs(target);
  saved.push(target);
}
const [zipDl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#downloadAll')]);
const zipPath = join(outDir, zipDl.suggestedFilename());
await zipDl.saveAs(zipPath);
await page.click('.card .find-toggle');
const [reportDl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#reportDownload')]);
const reportPath = join(outDir, reportDl.suggestedFilename());
await reportDl.saveAs(reportPath);
await page.screenshot({ path: resolve(here, 'out', 'ui-after.png'), fullPage: true });

console.log('\n-- verifying the downloaded files --');
for (const f of saved) {
  const size = statSync(f).size;
  const left = markers(f);
  const isVideo = /\.(mp4|mov|m4v)$/i.test(f);
  const dec = decodes(f);
  check(`${f.split(/[\\/]/).pop()} (${size} B) still decodes`, dec.ok, dec.err);
  check(`${f.split(/[\\/]/).pop()} carries no markers`, left.length === 0, 'left: ' + left.join(','));
  if (isVideo) {
    const tags = JSON.parse(ff(['ffprobe', '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', f])).format.tags || {};
    const real = Object.entries(tags).filter(([k]) => !['major_brand', 'minor_version', 'compatible_brands'].includes(k));
    check(`${f.split(/[\\/]/).pop()} ffprobe tags empty`, real.length === 0, JSON.stringify(real).slice(0, 120));
  }
  const fixture = fixtureFor(f);
  if (!isVideo && existsSync(fixture)) {
    const same = decodedImage(f) === decodedImage(fixture);
    check(`${f.split(/[\\/]/).pop()} pixels byte-identical to the original (no quality loss)`, same, 'decoded frames differ');
  }
}
const zipped = ff(['unzip', '-l', zipPath]).split('\n').filter((l) => /\.(jpg|png|webp|mp4|mov|m4v)$/i.test(l));
check('zip contains every cleaned file', zipped.length === fixtures.length, zipped.length + ' entries');
ff(['unzip', '-t', zipPath]); // throws if the archive is corrupt
check('zip integrity test passes', true);
const reportTxt = readFileSync(reportPath, 'utf8');
check('report text names the markers it removed', /AI traces found \(\d+\)/.test(reportTxt), reportTxt.slice(0, 160).replace(/\n/g, ' '));
check('report text states the limits', /synthid|invisible pixel-level watermarks/i.test(reportTxt));

console.log('\n-- rename + numbering pass --');
await page.uncheck('#renameToggle').catch(() => {});
await page.check('#renameToggle');
await page.fill('#baseName', 'COV');
await page.click('#clean');
await page.waitForFunction((n) => {
  const s = [...document.querySelectorAll('.card .status')].map((e) => e.textContent.trim());
  return s.length === n && s.every((t) => /Cleaned|Failed/.test(t));
}, fixtures.length, { timeout: 300000 });
const [renamed] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), (await page.$$('.card .icon.download'))[0].click()]);
check('rename + numbering applied', /^COV-1\.(jpg|png|webp|mp4|mov|m4v)$/.test(renamed.suggestedFilename()), renamed.suggestedFilename());

console.log('\n-- rebuild mode pass (pixels ARE re-encoded there) --');
await page.click('#modeBox button[data-mode="rebuild"]');
await page.click('#clean');
await page.waitForFunction((n) => {
  const s = [...document.querySelectorAll('.card .status')].map((e) => e.textContent.trim());
  return s.length === n && s.every((t) => /Cleaned|Failed/.test(t));
}, fixtures.length, { timeout: 300000 });
const rebuilt = (await page.$$eval('.card .chip', (els) => els.map((e) => e.textContent.trim()))).filter((t) => t.startsWith('rebuilt'));
check('rebuild mode is reported per image', rebuilt.length === 3, JSON.stringify(rebuilt));
const imgButtons = await page.$$('.card .icon.download');
const jpgIdx = saved.findIndex((f) => f.endsWith('.jpg'));
const [rebuiltDl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), imgButtons[jpgIdx].click()]);
const rebuiltPath = resolve(outDir, 'rebuilt-mode-' + rebuiltDl.suggestedFilename());
await rebuiltDl.saveAs(rebuiltPath);
check('rebuild mode really re-encodes (pixels differ)', decodedImage(rebuiltPath) !== decodedImage(resolve(fx, 'ai-photo.jpg')));

console.log('\n-- console hygiene --');
check('no page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('the page made no network requests (privacy claim)', externalRequests.length === 0, externalRequests.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
fails.forEach((f) => console.log('FAIL: ' + f));
if (fails.length) process.exit(1);
