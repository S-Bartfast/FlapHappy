import { expect, it } from 'vitest';
import { parseCli } from '../../app-electron/cli';
import { PanelRuntime } from '../../app-electron/panel-runtime';
import { MemoryProfileStore } from '../../adapters/simulated/memory-store';
import { defaultSettings, normalizeSettings } from '../../core/settings';
import { formatIas, formatWind, knotsToUnit, unitToKnots } from '../../core/units';

it('accepts each startup option and keeps standalone defaults and conversion precision', () => {
  expect(parseCli(['--airspeed-unit=mph','--weight-unit','lb','--altitude-unit=m','--wind-unit=mps']).displayUnits).toEqual({units:'mph',weight_unit:'lb',height:'m',wind_unit:'mps'});
  expect(parseCli(['--airspeed-unit=bad','--weight-unit=bad','--altitude-unit=bad','--wind-unit=bad']).displayUnits).toEqual({});
  expect(normalizeSettings({schema:'flaphappy.settings/1',units:'kmh'})).toMatchObject({units:'kmh',weight_unit:'kg',wind_unit:'auto'});
  expect(formatIas(100,'mph')).toBe('115 mph');
  expect(formatWind(20,'mps','mph')).toBe('10.3 m/s');
  expect(formatWind(20,'auto','kmh')).toBe('37 km/h');
  expect(unitToKnots(knotsToUnit(73.2,'mph'),'mph')).toBeCloseTo(73.2);
});
it('overlays session units without changing standalone preferences', async()=>{
 const store=new MemoryProfileStore();const saved=defaultSettings();saved.units='kmh';await store.setSettings(saved);
 const runtime=new PanelRuntime(store,()=>{},()=>{},{units:'mph',height:'m',weight_unit:'lb',wind_unit:'mps'});
 await runtime.initialize();expect(runtime.getState()).toMatchObject({units:'mph',height:'m',weightUnit:'lb',windUnit:'mps'});
 expect(runtime.getSession().launchUnits).toMatchObject({units:'mph',height:'m'});
 const changed=await runtime.settings();changed.ui.show_agl=false;await runtime.updateSettings(changed);
 expect(await store.getSettings()).toMatchObject({units:'kmh',height:'ft',weight_unit:'kg',wind_unit:'auto',ui:{show_agl:false}});
 runtime.setLaunchUnits({wind_unit:'kt'});expect(runtime.getState()).toMatchObject({units:'mph',height:'m',weightUnit:'lb',windUnit:'kt'});
 runtime.setLaunchUnits({});expect(runtime.getState().windUnit).toBe('kt');
 const standalone=new PanelRuntime(store,()=>{},()=>{});await standalone.initialize();expect(standalone.getState()).toMatchObject({units:'kmh',height:'ft',weightUnit:'kg',windUnit:'auto'});
});
