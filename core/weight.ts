import type { Profile } from './types';
import type { SimSample } from './sim';

export interface WeightState {
  kg: number | null;
  fraction: number | null;
  anchorsValid: boolean;
}

export function validWeightAnchors(p: Profile | null): boolean {
  const light = p?.weight_kg?.light;
  const heavy = p?.weight_kg?.heavy;
  return typeof light === 'number' && isFinite(light) && light > 0 &&
    typeof heavy === 'number' && isFinite(heavy) && heavy > light;
}

/** Clamp the interpolation only; keep the actual flying weight unchanged for display. */
export function liveWeight(p: Profile | null, sample: SimSample | null, live: boolean): WeightState {
  const raw = sample?.totalWeightKg;
  const kg = live && typeof raw === 'number' && isFinite(raw) && raw > 0 ? raw : null;
  const anchorsValid = validWeightAnchors(p);
  let fraction: number | null = null;
  if (kg !== null && p && anchorsValid) {
    const light = p.weight_kg.light as number;
    const heavy = p.weight_kg.heavy as number;
    fraction = Math.max(0, Math.min(1, (kg - light) / (heavy - light)));
  }
  return { kg, fraction, anchorsValid };
}
