import { describe, expect, it } from 'vitest';
import { buildDisplayModel, deriveLink, STALE_MS } from '../../core/display-model';
import { CurrentFlapResolver } from '../../core/flapmap';
import { validateProfile } from '../../core/validate';
import { createBlankProfile } from '../../core/profile';
import { effectiveBoundaries } from '../../core/scale';
import { initialBallast, ballastReadout, snapFraction } from '../../core/ballast';
import { defaultSettings, normalizeSettings } from '../../core/settings';
import { selectProfileId } from '../../core/select';
import { makeProfile, sample } from './helpers';
import type { SimSample } from '../../core/sim';
import { SETTINGS_SCHEMA, type Profile, type ProfileMeta } from '../../core/types';

function model(p: Profile | null, s: SimSample | null, f = 0, link = 'live' as 'live' | 'waiting' | 'nodata' | 'paused', ias?: number | null) {
  const v = p ? validateProfile(p) : null;
  const flap = p ? new CurrentFlapResolver().resolve(p, s, 1000) : ({ status: 'unknown', rowIndex: null, label: null, handleIndex: null, via: null } as const);
  return buildDisplayModel({ profile: p, validation: v, sample: s ? { ...s, totalWeightKg: 400 + f * 200 } : null, link, ias: ias ?? null, flap });
}

describe('display model', () => {
  it('has N cells, N + 1 ticks, and exactly one current cell for N = 1, 2, 6, 10', () => {
    for (const n of [1, 2, 6, 10]) {
      const p = makeProfile(n);
      for (let row = 0; row < n; row++) {
        const m = model(p, sample({ flapIndex: row, flapCount: n, iasKt: 60 }));
        expect(m.cells).toHaveLength(n);
        expect(m.ticks).toHaveLength(n + 1);
        expect(m.edges).toHaveLength(n + 1);
        expect(m.cells.filter((c) => c.state === 'current')).toHaveLength(1);
        expect(m.currentRow).toBe(row);
      }
    }
  });

  it('highlights only the current flap even when the marker is over another column', () => {
    const p = makeProfile(6);
    const b = effectiveBoundaries(p, 0)!;
    const m = model(p, sample({ flapIndex: 1, flapCount: 6, iasKt: (b[4] + b[5]) / 2 }));
    expect(m.currentRow).toBe(1);
    expect(m.marker.pos).toBeGreaterThan(m.edges![4]);
    expect(m.marker.pos).toBeLessThan(m.edges![5]);
  });

  it('ticks follow the ballast fraction', () => {
    const p = makeProfile(2);
    expect(model(p, sample({ flapCount: 2 }), 0).ticks).toEqual(['40', '52', '82']);
    expect(model(p, sample({ flapCount: 2 }), 1).ticks).toEqual(['50', '66', '82']);
  });

  it('FLAP ? badge when unreadable, with the bar and marker still working', () => {
    const p = makeProfile(3);
    const m = model(p, sample({ flapIndex: null, flapPercent: null, flapCount: 3, iasKt: 60 }));
    expect(m.badge).toEqual({ kind: 'unknown', text: 'FLAP ?' });
    expect(m.currentRow).toBeNull();
    expect(m.cells.every((c) => c.state === 'other')).toBe(true);
    expect(m.marker.pos).not.toBeNull();
  });

  it('an index that is not on a row shows #index and no highlighted cell', () => {
    const p = makeProfile(3);
    const m = model(p, sample({ flapIndex: 3, flapCount: 4, iasKt: 60 }));
    expect(m.badge).toEqual({ kind: 'other', text: '#3' });
    expect(m.cells.filter((c) => c.state === 'current')).toHaveLength(0);
  });

  it('off-scale IAS pins the marker and raises LOW / FAST', () => {
    const p = makeProfile(3);
    const lowInFlight = model(p, sample({ iasKt: 30, flapCount: 3 }));
    expect(lowInFlight.marker.pos).toBe(0);
    expect(lowInFlight.alert).toBe('LOW');
    const fast = model(p, sample({ iasKt: 200, flapCount: 3 }));
    expect(fast.marker.pos).toBe(1);
    expect(fast.alert).toBe('FAST');
  });

  it('greys the bar and hides the marker on the ground or below 25 kt', () => {
    const p = makeProfile(3);
    expect(model(p, sample({ onGround: true, iasKt: 60, flapCount: 3 })).marker).toEqual({ pos: null, region: null, greyed: true });
    expect(model(p, sample({ iasKt: 10, flapCount: 3 })).marker.greyed).toBe(true);
  });

  it('link states: waiting, no data, paused', () => {
    const p = makeProfile(3);
    expect(model(null, null, 0, 'waiting').statusText).toBe('Waiting for MSFS...');
    expect(model(p, sample(), 0, 'nodata').statusText).toBe('No data');
    expect(model(p, sample(), 0, 'nodata').iasText).toBe('--- kt');
    expect(model(p, sample({ inFlight: false }), 0, 'paused').statusText).toMatch(/Paused/);
    expect(model(p, sample(), 0, 'waiting').currentRow).toBeNull();
  });

  it('deriveLink: stale data becomes no data after 1.5 s', () => {
    const s = sample();
    expect(deriveLink(null, 0, 0)).toBe('waiting');
    expect(deriveLink(sample({ connected: false }), 0, 0)).toBe('waiting');
    expect(deriveLink(s, 1000, 1000 + STALE_MS)).toBe('live');
    expect(deriveLink(s, 1000, 1000 + STALE_MS + 1)).toBe('nodata');
    expect(deriveLink(sample({ inFlight: false }), 1000, 1100)).toBe('paused');
  });

  it('incomplete profile: no bar, message, but cells and the current flap still work', () => {
    const p = makeProfile(6);
    p.vs_min.no_ballast_kt = null;
    const m = model(p, sample({ flapIndex: 0, flapCount: 6 }));
    expect(m.mode).toBe('incomplete');
    expect(m.barVisible).toBe(false);
    expect(m.incompleteMessage).toBe('profile incomplete: open settings');
    expect(m.currentRow).toBe(0);
    expect(m.cells.filter((c) => c.state === 'current')).toHaveLength(1);
  });

  it('N = 0 is "no flaps" with an unsegmented bar when Vs and Vne are set', () => {
    const p = createBlankProfile();
    p.weight_kg = { light: 400, heavy: 600 };
    p.vs_min = { no_ballast_kt: 40, max_ballast_kt: 40 };
    p.vne = 120;
    const m = model(p, sample({ iasKt: 80 }));
    expect(m.mode).toBe('noflaps');
    expect(m.cells).toHaveLength(0);
    expect(m.barVisible).toBe(true);
    expect(m.edges).toEqual([0, 1]);
    expect(m.marker.pos).toBeCloseTo(0.5, 5);
  });

  it('optional VFE overlay turns on only for the current flap above its placard', () => {
    const p = makeProfile(3);
    p.flaps[0].vfe_kt = 50;
    p.display.vfe_overlay = true;
    const m = model(p, sample({ flapIndex: 0, flapCount: 3, iasKt: 60 }));
    expect(m.cells.map((c) => c.overVfe)).toEqual([true, false, false]);
    p.display.vfe_overlay = false;
    expect(model(p, sample({ flapIndex: 0, flapCount: 3, iasKt: 60 })).cells[0].overVfe).toBe(false);
  });

  it('shows raw IAS in the readout and the smoothed value drives the marker', () => {
    const p = makeProfile(2);
    const m = model(p, sample({ iasKt: 104.2, flapCount: 2 }), 0, 'live', 46);
    expect(m.iasText).toBe('104 kt');
    expect(m.marker.pos).toBeCloseTo((46 - 40) / (82 - 40), 8);
  });

  it('km/h converts the readout and the tick numbers from knots', () => {
    const p = makeProfile(2);
    const m = buildDisplayModel({
      profile: p,
      validation: validateProfile(p),
      sample: sample({ iasKt: 100, flapCount: 2 }),
      link: 'live',
      ias: null,
      flap: new CurrentFlapResolver().resolve(p, sample({ iasKt: 100, flapCount: 2 }), 1000),
      units: 'kmh',
    });
    expect(m.iasText).toBe('185 km/h');
    expect(m.ticks![0]).toBe(String(Math.round(40 * 1.852)));
  });
});

describe('ballast state, settings and selection', () => {
  it('snaps and clamps the fraction', () => {
    expect(snapFraction(0.52, 0.05)).toBeCloseTo(0.5, 10);
    expect(snapFraction(1.4, 0.05)).toBe(1);
    expect(snapFraction(-1, 0.05)).toBe(0);
    expect(snapFraction(0.123, 0)).toBeCloseTo(0.123, 10);
  });

  it('starts at the last saved ballast, or the default when none is saved', () => {
    const p = makeProfile(2);
    expect(initialBallast(p, undefined)).toEqual({ f: 1, unconfirmed: true, restored: false });
    expect(initialBallast(p, 0.6)).toEqual({ f: 0.6, unconfirmed: true, restored: true });
    p.ballast.default_fraction = 0.25;
    expect(initialBallast(p, undefined).f).toBe(0.25);
    expect(initialBallast(p, 0.6).f).toBe(0.6);
  });

  it('readout shows percent and optional litres', () => {
    const p = makeProfile(2);
    expect(ballastReadout(p, 0.6)).toBe('60%');
    p.ballast.max_ballast_litres = 200;
    expect(ballastReadout(p, 0.6)).toBe('60% 120 L');
  });

  it('normalises settings tolerantly', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    const s = normalizeSettings({ schema: SETTINGS_SCHEMA, ballast_by_profile: { a: 3, b: 'x' }, ui: { opacity: 0.1, zoom: 9, compact: true }, window: { x: 1, y: 2, width: 3, height: 4 }, active_by_title: { t: 'p', u: 4 } });
    expect(s.ballast_by_profile).toEqual({ a: 1 });
    expect(s.ui).toMatchObject({ opacity: 0.3, zoom: 3, compact: true });
    expect(s.window).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(s.active_by_title).toEqual({ t: 'p' });
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, units: 'kmh' }).units).toBe('kmh');
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, units: 'mph' }).units).toBe('kt');
    expect(normalizeSettings({ schema: 'flaphappy.settings/0', units: 'kmh' })).toEqual(defaultSettings());
  });

  it('auto-selects by remembered choice, then title match, then last used', () => {
    const m = (id: string, match: string[], incomplete = false): ProfileMeta => ({ id, filename: id + '.json', incomplete, match, source: 'user' });
    const metas = [m('a', ['AS 33'], true), m('b', ['AS 33']), m('c', ['JS3'])];
    const st = defaultSettings();
    expect(selectProfileId(metas, st, 'Got Friends AS 33 Me')).toBe('b');
    st.active_by_title['Got Friends AS 33 Me'] = 'a';
    expect(selectProfileId(metas, st, 'Got Friends AS 33 Me')).toBe('a');
    expect(selectProfileId(metas, st, 'Unknown glider')).toBe('a');
    st.last_profile_id = 'c';
    expect(selectProfileId(metas, st, 'Unknown glider')).toBe('c');
    expect(selectProfileId([], st, 'x')).toBeNull();
  });
});
