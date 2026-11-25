import type { Profile, ValidationResult } from './types';
import type { SimSample } from './sim';
import type { CurrentFlap } from './flapmap';
import { columnEdges, effectiveBoundaries, mapMarker, type MarkerRegion } from './scale';
import { interpolationFraction, liveWeight, type WeightState } from './weight';
import { formatIas, formatTick, type SpeedUnit } from './units';

export type LinkState = 'waiting' | 'nodata' | 'paused' | 'live';

export const STALE_MS = 1500;
export const GROUND_SPEED_KT = 25;

export function deriveLink(sample: SimSample | null, lastRxMs: number, nowMs: number): LinkState {
  if (!sample || !sample.connected) return 'waiting';
  if (nowMs - lastRxMs > STALE_MS) return 'nodata';
  if (!sample.inFlight) return 'paused';
  return 'live';
}

export interface CellModel {
  label: string;
  state: 'current' | 'other';
  /** Optional overlay: current flap above its placard speed. */
  overVfe: boolean;
}

export interface FlapBadge {
  kind: 'unknown' | 'other' | 'manual';
  text: string;
}

export interface DisplayModel {
  mode: 'none' | 'noflaps' | 'incomplete' | 'ok';
  link: LinkState;
  statusText: string | null;
  /** Bar drawn (all speeds valid at the current ballast). */
  barVisible: boolean;
  boundaries: number[] | null;
  edges: number[] | null;
  /** Left edge of each flap cell. One column per flap, so this matches `edges`. */
  cellEdges: number[] | null;
  ticks: string[] | null;
  cells: CellModel[];
  iasText: string;
  weight: WeightState;
  marker: { pos: number | null; region: MarkerRegion | null; greyed: boolean };
  alert: 'LOW' | 'FAST' | null;
  badge: FlapBadge | null;
  incompleteMessage: string | null;
  /** Row of the highlighted cell, or null. */
  currentRow: number | null;
}

export interface ModelInput {
  profile: Profile | null;
  validation: ValidationResult | null;
  sample: SimSample | null;
  link: LinkState;
  /** Stored manual fraction, used only when the loaded-weight anchors are incomplete. */
  manualBallast?: number;
  /** IAS after display smoothing (falls back to the raw sample when null). */
  ias: number | null;
  flap: CurrentFlap;
  /** Display unit. The profile's working speeds are knots. */
  units?: SpeedUnit;
}

const STATUS: Record<LinkState, string | null> = {
  waiting: 'Waiting for MSFS...',
  nodata: 'No data',
  paused: 'Paused or not in flight',
  live: null,
};

export function buildDisplayModel(inp: ModelInput): DisplayModel {
  const { profile, validation, sample, link, flap } = inp;
  const weight = liveWeight(profile, sample, link === 'live');
  const units = inp.units === 'kmh' ? 'kmh' : 'kt';
  const base: DisplayModel = {
    mode: 'none',
    link,
    statusText: STATUS[link],
    barVisible: false,
    boundaries: null,
    edges: null,
    cellEdges: null,
    ticks: null,
    cells: [],
    iasText: formatIas(null, units),
    weight,
    marker: { pos: null, region: null, greyed: false },
    alert: null,
    badge: null,
    incompleteMessage: null,
    currentRow: null,
  };
  if (!profile || !validation) {
    base.incompleteMessage = 'no profile: open settings';
    return base;
  }

  const live = link === 'live';
  const rawIas = inp.ias ?? (sample ? sample.iasKt : null);
  const hasIas = live && rawIas !== null && isFinite(rawIas);
  const shown = sample ? sample.iasKt : null;
  if (live && shown !== null && isFinite(shown)) base.iasText = formatIas(shown, units);

  const n = profile.flaps.length;
  const fraction = interpolationFraction(profile, weight, inp.manualBallast);
  const boundaries = validation.ok && fraction !== null ? effectiveBoundaries(profile, fraction) : null;
  base.mode = n === 0 ? 'noflaps' : validation.ok ? 'ok' : 'incomplete';
  if (base.mode === 'incomplete') base.incompleteMessage = 'profile incomplete: open settings';
  else if (weight.anchorsValid && weight.kg === null) base.incompleteMessage = 'Flying weight unavailable';

  // Flap cells: one per row.
  if (n > 0 && validation.structureOk) {
    const current = live || link === 'paused' || link === 'nodata' ? flap.rowIndex : null;
    base.currentRow = link === 'waiting' ? null : current;
    base.cells = profile.flaps.map((row, i) => {
      const isCur = base.currentRow === i;
      const vfe = typeof row.vfe_kt === 'number' ? row.vfe_kt : null;
      return {
        label: row.label,
        state: isCur ? 'current' : 'other',
        overVfe: !!(isCur && profile.display.vfe_overlay && hasIas && vfe !== null && (rawIas as number) > vfe),
      };
    });
  } else if (n > 0) {
    base.cells = profile.flaps.map((row) => ({ label: row.label, state: 'other' as const, overVfe: false }));
  }

  if (link !== 'waiting') {
    if (flap.status === 'unknown' && n > 0) base.badge = { kind: 'unknown', text: 'FLAP ?' };
    else if (flap.status === 'unlisted') base.badge = { kind: 'other', text: flap.label ?? '?' };
    else if (flap.via === 'manual') base.badge = { kind: 'manual', text: 'manual' };
  }

  if (boundaries) {
    base.barVisible = true;
    base.boundaries = boundaries;
    base.edges = columnEdges(boundaries);
    base.cellEdges = base.edges;
    base.ticks = boundaries.map((b) => formatTick(b, units));
    if (hasIas) {
      const ias = rawIas as number;
      const grey = (sample && sample.onGround === true) || ias < GROUND_SPEED_KT;
      if (grey) {
        base.marker = { pos: null, region: null, greyed: true };
      } else {
        const m = mapMarker(ias, boundaries, base.edges);
        base.marker = { pos: m.pos, region: m.region, greyed: false };
        base.alert = m.region === 'below' ? 'LOW' : m.region === 'above' ? 'FAST' : null;
      }
    }
  }
  return base;
}
