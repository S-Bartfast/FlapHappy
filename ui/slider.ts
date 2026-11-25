import type { WeightState } from '../core/weight';
import { h, setText } from './dom';

/** Read-only indicator; actual flying weight is independent of the clamped thumb. */
export class WeightIndicator {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private readout: HTMLElement;

  constructor() {
    this.fill = h('div', { class: 'fh-sl-fill' });
    this.thumb = h('div', { class: 'fh-sl-thumb' });
    this.readout = h('span', { class: 'fh-sl-pct' }, '-- kg');
    const track = h('div', { class: 'fh-sl-track', 'aria-hidden': 'true' }, this.fill, this.thumb);
    this.el = h('div', { class: 'fh-row fh-weight-row' },
      h('div', { class: 'fh-label' }, 'WEIGHT'),
      h('div', { class: 'fh-sl' }, h('div', { class: 'fh-sl-trackwrap' }, track)),
      h('div', { class: 'fh-gr fh-sl-read' }, this.readout));
  }

  render(state: WeightState): void {
    setText(this.readout, state.kg === null ? '-- kg' : Math.round(state.kg) + ' kg');
    const visible = state.fraction !== null;
    this.fill.style.display = this.thumb.style.display = visible ? '' : 'none';
    if (state.fraction !== null) {
      this.fill.style.width = state.fraction * 100 + '%';
      this.thumb.style.left = state.fraction * 100 + '%';
    }
  }
}
