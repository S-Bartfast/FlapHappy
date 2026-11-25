import type { Profile } from './types';
import type { SimSample } from './sim';

/** Live display state the desktop app publishes for the in-sim cockpit panel. */
export interface CockpitState {
  ready: boolean;
  profile: Profile | null;
  sample: SimSample | null;
  /** When the desktop app last received `sample`, in ms. */
  receivedAt: number;
  /** Manual ballast fraction (ignored for profiles with valid loaded-weight anchors). */
  ballast: number;
  units: 'kt' | 'kmh';
  zoom: number;
}

export const COCKPIT_PORT = 47321;
