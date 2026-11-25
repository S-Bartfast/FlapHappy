import type { DisplayModel } from '../core/display-model';
import type { Profile } from '../core/types';
import { nativeWidth } from '../core/scale';
import { clear, h, setText, toggleClass } from './dom';

export interface StripOptions {
  /** Content area for the weight indicator (shown under the tick row). */
  weightRow?: HTMLElement | null;
  title?: string;
}

/**
 * The display strip: IAS bar with ticks and marker, the FLAPS row and tick labels.
 * Positions are absolute percentages so the bar and cells always share the same N columns.
 * Flexbox plus absolute positioning only (Coherent-safe).
 */
export class StripView {
  readonly el: HTMLElement;
  private fit: HTMLElement;
  private panel: HTMLElement;
  private track!: HTMLElement;
  private cols!: HTMLElement;
  private fill!: HTMLElement;
  private marker!: HTMLElement;
  private barMsg!: HTMLElement;
  private readout!: HTMLElement;
  private cellsWrap!: HTMLElement;
  private badge!: HTMLElement;
  private tickLabels!: HTMLElement;
  private flapsLabel!: HTMLElement;
  private cellEls: HTMLElement[] = [];
  private cellWraps: HTMLElement[] = [];
  private tickEls: HTMLElement[] = [];
  private tickLines: HTMLElement[] = [];
  private tickTexts: HTMLElement[] = [];
  private colEls: HTMLElement[] = [];
  private sig = '';
  private native = 560;

  constructor(private opts: StripOptions = {}) {
    this.panel = h('div', { class: 'fh-panel' });
    this.fit = h('div', { class: 'fh-fit' }, this.panel);
    this.el = this.fit;
    this.buildChrome();
    window.addEventListener('resize', () => this.rescale());
  }

  get panelEl(): HTMLElement {
    return this.panel;
  }

  private buildChrome(): void {
    this.track = h('div', { class: 'fh-track' });
    this.cols = h('div', { class: 'fh-cols' });
    this.fill = h('div', { class: 'fh-fill' });
    this.marker = h('div', { class: 'fh-marker' });
    this.barMsg = h('div', { class: 'fh-barmsg' });
    this.track.appendChild(this.cols);
    this.track.appendChild(this.fill);
    this.track.appendChild(this.marker);
    this.track.appendChild(this.barMsg);
    this.readout = h('div', { class: 'fh-readout' }, '--- kt');
    this.track.appendChild(h('div', { class: 'fh-barread' }, this.readout));
    const iasRow = h('div', { class: 'fh-row fh-ias-row' }, h('div', { class: 'fh-label' }, 'IAS'), this.track);

    this.cellsWrap = h('div', { class: 'fh-cells' });
    this.badge = h('div', { class: 'fh-badge' });
    this.flapsLabel = h('div', { class: 'fh-label fh-flaps-label' }, 'FLAPS', this.badge);
    const flapsRow = h('div', { class: 'fh-row fh-flaps-row' }, this.flapsLabel, this.cellsWrap);

    this.tickLabels = h('div', { class: 'fh-ticklabels' });
    const tickRow = h('div', { class: 'fh-row fh-tick-row' }, h('div', { class: 'fh-label' }), this.tickLabels);

    clear(this.panel);
    this.panel.appendChild(iasRow);
    this.panel.appendChild(flapsRow);
    this.panel.appendChild(tickRow);
    if (this.opts.weightRow) this.panel.appendChild(this.opts.weightRow);
  }

  /** Rebuild cell/tick elements only when the layout signature changes. */
  private ensureStructure(model: DisplayModel): void {
    const sig = JSON.stringify([model.cells.map((c) => c.label), model.ticks ? model.ticks.length : 0, model.mode]);
    if (sig === this.sig) return;
    this.sig = sig;
    const n = model.cells.length;
    const cols = Math.max(n, 1);

    clear(this.cols);
    this.colEls = [];
    for (let i = 0; i < cols; i++) {
      const c = h('div', { class: 'fh-col ' + (i % 2 ? 'odd' : 'even') });
      this.colEls.push(c);
      this.cols.appendChild(c);
    }

    clear(this.cellsWrap);
    this.cellEls = [];
    this.cellWraps = [];
    model.cells.forEach((cell) => {
      const long = cell.label.length > 4;
      const inner = h('div', { class: 'fh-cell' + (long ? ' fh-long' : '') }, cell.label);
      const wrap = h('div', { class: 'fh-cellwrap' }, inner);
      this.cellEls.push(inner);
      this.cellWraps.push(wrap);
      this.cellsWrap.appendChild(wrap);
    });
    if (n === 0) this.cellsWrap.appendChild(h('div', { class: 'fh-noflaps' }, 'no flaps'));

    // Remove old ticks (they live in the track and the label row).
    this.tickLines.forEach((t) => t.parentNode && t.parentNode.removeChild(t));
    this.tickEls = [];
    this.tickLines = [];
    this.tickTexts = [];
    clear(this.tickLabels);
    const count = model.ticks ? model.ticks.length : 0;
    for (let i = 0; i < count; i++) {
      const line = h('div', { class: 'fh-tick' });
      this.track.insertBefore(line, this.marker);
      const txt = h('div', { class: 'fh-ticktext' });
      this.tickLabels.appendChild(txt);
      this.tickLines.push(line);
      this.tickTexts.push(txt);
    }
    this.native = nativeWidth(n);
    this.panel.style.width = this.native + 'px';
  }

  render(model: DisplayModel, extra: { profile: Profile | null; zoom?: number }): void {
    this.ensureStructure(model);
    const n = model.cells.length;
    const edges = model.edges;
    const cols = Math.max(n, 1);

    // One column per flap, lined up with the speed ticks.
    const colEdges = model.cellEdges && model.cellEdges.length === cols + 1 ? model.cellEdges : edges && edges.length === cols + 1 ? edges : equalEdges(cols);
    this.colEls.forEach((c, i) => {
      c.style.left = pct(colEdges[i]);
      c.style.width = pct(colEdges[i + 1] - colEdges[i]);
    });
    this.cellWraps.forEach((w, i) => {
      w.style.left = pct(colEdges[i]);
      w.style.width = pct(colEdges[i + 1] - colEdges[i]);
    });
    this.cellEls.forEach((c, i) => {
      const cell = model.cells[i];
      toggleClass(c, 'current', cell.state === 'current');
      toggleClass(c, 'over-vfe', cell.overVfe);
    });

    toggleClass(this.panel, 'fh-nobar', !model.barVisible);
    this.tickLines.forEach((t, i) => {
      const pos = model.edges && model.ticks ? model.edges[i] : 0;
      t.style.left = pct(pos);
      toggleClass(t, 'hidden', !model.barVisible);
    });
    this.tickTexts.forEach((t, i) => {
      const pos = model.edges ? model.edges[i] : 0;
      t.style.left = pct(pos);
      setText(t, model.ticks ? model.ticks[i] : '');
      toggleClass(t, 'hidden', !model.barVisible);
      toggleClass(t, 'first', i === 0);
      toggleClass(t, 'last', model.ticks ? i === model.ticks.length - 1 : false);
    });

    const m = model.marker;
    toggleClass(this.track, 'grey', m.greyed || model.link !== 'live');
    if (model.barVisible && m.pos !== null) {
      this.fill.style.width = pct(m.pos);
      this.fill.style.display = 'block';
      this.marker.style.display = 'block';
      this.marker.style.left = pct(m.pos);
    } else {
      this.fill.style.display = 'none';
      this.marker.style.display = 'none';
    }
    setText(this.barMsg, model.barVisible ? '' : model.incompleteMessage ?? (model.mode === 'noflaps' ? '' : ''));
    toggleClass(this.barMsg, 'on', !model.barVisible && !!model.incompleteMessage);

    setText(this.readout, model.iasText);
    toggleClass(this.readout, 'dim', model.link !== 'live');
    toggleClass(this.readout, 'low', model.alert === 'LOW');
    toggleClass(this.readout, 'fast', model.alert === 'FAST');

    if (model.badge) {
      setText(this.badge, model.badge.text);
      this.badge.className = 'fh-badge on ' + model.badge.kind;
    } else {
      setText(this.badge, '');
      this.badge.className = 'fh-badge';
    }
    toggleClass(this.cellsWrap, 'grey', model.mode === 'noflaps');
    this.rescale(extra.zoom);
  }

  private zoom = 1;

  rescale(zoom?: number): void {
    if (zoom !== undefined) this.zoom = zoom;
    const avail = this.fit.clientWidth || this.native;
    const s = (avail / this.native) * this.zoom;
    this.panel.style.transform = 'scale(' + s + ')';
    this.fit.style.height = Math.ceil(this.panel.offsetHeight * s) + 'px';
  }
}

function equalEdges(cols: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= cols; i++) out.push(i / cols);
  return out;
}

function pct(x: number): string {
  return (Math.round(x * 10000) / 100).toFixed(2) + '%';
}

export { clear, setText };
