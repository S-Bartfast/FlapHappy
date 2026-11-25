import { describe, expect, it } from 'vitest';
import { liveWeight } from '../../core/weight';
import { buildDisplayModel } from '../../core/display-model';
import { validateProfile } from '../../core/validate';
import { exportProfileJson, parseProfileJson } from '../../core/profile';
import { CurrentFlapResolver } from '../../core/flapmap';
import { makeProfile, sample } from './helpers';

describe('loaded flying weight', () => {
  const p = makeProfile(2);
  it('clamps the interpolation, not the actual reading', () => {
    for (const [kg, fraction] of [[250, 0], [400, 0], [500, 0.5], [600, 1], [800, 1]]) {
      expect(liveWeight(p, sample({ totalWeightKg: kg }), true)).toEqual({ kg, fraction, anchorsValid: true });
    }
  });
  it('does not use a fake value for invalid, stale, or missing weight', () => {
    for (const kg of [null, NaN, Infinity, -5, 0]) {
      expect(liveWeight(p, sample({ totalWeightKg: kg }), true).fraction).toBeNull();
    }
    expect(liveWeight(p, sample({ totalWeightKg: 550 }), false).kg).toBeNull();
    const legacy = makeProfile(2);
    legacy.weight_kg = { light: null, heavy: null };
    expect(liveWeight(legacy, sample({ totalWeightKg: 550 }), true)).toEqual({ kg: 550, fraction: null, anchorsValid: false });
  });
  it('preserves legacy speed data and roundtrips explicit anchors', () => {
    const raw = JSON.parse(exportProfileJson(p));
    delete raw.weight_kg;
    const legacy = parseProfileJson(JSON.stringify(raw)).profile!;
    expect(legacy.weight_kg).toEqual({ light: null, heavy: null });
    expect(JSON.parse(exportProfileJson(legacy)).transitions).toEqual(raw.transitions);
    expect(parseProfileJson(exportProfileJson(p)).profile?.weight_kg).toEqual(p.weight_kg);
  });
  it('uses the same weight-derived boundaries for both display callers', () => {
    const build = (kg: number | null, link: 'live' | 'nodata') => {
      const s = sample({ totalWeightKg: kg });
      return buildDisplayModel({ profile: p, validation: validateProfile(p), sample: s, link, ias: s.iasKt, flap: new CurrentFlapResolver().resolve(p, s, 1000) });
    };
    expect(build(300, 'live').boundaries).toEqual([40, 52, 82]);
    expect(build(500, 'live').boundaries).toEqual([45, 59, 82]);
    expect(build(700, 'live').boundaries).toEqual([50, 66, 82]);
    expect(build(null, 'live').barVisible).toBe(false);
    expect(build(500, 'nodata').barVisible).toBe(false);
  });
});
