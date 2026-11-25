import type { Profile } from './types';
import type { SimSample } from './sim';

/** Live display state published by the active desktop or panel-only session. */
export interface CockpitState {
  ready: boolean;
  profile: Profile | null;
  sample: SimSample | null;
  /** When the session last received `sample`, in ms. */
  receivedAt: number;
  ballast: number;
  units: 'kt' | 'kmh';
  zoom: number;
}

export const COCKPIT_PORT = 47321;
