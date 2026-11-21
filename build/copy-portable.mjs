import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const name = `FlapHappy-${version}-portable.exe`;
const from = join(root, '..', 'FlapHappy-pack', name);
const to = join(root, 'release', name);
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log('Portable exe: ' + to);
