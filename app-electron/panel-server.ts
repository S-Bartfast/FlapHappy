import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { CockpitState } from '../core/cockpit';
import { COCKPIT_PORT } from '../core/cockpit';

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

/**
 * Local page the in-sim panel loads. Bound to 127.0.0.1 only.
 * The active session publishes the profile and sim sample; the panel posts ballast changes back.
 */
export function startPanelServer(opts: {
  root: string;
  version: string;
  getState: () => CockpitState | null;
  onBallast: (f: number) => void | boolean | Promise<void | boolean>;
}): Promise<Server> {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/version') {
      json(res, 200, { app: 'Flap Happy', version: opts.version });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      json(res, 200, opts.getState() ?? { ready: false, profile: null, sample: null, receivedAt: 0, ballast: 0, units: 'kt', zoom: 1 });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ballast') {
      const body = await readBody(req);
      let f = NaN;
      try {
        f = Number(JSON.parse(body).f);
      } catch {
        f = NaN;
      }
      if (!isFinite(f)) {
        json(res, 400, { ok: false });
        return;
      }
      try {
        const applied = await opts.onBallast(Math.max(0, Math.min(1, f)));
        json(res, applied === false ? 409 : 200, { ok: applied !== false });
      } catch {
        json(res, 500, { ok: false });
      }
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    const rel = normalize(url.pathname === '/' ? '/panel.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    try {
      const data = await readFile(join(opts.root, rel));
      res.writeHead(200, { 'Content-Type': types[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(COCKPIT_PORT, '127.0.0.1', () => resolve(server));
  });
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size < 100000) chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
