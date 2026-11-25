import type { CockpitState } from '../core/cockpit';
import type { Profile } from '../core/types';
import { validateProfile } from '../core/validate';
import { CurrentFlapResolver } from '../core/flapmap';
import { buildDisplayModel, deriveLink } from '../core/display-model';
import type { AglScale } from '../core/units';
import { h, setText } from './dom';
import { StripView } from './strip';
import { BallastSlider } from './slider';

/**
 * Display shown inside the sim. It reads the desktop app over localhost and does not keep its own profile.
 * XMLHttpRequest only: the in-sim browser has no fetch.
 */
const root = document.getElementById('app') as HTMLElement;
const note = h('div', { class: 'fh-hint' }, 'Waiting for Flap Happy…');
const slider = new BallastSlider((f) => postBallast(f));
const strip = new StripView({ ballastRow: slider.el });
root.appendChild(note);
root.appendChild(strip.el);

let holdUntil = 0;
let shownBallast = -1;
let profileId = '';
const resolver = new CurrentFlapResolver();

function xhr(method: string, path: string, body: string | null, done: (status: number, text: string) => void): void {
  const req = new XMLHttpRequest();
  req.open(method, path, true);
  req.onreadystatechange = () => {
    if (req.readyState === 4) done(req.status, req.responseText || '');
  };
  if (body !== null) req.setRequestHeader('Content-Type', 'application/json');
  req.send(body);
}

function postBallast(f: number): void {
  holdUntil = Date.now() + 800;
  shownBallast = f;
  xhr('POST', '/api/ballast', JSON.stringify({ f: f }), () => undefined);
}

function paint(state: CockpitState): void {
  if (!state.ready || !state.profile) {
    setText(note, 'Waiting for Flap Happy…');
    note.style.display = 'block';
    return;
  }
  note.style.display = 'none';
  const profile = state.profile as Profile;
  if (profile.id !== profileId) {
    profileId = profile.id;
    resolver.reset();
  }
  const now = Date.now();
  const holding = now < holdUntil && shownBallast >= 0;
  const f = holding ? shownBallast : state.ballast;
  const validation = validateProfile(profile);
  const model = buildDisplayModel({
    profile,
    validation,
    sample: state.sample,
    link: deriveLink(state.sample, state.receivedAt, now),
    f,
    ias: state.sample ? state.sample.iasKt : null,
    flap: resolver.resolve(profile, state.sample, now),
    units: state.units === 'kmh' ? 'kmh' : 'kt',
    height: state.height === 'm' ? 'm' : 'ft',
    agl: aglFromState(state),
    groupHiddenFlapLabels: state.groupHiddenFlapLabels === true,
  });
  strip.render(model, { profile, zoom: state.zoom, showBallast: state.showBallast !== false, showAgl: state.showAgl !== false, showTransitions: state.showTransitions === true, showWind: state.showWind !== false, barShading: state.barShading !== false });
  if (!holding && state.ballast !== shownBallast) {
    shownBallast = state.ballast;
    slider.render(profile, { f: state.ballast, unconfirmed: false, restored: false });
  } else if (holding) {
    slider.render(profile, { f: shownBallast, unconfirmed: false, restored: false });
  }
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
        setText(note, 'Waiting for Flap Happy…');
      }
    }
    setTimeout(poll, 200);
  });
}

slider.render(null, { f: 1, unconfirmed: false, restored: false });
poll();
