import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--clean');

if (watch) rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'renderer'), { recursive: true });

// Renderer / harness bundle: old-Chrome target so the same code runs in the in-sim browser in Phase 2.
await build({
  entryPoints: [join(root, 'ui/main.ts')],
  outfile: join(dist, 'renderer/app.js'),
  bundle: true,
  format: 'iife',
  target: ['es2015'],
  loader: { '.json': 'json' },
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

copyFileSync(join(root, 'ui/index.html'), join(dist, 'renderer/index.html'));
copyFileSync(join(root, 'ui/panel.html'), join(dist, 'renderer/panel.html'));
copyFileSync(join(root, 'ui/styles.css'), join(dist, 'renderer/styles.css'));

await build({
  entryPoints: [join(root, 'ui/panel-client.ts')],
  outfile: join(dist, 'renderer/panel.js'),
  bundle: true,
  format: 'iife',
  target: ['es2015'],
  loader: { '.json': 'json' },
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

cpSync(join(root, 'panel', 'flaphappy-ingamepanel'), join(dist, 'panel', 'flaphappy-ingamepanel'), { recursive: true });

// Electron main process (bundles node-simconnect so the packaged app needs no node_modules).
await build({
  entryPoints: [join(root, 'app-electron/main.ts')],
  outfile: join(dist, 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  loader: { '.json': 'json' },
  logLevel: 'info',
});

await build({
  entryPoints: [join(root, 'app-electron/preload.ts')],
  outfile: join(dist, 'preload.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
});
