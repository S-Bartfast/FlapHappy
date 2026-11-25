import type { CockpitState } from '../core/cockpit';
import type { ProfileStore, SimSample } from '../core/sim';
import type { Profile, Settings } from '../core/types';
import { initialBallast } from '../core/ballast';
import { clamp01 } from '../core/profile';
import { selectProfileId } from '../core/select';
import { validateProfile } from '../core/validate';
import { PRESETS } from '../profiles';

/** Main-process session for both panels. It does not depend on a renderer. */
export class PanelRuntime {
  private state: CockpitState = { ready: false, profile: null, sample: null, receivedAt: 0, ballast: 0, units: 'kt', zoom: 1 };
  private title: string | null = null;
  private generation = 0;
  private ballastByProfile: Record<string, number> = {};
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private store: ProfileStore,
    private setLvar: (name: string | null) => void,
    private notifyBallast: (profileId: string, f: number) => void,
  ) {}

  getState = (): CockpitState => this.state;

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
    await this.refresh();
  }

  async settings(): Promise<Settings> {
    const settings = await this.store.getSettings();
    return { ...settings, ballast_by_profile: { ...this.ballastByProfile } };
  }

  private write(job: () => Promise<void>): Promise<void> {
    const next = this.writes.then(job);
    this.writes = next.catch(() => { /* callers handle failures; allow subsequent writes */ });
    return next;
  }

  flush(): Promise<void> { return this.writes; }

  async updateSettings(settings: Settings): Promise<void> {
    // The main session owns ballast; a renderer's older copy cannot overwrite a panel adjustment.
    await this.write(() => this.store.setSettings({ ...settings, ballast_by_profile: { ...this.ballastByProfile } }));
    await this.refresh();
  }

  async setBallast(f: number, profileId: string | null = this.state.profile?.id ?? null): Promise<boolean> {
    if (!profileId || this.state.profile?.id !== profileId || typeof f !== 'number' || !isFinite(f)) return false;
    const fraction = clamp01(f);
    this.ballastByProfile[profileId] = fraction;
    this.state = { ...this.state, ballast: fraction };
    this.notifyBallast(profileId, fraction);
    await this.write(async () => {
      const settings = await this.settings();
      await this.store.setSettings(settings);
    });
    return true;
  }

  async refresh(): Promise<void> {
    const g = ++this.generation;
    const settings = await this.settings();
    const metas = await this.store.list();
    const id = selectProfileId(metas, settings, this.title);
    let profile: Profile | null = null;
    try { if (id) profile = await this.store.load(id); } catch { /* unavailable */ }
    if (g !== this.generation) return;
    const prior = this.state.profile;
    if (profile && prior?.id === profile.id && validateProfile(prior).ok && !validateProfile(profile).ok) profile = prior;
    const ballast = profile ? initialBallast(profile, this.ballastByProfile[profile.id]).f : 0;
    const oldLvar = prior?.current_flap.lvar_name;
    const changed = prior?.id !== profile?.id || this.state.ballast !== ballast;
    this.state = { ...this.state, ready: true, profile, ballast, units: settings.units, zoom: settings.ui.zoom };
    if (oldLvar !== profile?.current_flap.lvar_name) this.setLvar(profile?.current_flap.lvar_name ?? null);
    if (changed && profile) this.notifyBallast(profile.id, ballast);
    if (profile && settings.last_profile_id !== profile.id) {
      const selectedId = profile.id;
      await this.write(async () => {
        if (g !== this.generation) return;
        const latest = await this.settings();
        // Do not overwrite a newer explicit selection arriving while this profile loaded.
        if (g !== this.generation || latest.last_profile_id !== settings.last_profile_id) return;
        latest.last_profile_id = selectedId;
        await this.store.setSettings(latest);
      });
    }
  }

  resetSample(): void { this.state = { ...this.state, sample: null, receivedAt: 0 }; }

  sample(sample: SimSample, receivedAt: number): void {
    this.state = { ...this.state, sample, receivedAt };
    if (sample.connected && sample.aircraftTitle && sample.aircraftTitle !== this.title) {
      this.title = sample.aircraftTitle;
      this.state = { ...this.state, profile: null, ready: false, ballast: 0 };
      void this.refresh().catch(() => { /* remain unavailable rather than showing an old profile */ });
    }
  }
}
