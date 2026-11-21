/** Display unit. Profile files store metres per second; the app works in knots. */
export type SpeedUnit = 'kt' | 'kmh';

/** International nautical mile: 1 knot = 1.852 km/h = 1852/3600 m/s. */
export const KT_TO_KMH = 1.852;
export const KT_TO_MS = 1852 / 3600;
export const MS_TO_KT = 3600 / 1852;

export function unitLabel(unit: SpeedUnit): string {
  return unit === 'kmh' ? 'km/h' : 'kt';
}

/** Metres per second for a saved profile, to two decimal places. */
export function knotsToMs(kt: number): number {
  return Math.round(kt * KT_TO_MS * 100) / 100;
}

/** Knots from a saved m/s value, to 0.1 kt. */
export function msToKnots(ms: number): number {
  return Math.round(ms * MS_TO_KT * 10) / 10;
}

export function knotsToUnit(kt: number, unit: SpeedUnit): number {
  return unit === 'kmh' ? kt * KT_TO_KMH : kt;
}

export function unitToKnots(value: number, unit: SpeedUnit): number {
  const kt = unit === 'kmh' ? value / KT_TO_KMH : value;
  return Math.round(kt * 10) / 10;
}

/** Whole number for the IAS readout, with the unit suffix. */
export function formatIas(kt: number | null, unit: SpeedUnit): string {
  if (kt === null || !isFinite(kt)) return '--- ' + unitLabel(unit);
  return String(Math.round(knotsToUnit(kt, unit))) + ' ' + unitLabel(unit);
}

/** Whole number for a tick under the bar. */
export function formatTick(kt: number, unit: SpeedUnit): string {
  return String(Math.round(knotsToUnit(kt, unit)));
}

/** Editor field: the chosen display unit, as a whole number. */
export function formatSpeedField(kt: number | null, unit: SpeedUnit): string {
  if (kt === null || !isFinite(kt)) return '';
  return String(Math.round(knotsToUnit(kt, unit)));
}
