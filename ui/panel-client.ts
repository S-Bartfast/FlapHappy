import type { CockpitState } from '../core/cockpit';
import type { Profile } from '../core/types';
import { validateProfile } from '../core/validate';
import { CurrentFlapResolver } from '../core/flapmap';
import { buildDisplayModel, deriveLink } from '../core/display-model';
import { h, setText } from './dom';
import { StripView } from './strip';
import { WeightIndicator } from './slider';

/**
 * Display shown inside the sim. It reads the desktop app over localhost and does not keep its own profile.
 * XMLHttpRequest only: the in-sim browser has no fetch.
 */
const root = document.getElementById('app') as HTMLElement;
const note = h('div', { class: 'fh-hint' }, 'Waiting for Flap Happy.');
const slider = new WeightIndicator();
const strip = new StripView({ weightRow: slider.el });
root.appendChild(note);
root.appendChild(strip.el);

let profileId = '';
const resolver = new CurrentFlapResolver();

function xhr(method: string, path: string, body: string | null, done: (status: number, text: string) => void): void {
  const req = new XMLHttpRequest();
  req.open(method, path, true);
  req.timeout = 1500;
  req.onreadystatechange = () => {
    if (req.readyState === 4) done(req.status, req.responseText || '');
  };
  if (body !== null) req.setRequestHeader('Content-Type', 'application/json');
  req.send(body);
}

function paint(state: CockpitState): void {
  if (!state.ready || !state.profile) {
    unavailable();
    return;
  }
  note.style.display = 'none';
  strip.el.style.display = '';
  const profile = state.profile as Profile;
  if (profile.id !== profileId) {
    profileId = profile.id;
    resolver.reset();
  }
  const now = Date.now();
  const validation = validateProfile(profile);
  const model = buildDisplayModel({
    profile,
    validation,
    sample: state.sample,
    link: deriveLink(state.sample, state.receivedAt, now),
    ias: state.sample ? state.sample.iasKt : null,
    flap: resolver.resolve(profile, state.sample, now),
    units: state.units === 'kmh' ? 'kmh' : 'kt',
  });
  strip.render(model, { profile, zoom: state.zoom });
  slider.render(model.weight);
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
  resolver.reset();
  note.style.display = 'block';
  strip.el.style.display = 'none';
  slider.render({ kg: null, fraction: null, anchorsValid: false });
}
unavailable();
poll();
