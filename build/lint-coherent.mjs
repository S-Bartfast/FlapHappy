// Enforces the Coherent-safe UI subset: ES2015 bundle, flexbox-only CSS, no unsupported browser APIs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const fail = (m) => { failed = true; console.error('FAIL ' + m); };

// 1. Bundle must be plain ES2015 (the in-sim browser is an old Chromium).
try {
  const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'es-check.cmd' : 'es-check');
  execFileSync(bin, ['es6', 'dist/renderer/app.js', 'dist/renderer/panel.js'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
} catch {
  fail('renderer bundle is not ES2015 (run npm run build first)');
}

// 2. CSS: flexbox only.
const css = readFileSync(join(root, 'ui/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const cssRules = [
  [/display\s*:\s*(inline-)?grid/, 'CSS grid'],
  [/grid-[a-z-]+\s*:/, 'CSS grid property'],
  [/(^|[;{\s])(row-|column-)?gap\s*:/, 'gap'],
  [/var\(\s*--/, 'CSS variables'],
  [/position\s*:\s*sticky/, 'position: sticky'],
  [/aspect-ratio\s*:/, 'aspect-ratio'],
  [/backdrop-filter/, 'backdrop-filter'],
  [/:is\(|:where\(|:has\(/, 'modern selector'],
];
for (const [re, name] of cssRules) if (re.test(css)) fail(`styles.css uses ${name}`);

// 3. Shared source: no APIs missing from the old browser.
const jsRules = [
  [/ResizeObserver/, 'ResizeObserver'],
  [/IntersectionObserver/, 'IntersectionObserver'],
  [/localStorage|sessionStorage/, 'web storage'],
  [/navigator\.clipboard/, 'navigator.clipboard'],
  [/\bfetch\s*\(/, 'fetch'],
  [/Object\.(entries|values|fromEntries)\b/, 'Object.entries/values/fromEntries'],
  [/\.(padStart|padEnd|replaceAll|flatMap|flat)\s*\(/, 'newer String/Array method'],
  [/\.at\(-?\d/, 'Array.at'],
  [/structuredClone|AbortController|queueMicrotask/, 'newer global'],
  [/PointerEvent|['"]pointer(down|move|up)['"]/, 'pointer events'],
  [/\bcrypto\.randomUUID/, 'crypto.randomUUID'],
];
const shared = ['core', 'ui', 'adapters/simulated', 'profiles'];
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js)$/.test(n)) out.push(p);
  }
  return out;
}
for (const d of shared) {
  for (const f of walk(join(root, d))) {
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [re, name] of jsRules) if (re.test(text)) fail(`${relative(root, f)} uses ${name}`);
  }
}

if (failed) process.exit(1);
console.log('Coherent-safe subset check passed.');
