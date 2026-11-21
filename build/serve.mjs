// Dev harness: serves dist/renderer on http://127.0.0.1:5173 so the UI runs in any browser, no Electron, no sim.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'renderer');
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export function serve(p = port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    try {
      const data = await readFile(join(root, rel));
      res.writeHead(200, { 'Content-Type': types[extname(rel)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(p, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await serve();
  console.log(`Flap Happy harness: http://127.0.0.1:${port}/?seed=demo   (try ?seed=none, ?dev=0)`);
}
