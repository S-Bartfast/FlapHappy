import { describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SHOT_DIR } from './browser-env';
import { createBlankProfile, exportProfileJson } from '../../core/profile';
import { makeProfile } from '../unit/helpers';

const root = path.resolve(__dirname, '../..');
const electronBin = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('electron') as string;
  } catch {
    return '';
  }
})();
const canRun = !!electronBin && fs.existsSync(path.join(root, 'dist/main.js')) && (process.platform === 'win32' || !!process.env.DISPLAY);

async function launch(userData: string, extra: string[] = ['--source=simulated']): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ executablePath: electronBin, args: [root, '--no-sandbox', `--user-data=${userData}`, ...extra], cwd: root });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).__flapHappy && !!(window as any).__flapHappy.app.lastSample);
  return { app, page };
}

describe.skipIf(!canRun)('Electron shell (simulated source): window, files, restart', () => {
  it('opens the window, builds a profile in the editor, saves real files, and restores everything after a restart', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-e2e-'));
    let { app, page } = await launch(ud);

    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('Flap Happy');
    expect(await page.title()).toBe('Flap Happy');

    // First launch installs the three built-in profiles and opens AS33-18m.
    await page.waitForSelector('.fh-display .fh-cell');
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.length)).toBe(6);
    await page.click('.fh-cog');
    await page.evaluate(async (p) => {
      const a = (window as any).__flapHappy.app;
      await a.store.save(p);
      await a.refreshMetas();
      await a.activate(p.id, true);
      a.closeSettings();
      a.openSettings();
    }, createBlankProfile('new-profile'));
    await page.waitForSelector('.fh-settings .fh-addrow');
    const labels = ['5', 'N', '4', '3', '2', '1'];
    for (let i = 0; i < 6; i++) await page.click('.fh-settings .fh-addrow');
    for (let i = 0; i < 6; i++) await page.fill(`.fh-settings [data-path="flaps[${i}].label"]`, labels[i]);
    for (let i = 0; i < 6; i++) await page.fill(`.fh-settings [data-path="flaps[${i}].handle_index"]`, String(i));
    await page.fill('.fh-settings [data-path="weight_kg.light"]', '400');
    await page.fill('.fh-settings [data-path="weight_kg.heavy"]', '600');
    await page.fill('.fh-settings [data-path="vs_min.no_ballast_kt"]', '48');
    await page.fill('.fh-settings [data-path="vs_min.max_ballast_kt"]', '56');
    const no = [62, 74, 86, 100, 118];
    const mx = [70, 83, 97, 113, 133];
    for (let k = 0; k < 5; k++) {
      await page.fill(`.fh-settings [data-path="transitions[${k}].no_ballast_kt"]`, String(no[k]));
      await page.fill(`.fh-settings [data-path="transitions[${k}].max_ballast_kt"]`, String(mx[k]));
    }
    await page.fill('.fh-settings [data-path="vne"]', '145');
    await page.click('.fh-settings .fh-save');
    await page.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')!.textContent === 'Saved and applied');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-editor.png` });
    await page.click('.fh-settings .fh-back');

    // Synthetic telemetry is not a saved pilot preference.
    await page.evaluate(() => { const sim = (window as any).__flapHappy.sim; sim.controls.totalWeightKg = 520; sim.tick(0); });
    expect(await page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent)).toBe('520 kg');
    await page.click('.fh-display .fh-pin');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
    await page.waitForTimeout(900);

    const file = path.join(ud, 'profiles', 'new-profile.json');
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.display_name).toBeUndefined();
    expect(onDisk.transitions).toHaveLength(5);
    expect(onDisk.weight_kg).toEqual({ light: 400, heavy: 600 });
    expect(fs.existsSync(path.join(ud, 'settings.json'))).toBe(true);
    await app.close();

    // Restart with the same user data folder.
    ({ app, page } = await launch(ud));
    await page.waitForSelector('.fh-display .fh-cell');
    expect(await page.$eval('.fh-display .fh-title', (e) => e.textContent)).toBe('new-profile');
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.map((x) => x.textContent))).toEqual(labels);
    expect(await page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent)).toBe('-- kg');
    await page.evaluate(() => { const sim = (window as any).__flapHappy.sim; sim.controls.totalWeightKg = 520; sim.tick(0); });
    expect(await page.$$eval('.fh-display .fh-ticktext', (e) => e.map((x) => x.textContent))).toEqual(['53', '67', '79', '93', '108', '127', '145']);
    expect(await page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent)).toBe('520 kg');
    expect(await page.$('.fh-display .fh-sl-flag')).toBeNull();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-restarted.png` });
    await app.close();
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('desktop and served cockpit panel use the same live weight and neither offers a ballast control', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-live-weight-'));
    const fixture = makeProfile(2, { id: 'weight-fixture' });
    fs.mkdirSync(path.join(ud, 'profiles'));
    fs.writeFileSync(path.join(ud, 'profiles', fixture.id + '.json'), exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ schema: 'flaphappy.settings/1', last_profile_id: fixture.id, active_by_title: { 'Simulated glider': fixture.id } }));
    const { app, page } = await launch(ud);
    await page.waitForFunction(() => (window as any).__flapHappy.profileId() === 'weight-fixture');
    let browser: import('playwright-core').Browser | undefined;
    try {
      const { chromium } = await import('playwright-core');
      const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
      browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
      const panel = await browser.newPage();
      const panelUrl = 'http://127.0.0.1:47321';
      await panel.goto(panelUrl + '/panel.html');
      const simulated = (patch: Record<string, unknown>) => page.evaluate(value => {
        const sim = (window as any).__flapHappy.sim;
        Object.assign(sim.controls, value);
        sim.tick(0);
      }, patch);
      const verify = async (kg: number | null, ticks: string[]) => {
        await simulated({ totalWeightKg: kg });
        const expected = kg === null ? '-- kg' : kg + ' kg';
        for (const view of [page, panel]) {
          await view.waitForFunction(text => document.querySelector('.fh-sl-pct')?.textContent === text, expected);
          const visibleTicks = await view.$$eval('.fh-ticktext', els => els.filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent));
          expect(visibleTicks).toEqual(ticks);
          expect(await view.locator('.fh-weight-row input, .fh-weight-row button').count()).toBe(0);
        }
      };
      await verify(300, ['40','52','82']);
      await verify(500, ['45','59','82']);
      await verify(800, ['50','66','82']);
      expect((await fetch(panelUrl + '/api/ballast', { method: 'POST', body: '{"f":0}' })).status).toBe(405);
      await verify(null, []);
      await verify(500, ['45','59','82']);
      // A lost or invalid panel response cannot retain the last flying weight.
      await panel.route('**/api/state', route => route.fulfill({ status: 200, body: 'not JSON' }));
      await panel.waitForFunction(() => document.querySelector<HTMLElement>('.fh-fit')?.style.display === 'none');
      await panel.unroute('**/api/state');
      await panel.waitForFunction(() => document.querySelector('.fh-sl-pct')?.textContent === '500 kg');
      await simulated({ fault: 'stale' });
      for (const view of [page, panel]) {
        await view.waitForFunction(() => document.querySelector('.fh-sl-pct')?.textContent === '-- kg');
        expect(await view.locator('.fh-ticktext:visible').count()).toBe(0);
      }
    } finally {
      await browser?.close();
      await app.close();
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('starts in compact mode with no MINI/FULL button and keeps the display', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-e2e-'));
    const { app, page } = await launch(ud);
    await page.waitForFunction(() => document.querySelector('.fh-root.fh-compact') !== null);
    expect(await page.$('.fh-compact-btn')).toBeNull();
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.length)).toBe(6);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-compact.png` });
    await app.close();
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('replay source: samples travel main process -> IPC bridge -> UI, and --record writes a trace', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-e2e-'));
    fs.mkdirSync(path.join(ud, 'profiles'), { recursive: true });
    fs.copyFileSync(path.join(root, 'profiles/as33-18m.json'), path.join(ud, 'profiles/as33-18m.json'));
    const trace = path.join(root, 'tests/fixtures/sample-trace.jsonl');
    const rec = path.join(ud, 'recorded.jsonl');
    const { app, page } = await launch(ud, ['--source=replay', `--trace=${trace}`, '--speed=2', '--loop', `--record=${rec}`]);
    await page.waitForSelector('.fh-display .fh-cell');
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const cur = await page.$$eval('.fh-display .fh-cell.current', (e) => e.map((x) => x.textContent).join(','));
      seen.add(cur);
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(await page.$eval('.fh-display .fh-status', (e) => e.textContent)).not.toContain('DEMO');
    expect(await page.$eval('.fh-display .fh-readout', (e) => e.textContent)).toMatch(/kt$/);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-replay.png` });
    await app.close();
    expect(fs.readFileSync(rec, 'utf8').trim().split('\n').length).toBeGreaterThan(10);
    fs.rmSync(ud, { recursive: true, force: true });
  });
});
