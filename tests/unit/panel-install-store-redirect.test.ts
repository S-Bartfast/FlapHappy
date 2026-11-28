import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installCockpitPanel, panelInstallStatus, removeCockpitPanel } from '../../app-electron/panel-install';
import type { PanelDestination } from '../../core/panel-install';

const mocked=vi.hoisted(()=>({unreadable:new Set<string>()}));
vi.mock('node:fs',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('node:fs')>();
 return {...actual,lstatSync:(p:Parameters<typeof actual.lstatSync>[0],options?:any)=>{
   if(mocked.unreadable.has(String(p)))throw Object.assign(new Error('UNKNOWN: unknown error, lstat '+String(p)),{code:'UNKNOWN',syscall:'lstat',path:String(p)});
   return actual.lstatSync(p,options);
 }};
});
const dirs:string[]=[];
afterEach(()=>{mocked.unreadable.clear();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const def:PanelDestination={kind:'community',customParent:null};
const stopped=()=>false;
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'fh-store-redirect-'));dirs.push(root);
 const wp=join(root,'WpSystem');
 const sid=join(wp,'S-1-5-21-123-456-789-1001');
 const packages=join(sid,'AppData','Local','Packages','Microsoft.Limitless_8wekyb3d8bbwe','LocalCache','Packages');
 const physical=join(packages,'Community2024');
 const logical=join(root,'local-cache','Packages','Community2024');
 mkdirSync(physical,{recursive:true});mkdirSync(join(root,'local-cache','Packages'),{recursive:true});
 symlinkSync(physical,logical,process.platform==='win32'?'junction':'dir');
 const bundle=join(root,'bundle');cpSync(resolve('panel/flaphappy-ingamepanel'),bundle,{recursive:true});
 return {root,wp,sid,packages,physical,logical,bundle};
}
describe('redirected MSFS 2024 Windows Store Community',()=>{
 it.skipIf(process.platform!=='win32')('does not require reading the protected WpSystem manifest for a verified default Community; installation, update and removal still verify the physical package',()=>{
  const f=fixture();
  mocked.unreadable.add(join(f.wp,'manifest.json'));
  const status=panelInstallStatus(f.bundle,def,f.logical);
  expect(status.state).toBe('not-installed');
  expect(status.target).toBe(join(f.physical,'flaphappy-ingamepanel'));
  expect(panelInstallStatus(f.bundle,{kind:'custom',customParent:f.logical},f.logical).destination.kind).toBe('community');
  expect(installCockpitPanel(f.bundle,def,f.logical,renameSync,stopped).ok).toBe(true);
  expect(panelInstallStatus(f.bundle,def,f.logical).state).toBe('up-to-date');
  const manifestFile=join(f.bundle,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  manifest.package_version='1.0.2';writeFileSync(manifestFile,JSON.stringify(manifest));
  expect(panelInstallStatus(f.bundle,def,f.logical).action).toBe('Update');
  expect(installCockpitPanel(f.bundle,def,f.logical,renameSync,stopped).ok).toBe(true);
  expect(panelInstallStatus(f.bundle,def,f.logical).installedVersion).toBe('1.0.2');
  expect(removeCockpitPanel(f.bundle,def,f.logical,renameSync,stopped).ok).toBe(true);
  expect(readdirSync(f.physical)).toEqual([]);
  expect(readdirSync(f.packages).some(n=>n.startsWith('.flaphappy-stage-'))).toBe(false);
 });
 it.skipIf(process.platform!=='win32')('still rejects a package ancestor and inaccessible non-system ancestors; custom targets remain fail-closed',()=>{
  const f=fixture();
  writeFileSync(join(f.packages,'manifest.json'),'{}');
  expect(panelInstallStatus(f.bundle,def,f.logical).state).toBe('conflict');
  unlinkSync(join(f.packages,'manifest.json'));
  writeFileSync(join(f.wp,'manifest.json'),'{}');
  expect(panelInstallStatus(f.bundle,def,f.logical).state).toBe('conflict');
  unlinkSync(join(f.wp,'manifest.json'));
  const unrelated=join(f.wp,'Unrelated','Community2024');mkdirSync(unrelated,{recursive:true});
  mocked.unreadable.add(join(f.wp,'manifest.json'));
  expect(panelInstallStatus(f.bundle,def,unrelated).state).toBe('unavailable');
  mocked.unreadable.clear();
  mocked.unreadable.add(join(f.sid,'manifest.json'));
  expect(panelInstallStatus(f.bundle,def,f.logical).state).toBe('unavailable');
  mocked.unreadable.clear();
  const library=join(f.wp,'custom-library');mkdirSync(library);
  mocked.unreadable.add(join(f.wp,'manifest.json'));
  const custom:PanelDestination={kind:'custom',customParent:library};
  expect(panelInstallStatus(f.bundle,custom,f.logical).state).toBe('unavailable');
  expect(installCockpitPanel(f.bundle,custom,f.logical,renameSync,stopped).ok).toBe(false);
  expect(existsSync(join(library,'flaphappy-ingamepanel'))).toBe(false);
 });
});
