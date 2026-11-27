import { describe, expect, it, vi } from 'vitest';
import { PanelRuntime } from '../../app-electron/panel-runtime';
import { parseCli } from '../../app-electron/cli';
import { MemoryProfileStore } from '../../adapters/simulated/memory-store';
import { defaultSettings, normalizeSettings } from '../../core/settings';
import { makeProfile, sample } from './helpers';

describe('main-process panel session', () => {
  it('keeps the main window mandatory and defaults the external-on-launch preference off', () => {
    expect(parseCli([])).toMatchObject({ quit: false });
    expect(parseCli(['--panel-only', '--source=replay'])).not.toHaveProperty('panelOnly');
    expect(parseCli(['--quit'])).toMatchObject({ quit: true });
    expect(defaultSettings().ui.external_panel_on_launch).toBe(false);
    expect(normalizeSettings({ schema: 'flaphappy.settings/1' }).ui.external_panel_on_launch).toBe(false);
    expect(normalizeSettings({ schema: 'flaphappy.settings/1', ui: { external_panel_on_launch: true } }).ui.external_panel_on_launch).toBe(true);
  });

  it('uses saved profiles and telemetry without a renderer, with preserved manual ballast', async () => {
    const p = makeProfile(2, { id: 'fixture' });
    p.weight_kg={light:null,heavy:null};
    const next = makeProfile(3, { id: 'next' });
    next.current_flap = { source: 'lvar', lvar_name: 'Flap test', manual_fallback: false };
    const store = new MemoryProfileStore([p, next]);
    const settings = await store.getSettings();
    settings.last_profile_id = p.id;
    settings.active_by_title['first'] = p.id;
    settings.active_by_title['second'] = next.id;
    settings.ballast_by_profile[p.id] = 0.25;
    await store.setSettings(settings);
    const setLvar = vi.fn();
    const notify = vi.fn();
    const runtime = new PanelRuntime(store, setLvar, notify);
    await runtime.initialize();
    expect(runtime.getState()).toMatchObject({ ready: true, profile: { id: p.id }, ballast: 0.25 });
    runtime.sample(sample({ aircraftTitle: 'first' }), 1200);
    await runtime.refresh();
    expect(runtime.getState()).toMatchObject({ sample: { iasKt: 70 }, receivedAt: 1200, profile: { id: p.id } });
    const staleDesktopSettings = await runtime.settings();
    await Promise.all([
      runtime.setBallast(0.5),
      runtime.updateSettings({ ...staleDesktopSettings, units: 'kmh' }),
      runtime.setBallast(0.75, p.id),
    ]);
    expect(runtime.getState()).toMatchObject({ units: 'kmh', ballast: 0.75 });
    await runtime.flush();
    expect((await store.getSettings()).ballast_by_profile[p.id]).toBe(0.75);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ profile:expect.objectContaining({id:p.id}), ballast:0.75 }));
    expect(await runtime.setBallast(0.15, 'other')).toBe(false);
    runtime.sample(sample({ aircraftTitle: 'second' }), 1300);
    expect(runtime.getState().ready).toBe(false);
    await runtime.refresh();
    expect(runtime.getState()).toMatchObject({ profile: { id: next.id }, receivedAt: 1300, ballast: next.ballast.default_fraction });
    expect(setLvar).toHaveBeenCalledWith('Flap test');
    expect(await runtime.setBallast(0.9,next.id)).toBe(false);
    expect((await runtime.settings()).ballast_by_profile[next.id]).toBeUndefined();
    const changedSettings=await runtime.settings();
    changedSettings.height='m';changedSettings.weight_unit='lb';changedSettings.agl={bottom_m:10,top_m:500,low_m:100,high_m:300};
    changedSettings.ui.show_agl=false;changedSettings.ui.show_wind=false;changedSettings.ui.show_transitions=true;changedSettings.ui.bar_shading=false;
    await runtime.updateSettings(changedSettings);
    runtime.sample(sample({aircraftTitle:'second',aglFt:600,windKt:17}),1400);
    expect(runtime.getState()).toMatchObject({height:'m',weightUnit:'lb',agl:changedSettings.agl,showAgl:false,showWind:false,showTransitions:true,barShading:false,sample:{aglFt:600,windKt:17}});
    expect((await runtime.settings()).last_profile_id).toBe(next.id);
    expect((await runtime.settings()).ballast_by_profile[p.id]).toBe(0.75);
    await runtime.flush();
  });

  it('coalesces drag updates, publishes immediately, avoids profile IO, and flushes on close', async () => {
    const profile = makeProfile(2, {id:'fixture'});
    profile.weight_kg = {light:null,heavy:null};
    const next = makeProfile(3, {id:'next'});
    const store = new MemoryProfileStore([profile,next]);
    const initial = await store.getSettings();
    initial.last_profile_id = profile.id;
    initial.active_by_title.first = profile.id;
    await store.setSettings(initial);
    const runtime = new PanelRuntime(store, vi.fn(), vi.fn());
    await runtime.initialize();
    await runtime.flush();
    const writes = vi.spyOn(store,'setSettings');
    const lists = vi.spyOn(store,'list');
    const loads = vi.spyOn(store,'load');
    vi.useFakeTimers();
    try {
      const stale = await runtime.settings();
      stale.last_profile_id=next.id; // deferred renderer snapshot must not change selection
      for(let i=1;i<=20;i++){
        const settings = {...stale,ui:{...stale.ui,zoom:1+i/20,opacity:1-i/40}};
        await runtime.updateSettings(settings,false);
        await runtime.setBallast(i/20, profile.id);
        await vi.advanceTimersByTimeAsync(10);
      }
      expect(runtime.getState()).toMatchObject({profile:{id:profile.id},zoom:2,ballast:1});
      expect((await runtime.settings()).ui.opacity).toBe(0.5);
      expect(writes).not.toHaveBeenCalled();
      expect(lists).not.toHaveBeenCalled();
      expect(loads).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(489);
      expect(writes).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(await store.getSettings()).toMatchObject({last_profile_id:profile.id,ui:{zoom:2,opacity:0.5},ballast_by_profile:{fixture:1}});

      const edited=await runtime.settings();
      edited.ui.zoom=1.4;
      await runtime.updateSettings(edited,false);
      expect(writes).toHaveBeenCalledTimes(1);
      await runtime.flush();
      expect(writes).toHaveBeenCalledTimes(2);
      expect((await store.getSettings()).ui.zoom).toBe(1.4);
      await vi.advanceTimersByTimeAsync(1000);
      expect(writes).toHaveBeenCalledTimes(2);
      expect(lists).not.toHaveBeenCalled();
      expect(loads).not.toHaveBeenCalled();

      const selected=await runtime.settings();
      selected.last_profile_id=next.id;
      await runtime.selectProfile(selected.last_profile_id!, true);
      expect(runtime.getState().profile?.id).toBe(next.id);
      expect(lists).toHaveBeenCalledTimes(1);
      expect(loads).toHaveBeenCalledTimes(2);
      expect((await store.getSettings()).last_profile_id).toBe(next.id);
    } finally { await runtime.flush(); vi.useRealTimers(); }
  });

  it('drains a newer preference arriving while a close-time write is in progress', async () => {
    const store=new MemoryProfileStore();
    const runtime=new PanelRuntime(store,vi.fn(),vi.fn());
    await runtime.initialize();
    await runtime.flush();
    const save=store.setSettings.bind(store);
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    let started!:()=>void;
    const begin=new Promise<void>(resolve=>{started=resolve;});
    let releaseSecond!:()=>void;
    const secondGate=new Promise<void>(resolve=>{releaseSecond=resolve;});
    let startedSecond!:()=>void;
    const secondBegin=new Promise<void>(resolve=>{startedSecond=resolve;});
    const writes=vi.spyOn(store,'setSettings').mockImplementationOnce(async s=>{
      started();await gate;await save(s);
    }).mockImplementationOnce(async s=>{
      startedSecond();await secondGate;await save(s);
    });
    const first=await runtime.settings();first.ui.zoom=1.2;
    await runtime.updateSettings(first,false);
    const closing=runtime.flush();
    await begin;
    const last=await runtime.settings();last.ui.zoom=1.7;
    await runtime.updateSettings(last,false);
    const secondFlush=runtime.flush();
    let finished=false;void closing.then(()=>{finished=true;});
    release();
    await secondBegin;
    expect(finished).toBe(false);
    releaseSecond();
    await Promise.all([closing,secondFlush]);
    expect(writes).toHaveBeenCalledTimes(2);
    expect((await store.getSettings()).ui.zoom).toBe(1.7);
  });

  it('publishes one active profile and preserves the last valid version of the profile across invalid edits', async () => {
    const first=makeProfile(2,{id:'first'}), second=makeProfile(3,{id:'second'});
    const store=new MemoryProfileStore([first,second]);
    const settings=await store.getSettings();
    settings.last_profile_id=first.id;settings.active_by_title['A']=first.id;settings.active_by_title['B']=second.id;
    await store.setSettings(settings);
    const notify=vi.fn();
    const runtime=new PanelRuntime(store,vi.fn(),notify);
    await runtime.initialize();
    runtime.sample(sample({aircraftTitle:'B',flapCount:2}),1200);
    expect(runtime.getSession()).toMatchObject({ready:false,profile:null});
    await runtime.refresh();
    const active=runtime.getSession();
    expect(active).toMatchObject({ready:true,profile:{id:second.id}});
    expect(notify).toHaveBeenLastCalledWith(active);
    expect(active.profile).toEqual(runtime.getState().profile);
    const invalid=await store.load(second.id);invalid.transitions[0].no_ballast_kt=null;
    await store.save(invalid);
    await runtime.refresh();
    expect(runtime.getSession().profile).toEqual(active.profile);
    expect(runtime.getState().profile).toEqual(active.profile);
    expect(runtime.getSession().revision).toBeGreaterThan(active.revision);
    const savedFirst=await store.load(first.id);savedFirst.flaps[0].label='changed';await store.save(savedFirst);
    await runtime.refresh();
    expect(runtime.getState().profile?.id).toBe(second.id);
    expect((await runtime.settings()).active_by_title.B).toBe(second.id);
    await runtime.selectProfile(first.id,true);
    expect(runtime.getSession().profile?.id).toBe(first.id);
    expect((await store.getSettings()).active_by_title.B).toBe(first.id);
    await runtime.flush();
  });

  it('seeds only missing built-in profiles on first run', async () => {
    const store = new MemoryProfileStore();
    const runtime = new PanelRuntime(store, () => {}, () => {});
    await runtime.initialize();
    expect((await store.list()).map(p => p.id).sort()).toEqual(['as33-15m','as33-18m','js3']);
    expect(runtime.getState()).toMatchObject({ ready: true, profile: { id: 'as33-18m' }, sample: null });
    const original = await store.load('as33-18m');
    original.notes = 'existing fixture';
    await store.save(original);
    await runtime.initialize();
    expect((await store.load('as33-18m')).notes).toBe('existing fixture');
  });
});
