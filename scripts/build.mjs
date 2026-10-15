// scripts/build.mjs — assemble the single-file offline app from src/.
// index.html is a BUILD ARTIFACT: edit src/ and re-run this. CI verifies the
// committed index.html matches src/, so it can never silently drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const template = read('src/index.template.html');
const core = read('src/cleanslate-core.js').replace(/\s+$/, '');
const ui = read('src/cleanslate-ui.js').replace(/\s+$/, '');

let out = template
  .replace('/*__CORE__*/', () => core)
  .replace('/*__UI__*/', () => ui);

writeFileSync(resolve(root, 'index.html'), out);
console.log(`built index.html — ${out.length} bytes (core ${core.length}, ui ${ui.length})`);
