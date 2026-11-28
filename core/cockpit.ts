import type { Profile } from './types';
import type { SimSample } from './sim';

/** Authoritative active profile/ballast snapshot, separate from any editor draft. */
export interface ActiveSession {
  revision: number;
  ready: boolean;
  profile: Profile | null;
  ballast: number;
}

/** Live display state published by the main process for the shared in-sim and external display. */
export interface CockpitState {
  ready: boolean;
  profile: Profile | null;
  sample: SimSample | null;
  /** When the session last received `sample`, in ms. */
  receivedAt: number;
  /** Manual ballast fraction (ignored for profiles with valid loaded-weight anchors). */
  ballast: number;
  units: 'kt' | 'kmh';
  height: 'ft' | 'm';
  weightUnit?: 'kg' | 'lb';
  /** AGL bar ends and the green band, in feet. */
  agl: { bottom_m: number; top_m: number; low_m: number; high_m: number };
  zoom: number;
  showBallast: boolean;
  showAgl: boolean;
  /** Missing on an older desktop app means ordinary ribbon mode. */
  simpleFlap?: boolean;
  groupHiddenFlapLabels?: boolean;
  showTransitions: boolean;
  showWind: boolean;
  /** Cylinder shading on the IAS and AGL fills. Missing means on. */
  barShading: boolean;
}

export const COCKPIT_PORT = 47321;
