import { describe, expect, it } from 'vitest';
import { CurrentFlapResolver } from '../../core/flapmap';
import { makeProfile, sample } from './helpers';
import { createBlankProfile } from '../../core/profile';

const p6 = () => {
  const p = makeProfile(6);
  p.handle_count = 8;
  return p;
};
// Row k: handle index k. Percent follows the same index across 8 lever positions.
const at = (idx: number | null, extra: Record<string, unknown> = {}) =>
  sample({ flapIndex: idx, flapCount: 8, flapPercent: idx === null ? null : idx / 7, ...extra });

describe('current flap resolution', () => {
  it('maps the live index to exactly one row for every row', () => {
    const r = new CurrentFlapResolver();
    const p = p6();
    for (let i = 0; i < 6; i++) {
      const f = r.resolve(p, at(i), 1000 + i * 100);
      expect(f).toMatchObject({ status: 'row', rowIndex: i, label: String(i + 1), via: 'index' });
    }
  });

  it('an index that is not on a row shows #index and no highlighted row', () => {
    const r = new CurrentFlapResolver();
    expect(r.resolve(p6(), at(7), 0)).toMatchObject({ status: 'unlisted', rowIndex: null, label: '#7' });
    const q = makeProfile(3);
    expect(r.resolve(q, at(5, { flapCount: 8 }), 0)).toMatchObject({ status: 'unlisted', rowIndex: null, label: '#5' });
  });

  it('does not depend on lever direction: the mapping is in the profile', () => {
    const p = makeProfile(3);
    p.flaps[0].handle_index = 2;
    p.flaps[2].handle_index = 0;
    const f = new CurrentFlapResolver().resolve(p, at(2, { flapCount: 3 }), 0);
    expect(f.rowIndex).toBe(0);
  });

  it('missing index falls back to percent', () => {
    const f = new CurrentFlapResolver().resolve(p6(), at(3, { flapIndex: null }), 0);
    expect(f).toMatchObject({ status: 'row', rowIndex: 3, via: 'percent' });
  });

  it('out-of-range index falls back to percent', () => {
    const f = new CurrentFlapResolver().resolve(p6(), at(2, { flapIndex: 11 }), 0);
    expect(f).toMatchObject({ status: 'row', rowIndex: 2, via: 'percent' });
  });

  it('NaN index is treated as missing', () => {
    const f = new CurrentFlapResolver().resolve(p6(), at(4, { flapIndex: NaN }), 0);
    expect(f.via).toBe('percent');
  });

  it('falls to percent (even spacing) when the index is missing', () => {
    const s = at(null, { flapPercent: 3 / 7 });
    const f = new CurrentFlapResolver().resolve(p6(), s, 0);
    expect(f).toMatchObject({ status: 'row', rowIndex: 3, via: 'percent' });
  });

  it('uses the named L: var last', () => {
    const p = p6();
    p.current_flap.lvar_name = 'FLAP_POS';
    const s = at(null, { flapPercent: null, lvar: 4 });
    expect(new CurrentFlapResolver().resolve(p, s, 0)).toMatchObject({ rowIndex: 4, via: 'lvar' });
    p.current_flap.lvar_name = null;
    expect(new CurrentFlapResolver().resolve(p, s, 0).status).toBe('unknown');
  });

  it('source preference changes the starting point of the chain', () => {
    const p = p6();
    p.current_flap.source = 'percent';
    const s = at(1, { flapPercent: 3 / 7 });
    expect(new CurrentFlapResolver().resolve(p, s, 0)).toMatchObject({ rowIndex: 3, via: 'percent' });
  });

  it('everything unreadable gives unknown (FLAP ?) and no row', () => {
    const s = at(null, { flapPercent: null });
    const f = new CurrentFlapResolver().resolve(p6(), s, 0);
    expect(f).toMatchObject({ status: 'unknown', rowIndex: null });
  });

  it('disconnected or no sample is unknown; N = 0 is noflaps', () => {
    const r = new CurrentFlapResolver();
    expect(r.resolve(p6(), null, 0).status).toBe('unknown');
    expect(r.resolve(p6(), sample({ connected: false }), 0).status).toBe('unknown');
    expect(r.resolve(createBlankProfile(), at(1), 0).status).toBe('noflaps');
  });

  it('a count of 0 makes the index implausible', () => {
    const f = new CurrentFlapResolver().resolve(p6(), at(2, { flapCount: 0, flapPercent: null }), 0);
    expect(f.status).toBe('unknown');
  });

  it('manual fallback only applies when enabled', () => {
    const p = p6();
    const s = at(null, { flapPercent: null });
    const r = new CurrentFlapResolver();
    r.setManual(2);
    expect(r.resolve(p, s, 0).status).toBe('unknown');
    p.current_flap.manual_fallback = true;
    expect(r.resolve(p, s, 0)).toMatchObject({ rowIndex: 2, via: 'manual' });
  });
});
