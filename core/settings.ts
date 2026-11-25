import { SETTINGS_SCHEMA, type Settings } from './types';
import type { SpeedUnit } from './units';
import { clamp01 } from './profile';

export function defaultSettings(): Settings {
  return {
    schema: SETTINGS_SCHEMA,
    last_profile_id: null,
    active_by_title: {},
    ballast_by_profile: {},
    units: 'kt',
    ui: { compact: true, always_on_top: false, opacity: 1, zoom: 1, demo_mode: false, external_panel_on_launch: false },
    window: null,
    main_window: null,
  };
}

function obj(x: unknown): Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

/** Current settings only. A missing file or another schema id falls back to defaults. Malformed fields do too. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const r = obj(raw);
  if (r.schema !== SETTINGS_SCHEMA) return d;
  const ui = obj(r.ui);
  const byTitle: Record<string, string> = {};
  const t = obj(r.active_by_title);
  for (const k of Object.keys(t)) if (typeof t[k] === 'string') byTitle[k] = t[k] as string;
  const ballast: Record<string, number> = {};
  const b = obj(r.ballast_by_profile);
  for (const k of Object.keys(b)) if (typeof b[k] === 'number' && isFinite(b[k] as number)) ballast[k] = clamp01(b[k] as number);
  const bounds = (raw: unknown) => {
    const w = obj(raw);
    return typeof w.x === 'number' && typeof w.y === 'number' && typeof w.width === 'number' && typeof w.height === 'number' &&
      [w.x, w.y, w.width, w.height].every(Number.isFinite) && w.width > 0 && w.height > 0
      ? { x: w.x, y: w.y, width: w.width, height: w.height } : null;
  };
  const num = (x: unknown, def: number, lo: number, hi: number) =>
    typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def;
  const units: SpeedUnit = r.units === 'kmh' ? 'kmh' : 'kt';
  return {
    schema: SETTINGS_SCHEMA,
    last_profile_id: typeof r.last_profile_id === 'string' ? r.last_profile_id : null,
    active_by_title: byTitle,
    ballast_by_profile: ballast,
    units,
    ui: {
      compact: true,
      always_on_top: ui.always_on_top === true,
      opacity: num(ui.opacity, d.ui.opacity, 0.3, 1),
      zoom: num(ui.zoom, d.ui.zoom, 0.5, 3),
      demo_mode: ui.demo_mode === true,
      external_panel_on_launch: ui.external_panel_on_launch === true,
    },
    window: bounds(r.window),
    main_window: bounds(r.main_window),
  };
}
