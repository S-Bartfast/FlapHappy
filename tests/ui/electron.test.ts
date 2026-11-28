import { describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SHOT_DIR } from './browser-env';
import { makeProfile, sample } from '../unit/helpers';
import { exportProfileJson, createBlankProfile, parseProfileJson } from '../../core/profile';
import { installCockpitPanel } from '../../app-electron/panel-install';

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

async function launch(userData: string, extra: string[] = ['--source=simulated'], env?: Record<string,string>): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ executablePath: electronBin, args: [root, '--no-sandbox', `--user-data=${userData}`, ...extra], cwd: root, env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).__flapHappy && !!(window as any).__flapHappy.app.lastSample);
  return { app, page };
}

async function waitUntil<T>(test: () => T | Promise<T>, message = 'condition'): Promise<NonNullable<T>> {
  for (let i = 0; i < 80; i++) {
    const result = await test();
    if (result) return result as NonNullable<T>;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out: ' + message);
}
const panelUrl = 'http://127.0.0.1:47321';
const getFeed = async () => (await (await fetch(panelUrl + '/api/state')).json());
const settingsOnDisk = (ud: string) => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
const panelPage = (app: ElectronApplication) => waitUntil(() => app.windows().find(w => w.url() === panelUrl + '/panel.html'), 'external panel page');
const countWindows = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const pct = (page: Page, text: string) => page.waitForFunction(t => document.querySelector('.fh-sl-pct')?.textContent === t, text);

async function openExternal(app: ElectronApplication, main: Page): Promise<Page> {
  await main.click('.fh-external-toggle');
  const panel = await panelPage(app);
  await panel.waitForSelector('.fh-sl-track');
  await main.waitForFunction(() => document.querySelector('.fh-external-toggle')?.textContent === 'Close external panel');
  return panel;
}

async function closeExternal(app: ElectronApplication, main: Page): Promise<void> {
  await main.click('.fh-external-toggle');
  await waitUntil(async () => await countWindows(app) === 1, 'external closed');
  await main.waitForFunction(() => document.querySelector('.fh-external-toggle')?.textContent === 'Show external panel');
}

async function clickBallast(panel: Page, fraction: number) {
  const box = (await panel.locator('.fh-sl-track').boundingBox())!;
  await panel.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

describe.skipIf(!canRun)('visible control window and optional external panel', () => {
  it('forwards simple preference from the main Settings session to both live panels and restart', async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-simple-session-'));
    const fixture=makeProfile(3,{id:'simple-fixture'});

    fs.mkdirSync(path.join(ud,'profiles'));fs.writeFileSync(path.join(ud,'profiles',fixture.id+'.json'),exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud,'settings.json'),JSON.stringify({schema:'flaphappy.settings/1',last_profile_id:fixture.id,active_by_title:{'Simulated glider':fixture.id}}));
    let session=await launch(ud);let browser:import('playwright-core').Browser|undefined;
    try{
      let {app,page}=session;
      let external=await openExternal(app,page);
      const {chromium}=await import('playwright-core');const {chromePath}=await import('./browser-env');
      browser=await chromium.launch({executablePath:chromePath(),args:['--no-sandbox']});const cockpit=await browser.newPage();await cockpit.goto(panelUrl+'/panel.html');
      const sim=async(patch:Record<string,unknown>)=>page.evaluate(value=>{const sim=(window as any).__flapHappy.sim;Object.assign(sim.controls,value);sim.tick(0);},patch);
      await sim({flapCount:3,flapIndex:1,totalWeightKg:400,iasKt:55});
      const hosts=[external,cockpit];
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-cell.current')!==null);
      expect((await getFeed()).simpleFlap).toBe(false);
      await page.click('.fh-main-settings');await page.waitForSelector('.fh-simple-flap');
      await page.locator('.fh-show-transitions').locator('..').click();
      await page.locator('.fh-simple-flap').locator('..').click();
      expect(await page.locator('.fh-show-transitions').isDisabled()).toBe(true);expect(await page.locator('.fh-show-transitions').isChecked()).toBe(true);
      await waitUntil(async()=> (await getFeed()).simpleFlap===true,'simple preference');
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector<HTMLElement>('.fh-simple-actual')?.textContent==='2'&&document.querySelectorAll('.fh-simple-arrow.on').length===0);
      await sim({iasKt:75});
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-simple-arrow.on.faster')!==null&&Array.from(document.querySelectorAll<HTMLElement>('.fh-simple-pill')).some(e=>e.offsetHeight>0&&e.textContent==='3'));
      await sim({iasKt:0});
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-simple-arrow.on.slower')!==null);
      await page.locator('.fh-simple-flap').locator('..').click();expect(await page.locator('.fh-show-transitions').isEnabled()).toBe(true);expect(await page.locator('.fh-show-transitions').isChecked()).toBe(true);
      await page.locator('.fh-simple-flap').locator('..').click();
      await page.click('.fh-main-settings');
      await app.close();session=await launch(ud);({app,page}=session);
      expect((await getFeed()).simpleFlap).toBe(true);
      await page.click('.fh-main-settings');expect(await page.locator('.fh-simple-flap').isChecked()).toBe(true);
    }finally{await browser?.close();await session.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}

  });

  it('updates a custom 1.0.0 panel to the merged Auto-hide package and persists the destination on immediate native close',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'fh-panel-destination-'));
    const custom=path.join(ud,'custom-addons'), packages=path.join(ud,'packages'), community=path.join(packages,'Community2024');
    const appData=path.join(ud,'fake-appdata'), localData=path.join(ud,'fake-localappdata');
    const configDir=path.join(appData,'Microsoft Flight Simulator 2024');
    for(const dir of [custom,community,configDir,localData])fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(configDir,'UserCfg.opt'),`InstalledPackagesPath "${packages}"\n`);
    const env={...Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined)),APPDATA:appData,LOCALAPPDATA:localData};
    const bundle=path.join(root,'dist','panel','flaphappy-ingamepanel'), old=path.join(ud,'old-bundle');
    const wrapper='html_ui/InGamePanels/FlapHappy/FlapHappy.js';
    // With an archived old package supplied, exercise its real payload too;
    // ordinary test runs use a synthetic previous-version installation.
    fs.cpSync(process.env.FH_TEST_PREVIOUS_PANEL || bundle,old,{recursive:true});
    const manifest=path.join(old,'manifest.json');
    const oldManifest=JSON.parse(fs.readFileSync(manifest,'utf8'));oldManifest.package_version='1.0.0';
    fs.writeFileSync(manifest,JSON.stringify(oldManifest));
    if(!process.env.FH_TEST_PREVIOUS_PANEL)fs.writeFileSync(path.join(old,wrapper),'// previous toolbar wrapper\n');
    const destination={kind:'custom' as const,customParent:custom};
    expect(installCockpitPanel(old,destination,community,fs.renameSync,()=>false).ok).toBe(true);
    const target=path.join(custom,'flaphappy-ingamepanel');
    expect(JSON.parse(fs.readFileSync(path.join(target,'manifest.json'),'utf8')).package_version).toBe('1.0.0');
    expect(fs.readFileSync(path.join(target,wrapper))).not.toEqual(fs.readFileSync(path.join(bundle,wrapper)));
    let session=await launch(ud,['--source=simulated'],env);
    try{
      let {app,page}=session;
      await app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});},custom);
      await page.click('.fh-main-settings');await page.getByText('Window and app',{exact:true}).click();
      await page.getByLabel('Panel destination').selectOption('custom');
      const browse=page.getByRole('button',{name:'Browse',exact:true});await browse.waitFor({state:'visible'});await browse.click();
      await page.waitForFunction(p=>(document.querySelector('[aria-label="Custom package parent"]') as HTMLInputElement)?.value===p,custom);
      const process=app.process();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Flap Happy')!.close());
      await waitUntil(()=>process.exitCode!==null,'immediate native close');
      expect(settingsOnDisk(ud).panel_destination).toEqual(destination);
      session=await launch(ud,['--source=simulated'],env);({app,page}=session);
      await page.click('.fh-main-settings');await page.getByText('Window and app',{exact:true}).click();
      expect(await page.getByLabel('Panel destination').inputValue()).toBe('custom');
      expect(await page.getByLabel('Custom package parent').inputValue()).toBe(custom);
      const update=page.getByRole('button',{name:'Update',exact:true});await update.waitFor({state:'visible'});
      expect(await page.locator('.fh-panel-install').textContent()).toContain('Installed version: 1.0.0');
      expect(await page.locator('.fh-main-settings').getAttribute('class')).toContain('fh-panel-update');
      await update.click();await update.waitFor({state:'hidden'});
      await page.waitForFunction(()=>document.querySelector('.fh-panel-install')?.textContent?.includes('Up to date'));
      const newVersion=JSON.parse(fs.readFileSync(path.join(bundle,'manifest.json'),'utf8')).package_version;
      expect(newVersion).toBe('1.0.1');
      expect(JSON.parse(fs.readFileSync(path.join(target,'manifest.json'),'utf8')).package_version).toBe(newVersion);
      for(const file of [wrapper,'html_ui/InGamePanels/FlapHappy/FlapHappy.html','html_ui/InGamePanels/FlapHappy/FlapHappy.css','InGamePanels/FlapHappy.spb'])
        expect(fs.readFileSync(path.join(target,file))).toEqual(fs.readFileSync(path.join(bundle,file)));
      expect(await page.locator('.fh-main-settings').getAttribute('class')).not.toContain('fh-panel-update');
      expect(await page.locator('.fh-auto-hide-external').count()).toBe(1);
      expect(fs.readdirSync(community)).toEqual([]);
      expect(fs.readdirSync(custom)).toEqual(['flaphappy-ingamepanel']);
      expect(fs.readdirSync(ud).some(n=>n.startsWith('.flaphappy-stage-'))).toBe(false);
    }finally{await session.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('persists Auto-hide preference across restart and publishes it without hiding the external panel', async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-auto-hide-'));let session=await launch(ud);
    try {
      let {app,page}=session; const read=async()=> (await (await fetch(panelUrl+'/panel-settings')).json()).autoHideExternal;
      const external=await openExternal(app,page);
      expect(await read()).toBe(false);
      await page.click('.fh-main-settings');await page.getByText('Window and app',{exact:true}).click();
      const check=page.locator('.fh-auto-hide-external');
      expect(await check.isChecked()).toBe(false);
      await check.check();
      await waitUntil(async()=>await read()===true,'auto-hide endpoint');
      expect((await getFeed()).autoHideExternal).toBe(true);
      expect(await external.locator('.fh-fit').isVisible()).toBe(true);
      const process=app.process();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Flap Happy')!.close());
      await waitUntil(()=>process.exitCode!==null,'close flush');
      session=await launch(ud);({app,page}=session);
      expect(await read()).toBe(true);
      const again=await openExternal(app,page);expect(await again.locator('.fh-fit').isVisible()).toBe(true);
      await page.click('.fh-main-settings');await page.getByText('Window and app',{exact:true}).click();
      expect(await page.locator('.fh-auto-hide-external').isChecked()).toBe(true);
      await page.locator('.fh-auto-hide-external').uncheck();
      await waitUntil(async()=>await read()===false,'auto-hide disabled');
    }finally{await session.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('forwards group preference from the main Settings session to both live panels and restart', async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-group-session-'));
    const fixture=makeProfile(8,{id:'group-fixture'});
    fixture.flaps.forEach((r,i)=>r.label=['L','6','5','N','4','3','2','1'][i]);for(const i of [0,1,4])fixture.transitions[i]={no_ballast_kt:null,max_ballast_kt:null,exclude_from_display:true};
    fs.mkdirSync(path.join(ud,'profiles'));fs.writeFileSync(path.join(ud,'profiles',fixture.id+'.json'),exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud,'settings.json'),JSON.stringify({schema:'flaphappy.settings/1',last_profile_id:fixture.id,active_by_title:{'Simulated glider':fixture.id}}));
    let session=await launch(ud);let browser:import('playwright-core').Browser|undefined;
    try{
      let {app,page}=session;
      let external=await openExternal(app,page);
      const {chromium}=await import('playwright-core');const {chromePath}=await import('./browser-env');
      browser=await chromium.launch({executablePath:chromePath(),args:['--no-sandbox']});const cockpit=await browser.newPage();await cockpit.goto(panelUrl+'/panel.html');
      const sim=async(patch:Record<string,unknown>)=>page.evaluate(value=>{const sim=(window as any).__flapHappy.sim;Object.assign(sim.controls,value);sim.tick(0);},patch);
      await sim({flapCount:8,flapIndex:1,totalWeightKg:400,iasKt:80});
      const hosts=[external,cockpit];
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-cell.current')!==null);
      expect((await getFeed()).groupHiddenFlapLabels).toBe(false);
      await page.click('.fh-main-settings');await page.waitForSelector('.fh-group-hidden-labels');

      await page.locator('.fh-group-hidden-labels').locator('..').click();

      await waitUntil(async()=> (await getFeed()).groupHiddenFlapLabels===true,'group preference');
      for(const host of hosts){await host.waitForFunction(()=>document.querySelector('.fh-cell.current')?.textContent==='L-6-5');expect(await host.locator('.fh-badge').textContent()).toBe('6');}
      await page.locator('.fh-group-hidden-labels').locator('..').click();await waitUntil(async()=> (await getFeed()).groupHiddenFlapLabels===false);
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-cell.current')?.textContent==='5');
      await page.locator('.fh-group-hidden-labels').locator('..').click();await waitUntil(async()=> (await getFeed()).groupHiddenFlapLabels===true);
      await page.locator('.fh-simple-flap').locator('..').click();
      await sim({iasKt:80});
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector<HTMLElement>('.fh-simple-actual')?.textContent==='6'&&document.querySelector('.fh-simple-arrow.on.faster')!==null&&Array.from(document.querySelectorAll<HTMLElement>('.fh-simple-pill')).some(e=>e.offsetHeight>0&&e.textContent==='N'));
      await sim({iasKt:30});
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector<HTMLElement>('.fh-simple-actual')?.textContent==='6'&&document.querySelectorAll('.fh-simple-arrow.on').length===0);
      await sim({flapIndex:3,iasKt:30});
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-simple-arrow.on.slower')!==null&&Array.from(document.querySelectorAll<HTMLElement>('.fh-simple-pill')).some(e=>e.offsetHeight>0&&e.textContent==='L-6-5'));
      await page.locator('.fh-group-hidden-labels').locator('..').click();
      for(const host of hosts)await host.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLElement>('.fh-simple-pill')).some(e=>e.offsetHeight>0&&e.textContent==='5'));
      await page.locator('.fh-group-hidden-labels').locator('..').click();
      await page.locator('.fh-simple-flap').locator('..').click();
      await page.click('.fh-main-settings');
      await app.close();session=await launch(ud);({app,page}=session);
      expect((await getFeed()).groupHiddenFlapLabels).toBe(true);
      await page.click('.fh-main-settings');expect(await page.locator('.fh-group-hidden-labels').isChecked()).toBe(true);
    }finally{await browser?.close();await session.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('edits inline divider switches, retains hidden values and reloads saved/null transitions', async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'fh-divider-switch-'));
    const fixture=makeProfile(4,{id:'divider-fixture'});
    fixture.transitions[1]={no_ballast_kt:null,max_ballast_kt:null,exclude_from_display:true};
    const profileFile=path.join(ud,'profiles',fixture.id+'.json');
    fs.mkdirSync(path.dirname(profileFile));fs.writeFileSync(profileFile,exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud,'settings.json'),JSON.stringify({schema:'flaphappy.settings/1',last_profile_id:fixture.id,active_by_title:{'Simulated glider':fixture.id}}));
    let session=await launch(ud);
    try{
      let {app,page}=session;
      await page.click('.fh-main-settings');
      const first=()=>page.locator('.fh-trow').nth(0), second=()=>page.locator('.fh-trow').nth(1);
      const light=()=>first().locator('[data-path="transitions[0].no_ballast_kt"]'), heavy=()=>first().locator('[data-path="transitions[0].max_ballast_kt"]');
      await first().getByRole('switch',{name:'Show divider Transition 1 -> 2'}).waitFor();
      expect(await first().getByRole('switch').isChecked()).toBe(true);expect(await second().getByRole('switch').isChecked()).toBe(false);
      expect(await page.locator('.fh-group-hidden-labels').isChecked()).toBe(false);
      await light().fill('54');await heavy().fill('68');
      const toggle=first().getByRole('switch');await toggle.focus();await toggle.press('Space');
      expect(await toggle.isChecked()).toBe(false);expect(await light().isVisible()).toBe(false);expect(await heavy().isDisabled()).toBe(true);
      expect(await toggle.evaluate(el=>document.activeElement===el)).toBe(true);
      await toggle.press('Tab');expect(await page.evaluate(()=>document.activeElement?.getAttribute('data-path'))).toBe('flaps[1].label');
      await first().locator('.fh-transition-toggle').click();
      expect(await light().inputValue()).toBe('54');expect(await heavy().inputValue()).toBe('68');
      expect(await light().isEnabled()).toBe(true);
      await second().locator('.fh-transition-toggle').click();
      expect(await second().locator('.fh-speed:visible').count()).toBe(2);
      expect(await second().locator('.fh-speed').first().inputValue()).toBe('');
      expect(await page.locator('.fh-validhead.err').textContent()).toContain('Not applied');
      await second().locator('.fh-transition-toggle').click();
      expect(await page.locator('.fh-validhead.err').count()).toBe(0);
      await first().locator('.fh-transition-toggle').click();
      expect((await getFeed()).profile.transitions[0].exclude_from_display).not.toBe(true);
      await page.click('.fh-settings .fh-save');await page.waitForFunction(()=>document.querySelector('.fh-savestate')?.textContent==='Saved and applied');
      const saved=parseProfileJson(fs.readFileSync(profileFile,'utf8')).profile!;
      expect(saved.transitions[0].exclude_from_display).toBe(true);expect(saved.transitions[0].no_ballast_kt).toBeCloseTo(54,6);expect(saved.transitions[0].max_ballast_kt).toBeCloseTo(68,6);
      expect(saved.transitions[1]).toEqual({no_ballast_kt:null,max_ballast_kt:null,exclude_from_display:true});
      expect(saved.flaps).toEqual(fixture.flaps);expect(saved.transitions[2]).toEqual(fixture.transitions[2]);
      expect((await getFeed()).profile.transitions[0].exclude_from_display).toBe(true);
      expect((await getFeed()).groupHiddenFlapLabels).toBe(false);
      const external=await openExternal(app,page);
      await page.evaluate(()=>{const sim=(window as any).__flapHappy.sim;Object.assign(sim.controls,{totalWeightKg:400,flapCount:4,flapIndex:1,iasKt:70});sim.tick(0);});
      await external.waitForFunction(()=>document.querySelector('.fh-cell.current')?.textContent==='3'&&document.querySelector('.fh-badge')?.textContent==='2');
      expect(await external.locator('.fh-cell').allTextContents()).toEqual(['3','4']);
      await app.close();session=await launch(ud);({app,page}=session);
      await page.click('.fh-main-settings');await first().getByRole('switch').waitFor();
      expect(await first().getByRole('switch').isChecked()).toBe(false);expect(await first().locator('.fh-speed:visible').count()).toBe(0);
      await first().locator('.fh-transition-toggle').click();
      expect(await light().inputValue()).toBe('54');expect(await heavy().inputValue()).toBe('68');
      expect(await second().getByRole('switch').isChecked()).toBe(false);
      await second().locator('.fh-transition-toggle').click();
      expect(await second().locator('.fh-speed').first().inputValue()).toBe('');
      await page.click('.fh-settings .fh-save');await page.waitForFunction(()=>document.querySelector('.fh-savestate')?.textContent?.startsWith('Saved as incomplete'));
      const incomplete=parseProfileJson(fs.readFileSync(profileFile,'utf8')).profile!;
      expect(incomplete.transitions[1].exclude_from_display).not.toBe(true);expect(incomplete.transitions[1].no_ballast_kt).toBeNull();
      expect((await getFeed()).profile.transitions[1].exclude_from_display).toBe(true);
    }finally{await session.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('forwards highlight preference from the main Settings session to both live panels and restart', async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-highlight-session-'));
    const fixture=makeProfile(3,{id:'highlight-fixture'});
    fixture.flaps.forEach(row => { row.handle_index! += 1; });
    fixture.flaps.unshift({label:'L',handle_index:0});
    fixture.transitions.unshift({no_ballast_kt:null,max_ballast_kt:null,exclude_from_display:true});
    fixture.handle_count=4;

    fs.mkdirSync(path.join(ud,'profiles'));fs.writeFileSync(path.join(ud,'profiles',fixture.id+'.json'),exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud,'settings.json'),JSON.stringify({schema:'flaphappy.settings/1',last_profile_id:fixture.id,active_by_title:{'Simulated glider':fixture.id}}));
    let session=await launch(ud);let browser:import('playwright-core').Browser|undefined;
    try{
      let {app,page}=session;
      let external=await openExternal(app,page);
      const {chromium}=await import('playwright-core');const {chromePath}=await import('./browser-env');
      browser=await chromium.launch({executablePath:chromePath(),args:['--no-sandbox']});const cockpit=await browser.newPage();await cockpit.goto(panelUrl+'/panel.html');
      const sim=async(patch:Record<string,unknown>)=>page.evaluate(value=>{const sim=(window as any).__flapHappy.sim;Object.assign(sim.controls,value);sim.tick(0);},patch);
      await sim({flapCount:4,flapIndex:2,totalWeightKg:400,iasKt:55});
      const hosts=[external,cockpit];
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-cell.current')!==null);
      expect((await getFeed()).highlightRecommended).toBe(false);
      await page.click('.fh-main-settings');await page.waitForSelector('.fh-highlight-recommended');

      await page.locator('.fh-highlight-recommended').locator('..').click();

      await waitUntil(async()=> (await getFeed()).highlightRecommended===true,'highlight preference');
      for(const host of hosts){
        await host.waitForFunction(()=>document.querySelector('.fh-readout')?.textContent==='55 kt'&&document.querySelectorAll('.fh-cell.recommended').length===0);
        await host.waitForTimeout(1000);
        await host.evaluate(()=>{const frames:any[]=[];(window as any).__frames=frames;new MutationObserver(()=>frames.push({ias:document.querySelector('.fh-readout')?.textContent,recommended:document.querySelector('.fh-cell.recommended')?.textContent,marker:parseFloat((document.querySelector('.fh-marker') as HTMLElement).style.left)})).observe(document.getElementById('app')!,{subtree:true,attributes:true,childList:true,characterData:true});});
      }
      await sim({iasKt:75});
      for(const host of hosts){await host.waitForFunction(()=>document.querySelector('.fh-cell.recommended')?.textContent==='3');
        const frames=await host.evaluate(()=>(window as any).__frames as {ias:string,recommended:string,marker:number}[]);
        expect(frames.some(f=>f.ias==='75 kt'&&f.recommended==='3'&&f.marker<100*(64-40)/(98-40))).toBe(true);
        expect(await host.locator('.fh-cell.current').textContent()).toBe('2');
      }
      await sim({iasKt:0});for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-cell.recommended')?.textContent==='1');
      await page.locator('.fh-group-hidden-labels').locator('..').click();
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-cell.recommended')?.textContent==='L-1'&&document.querySelector('.fh-cell.current')?.textContent==='2');
      await page.click('.fh-main-settings');
      await app.close();session=await launch(ud);({app,page}=session);
      expect((await getFeed()).highlightRecommended).toBe(true);
      await page.click('.fh-main-settings');expect(await page.locator('.fh-highlight-recommended').isChecked()).toBe(true);
    }finally{await browser?.close();await session.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('starts visibly with no ribbon, opens/closes/reopens the common panel and keeps feeding while minimized', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-main-window-'));
    const fixture = makeProfile(2, { id: 'panel-fixture' });
    fixture.weight_kg={light:null,heavy:null};
    fs.mkdirSync(path.join(ud, 'profiles'));
    fs.writeFileSync(path.join(ud, 'profiles', fixture.id + '.json'), exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({
      schema: 'flaphappy.settings/1', last_profile_id: fixture.id,
      active_by_title: { 'Test glider': fixture.id }, ballast_by_profile: { [fixture.id]: 0.25 },
    }));
    const trace = path.join(ud, 'trace.jsonl');
    fs.writeFileSync(trace, [0, 300, 600].map(t => JSON.stringify(sample({ t, flapCount: 2 }))).join('\n'));
    const { app, page } = await launch(ud, ['--source=replay','--loop','--trace='+trace]);
    const process = app.process();
    try {
      await page.waitForSelector('.fh-main-controls');
      expect(await page.locator('.fh-fit').count()).toBe(0);
      expect(await page.isChecked('.fh-external-launch')).toBe(false);
      await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), 'main visible');
      expect(await app.evaluate(({ BrowserWindow, webContents }) => BrowserWindow.getAllWindows().map(w => ({title:w.getTitle(), visible:w.isVisible(), minimized:w.isMinimized(), webContents:webContents.getAllWebContents().length})))).toEqual([
        {title:'Flap Happy',visible:true,minimized:false,webContents:1},
      ]);
      const first = await waitUntil(async () => { const s = await getFeed(); return s.ready && s.sample?.iasKt === 70 && s.profile?.id === fixture.id ? s : null; }, 'main-owned feed');
      expect(first.ballast).toBe(0.25);
      let panel = await openExternal(app, page);
      expect(await countWindows(app)).toBe(2);
      await pct(panel, '25%');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('External panel'))!.setSize(720, 360));
      await panel.waitForTimeout(200);
      await clickBallast(panel, 0.5);
      await waitUntil(async () => (await getFeed()).ballast === 0.5, 'external ballast');
      await pct(panel, '50%');
      await closeExternal(app, page);
      const before = (await getFeed()).receivedAt;
      await waitUntil(async () => (await getFeed()).receivedAt > before + 1200, 'feed after external close');
      panel = await openExternal(app, page);
      await pct(panel, '50%');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('External panel'))!.close());
      await waitUntil(async () => await countWindows(app) === 1, 'native external close');
      await page.waitForFunction(() => document.querySelector('.fh-external-toggle')?.textContent === 'Show external panel');
      expect(await page.isChecked('.fh-external-launch')).toBe(false);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Flap Happy')!.minimize());
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
      const minAt = (await getFeed()).receivedAt;
      await waitUntil(async () => (await getFeed()).receivedAt > minAt + 1200, 'feed while main minimized');
      const { spawn } = await import('node:child_process');
      const child = spawn(electronBin, [root, '--no-sandbox','--show','--user-data='+ud], {cwd:root, stdio:'ignore', windowsHide:true});
      await new Promise<void>((resolve,reject) => { child.once('error',reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('show exit '+code))); });
      await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible() && !BrowserWindow.getAllWindows()[0].isMinimized()), 'main restored');
      expect(await countWindows(app)).toBe(1);
      await openExternal(app, page);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Flap Happy')!.close());
      await waitUntil(() => process.exitCode !== null, 'normal main close exits');
      expect(process.exitCode).toBe(0);
      expect(settingsOnDisk(ud).ui.external_panel_on_launch).toBe(false);
    } finally {
      if (process.exitCode === null) await app.close();
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('persists the separate startup preference across actual restarts, without manual actions changing it', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-launch-option-'));
    let instance: { app: ElectronApplication; page: Page } | null = null;
    try {
      instance = await launch(ud);
      expect(await countWindows(instance.app)).toBe(1);
      expect(await instance.page.isChecked('.fh-external-launch')).toBe(false);
      await openExternal(instance.app, instance.page);
      expect(settingsOnDisk(ud).ui.external_panel_on_launch).toBe(false);
      await instance.app.close();
      instance = await launch(ud);
      expect(await countWindows(instance.app)).toBe(1);
      await instance.page.check('.fh-external-launch');
      await waitUntil(() => settingsOnDisk(ud).ui.external_panel_on_launch === true, 'startup preference saved');
      expect(await countWindows(instance.app)).toBe(1); // toggling the preference does not open it now
      await instance.app.close();
      instance = await launch(ud);
      await panelPage(instance.app);
      expect(await instance.page.isChecked('.fh-external-launch')).toBe(true);
      expect(await countWindows(instance.app)).toBe(2);
      await closeExternal(instance.app, instance.page);
      expect(settingsOnDisk(ud).ui.external_panel_on_launch).toBe(true);
      await instance.app.close();
      instance = await launch(ud);
      await panelPage(instance.app);
      expect(await countWindows(instance.app)).toBe(2);
      await instance.page.uncheck('.fh-external-launch');
      await waitUntil(() => settingsOnDisk(ud).ui.external_panel_on_launch === false, 'startup preference cleared');
      expect(await countWindows(instance.app)).toBe(2);
      await instance.app.close();
      instance = await launch(ud, ['--source=simulated','--panel-only']); // obsolete flag never hides the main window
      expect(await countWindows(instance.app)).toBe(1);
      expect(await instance.page.isChecked('.fh-external-launch')).toBe(false);
      expect(await instance.page.isVisible('.fh-main-controls')).toBe(true);
    } finally {
      if (instance) await instance.app.close().catch(() => {});
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('preserves profile editing, simulator test controls, external settings and saved data on restart', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-e2e-'));
    let instance: {app: ElectronApplication; page: Page} | null = null;
    try {
      instance = await launch(ud);
      let {app,page} = instance;
      await page.click('.fh-main-settings');
      await page.evaluate(async p => {
        const a = (window as any).__flapHappy.app;
        await a.store.save(p); await a.refreshMetas(); await a.activate(p.id, true);
        a.closeSettings(); a.openSettings();
      }, createBlankProfile('new-profile'));
      await page.waitForSelector('.fh-settings .fh-addrow');
      const labels = ['5','N','4','3','2','1'];
      for (let i=0;i<6;i++) await page.click('.fh-settings .fh-addrow');
      for (let i=0;i<6;i++) {
        await page.fill(`.fh-settings [data-path="flaps[${i}].label"]`,labels[i]);
        await page.fill(`.fh-settings [data-path="flaps[${i}].handle_index"]`,String(i));
      }
      await page.fill('.fh-settings [data-path="vs_min.no_ballast_kt"]','48');
      await page.fill('.fh-settings [data-path="vs_min.max_ballast_kt"]','56');
      const no=[62,74,86,100,118], mx=[70,83,97,113,133];
      for(let k=0;k<5;k++) {
        await page.fill(`.fh-settings [data-path="transitions[${k}].no_ballast_kt"]`,String(no[k]));
        await page.fill(`.fh-settings [data-path="transitions[${k}].max_ballast_kt"]`,String(mx[k]));
      }
      await page.fill('.fh-settings [data-path="vne"]','145');
      await page.click('.fh-settings .fh-save');
      await page.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')?.textContent === 'Saved and applied');
      await page.screenshot({path:`${SHOT_DIR}/flaphappy-main-settings.png`});
      await page.click('.fh-main-settings');
      let panel = await openExternal(app,page);
      await waitUntil(async()=> (await getFeed()).profile?.id==='new-profile','saved profile feed');
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('External panel'))!.setSize(720,360));
      await panel.waitForTimeout(200);
      await clickBallast(panel,0.6);
      await pct(panel,'60%');
      await waitUntil(async()=> Math.abs((await getFeed()).ballast-0.6)<1e-9,'ballast saved');
      await page.evaluate(() => { const a=(window as any).__flapHappy.app; a.setAlwaysOnTop(true); a.setOpacity(.85); const sim=(window as any).__flapHappy.sim; sim.controls.iasKt=92; sim.tick(0); });
      await waitUntil(async()=> (await getFeed()).sample?.iasKt===92,'main simulated controls reach panel');
      await waitUntil(() => app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('External panel'))!.isAlwaysOnTop()),'external topmost');
      expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Flap Happy')!.isAlwaysOnTop())).toBe(false);
      expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Flap Happy')!.getOpacity())).toBe(1);
      const saved=JSON.parse(fs.readFileSync(path.join(ud,'profiles','new-profile.json'),'utf8'));
      expect(saved.transitions).toHaveLength(5);
      await app.close();
      instance=await launch(ud);
      ({app,page}=instance);
      expect(await countWindows(app)).toBe(1);
      expect(await page.$eval('.fh-title',e=>e.textContent)).toBe('new-profile');
      panel=await openExternal(app,page);
      await pct(panel,'60%');
      expect(await panel.$$eval('.fh-cell',els=>els.map(e=>e.textContent))).toEqual(labels);
      expect(await panel.$$eval('.fh-ticktext',els=>els.map(e=>e.textContent))).toEqual(['53','67','79','93','108','127','145']);
      expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('External panel'))!.isAlwaysOnTop())).toBe(true);
      await page.screenshot({path:`${SHOT_DIR}/flaphappy-main-restarted.png`});
    } finally {
      if(instance) await instance.app.close().catch(()=>{});
      fs.rmSync(ud,{recursive:true,force:true});
    }
  });

  it('toggles Settings, keeps one Save, coalesces display drags and flushes on editor and native close',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-settings-feedback-'));
    let session=await launch(ud);
    try{
      let {app,page}=session;
      const toggle=page.locator('.fh-main-settings');
      expect(await toggle.textContent()).toBe('Settings and profiles');
      await toggle.click();await page.waitForSelector('[data-path="flaps[0].label"]');
      expect(await toggle.textContent()).toBe('Close settings');
      expect(await toggle.getAttribute('aria-expanded')).toBe('true');
      expect(await page.locator('.fh-settings .fh-back').count()).toBe(0);
      expect(await page.locator('button.fh-save:visible').count()).toBe(1);
      const label=page.locator('[data-path="flaps[0].label"]');
      const original=await label.inputValue();
      await label.fill(original+'x');
      await toggle.click();
      expect(await toggle.textContent()).toBe('Settings and profiles');
      expect(await toggle.getAttribute('aria-expanded')).toBe('false');
      expect(await page.locator('button.fh-save:visible').count()).toBe(1);
      expect(await page.locator('button.fh-save:visible').isEnabled()).toBe(true);
      await toggle.click();await page.waitForSelector('[data-path="flaps[0].label"]');
      expect(await label.inputValue()).toBe(original+'x');
      expect(await page.locator('button.fh-save:visible').count()).toBe(1);
      await toggle.click();
      await page.locator('button.fh-save:visible').click();
      const profile=await page.evaluate(()=>(window as any).__flapHappy.profileId());
      await waitUntil(()=>JSON.parse(fs.readFileSync(path.join(ud,'profiles',profile+'.json'),'utf8')).flaps[0].label===original+'x','header Save retained draft');

      await toggle.click();await page.getByText('Window and app',{exact:true}).click();
      await page.waitForTimeout(800); // window bounds and previous writes settled
      const settingsPath=path.join(ud,'settings.json');
      const originalSettings=fs.readFileSync(settingsPath,'utf8');
      const range=(name:string)=>page.locator('.fh-arow').filter({hasText:name}).locator('input[type=range]');
      const drag=async()=>page.evaluate(()=>{
        const inputs=Array.from(document.querySelectorAll<HTMLInputElement>('.fh-appbox input[type=range]'));
        if(inputs.length!==2)throw Error('expected opacity and zoom controls');
        for(let i=0;i<10;i++){
          inputs[0].value=String(0.5+i*0.05);inputs[0].dispatchEvent(new Event('input',{bubbles:true}));
          inputs[1].value=String(0.6+i*0.1);inputs[1].dispatchEvent(new Event('input',{bubbles:true}));
        }
      });
      await drag();
      await waitUntil(async()=> (await getFeed()).zoom===1.5,'immediate panel zoom');
      expect(fs.readFileSync(settingsPath,'utf8')).toBe(originalSettings);
      await toggle.click(); // flush pending settings without Save
      await waitUntil(()=>settingsOnDisk(ud).ui.zoom===1.5,'editor close persists display settings');
      expect(settingsOnDisk(ud).ui.opacity).toBe(0.95);
      await toggle.click();await page.getByText('Window and app',{exact:true}).click();
      await range('Zoom').evaluate((input:HTMLInputElement)=>{input.value='1.8';input.dispatchEvent(new Event('input',{bubbles:true}));});
      const process=app.process();
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Flap Happy')!.close());
      await waitUntil(()=>process.exitCode!==null,'native close flush');
      expect(settingsOnDisk(ud).ui.zoom).toBe(1.8);
      session=await launch(ud);({app,page}=session);
      await page.click('.fh-main-settings');await page.getByText('Window and app',{exact:true}).click();
      expect(await range('Zoom').inputValue()).toBe('1.8');
    }finally{await session.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('keeps one active session across an aircraft switch while a previous profile draft is open',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-session-switch-'));
    const first=makeProfile(2,{id:'first-profile'});first.weight_kg={light:null,heavy:null};first.flaps[0].label='First';
    const second=makeProfile(3,{id:'second-profile'});second.flaps[0].label='Second';
    fs.mkdirSync(path.join(ud,'profiles'));
    for(const p of [first,second])fs.writeFileSync(path.join(ud,'profiles',p.id+'.json'),exportProfileJson(p));
    fs.writeFileSync(path.join(ud,'settings.json'),JSON.stringify({schema:'flaphappy.settings/1',last_profile_id:first.id,active_by_title:{'Simulated glider':first.id,'Other glider':second.id},ballast_by_profile:{[first.id]:0.25}}));
    const {app,page}=await launch(ud);let browser:import('playwright-core').Browser|undefined;
    try{
      const external=await openExternal(app,page);
      const {chromium}=await import('playwright-core');
      const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
      browser=await chromium.launch({executablePath,args:['--no-sandbox']});const cockpit=await browser.newPage();await cockpit.goto(panelUrl+'/panel.html');
      for(const host of [external,cockpit])await host.waitForFunction(()=>document.querySelector('.fh-cell.current')?.textContent==='First');
      await page.click('.fh-main-settings');await page.waitForSelector('[data-path="flaps[0].label"]');
      await page.fill('[data-path="flaps[0].label"]','First X');
      await page.evaluate(()=>{const sim=(window as any).__flapHappy.sim;Object.assign(sim.controls,{title:'Other glider',totalWeightKg:500,flapCount:3,flapIndex:0});sim.tick(0);});
      await waitUntil(async()=> (await getFeed()).profile?.id===second.id,'new profile in panel session');
      for(const host of [external,cockpit]){
        await host.waitForFunction(()=>document.querySelector('.fh-cell.current')?.textContent==='Second');
        await host.waitForFunction(()=>document.querySelector('.fh-sl-pct')?.textContent==='500 kg');
      }
      // The main window must agree immediately, not only after the settings editor closes.
      expect(await page.evaluate(()=>(window as any).__flapHappy.profileId())).toBe(second.id);
      expect(await page.locator('[data-path="flaps[0].label"]').inputValue()).toBe('First X');
      expect(await page.locator('.fh-liveline').textContent()).toContain('second-profile');
      await page.click('[data-weight-unit="lb"]');
      await waitUntil(async()=> (await getFeed()).weightUnit==='lb','display setting while editing previous aircraft');
      expect((await getFeed()).profile.id).toBe(second.id);
      await page.click('.fh-settings .fh-save');
      await waitUntil(()=>JSON.parse(fs.readFileSync(path.join(ud,'profiles',first.id+'.json'),'utf8')).flaps[0].label==='First X','inactive draft saved');
      expect((await getFeed()).profile.id).toBe(second.id);
      expect(await page.evaluate(()=>(window as any).__flapHappy.profileId())).toBe(second.id);
      expect((await getFeed()).ballast).not.toBe(0.25);
      await page.click('.fh-main-settings');await page.click('.fh-main-settings');
      await page.waitForSelector('[data-path="flaps[0].label"]');
      expect(await page.locator('[data-path="flaps[0].label"]').inputValue()).toBe('Second');
    }finally{await browser?.close();await app.close();fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('smooths IAS and AGL markers in both actual panel hosts, retains raw numbers and clears stale history',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-marker-smoothing-'));
    const fixture=makeProfile(2,{id:'smoothing-fixture'});
    fixture.marker_smoothing_ms=300;
    fs.mkdirSync(path.join(ud,'profiles'));fs.writeFileSync(path.join(ud,'profiles',fixture.id+'.json'),exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud,'settings.json'),JSON.stringify({schema:'flaphappy.settings/1',last_profile_id:fixture.id,active_by_title:{'Simulated glider':fixture.id}}));
    const {app,page}=await launch(ud);let browser:import('playwright-core').Browser|undefined;
    try{
      const external=await openExternal(app,page);
      const {chromium}=await import('playwright-core');
      const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
      browser=await chromium.launch({executablePath,args:['--no-sandbox']});const cockpit=await browser.newPage();await cockpit.goto(panelUrl+'/panel.html');
      const hosts=[external,cockpit];
      const send=async(patch:Record<string,unknown>)=>page.evaluate(value=>{
        const sim=(window as any).__flapHappy.sim;Object.assign(sim.controls,value);sim.tick(0);
      },patch);
      await send({flapCount:2,totalWeightKg:400,iasKt:45,aglFt:400});
      for(const host of hosts){
        await host.waitForFunction(()=>document.querySelector('.fh-readout')?.textContent==='45 kt'&&document.querySelector('.fh-aglread')?.textContent==='400 ft');
        await host.waitForTimeout(1200);
        await host.evaluate(()=>{
          const frames:any[]=[];(window as any).__markerFrames=frames;
          const capture=()=>{const value=(s:string)=>document.querySelector(s)?.textContent;const pos=(s:string)=>parseFloat((document.querySelector(s) as HTMLElement).style.left);
            frames.push({ias:value('.fh-readout'),agl:value('.fh-aglread'),marker:pos('.fh-marker'),aglMarker:pos('.fh-aglmarker')});};
          capture();new MutationObserver(capture).observe(document.getElementById('app')!,{subtree:true,attributes:true,childList:true,characterData:true});
        });
      }
      await send({iasKt:75,aglFt:1000});
      for(const host of hosts){
        await host.waitForFunction(()=>document.querySelector('.fh-readout')?.textContent==='75 kt'&&document.querySelector('.fh-aglread')?.textContent==='1000 ft');
      }
      await external.waitForTimeout(1800);
      for(const host of hosts){
        const frames=await host.evaluate(()=>(window as any).__markerFrames as {ias:string,agl:string,marker:number,aglMarker:number}[]);
        const first=frames[0],last=frames[frames.length-1];
        expect(last.marker).toBeGreaterThan(first.marker+40);
        expect(last.aglMarker).toBeGreaterThan(first.aglMarker+5);
        expect(frames.some(f=>f.ias==='75 kt'&&f.marker>first.marker+1&&f.marker<last.marker-3)).toBe(true);
        expect(frames.some(f=>f.agl==='1000 ft'&&f.aglMarker>first.aglMarker+1&&f.aglMarker<last.aglMarker-2)).toBe(true);
      }
      await send({fault:'stale'});
      for(const host of hosts)await host.waitForFunction(()=>document.querySelector('.fh-readout')?.textContent==='--- kt'&&document.querySelector<HTMLElement>('.fh-marker')?.style.display==='none'&&document.querySelector<HTMLElement>('.fh-aglmarker')?.style.display==='none');
      // First fresh sample after a stale gap should not animate from withheld history.
      for(const host of hosts)await host.evaluate(()=>{(window as any).__markerFrames.length=0;});
      await send({fault:'none',iasKt:45,aglFt:400});
      for(const host of hosts){
        await host.waitForFunction(()=>document.querySelector('.fh-readout')?.textContent==='45 kt');
        const first=await host.evaluate(()=>(window as any).__markerFrames.find((f:any)=>f.ias==='45 kt'));
        expect(first.marker).toBeCloseTo(100*(45-40)/(82-40),0);
      }
      // A configured zero tau still disables smoothing.
      fixture.marker_smoothing_ms=0;
      await page.evaluate(async p=>{await (window as any).__flapHappy.app.store.save(p);},fixture);
      for(const host of hosts)await host.evaluate(()=>{(window as any).__markerFrames.length=0;});
      await send({iasKt:75,aglFt:1000});
      for(const host of hosts){
        await host.waitForFunction(()=>document.querySelector('.fh-readout')?.textContent==='75 kt');
        const first=await host.evaluate(()=>(window as any).__markerFrames.find((f:any)=>f.ias==='75 kt'));
        expect(first.marker).toBeCloseTo(100*(75-40)/(82-40),0);
      }
    }finally{await browser?.close();await app.close();fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('uses upstream AGL and wind settings in the shared external and cockpit panel after main-process reconciliation',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-agl-panel-'));
    const {app,page}=await launch(ud);let browser:import('playwright-core').Browser|undefined;
    try{
      const panel=await openExternal(app,page);
      const {chromium}=await import('playwright-core');
      const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
      browser=await chromium.launch({executablePath,args:['--no-sandbox']});const cockpit=await browser.newPage();await cockpit.goto(panelUrl+'/panel.html');
      await page.evaluate(()=>{const a=(window as any).__flapHappy.app;const sim=(window as any).__flapHappy.sim;sim.controls.aglFt=600;sim.controls.windKt=17;sim.tick(0);a.setHeightUnit('m');a.setAglEdge('top_m',450);});
      await waitUntil(async()=>{const feed=await getFeed();return feed.height==='m'&&feed.agl.top_m===450&&feed.sample?.aglFt===600&&feed.sample?.windKt===17;},'metric AGL and wind feed');
      for(const host of [panel,cockpit]){
        await host.waitForFunction(()=>document.querySelector('.fh-aglread')?.textContent?.includes('183 m')&&document.querySelector('.fh-aglwindtext')?.textContent?.includes('17 kt'),{}, {polling:100,timeout:10000});
      }
      await page.click('.fh-main-settings');await page.waitForSelector('.fh-show-agl');await page.locator('.fh-show-agl').locator('..').click();
      await waitUntil(async()=> (await getFeed()).showAgl===false,'AGL setting reaches session');
      for(const host of [panel,cockpit])await host.waitForFunction(()=>!document.querySelector<HTMLElement>('.fh-agl-row')?.offsetHeight,{}, {polling:100,timeout:10000});
      await page.locator('.fh-show-agl').locator('..').click();await page.locator('.fh-show-wind').locator('..').click();
      await waitUntil(async()=>{const f=await getFeed();return f.showAgl===true&&f.showWind===false;},'wind setting reaches session');
      for(const host of [panel,cockpit])await host.waitForFunction(()=>!!document.querySelector<HTMLElement>('.fh-agl-row')?.offsetHeight&&!document.querySelector<HTMLElement>('.fh-aglwind')?.offsetHeight,{}, {polling:100,timeout:10000});
    }finally{await browser?.close();await app.close();fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('desktop and served cockpit panel use the same live weight and neither offers a ballast control', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-live-weight-'));
    const fixture = makeProfile(2, { id: 'weight-fixture' });
    fs.mkdirSync(path.join(ud, 'profiles'));
    fs.writeFileSync(path.join(ud, 'profiles', fixture.id + '.json'), exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ schema: 'flaphappy.settings/1', last_profile_id: fixture.id, active_by_title: { 'Simulated glider': fixture.id }, ui: { show_transitions: true } }));
    const { app, page } = await launch(ud);
    await page.waitForFunction(() => (window as any).__flapHappy.profileId() === 'weight-fixture');
    let browser: import('playwright-core').Browser | undefined;
    try {
      const { chromium } = await import('playwright-core');
      const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
      browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
      let external = await openExternal(app,page);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('External panel'))!.setSize(720,360));
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
        for (const view of [external, panel]) {
          await view.waitForFunction(text => document.querySelector('.fh-sl-pct')?.textContent === text, expected);
          const visibleTicks = await view.$$eval('.fh-ticktext', els => els.filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent));
          expect(visibleTicks).toEqual(ticks);
          expect(await view.locator('.fh-weight-row input, .fh-weight-row button, .fh-ballast-row').count()).toBe(0);
        }
      };
      await simulated({ aglFt: 650, windKt: 13 });
      for (const view of [external, panel]) {
        await view.waitForFunction(() => document.querySelector('.fh-aglread')?.textContent === '650 ft' && document.querySelector('.fh-aglwindtext')?.textContent === '13 kt');
      }
      await verify(300, ['40','52','82']);
      await verify(500, ['45','59','82']);
      await page.click('.fh-main-settings');
      await page.waitForSelector('[data-weight-unit="lb"]');
      await page.click('[data-weight-unit="lb"]');
      expect(await page.locator('[data-path="weight_kg.light"]').inputValue()).toBe('882');
      expect(await page.locator('[data-path="weight_kg.heavy"]').inputValue()).toBe('1323');
      expect(await page.locator('.fh-liveline').textContent()).toContain('1102 lb');
      await page.fill('[data-path="weight_kg.light"]','1000');
      await page.click('.fh-settings .fh-save');
      await page.waitForFunction(() => document.querySelector('.fh-savestate')?.textContent === 'Saved and applied');
      expect(JSON.parse(fs.readFileSync(path.join(ud, 'profiles', fixture.id + '.json'), 'utf8')).weight_kg.light).toBe(453.59);
      await page.fill('[data-path="weight_kg.light"]','882');
      await page.click('[data-weight-unit="kg"]');
      await page.fill('[data-path="weight_kg.light"]','400');
      await page.click('.fh-settings .fh-save');
      await page.waitForFunction(() => document.querySelector('.fh-savestate')?.textContent === 'Saved and applied');
      await page.click('[data-weight-unit="lb"]');
      await page.click('.fh-main-settings');
      for (const view of [external, panel]) {
        await view.waitForFunction(() => document.querySelector('.fh-sl-pct')?.textContent === '1102 lb');
      }
      await page.click('.fh-main-settings');
      await page.click('[data-weight-unit="kg"]');
      await page.click('.fh-main-settings');
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
      for (const view of [external, panel]) {
        await view.waitForFunction(() => document.querySelector('.fh-sl-pct')?.textContent === '-- kg');
        expect(await view.locator('.fh-ticktext:visible').count()).toBe(0);
        expect(await view.locator('.fh-aglread').textContent()).toBe('--- ft');
        expect(await view.locator('.fh-aglwindtext').textContent()).toBe('--- kt');
      }
    } finally {
      await browser?.close();
      await app.close();
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('restores the original manual slider for legacy profiles in both windows and persists the selected fraction', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-legacy-weight-'));
    const legacy = makeProfile(2, { id: 'legacy-fixture' });
    legacy.weight_kg = { light: null, heavy: null };
    legacy.ballast.default_fraction = 0.25;
    legacy.ballast.max_ballast_litres = 200;
    fs.mkdirSync(path.join(ud, 'profiles'));
    const file = JSON.parse(exportProfileJson(legacy));
    delete file.weight_kg;
    fs.writeFileSync(path.join(ud, 'profiles', legacy.id + '.json'), JSON.stringify(file));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ schema: 'flaphappy.settings/1', last_profile_id: legacy.id, active_by_title: { 'Simulated glider': legacy.id }, ui: { show_transitions: true } }));
    let { app, page } = await launch(ud);
    let browser: import('playwright-core').Browser | undefined;
    try {
      const { chromium } = await import('playwright-core');
      const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
      browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
      let external = await openExternal(app,page);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('External panel'))!.setSize(720,360));
      const panel = await browser.newPage();
      const panelUrl = 'http://127.0.0.1:47321';
      await panel.goto(panelUrl + '/panel.html');
      const read = async (view: Page, pct: string, ticks: string[]) => {
        await view.waitForFunction(({ text, expected }) => document.querySelector('.fh-ballast-row .fh-sl-pct')?.textContent === text &&
          Array.from(document.querySelectorAll('.fh-ticktext')).filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent).join(',') === expected.join(','), { text: pct, expected: ticks }, { timeout: 5000 });
        expect(await view.locator('.fh-weight-row').count()).toBe(0);
        expect(await view.$$eval('.fh-ticktext:visible', els => els.map(x => x.textContent))).toEqual(ticks);
      };
      for (const view of [external, panel]) {
        await read(view, '25% 50 L', ['43', '56', '82']);
        await view.waitForFunction(() => document.querySelector('.fh-aglread')?.textContent === '600 ft' && document.querySelector('.fh-aglwindtext')?.textContent === '12 kt');
      }
      const click = async (view: Page, f: number) => {
        const track = view.locator('.fh-ballast-row .fh-sl-track');
        const r = (await track.boundingBox())!;
        await view.bringToFront();
        await view.mouse.click(r.x + r.width * f, r.y + r.height / 2);
      };
      await click(panel, 0.75);
      for (const view of [external, panel]) await read(view, '75% 150 L', ['48', '63', '82']);
      // A two-flap strip with transitions and AGL can exceed the compact window height.
      // Resize the actual Electron window, just as a pilot can, before clicking.
      await click(external, 0.5);
      for (const view of [external, panel]) await read(view, '50% 100 L', ['45', '59', '82']);
      expect((await fetch(panelUrl + '/api/ballast', { method: 'POST', body: JSON.stringify({ profileId: 'wrong-profile', f: 0 }) })).status).toBe(409);
      await page.evaluate(() => { const sim = (window as any).__flapHappy.sim; sim.controls.totalWeightKg = 800; sim.tick(0); });
      for (const view of [external, panel]) await read(view, '50% 100 L', ['45', '59', '82']);
      await page.click('.fh-main-settings');await page.waitForFunction(()=>document.querySelector('.fh-liveline')?.textContent?.includes('800 kg'));await page.click('.fh-main-settings');
      await page.waitForTimeout(650);
      expect(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).ballast_by_profile[legacy.id]).toBe(0.5);
      await browser.close(); browser = undefined;
      await app.close();
      ({ app, page } = await launch(ud));
      external=await openExternal(app,page);
      await read(external, '50% 100 L', ['45', '59', '82']);
      await page.click('.fh-main-settings');await page.waitForSelector('.fh-weight-mode');
      expect(await page.locator('.fh-weight-mode').inputValue()).toBe('manual');
      await page.selectOption('.fh-weight-mode','live');
      await page.fill('[data-path="weight_kg.light"]','400');await page.fill('[data-path="weight_kg.heavy"]','600');
      await page.click('.fh-settings .fh-save');await page.waitForFunction(()=>document.querySelector('.fh-savestate')?.textContent==='Saved and applied');
      await external.waitForSelector('.fh-weight-row');expect(await external.locator('.fh-ballast-row').count()).toBe(0);
      expect(await page.locator('.fh-liveline').textContent()).toContain('unavailable');
      await page.selectOption('.fh-weight-mode','manual');await page.click('.fh-settings .fh-save');await page.waitForFunction(()=>document.querySelector('.fh-savestate')?.textContent==='Saved and applied');
      await read(external, '50% 100 L', ['45', '59', '82']);
      expect(JSON.parse(fs.readFileSync(path.join(ud,'profiles',legacy.id+'.json'),'utf8')).weight_kg).toEqual({light:null,heavy:null});
    } finally {
      await browser?.close();
      await app.close();
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('replay records real source samples and the cockpit panel follows changing flap positions', async () => {
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-e2e-'));
    fs.mkdirSync(path.join(ud,'profiles'),{recursive:true});
    fs.copyFileSync(path.join(root,'profiles/as33-18m.json'),path.join(ud,'profiles/as33-18m.json'));
    const trace=path.join(root,'tests/fixtures/sample-trace.jsonl'), rec=path.join(ud,'recorded.jsonl');
    const {app,page}=await launch(ud,['--source=replay','--trace='+trace,'--speed=2','--loop','--record='+rec]);
    try {
      const panel=await openExternal(app,page);
      await panel.waitForSelector('.fh-cell');
      const seen=new Set<string>();
      for(let i=0;i<25;i++) {
        seen.add(await panel.$$eval('.fh-cell.current',e=>e.map(x=>x.textContent).join(',')));
        await panel.waitForTimeout(200);
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
      expect(await page.$eval('.fh-status',e=>e.textContent)).not.toContain('DEMO');
      expect(await panel.$eval('.fh-readout',e=>e.textContent)).toMatch(/kt$/);
      await panel.screenshot({path:`${SHOT_DIR}/flaphappy-external-replay.png`});
    } finally {
      await app.close();
      expect(fs.readFileSync(rec,'utf8').trim().split('\n').length).toBeGreaterThan(10);
      fs.rmSync(ud,{recursive:true,force:true});
    }
  });
});

it.skipIf(!canRun)('fits main window controls as the actual Windows client width changes',async()=>{
 const ud=fs.mkdtempSync(path.join(os.tmpdir(),'fh-resizable-main-'));const {app,page}=await launch(ud);
 try{for(const width of [480,760,1200]){
   await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,560),width);
   await page.waitForTimeout(150);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   expect(await page.evaluate(()=>{const e=document.querySelector('.fh-main-controls')!;return e.getBoundingClientRect().width>=document.documentElement.clientWidth-25;})).toBe(true);
 }}finally{await app.close();}
});
