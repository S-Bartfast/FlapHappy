import { ballastReadout, snapFraction } from '../core/ballast';
import type { BallastState } from '../core/ballast';
import type { Profile } from '../core/types';
import { h, setText } from './dom';

/**
 * Ballast slider: None (0) to Max (1). Click the track to set, drag with snap.
 * Mouse and touch events only (no pointer events, which the in-sim browser lacks).
 */
export class BallastSlider {
  readonly el: HTMLElement;
  private track: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private readout: HTMLElement;
  private dragging = false;
  private profile: Profile | null = null;

  constructor(private onChange: (f: number) => void) {
    this.fill = h('div', { class: 'fh-sl-fill' });
    this.thumb = h('div', { class: 'fh-sl-thumb' });
    this.track = h('div', { class: 'fh-sl-track' }, this.fill, this.thumb);
    this.readout = h('span', { class: 'fh-sl-pct' }, '0%');

    this.el = h(
      'div',
      { class: 'fh-row fh-ballast-row' },
      h('div', { class: 'fh-label' }, 'BALLAST'),
      h('div', { class: 'fh-sl' }, h('div', { class: 'fh-sl-trackwrap' }, this.track), h('div', { class: 'fh-sl-read' }, this.readout)),
    );

    const move = (clientX: number) => {
      const r = this.track.getBoundingClientRect();
      const raw = r.width > 0 ? (clientX - r.left) / r.width : 0;
      this.commit(snapFraction(raw, this.snap()));
    };
    this.track.addEventListener('mousedown', (e) => {
      this.dragging = true;
      move(e.clientX);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (this.dragging) move(e.clientX);
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });
    this.track.addEventListener('touchstart', (e) => {
      this.dragging = true;
      if (e.touches[0]) move(e.touches[0].clientX);
      e.preventDefault();
    });
    this.track.addEventListener('touchmove', (e) => {
      if (this.dragging && e.touches[0]) move(e.touches[0].clientX);
      e.preventDefault();
    });
    this.track.addEventListener('touchend', () => {
      this.dragging = false;
    });
  }

  private snap(): number {
    return this.profile ? this.profile.ballast.drag_snap : 0.05;
  }

  private commit(f: number): void {
    this.paint(f);
    this.onChange(f);
  }

  render(profile: Profile | null, st: BallastState): void {
    this.profile = profile;
    this.paint(st.f);
  }

  private paint(f: number): void {
    const pctText = this.profile ? ballastReadout(this.profile, f) : Math.round(f * 100) + '%';
    setText(this.readout, pctText);
    this.fill.style.width = f * 100 + '%';
    this.thumb.style.left = f * 100 + '%';
  }
}
