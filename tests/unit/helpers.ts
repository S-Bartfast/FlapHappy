import { createBlankProfile } from '../../core/profile';
import type { Profile } from '../../core/types';
import { emptySample, type SimSample } from '../../core/sim';

/** Valid N-row profile: row k has handle index N-1-k, bucket widths of 12 kt (no ballast) / 16 kt (max), and one VNE above both. */
export function makeProfile(n: number, opts: { id?: string } = {}): Profile {
  const p = createBlankProfile(opts.id ?? `test-${n}`);
  for (let i = 0; i < n; i++) {
    p.flaps.push({ label: String(i + 1) });
  }
  p.weight_kg = { light: 400, heavy: 600 };
  p.vs_min = { no_ballast_kt: 40, max_ballast_kt: 50 };
  for (let k = 1; k < n; k++) p.transitions.push({ no_ballast_kt: 40 + 12 * k, max_ballast_kt: 50 + 16 * k });
  const topMax = n >= 1 ? 50 + 16 * n : 120;
  p.vne = topMax;
  p.handle_count = Math.max(n, 1);
  return p;
}

export function sample(over: Partial<SimSample> = {}): SimSample {
  return { ...emptySample(1000), connected: true, inFlight: true, iasKt: 70, totalWeightKg: 400, onGround: false, flapIndex: 0, flapCount: 6, flapPercent: 0, aircraftTitle: 'Test glider', ...over };
}
