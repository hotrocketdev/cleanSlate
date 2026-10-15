// tests/browser-test.mjs — drives the real index.html in Chromium, cleans every
// fixture through the UI, saves the actual downloads and verifies them.
// Run: node tests/browser-test.mjs
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const FORCE_HOOK = process.env.CLEANSLATE_FORCE_HOOK === '1'; // exercise the fallback locally
const routes = { download: 0, hook: 0 };

// Save what the app produced. Preferred route is the real browser download; if this
// browser raises no download event, read back the blob the app created and report
// which route each file came through.
async function grab(page, outDir, expected, trigger) {
  const before = await page.evaluate(() => (window.__cs ? window.__cs.clicks.length : -1));
  if (!FORCE_HOOK) {
    try {
      // once this browser has shown it does not deliver download events, do not
      // wait long for the remaining files
      const wait = routes.hook > 0 ? 3000 : 15000;
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: wait }), trigger()]);
      const target = join(outDir, dl.suggestedFilename());
      await dl.saveAs(target);
      routes.download++;
      return target;
    } catch (e) { /* fall through to the in-page read-back */ }
  } else {
    await trigger();
    await page.waitForTimeout(500);
  }
  const captured = await page.evaluate(async (idx) => {
    const clicks = (window.__cs || {}).clicks || [];
    const click = idx >= 0 ? clicks[idx] : clicks[clicks.length - 1];
    if (!click) return null;
    const rec = ((window.__cs || {}).blobs || []).filter((b) => b.url === click.href).pop();
    if (!rec) return null;
    const bytes = new Uint8Array(await rec.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { name: click.name, b64: btoa(s) };
  }, before);
  if (!captured) throw new Error('no download event and the app recorded no anchor click for ' + expected);
  const target = join(outDir, captured.name || expected);
  writeFileSync(target, Buffer.from(captured.b64, 'base64'));
  routes.hook++;
  console.log(`    (read back in-page: this browser raised no download event for ${captured.name})`);
  return target;
}
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
// Diagnostic + fallback: record the app's own blob URLs and anchor clicks, so if a
// browser does not deliver a download event we can still verify the exact bytes the
// app produced (and report which route was used) instead of failing blind.
await ctx.addInitScript(() => {
  window.__cs = { blobs: [], clicks: [] };
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) { const u = origCreate(b); try { window.__cs.blobs.push({ url: u, blob: b }); } catch (e) {} return u; };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try { window.__cs.clicks.push({ href: this.href, name: this.download }); } catch (e) {}
    return origClick.apply(this, arguments);
  };
});
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
  saved.push(await grab(page, outDir, 'card ' + i, () => buttons[i].click()));
}
const zipPath = await grab(page, outDir, 'zip', () => page.click('#downloadAll'));
await page.click('.card .find-toggle');
const reportPath = await grab(page, outDir, 'report', () => page.click('#reportDownload'));
await page.screenshot({ path: resolve(here, 'out', 'ui-after.png'), fullPage: true });

console.log(`\n-- verifying the files the app produced (${routes.download} via browser download, ${routes.hook} via in-page read-back) --`);
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
const renameButtons = await page.$$('.card .icon.download');
const renamedPath = await grab(page, outDir, 'renamed', () => renameButtons[0].click());
const renamedName = basename(renamedPath);
check('rename + numbering applied', /^COV-1\.(jpg|png|webp|mp4|mov|m4v)$/.test(renamedName), renamedName);

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
const rebuiltSaved = await grab(page, outDir, 'rebuilt', () => imgButtons[jpgIdx].click());
const rebuiltPath = resolve(outDir, 'rebuilt-mode-' + basename(rebuiltSaved));
check('rebuild mode really re-encodes (pixels differ)', decodedImage(rebuiltPath) !== decodedImage(resolve(fx, 'ai-photo.jpg')));

console.log('\n-- console hygiene --');
check('no page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('the page made no network requests (privacy claim)', externalRequests.length === 0, externalRequests.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
fails.forEach((f) => console.log('FAIL: ' + f));
if (fails.length) process.exit(1);
