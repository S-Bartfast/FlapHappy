import { describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SHOT_DIR } from './browser-env';
import { makeProfile, sample } from '../unit/helpers';
import { exportProfileJson, createBlankProfile } from '../../core/profile';

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

describe.skipIf(!canRun)('panel-only process', () => {
  it('serves the cockpit with zero windows, synchronizes ballast, reopens/closes the desktop and quits', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-panel-only-'));
    const fixture = makeProfile(2, { id: 'panel-fixture' });
    fs.mkdirSync(path.join(ud, 'profiles'));
    fs.writeFileSync(path.join(ud, 'profiles', fixture.id + '.json'), exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({
      schema: 'flaphappy.settings/1', last_profile_id: fixture.id,
      active_by_title: { 'Test glider': fixture.id }, ballast_by_profile: { [fixture.id]: 0.25 },
    }));
    const trace = path.join(ud, 'trace.jsonl');
    fs.writeFileSync(trace, [0, 300, 600].map(t => JSON.stringify(sample({ t, flapCount: 2 }))).join('\n'));
    const app = await electron.launch({ executablePath: electronBin, cwd: root, args: [root, '--no-sandbox', '--panel-only', '--source=replay', '--loop', '--trace=' + trace, '--user-data=' + ud] });
    const mainProcess = app.process();
    let browser: import('playwright-core').Browser | undefined;
    try {
      const panelUrl = 'http://127.0.0.1:47321';
      const ready = async (ballast: number) => {
        for (let i = 0; i < 60; i++) {
          try {
            const state = await (await fetch(panelUrl + '/api/state')).json();
            if (state.ready && state.profile?.id === fixture.id && state.sample?.iasKt === 70 && state.ballast === ballast) return state;
          } catch {}
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('No expected cockpit state');
      };
      expect((await ready(0.25)).ballast).toBe(0.25);
      const windows = () => app.evaluate(({ BrowserWindow, webContents }) => [BrowserWindow.getAllWindows().length, webContents.getAllWebContents().length]);
      expect(await windows()).toEqual([0, 0]);
      const { chromium } = await import('playwright-core');
      const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
      browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
      const panel = await browser.newPage();
      await panel.goto(panelUrl + '/panel.html');
      const pct = (page: Page, text: string) => page.waitForFunction(t => document.querySelector('.fh-sl-pct')?.textContent === t, text);
      const clickBallast = async (page: Page, f: number) => {
        const box = (await page.locator('.fh-sl-track').boundingBox())!;
        await page.mouse.click(box.x + box.width * f, box.y + box.height / 2);
      };
      await pct(panel, '25%');
      await clickBallast(panel, 0.5);
      await ready(0.5);
      await pct(panel, '50%');
      const { spawn } = await import('node:child_process');
      const command = async (flag: string) => {
        const child = spawn(electronBin, [root, '--no-sandbox', flag, '--user-data=' + ud], { cwd: root, stdio: 'ignore', windowsHide: true });
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', code => code === 0 ? resolve() : reject(new Error(flag + ' exit ' + code)));
        });
      };
      await command('--show');
      let desktop = await app.firstWindow();
      await pct(desktop, '50%');
      expect(await windows()).toEqual([1, 1]);
      await command('--show');
      expect(await windows()).toEqual([1, 1]);
      // The compact default can clip the bottom slider at this DPI; size only the disposable window.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 360));
      await desktop.waitForTimeout(250);
      await clickBallast(desktop, 0.75);
      await pct(desktop, '75%');
      await ready(0.75);
      await pct(panel, '75%');
      await clickBallast(panel, 0.25);
      await ready(0.25);
      await pct(desktop, '25%');
      const before = (await ready(0.25)).receivedAt;
      await desktop.click('.fh-display .fh-close');
      await new Promise(r => setTimeout(r, 1700));
      expect(await windows()).toEqual([0, 0]);
      const after = await ready(0.25);
      expect(after.receivedAt).toBeGreaterThan(before);
      await pct(panel, '25%');
      await command('--show');
      desktop = await app.firstWindow();
      await pct(desktop, '25%');
      expect(await windows()).toEqual([1, 1]);
      await command('--quit');
      for (let i = 0; i < 40 && mainProcess.exitCode === null; i++) await new Promise(r => setTimeout(r, 100));
      expect(mainProcess.exitCode).toBe(0);
      await panel.waitForFunction(() => document.querySelector<HTMLElement>('.fh-fit')?.style.display === 'none');
      const persisted = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
      expect(persisted.ballast_by_profile[fixture.id]).toBe(0.25);
    } finally {
      await browser?.close();
      if (mainProcess.exitCode === null) await app.close();
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });
});

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

    // Ballast slider to 60 % (persisted), pin the window on top.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 360));
    await page.waitForTimeout(250);
    const slider = (await (await page.$('.fh-display .fh-sl-track'))!.boundingBox())!;
    await page.mouse.click(slider.x + slider.width * 0.6, slider.y + slider.height / 2);
    expect(await page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent)).toBe('60%');
    await page.click('.fh-display .fh-pin');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
    await page.waitForTimeout(900);

    const file = path.join(ud, 'profiles', 'new-profile.json');
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.display_name).toBeUndefined();
    expect(onDisk.transitions).toHaveLength(5);
    expect(fs.existsSync(path.join(ud, 'settings.json'))).toBe(true);
    await app.close();

    // Restart with the same user data folder.
    ({ app, page } = await launch(ud));
    await page.waitForSelector('.fh-display .fh-cell');
    expect(await page.$eval('.fh-display .fh-title', (e) => e.textContent)).toBe('new-profile');
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.map((x) => x.textContent))).toEqual(labels);
    expect(await page.$$eval('.fh-display .fh-ticktext', (e) => e.map((x) => x.textContent))).toEqual(['53', '67', '79', '93', '108', '127', '145']); // effective speeds at 60 % ballast
    expect(await page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent)).toBe('60%');
    expect(await page.$('.fh-display .fh-sl-flag')).toBeNull();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-restarted.png` });
    await app.close();
    fs.rmSync(ud, { recursive: true, force: true });
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
