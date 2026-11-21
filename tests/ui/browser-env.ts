import { chromium, type Browser, type Page } from 'playwright-core';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
// @ts-expect-error plain ESM helper without types
import { serve } from '../../build/serve.mjs';
import type { Server } from 'http';

export const SHOT_DIR = process.env.SCREENSHOT_DIR ?? fileURLToPath(new URL('./screenshots/', import.meta.url));
fs.mkdirSync(SHOT_DIR, { recursive: true });

export function chromePath(): string {
  const cands = [process.env.CHROME_PATH, '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
  const hit = cands.find((c) => c && fs.existsSync(c));
  if (!hit) throw new Error('Set CHROME_PATH to a Chrome/Chromium/Edge executable');
  return hit;
}

export interface Env {
  browser: Browser;
  server: Server;
  url: string;
  errors: string[];
  newPage(query?: string, size?: { width: number; height: number }): Promise<Page>;
  close(): Promise<void>;
}

export async function startEnv(): Promise<Env> {
  const server: Server = await serve(0);
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
  const errors: string[] = [];
  const url = `http://127.0.0.1:${port}/`;
  return {
    browser,
    server,
    url,
    errors,
    async newPage(query = '?seed=demo', size = { width: 820, height: 700 }) {
      const page = await browser.newPage({ viewport: size });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(url + query);
      await page.waitForFunction(() => !!(window as any).__flapHappy && !!(window as any).__flapHappy.app.lastSample);
      await page.waitForTimeout(150);
      return page;
    },
    async close() {
      await browser.close();
      server.close();
    },
  };
}
