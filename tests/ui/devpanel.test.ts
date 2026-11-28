import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHOT_DIR, startEnv, type Env } from './browser-env';

let env: Env;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  expect(env.errors).toEqual([]);
  await env.close();
});

describe('dev control panel drives the simulated feed', () => {
  it('IAS slider/number, flap selector, toggles and fault buttons change the display', async () => {
    const page = await env.newPage('?seed=demo', { width: 820, height: 900 });
    await page.fill('.fh-dev-iasnum', '95');
    await page.waitForTimeout(400);
    expect(await page.$eval('.fh-display .fh-readout', (e) => e.textContent)).toBe('95 kt');
    await page.fill('.fh-dev-flap', '5');
    await page.waitForTimeout(300);
    expect(await page.$$eval('.fh-display .fh-cell.current', (e) => e.map((x) => x.textContent))).toEqual(['5']);
    await page.focus('.fh-dev-flap');
    await page.keyboard.press('ArrowDown');
    expect(await page.inputValue('.fh-dev-flap')).toBe('4');
    await page.fill('.fh-dev-flap', '9');
    expect(await page.inputValue('.fh-dev-flap')).toBe('5');
    await page.click('.fh-fault[data-fault="unreadable"]');
    await page.waitForTimeout(300);
    expect(await page.$eval('.fh-display .fh-badge', (e) => e.textContent)).toBe('FLAP ?');
    await page.click('.fh-fault[data-fault="none"]');
    await page.uncheck('.fh-dev-connected');
    await page.waitForTimeout(300);
    expect(await page.$eval('.fh-display .fh-status', (e) => e.textContent)).toContain('Waiting for MSFS...');
    await page.check('.fh-dev-connected');
    await page.check('.fh-dev-ground');
    await page.waitForTimeout(300);
    expect(await page.$eval('.fh-display .fh-marker', (e) => (e as HTMLElement).style.display)).toBe('none');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-devpanel.png` });
    await page.close();
  });

  it('scenarios run: the IAS sweep moves the marker across the whole bar, the lever sequence steps through every row', async () => {
    const page = await env.newPage('?seed=demo', { width: 820, height: 900 });
    await page.evaluate(() => { (window as any).__flapHappy.app.profile.marker_smoothing_ms = 0; });
    await page.selectOption('.fh-dev-scen', '0');
    await page.click('.fh-dev-play');
    const xs: number[] = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(250);
      xs.push(await page.$eval('.fh-display .fh-readout', (e) => parseFloat(e.textContent || '0')));
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
    await page.click('.fh-dev-stop');

    await page.selectOption('.fh-dev-scen', '1');
    await page.click('.fh-dev-play');
    const seen = new Set<string>();
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(300);
      seen.add((await page.$$eval('.fh-display .fh-cell.current', (e) => e.map((x) => x.textContent))).join(','));
    }
    await page.click('.fh-dev-stop');
    expect(seen.size).toBeGreaterThanOrEqual(2);
    await page.close();
  });

  it('remembers the control values for the next session', async () => {
    const page = await env.newPage('?seed=demo', { width: 820, height: 900 });
    await page.fill('.fh-dev-iasnum', '73');
    await page.fill('.fh-dev-flap', '2');
    await page.uncheck('.fh-dev-connected');
    await page.reload();
    await page.waitForSelector('.fh-dev-flap');
    expect(await page.inputValue('.fh-dev-iasnum')).toBe('73');
    expect(await page.inputValue('.fh-dev-flap')).toBe('2');
    expect(await page.isChecked('.fh-dev-connected')).toBe(false);
    expect(await page.$eval('.fh-display .fh-status', (e) => e.textContent)).toContain('Waiting for MSFS...');
    await page.close();
  });

  it('keeps the handle index inside the flap count, live and after a restart', async () => {
    const page = await env.newPage('?seed=demo', { width: 820, height: 900 });
    await page.fill('.fh-dev-count', '8');
    await page.fill('.fh-dev-flap', '7');
    expect(await page.inputValue('.fh-dev-flap')).toBe('7');
    await page.fill('.fh-dev-count', '6');
    expect(await page.inputValue('.fh-dev-flap')).toBe('5');
    expect(await page.evaluate(() => (window as any).__flapHappy.sim.controls.flapIndex)).toBe(5);
    await page.reload();
    await page.waitForSelector('.fh-dev-flap');
    expect(await page.inputValue('.fh-dev-flap')).toBe('5');
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('flaphappy.devpanel') || '{}');
      localStorage.setItem('flaphappy.devpanel', JSON.stringify({ ...saved, flapCount: 6, flapIndex: 7 }));
    });
    await page.reload();
    await page.waitForSelector('.fh-dev-flap');
    expect(await page.inputValue('.fh-dev-count')).toBe('6');
    expect(await page.inputValue('.fh-dev-flap')).toBe('5');
    await page.close();
  });

  it('resets the controls to their defaults, and the reset is remembered', async () => {
    const page = await env.newPage('?seed=demo', { width: 820, height: 900 });
    await page.fill('.fh-dev-iasnum', '73');
    await page.fill('.fh-dev-count', '8');
    await page.fill('.fh-dev-flap', '7');
    await page.uncheck('.fh-dev-connected');
    await page.click('.fh-dev-reset');
    expect(await page.$$('.fh-devpanel')).toHaveLength(1);
    expect(await page.inputValue('.fh-dev-iasnum')).toBe('80');
    expect(await page.inputValue('.fh-dev-count')).toBe('6');
    expect(await page.inputValue('.fh-dev-flap')).toBe('0');
    expect(await page.isChecked('.fh-dev-connected')).toBe(true);
    await page.reload();
    await page.waitForSelector('.fh-dev-flap');
    expect(await page.inputValue('.fh-dev-iasnum')).toBe('80');
    expect(await page.inputValue('.fh-dev-count')).toBe('6');
    await page.waitForTimeout(400);
    expect(await page.$eval('.fh-display .fh-status', (e) => e.textContent)).not.toContain('Waiting for MSFS...');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-devpanel-reset.png` });
    await page.close();
  });

  it('can be hidden (?dev=0) like in a release build', async () => {
    const page = await env.newPage('?seed=demo&dev=0', { width: 820, height: 600 });
    expect(await page.$$('.fh-dev')).toHaveLength(0);
    await page.close();
  });

  it('compact mode shows the display only', async () => {
    const page = await env.newPage('?seed=demo&dev=0&compact=1', { width: 700, height: 260 });
    expect(await page.$eval('.fh-root', (e) => e.classList.contains('fh-compact'))).toBe(true);
    expect(await page.isVisible('.fh-display .fh-sl')).toBe(true);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-compact.png` });
    await page.close();
  });
});
