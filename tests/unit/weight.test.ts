import { describe, expect, it } from 'vitest';
import { canSaveWeightMode, liveWeight, profileForWeightMode, weightModeForProfile } from '../../core/weight';
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
  it('uses manual ballast only for profiles without both weight anchors', () => {
    const build = (profile: ReturnType<typeof makeProfile>, link: 'live' | 'nodata', kg: number | null, manualBallast: number) => {
      const s = sample({ totalWeightKg: kg });
      return buildDisplayModel({ profile, validation: validateProfile(profile), sample: s, link, ias: s.iasKt,
        flap: new CurrentFlapResolver().resolve(profile, s, 1000), manualBallast });
    };
    for (const anchors of [{light: null, heavy: null}, {light: 400, heavy: null}, {light: null, heavy: 600}]) {
      const legacy = makeProfile(2);
      legacy.weight_kg = anchors;
      expect(validateProfile(legacy).ok).toBe(true);
      expect(build(legacy, 'live', 800, 0.5).boundaries).toEqual([45, 59, 82]);
      expect(build(legacy, 'nodata', null, 0.5).boundaries).toEqual([45, 59, 82]);
      expect(build(legacy, 'nodata', null, 0.5).marker.pos).toBeNull();
    }
    expect(build(p, 'live', 400, 1).boundaries).toEqual([40, 52, 82]);
    expect(build(p, 'nodata', 600, 1).boundaries).toBeNull();
    expect(build(p, 'live', null, 1).boundaries).toBeNull();
    const invalid = makeProfile(2); invalid.weight_kg = { light: 600, heavy: 400 };
    expect(validateProfile(invalid).ok).toBe(false);
    expect(build(invalid, 'live', 500, 0.5).barVisible).toBe(false);
  });

  it('requires both anchors only when live weight has been explicitly selected in the editor', () => {
    const p = makeProfile(2);
    expect(weightModeForProfile(p)).toBe('live');
    const manual = profileForWeightMode(p, 'manual');
    expect(manual.weight_kg).toEqual({ light: null, heavy: null });
    expect(p.weight_kg).toEqual({ light: 400, heavy: 600 });
    expect(weightModeForProfile(manual)).toBe('manual');
    expect(canSaveWeightMode(manual, 'manual')).toBe(true);
    expect(canSaveWeightMode(manual, 'live')).toBe(false);
    expect(validateProfile(manual).ok).toBe(true);
    expect(validateProfile(manual, { requireWeightAnchors: true }).errors.map(e => e.code)).toEqual(['weight-light-required', 'weight-heavy-required']);
    manual.weight_kg.light = 400;
    expect(canSaveWeightMode(manual, 'live')).toBe(false);
    expect(profileForWeightMode(manual, 'manual').weight_kg.light).toBe(400); // retain an untouched legacy partial anchor
    manual.weight_kg.heavy = 400;
    expect(canSaveWeightMode(manual, 'live')).toBe(false);
    manual.weight_kg.heavy = 600;
    expect(canSaveWeightMode(manual, 'live')).toBe(true);
  });

});
