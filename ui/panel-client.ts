import type { CockpitState } from '../core/cockpit';
import type { Profile } from '../core/types';
import { usesManualBallast } from '../core/weight';
import { validateProfile } from '../core/validate';
import { CurrentFlapResolver } from '../core/flapmap';
import { buildDisplayModel, deriveLink } from '../core/display-model';
import { smoothStep } from '../core/scale';
import type { AglScale } from '../core/units';
import { h, setText } from './dom';
import { StripView } from './strip';
import { WeightControl } from './slider';

/**
 * Display shown inside the sim. It reads the desktop app over localhost and does not keep its own profile.
 * XMLHttpRequest only: the in-sim browser has no fetch.
 */
const root = document.getElementById('app') as HTMLElement;
const note = h('div', { class: 'fh-hint' }, 'Waiting for Flap Happy.');
const slider = new WeightControl((f) => postBallast(f));
const strip = new StripView({ weightRow: slider.el });
root.appendChild(note);
root.appendChild(strip.el);

let profileId = '';
let aircraftTitle: string | null = null;
let manualMode = false;
let holdUntil = 0;
let shownBallast = 0;
const resolver = new CurrentFlapResolver();
let smoothIas: number | null = null;
let smoothAgl: number | null = null;
let smoothAt = 0;

function resetSmoothing(): void {
  smoothIas = smoothAgl = null;
  smoothAt = 0;
}

function smoothValue(previous: number | null, value: number | null, dt: number, tau: number): number | null {
  return value !== null && isFinite(value) ? smoothStep(previous, value, dt, tau) : null;
}

function xhr(method: string, path: string, body: string | null, done: (status: number, text: string) => void): void {
  const req = new XMLHttpRequest();
  req.open(method, path, true);
  req.timeout = 1500;
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    done(req.status, req.responseText || '');
  };
  req.onreadystatechange = () => { if (req.readyState === 4) finish(); };
  req.onerror = req.ontimeout = finish;
  if (body !== null) req.setRequestHeader('Content-Type', 'application/json');
  req.send(body);
}

function postBallast(f: number): void {
  if (!profileId || !manualMode) return;
  const id = profileId;
  shownBallast = f;
  holdUntil = Date.now() + 800;
  xhr('POST', '/api/ballast', JSON.stringify({ profileId: id, f }), (status) => {
    if (status !== 200 && profileId === id) holdUntil = 0;
  });
}

function paint(state: CockpitState): void {
  if (!state.ready || !state.profile) {
    unavailable();
    return;
  }
  note.style.display = 'none';
  strip.el.style.display = '';
  const profile = state.profile as Profile;
  const changedProfile = profile.id !== profileId;
  const nextTitle = state.sample?.aircraftTitle ?? null;
  if (changedProfile || aircraftTitle !== nextTitle) {
    aircraftTitle = nextTitle;
    profileId = profile.id;
    shownBallast = -1;
    holdUntil = 0;
    resolver.reset();
    resetSmoothing();
  }
  const now = Date.now();
  const nextManual = usesManualBallast(profile);
  if (manualMode !== nextManual || changedProfile) holdUntil = 0;
  manualMode = nextManual;
  const f = manualMode && now < holdUntil ? shownBallast : state.ballast;
  const count = state.sample?.connected && state.sample.flapCount !== null && state.sample.flapCount > 0 ? state.sample.flapCount : null;
  const validation = validateProfile(profile, { liveHandleCount: count });
  const link = deriveLink(state.sample, state.receivedAt, now);
  if (link === 'live' && state.sample) {
    const dt = smoothAt ? now - smoothAt : 0;
    const tau = profile.marker_smoothing_ms;
    smoothIas = smoothValue(smoothIas, state.sample.iasKt, dt, tau);
    smoothAgl = smoothValue(smoothAgl, state.sample.aglFt, dt, tau);
    smoothAt = now;
  } else resetSmoothing();
  const model = buildDisplayModel({
    profile,
    validation,
    sample: state.sample,
    link,
    manualBallast: f,
    ias: smoothIas,
    aglFt: smoothAgl,
    flap: resolver.resolve(profile, state.sample, now),
    units: state.units === 'kmh' ? 'kmh' : 'kt',
    height: state.height === 'm' ? 'm' : 'ft',
    agl: aglFromState(state),
  });
  slider.render(profile, model.weight, { f: typeof f === 'number' && isFinite(f) ? Math.max(0, Math.min(1, f)) : profile.ballast.default_fraction, unconfirmed: false, restored: false }, state.weightUnit === 'lb' ? 'lb' : 'kg');
  strip.render(model, { profile, zoom: state.zoom, showBallast: state.showBallast !== false, showAgl: state.showAgl !== false, showTransitions: state.showTransitions === true, showWind: state.showWind !== false, barShading: state.barShading !== false });
}

function aglFromState(state: CockpitState): AglScale | undefined {
  const agl = state.agl;
  if (!agl) return undefined;
  if (typeof agl.bottom_m !== 'number' || typeof agl.top_m !== 'number' || typeof agl.low_m !== 'number' || typeof agl.high_m !== 'number') return undefined;
  return agl;
}

function poll(): void {
  xhr('GET', '/api/state', null, (status, text) => {
    if (status === 200) {
      try {
        paint(JSON.parse(text) as CockpitState);
      } catch {
        unavailable();
      }
    } else unavailable();
    setTimeout(poll, 200);
  });
}

function unavailable(): void {
  setText(note, 'Waiting for Flap Happy.');
  profileId = '';
  aircraftTitle = null;
  shownBallast = -1;
  manualMode = false;
  holdUntil = 0;
  resolver.reset();
  resetSmoothing();
  note.style.display = 'block';
  strip.el.style.display = 'none';
  slider.render(null, { kg: null, fraction: null, anchorsValid: false }, { f: 0, unconfirmed: false, restored: false });
}
unavailable();
poll();
