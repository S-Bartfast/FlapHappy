import type { Profile } from './types';
import { clamp01 } from './profile';

export interface BallastState {
  /** 0 = None, 1 = Max. */
  f: number;
  /** True until the pilot touches the slider once (first use or restored value). */
  unconfirmed: boolean;
  /** Value came from a stored setting. */
  restored: boolean;
}

export function snapFraction(f: number, snap: number): number {
  const c = clamp01(f);
  if (!(snap > 0)) return c;
  return clamp01(Math.round(c / snap) * snap);
}

/** Slider starts at the last saved position, or the profile default when none has been saved. */
export function initialBallast(p: Profile, stored: number | undefined): BallastState {
  if (typeof stored === 'number' && isFinite(stored)) return { f: clamp01(stored), unconfirmed: true, restored: true };
  return { f: clamp01(p.ballast.default_fraction), unconfirmed: true, restored: false };
}

export function ballastReadout(p: Profile, f: number): string {
  const pct = Math.round(clamp01(f) * 100) + '%';
  const l = p.ballast.max_ballast_litres;
  if (l !== null && l > 0) return `${pct} ${Math.round(clamp01(f) * l)} L`;
  return pct;
}
