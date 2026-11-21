import type { SimControls, Fault } from './simulated-source';

export interface IasRel {
  from: 'vs' | 'vne';
  frac?: number;
  offsetKt?: number;
}

export interface Keyframe {
  /** Seconds from scenario start. */
  t: number;
  /** Absolute IAS (kt), interpolated linearly between keyframes. */
  ias?: number;
  /** IAS relative to the active profile's bar: vs + frac * (vne - vs) + offsetKt. */
  iasRel?: IasRel;
  /** Flap row (0-based, clamped to the profile's rows) resolved to that row's handle index. */
  flapRow?: number;
  flapIndex?: number;
  connected?: boolean;
  inFlight?: boolean;
  onGround?: boolean;
  fault?: Fault;
  /** Ballast fraction 0..1, interpolated linearly; applied through the app hook. */
  ballast?: number;
}

export interface Scenario {
  name: string;
  description?: string;
  loop?: boolean;
  /** Total length in seconds (defaults to the last keyframe). */
  duration?: number;
  keyframes: Keyframe[];
}

export interface ScenarioContext {
  /** Effective bar boundaries `[Vs..Vne]` at the current ballast, if known. */
  vs: number | null;
  vne: number | null;
  rowHandles: number[];
}

export interface ScenarioOutput extends Partial<Pick<SimControls, 'connected' | 'inFlight' | 'onGround' | 'iasKt' | 'flapIndex' | 'fault'>> {
  ballast?: number;
}

function resolveIas(k: Keyframe, ctx: ScenarioContext): number | undefined {
  if (typeof k.ias === 'number') return k.ias;
  if (k.iasRel) {
    const vs = ctx.vs ?? 50;
    const vne = ctx.vne ?? 150;
    const base = k.iasRel.from === 'vne' ? vne : vs;
    return base + (k.iasRel.frac ?? 0) * (vne - vs) + (k.iasRel.offsetKt ?? 0);
  }
  return undefined;
}

export function scenarioDuration(s: Scenario): number {
  if (typeof s.duration === 'number') return s.duration;
  return s.keyframes.length ? s.keyframes[s.keyframes.length - 1].t : 0;
}

/** Pure function of time: `at(t)` yields the controls that scenario wants at t seconds. */
export class ScenarioPlayer {
  constructor(
    public scenario: Scenario,
    public ctx: ScenarioContext,
  ) {}

  at(tSec: number): ScenarioOutput {
    const sc = this.scenario;
    const dur = scenarioDuration(sc);
    let t = tSec;
    if (sc.loop && dur > 0) t = tSec % dur;
    else if (t > dur) t = dur;
    const out: ScenarioOutput = {};
    const ks = sc.keyframes;
    if (!ks.length) return out;

    // Discrete fields: last keyframe at or before t that defines the field.
    for (const k of ks) {
      if (k.t > t) break;
      if (k.connected !== undefined) out.connected = k.connected;
      if (k.inFlight !== undefined) out.inFlight = k.inFlight;
      if (k.onGround !== undefined) out.onGround = k.onGround;
      if (k.fault !== undefined) out.fault = k.fault;
      if (k.flapIndex !== undefined) out.flapIndex = k.flapIndex;
      if (k.flapRow !== undefined && this.ctx.rowHandles.length) {
        const row = Math.max(0, Math.min(this.ctx.rowHandles.length - 1, k.flapRow));
        out.flapIndex = this.ctx.rowHandles[row];
      }
    }

    // Numeric fields: linear interpolation between surrounding keyframes that define them.
    const interp = (get: (k: Keyframe) => number | undefined): number | undefined => {
      let prev: { t: number; v: number } | null = null;
      let next: { t: number; v: number } | null = null;
      for (const k of ks) {
        const v = get(k);
        if (v === undefined) continue;
        if (k.t <= t) prev = { t: k.t, v };
        else {
          next = { t: k.t, v };
          break;
        }
      }
      if (prev && next) {
        const span = next.t - prev.t;
        return span > 0 ? prev.v + ((next.v - prev.v) * (t - prev.t)) / span : next.v;
      }
      if (prev) return prev.v;
      return next ? next.v : undefined;
    };
    const ias = interp((k) => resolveIas(k, this.ctx));
    if (ias !== undefined) out.iasKt = ias;
    const b = interp((k) => k.ballast);
    if (b !== undefined) out.ballast = b;
    return out;
  }
}
