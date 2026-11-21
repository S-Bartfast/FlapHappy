import { describe, expect, it } from 'vitest';
import { validateProfile } from '../../core/validate';
import { PRESETS } from '../../profiles';
import { makeProfile } from './helpers';
import { createBlankProfile } from '../../core/profile';

const codes = (p = makeProfile(4)) => validateProfile(p).issues.map((i) => i.code);

describe('validateProfile', () => {
  it('accepts the built-in profile and N = 0..12', () => {
    for (const preset of PRESETS) expect(validateProfile(preset.profile).ok, preset.id).toBe(true);
    for (let n = 0; n <= 12; n++) {
      const v = validateProfile(makeProfile(n));
      expect(v.errors, `N=${n}`).toEqual([]);
    }
  });

  it('flags a profile with missing speeds as incomplete', () => {
    const p = makeProfile(6);
    p.vs_min.no_ballast_kt = null;
    p.transitions[4].max_ballast_kt = null;
    const v = validateProfile(p);
    expect(v.ok).toBe(false);
    expect(v.structureOk).toBe(true);
    expect(v.errors.some((e) => e.path === 'vs_min.no_ballast_kt')).toBe(true);
    expect(v.errors.some((e) => e.path === 'transitions[4].max_ballast_kt')).toBe(true);
  });

  it('an empty profile (N = 0) is valid: no flaps', () => {
    expect(validateProfile(createBlankProfile()).ok).toBe(true);
  });

  it('names the offending pair with the spec wording', () => {
    const p = makeProfile(4);
    p.transitions[2].no_ballast_kt = 62; // T3 must exceed T2 (64)
    const v = validateProfile(p);
    const e = v.errors.find((x) => x.code === 'not-ascending')!;
    expect(e.message).toBe('T3 (No Ballast) 62 must be above T2 (No Ballast) 64');
    expect(e.path).toBe('transitions[2].no_ballast_kt');
  });

  it('checks the two ends separately', () => {
    const p = makeProfile(3);
    p.transitions[1].max_ballast_kt = 70; // below T1 max (66)? 66<70 fine, now below
    p.transitions[0].max_ballast_kt = 90;
    const v = validateProfile(p);
    expect(v.errors.filter((e) => e.message.includes('(Max Ballast)'))).not.toHaveLength(0);
    expect(v.errors.filter((e) => e.message.includes('(No Ballast)'))).toHaveLength(0);
  });

  it('blank max ballast on Min and Max means same; transitions require both', () => {
    const p = makeProfile(3);
    p.vs_min.max_ballast_kt = null;
    p.vne = 76;
    expect(validateProfile(p).ok).toBe(false); // one VNE of 76 is below T2 max ballast 82
    const q = makeProfile(2);
    q.vs_min.max_ballast_kt = null;
    q.transitions[0] = { no_ballast_kt: 50, max_ballast_kt: 55 };
    q.vne = 90;
    expect(validateProfile(q).ok).toBe(true);
    q.transitions[0].max_ballast_kt = null;
    expect(validateProfile(q).ok).toBe(false);
  });

  it('enforces the minimum bucket width (error under 2 kt, warning under 4 kt)', () => {
    const p = makeProfile(2);
    p.transitions[0].no_ballast_kt = 41; // 1 kt above Vs
    expect(codes(p)).toContain('bucket-too-narrow');
    p.transitions[0].no_ballast_kt = 43;
    const v = validateProfile(p);
    expect(v.errors.map((e) => e.code)).not.toContain('bucket-too-narrow');
    expect(v.warnings.map((e) => e.code)).toContain('bucket-narrow');
  });

  it('structure: labels, indices, duplicates', () => {
    const p = makeProfile(3);
    p.flaps[0].label = '';
    p.flaps[1].label = '3';
    p.flaps[2].handle_index = 1;
    p.flaps[2].label = 'toolong7';
    const c = codes(p);
    expect(c).toContain('label-empty');
    expect(c).toContain('label-long');
    expect(c).toContain('index-duplicate');
    expect(validateProfile(p).structureOk).toBe(false);
  });

  it('warns about long labels, direction, VFE, many rows, out-of-range indices', () => {
    const p = makeProfile(11);
    p.flaps[0].label = 'abcde';
    p.flaps[1].vfe_kt = 45;
    p.transitions[3].max_ballast_kt = (p.transitions[3].no_ballast_kt as number) - 0; // equal: not a direction warning
    p.handle_count = 5;
    const w = validateProfile(p).warnings.map((x) => x.code);
    expect(w).toEqual(expect.arrayContaining(['label-long-warn', 'above-vfe', 'many-rows', 'index-range']));
    const q = makeProfile(3);
    q.transitions[0].max_ballast_kt = 40;
    expect(validateProfile(q).warnings.map((x) => x.code)).toContain('ballast-direction');
  });

  it('index range uses the live count when given', () => {
    const p = makeProfile(3);
    const v = validateProfile(p, { liveHandleCount: 2 });
    expect(v.warnings.some((w) => w.message.includes('the sim reports'))).toBe(true);
    expect(v.ok).toBe(true);
  });

  it('rejects a transitions array of the wrong length', () => {
    const p = makeProfile(3);
    p.transitions.pop();
    expect(codes(p)).toContain('transitions-length');
  });
});
