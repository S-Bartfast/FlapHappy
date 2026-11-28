import type { DisplayUnitOverrides } from '../core/units';
import { defaultSettings, normalizeSettings } from '../core/settings';
import type { ActiveSession, CockpitState } from '../core/cockpit';
import type { ProfileStore, SimSample } from '../core/sim';
import type { Profile, Settings } from '../core/types';
import { initialBallast } from '../core/ballast';
import { clamp01 } from '../core/profile';
import { selectProfileId } from '../core/select';
import { validateProfile } from '../core/validate';
import { PRESETS } from '../profiles';
import { usesManualBallast } from '../core/weight';

/** Main-process session for both panels. It does not depend on a renderer. */
export class PanelRuntime {
  private state: CockpitState = { ready: false, profile: null, sample: null, receivedAt: 0, ballast: 0, units: 'kt', height:'ft', agl:defaultSettings().agl, zoom: 1, showBallast:true,showAgl:true,showTransitions:false,showWind:true,barShading:true };
  private title: string | null = null;
  private generation = 0;
  private sessionRevision = 0;
  private ballastByProfile: Record<string, number> = {};
  private writes: Promise<void> = Promise.resolve();
  private preferences: Settings = defaultSettings();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private store: ProfileStore,
    private setLvar: (name: string | null) => void,
    private notifySession: (session: ActiveSession) => void,
    private launchUnits: DisplayUnitOverrides = {},
  ) {}

  getState = (): CockpitState => this.state;

  getSession = (): ActiveSession => ({
    revision: this.sessionRevision, launchUnits: { ...this.launchUnits }, ready: this.state.ready, profile: this.state.profile, ballast: this.state.ballast,
  });

  private publishSession(): void {
    this.sessionRevision++;
    this.notifySession(this.getSession());
  }

  async initialize(): Promise<void> {
    const metas = await this.store.list();
    // Match the desktop first-run library behavior without touching existing profiles.
    let added = false;
    for (const preset of PRESETS) {
      if (metas.some(m => m.id === preset.id)) continue;
      await this.store.save({ ...preset.profile, source: 'user' });
      added = true;
    }
    const settings = await this.store.getSettings();
    this.ballastByProfile = { ...settings.ballast_by_profile };
    if (!settings.last_profile_id && added) {
      settings.last_profile_id = 'as33-18m';
      await this.store.setSettings(settings);
    }
    this.preferences = settings;
    this.applyDisplayPreferences();
    await this.refresh();
  }

  async settings(): Promise<Settings> {
    // Native window bounds can change outside this session; get the latest
    // main-owned values (FileProfileStore serves its cached copy).
    const { window, main_window } = await this.store.getSettings();
    return normalizeSettings({ ...this.preferences, window, main_window, ballast_by_profile: this.ballastByProfile });
  }

  private write(job: () => Promise<void>): Promise<void> {
    const next = this.writes.then(job);
    this.writes = next.catch(() => { /* callers handle failures; allow subsequent writes */ });
    return next;
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush().catch(e => console.error('Could not save panel settings', e));
    }, 500);
  }

  async flush(): Promise<void> {
    // A newer update can arrive during an in-flight write (including on close).
    // Keep draining until there is no pending state or queued write.
    for (;;) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.dirty) {
        const snapshot = normalizeSettings({ ...this.preferences, ballast_by_profile: this.ballastByProfile });
        this.dirty = false;
        await this.write(() => this.store.setSettings(snapshot)).catch(e => {
          this.dirty = true; // retry on the next change or explicit flush
          throw e;
        });
      }
      const tail = this.writes;
      await tail;
      if (!this.dirty && tail === this.writes) return;
    }
  }

  setLaunchUnits(units: DisplayUnitOverrides): void {
    if (!Object.keys(units).length) return;
    this.launchUnits = { ...this.launchUnits, ...units };
    this.applyDisplayPreferences();
    this.publishSession();
  }

  private applyDisplayPreferences(): void {
    const s = { ...this.preferences, ...this.launchUnits };
    this.state = { ...this.state, units: s.units, weightUnit: s.weight_unit, height: s.height, windUnit: s.wind_unit, agl: s.agl, zoom: s.ui.zoom,
      showBallast: s.ui.show_ballast, showAgl: s.ui.show_agl, simpleFlap: s.ui.simple_flap, groupHiddenFlapLabels: s.ui.group_hidden_flap_labels, autoHideExternal: s.ui.auto_hide_external, showTransitions: s.ui.show_transitions,
      showWind: s.ui.show_wind, barShading: s.ui.bar_shading };
  }

  async updateSettings(incoming: Settings, immediate = true): Promise<void> {
    const previous = this.preferences;
    // Settings requests from the renderer are display-only. Selection is
    // an explicit command, never an older renderer snapshot.
    const settings = normalizeSettings({
      ...previous, units: incoming.units, height: incoming.height, weight_unit: incoming.weight_unit, wind_unit: incoming.wind_unit, agl: incoming.agl, ui: incoming.ui,
      panel_destination: incoming.panel_destination,
    });
    settings.ballast_by_profile = previous.ballast_by_profile;
    settings.window = previous.window;
    settings.main_window = previous.main_window;
    if (JSON.stringify(settings) !== JSON.stringify(previous)) {
      this.preferences = settings;
      this.applyDisplayPreferences();
      this.schedulePersist();
    }
    if (immediate) await this.flush();
  }

  async selectProfile(id: string, manual: boolean): Promise<ActiveSession> {
    try { await this.store.load(id); } catch { return this.getSession(); }
    const activeByTitle = { ...this.preferences.active_by_title };
    if (manual && this.title) activeByTitle[this.title] = id;
    this.preferences = { ...this.preferences, last_profile_id: id, active_by_title: activeByTitle };
    this.schedulePersist();
    await this.refresh();
    await this.flush();
    return this.getSession();
  }

  async setBallast(f: number, profileId: string | null = this.state.profile?.id ?? null): Promise<boolean> {
    if (!profileId || !this.state.ready || this.state.profile?.id !== profileId || !usesManualBallast(this.state.profile) || typeof f !== 'number' || !isFinite(f)) return false;
    const fraction = clamp01(f);
    this.ballastByProfile[profileId] = fraction;
    this.state = { ...this.state, ballast: fraction };
    this.publishSession();
    this.schedulePersist();
    return true;
  }

  async refresh(): Promise<void> {
    const g = ++this.generation;
    const settings = this.preferences;
    const metas = await this.store.list();
    const id = selectProfileId(metas, settings, this.title);
    let profile: Profile | null = null;
    try { if (id) profile = await this.store.load(id); } catch { /* unavailable */ }
    if (g !== this.generation) return;
    const prior = this.state.profile;
    const sample = this.state.sample;
    const liveHandleCount = sample?.connected && sample.flapCount !== null && sample.flapCount > 0 ? sample.flapCount : null;
    const options = { liveHandleCount };
    if (profile && prior?.id === profile.id && validateProfile(prior, options).ok && !validateProfile(profile, options).ok) profile = prior;
    const ballast = profile ? initialBallast(profile, this.ballastByProfile[profile.id]).f : 0;
    const oldLvar = prior?.current_flap.lvar_name;
    this.state = { ...this.state, ready: true, profile, ballast };
    if (oldLvar !== profile?.current_flap.lvar_name) this.setLvar(profile?.current_flap.lvar_name ?? null);
    this.publishSession();
    if (profile && this.preferences.last_profile_id !== profile.id) {
      // Preserve display changes received while the profile was loading.
      this.preferences = { ...this.preferences, last_profile_id: profile.id };
      this.schedulePersist();
    }
  }

  resetSample(): void { this.state = { ...this.state, sample: null, receivedAt: 0 }; }

  sample(sample: SimSample, receivedAt: number): void {
    this.state = { ...this.state, sample, receivedAt };
    if (sample.connected && sample.aircraftTitle && sample.aircraftTitle !== this.title) {
      this.title = sample.aircraftTitle;
      this.state = { ...this.state, profile: null, ready: false, ballast: 0 };
      this.setLvar(null);
      this.publishSession();
      void this.refresh().catch(() => { /* remain unavailable rather than showing an old profile */ });
    }
  }
}
