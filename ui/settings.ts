import type { Profile, ValidationResult } from '../core/types';
import {
  addRow,
  cloneProfile,
  deleteRow,
  exportProfileJson,
  moveLabel,
  profileLabel,
  transitionName,
} from '../core/profile';
import { formatSpeedField, unitLabel, unitToKnots, type SpeedUnit } from '../core/units';
import { validateProfile } from '../core/validate';
import { clear, fmtNum, h, numberOrNull, setText, toggleClass } from './dom';
import type { App } from './app';

export interface ImportDraft {
  name: string;
  profile: Profile | null;
  errors: string[];
  validation: ValidationResult | null;
}

type Field = HTMLInputElement | HTMLSelectElement;

export class SettingsView {
  readonly el: HTMLElement;
  private draft: Profile | null = null;
  private validation: ValidationResult | null = null;
  private prefilled: number[] = [];
  private undo: { profile: Profile; what: string } | null = null;
  private fields: Record<string, Field> = {};
  private transNames: HTMLElement[] = [];
  private rowEls: HTMLElement[] = [];
  private saveBtn: HTMLButtonElement;
  private saveState: HTMLElement;
  private dirty = false;

  private profileBar: HTMLElement;
  private banner: HTMLElement;
  private table: HTMLElement;
  private tools: HTMLElement;
  private panel: HTMLElement;
  private liveLine: HTMLElement;
  private validBox: HTMLElement;
  private advanced: HTMLElement;
  private appBox: HTMLElement;
  private dragStop: (() => void) | null = null;

  constructor(private app: App) {
    this.saveBtn = h('button', { class: 'fh-btn fh-save', type: 'button', disabled: true, onclick: () => void this.saveNow() }, 'Save') as HTMLButtonElement;
    this.saveState = h('span', { class: 'fh-savestate' });
    this.profileBar = h('div', { class: 'fh-pbar' });
    this.banner = h('div', { class: 'fh-banner' });
    this.table = h('div', { class: 'fh-table' });
    this.tools = h('div', { class: 'fh-tools' });
    this.panel = h('div', { class: 'fh-subpanel' });
    this.liveLine = h('div', { class: 'fh-liveline' });
    this.validBox = h('div', { class: 'fh-validbox' });
    this.advanced = h('div', { class: 'fh-advanced' });
    this.appBox = h('div', { class: 'fh-appbox' });

    const back = h('button', { class: 'fh-btn fh-back', type: 'button', onclick: () => this.close() }, '\u2190 Back to display');
    this.el = h(
      'div',
      { class: 'fh-settings' },
      h('div', { class: 'fh-sethead' }, back, h('div', { class: 'fh-settitle' }, 'Settings'), this.saveBtn, this.saveState),
      this.profileBar,
      this.banner,
      this.table,
      this.tools,
      this.panel,
      this.liveLine,
      this.validBox,
      this.advanced,
      this.appBox,
    );
  }

  async init(): Promise<void> {
    await this.app.refreshMetas();
    const imp = this.app.consumeImport();
    if (this.app.unsaved) this.draft = cloneProfile(this.app.unsaved);
    else if (this.app.profile) this.draft = cloneProfile(this.app.profile);
    this.dirty = !!this.app.unsaved;
    this.revalidate();
    this.renderAll();
    if (imp) this.setImport(imp);
    if (this.dirty) {
      toggleClass(this.saveState, 'dirty', true);
      setText(this.saveState, 'Unsaved');
    }
    this.paintSaveState();
    this.app.onModel = () => this.updateLive();
    this.updateLive();
  }

  dispose(): void {
    this.endDrag();
    if (this.dirty && this.draft) this.app.setUnsaved(this.draft);
  }

  private close(): void {
    this.app.closeSettings();
  }

  // ------------------------------------------------------------------ Drafts

  private revalidate(): void {
    this.validation = this.draft ? validateProfile(this.draft, { liveHandleCount: this.app.liveCount() }) : null;
  }

  /** After any edit: re-validate and refresh field states. The file is written only from Save. */
  private edited(structural: boolean): void {
    this.revalidate();
    if (structural) this.renderTable();
    this.updateFieldStates();
    this.renderValidation();
    this.updateLive();
    this.dirty = true;
    if (this.draft) this.app.setUnsaved(this.draft);
    toggleClass(this.saveState, 'dirty', true);
    setText(this.saveState, 'Unsaved');
    this.paintSaveState();
  }

  async saveNow(): Promise<void> {
    const d = this.draft;
    if (!d) return;
    const applied = !!(this.validation && this.validation.ok);
    const did = await this.app.saveProfile(d);
    this.dirty = false;
    toggleClass(this.saveState, 'dirty', false);
    setText(this.saveState, applied && did ? 'Saved and applied' : applied ? 'Saved' : 'Saved as incomplete. Not applied: fix errors');
    this.paintSaveState();
    this.updateLive();
  }

  private paintSaveState(): void {
    this.saveBtn.disabled = !this.dirty || !this.draft;
    toggleClass(this.saveBtn, 'dirty', this.dirty);
  }

  private setDraft(p: Profile | null): void {
    this.draft = p;
    this.dirty = false;
    this.app.setUnsaved(null);
    this.prefilled = [];
    this.undo = null;
    clear(this.panel);
    this.revalidate();
    this.renderAll();
    this.paintSaveState();
  }

  private mutate(next: Profile, what?: string, prefilled?: number | null): void {
    if (!this.draft) return;
    if (what) this.undo = { profile: cloneProfile(this.draft), what };
    this.draft = next;
    this.prefilled = this.prefilled.filter(() => false);
    if (prefilled !== undefined && prefilled !== null) this.prefilled.push(prefilled);
    this.edited(true);
  }

  // --------------------------------------------------------------- Rendering

  private setUnits(unit: SpeedUnit): void {
    this.app.setSpeedUnit(unit);
    this.renderProfileBar();
    this.renderTable();
    this.updateFieldStates();
  }

  private renderAll(): void {
    this.renderProfileBar();
    this.renderTable();
    this.renderTools();
    this.renderValidation();
    this.renderAdvanced();
    this.renderAppBox();
    this.updateFieldStates();
    this.updateLive();
  }

  private renderProfileBar(): void {
    const app = this.app;
    clear(this.profileBar);
    const files = app.host.capabilities.files;
    const unit = app.settings.units === 'kmh' ? 'kmh' : 'kt';
    const unitBtn = (id: SpeedUnit, label: string) =>
      h('button', { class: 'fh-btn fh-unitbtn' + (unit === id ? ' on' : ''), type: 'button', onclick: () => this.setUnits(id) }, label);
    const shown = this.draft ? h('span', { class: 'fh-profilename' }, profileLabel(this.draft.id)) : null;
    this.profileBar.appendChild(h('div', { class: 'fh-prow' }, h('label', null, 'Profile'), shown, files ? h('button', { class: 'fh-btn fh-open', type: 'button', onclick: () => void this.openFile() }, 'Open...') : null, files ? h('button', { class: 'fh-btn fh-saveas', type: 'button', onclick: () => void this.saveAs() }, 'Save As...') : null, app.host.capabilities.openFolder ? h('button', { class: 'fh-btn', type: 'button', onclick: () => app.host.openProfilesFolder() }, 'Open profiles folder') : null, h('span', { class: 'fh-units' }, unitBtn('kt', 'kt'), unitBtn('kmh', 'km/h'))));
    if (!this.draft) {
      this.profileBar.appendChild(h('div', { class: 'fh-hint' }, 'No profile yet. Open a profile file to start.'));
    }
  }

  private fieldInput(path: string, value: string, opts: { cls?: string; placeholder?: string; type?: string; step?: string; onInput: (text: string) => void; label?: string }): HTMLInputElement {
    const inp = h('input', {
      class: 'fh-in ' + (opts.cls ?? ''),
      type: opts.type ?? 'number',
      step: opts.step ?? '0.1',
      value,
      placeholder: opts.placeholder ?? '',
      'aria-label': opts.label ?? path,
      'data-path': path,
      oninput: (e: Event) => {
        const el = e.target as HTMLInputElement;
        const idx = this.prefilled.indexOf(parseTransitionIndex(path));
        if (idx >= 0 && path.indexOf('transitions[') === 0) this.prefilled.splice(idx, 1);
        opts.onInput(el.value);
        this.edited(false);
      },
    }) as HTMLInputElement;
    this.fields[path] = inp;
    return inp;
  }

  private renderTable(): void {
    clear(this.table);
    this.fields = {};
    this.transNames = [];
    this.rowEls = [];
    const d = this.draft;
    if (!d) return;
    const n = d.flaps.length;

    const unit = this.app.settings.units === 'kmh' ? 'kmh' : 'kt';
    const storeSpeed = (text: string): number | null => {
      const n = numberOrNull(text);
      return n === null ? null : unitToKnots(n, unit);
    };
    const speedRow = (title: string, cls: string, nameEl: HTMLElement | null, get: () => { no_ballast_kt: number | null; max_ballast_kt: number | null }, path: string, isEnd: boolean) => {
      const s = get();
      return h(
        'div',
        { class: 'fh-erow fh-speedrow ' + cls },
        nameEl ?? h('div', { class: 'fh-rowname' }, title),
        h('label', { class: 'fh-sub' }, 'No Ballast'),
        this.fieldInput(path + '.no_ballast_kt', formatSpeedField(s.no_ballast_kt, unit), { cls: 'fh-speed', step: '1', onInput: (t) => { get().no_ballast_kt = storeSpeed(t); }, label: title + ' No Ballast' }),
        h('label', { class: 'fh-sub' }, 'Max Ballast'),
        this.fieldInput(path + '.max_ballast_kt', formatSpeedField(s.max_ballast_kt, unit), { cls: 'fh-speed', step: '1', placeholder: isEnd ? 'same' : '', onInput: (t) => { get().max_ballast_kt = storeSpeed(t); }, label: title + ' Max Ballast' }),
        h('span', { class: 'fh-unit' }, unitLabel(unit)),
      );
    };

    this.table.appendChild(speedRow('Min (stall)', 'fh-minrow', null, () => d.vs_min, 'vs_min', true));

    d.flaps.forEach((row, i) => {
      const labelIn = this.fieldInput(`flaps[${i}].label`, row.label, {
        cls: 'fh-lbl',
        type: 'text',
        label: 'Flap ' + (i + 1) + ' label',
        onInput: (t) => {
          row.label = t;
          this.transNames.forEach((el, k) => setText(el, 'Transition ' + transitionName(d, k)));
        },
      });
      labelIn.setAttribute('maxlength', '8');
      const indexIn = this.fieldInput(`flaps[${i}].handle_index`, row.handle_index === null ? '' : String(row.handle_index), {
        cls: 'fh-handle',
        step: '1',
        label: 'Flap ' + (i + 1) + ' sim index',
        onInput: (t) => {
          const n = numberOrNull(t);
          row.handle_index = n === null ? null : Math.round(n);
          frow.setAttribute('data-handle', row.handle_index === null ? '' : String(row.handle_index));
        },
      });
      indexIn.setAttribute('min', '0');
      const frow = h(
        'div',
        { class: 'fh-erow fh-frow', 'data-handle': row.handle_index === null ? '' : String(row.handle_index), title: 'Drag to reorder' },
        h('span', { class: 'fh-grip', 'aria-hidden': 'true' }, '\u2630'),
        h('label', { class: 'fh-sub' }, 'Label'),
        labelIn,
        h('label', { class: 'fh-sub' }, 'Sim index'),
        indexIn,
        h('span', { class: 'fh-rowbtns' },
          h('button', { class: 'fh-btn fh-remove', type: 'button', title: 'Remove this flap row', 'aria-label': 'Remove row', onclick: () => this.mutate(deleteRow(d, i), 'Deleted row "' + row.label + '"') }, '\u00d7'),
        ),
      );
      this.armRowDrag(frow, i);
      this.rowEls.push(frow);
      this.table.appendChild(frow);
      if (i < n - 1) {
        const nameEl = h('div', { class: 'fh-rowname fh-transname' }, 'Transition ' + transitionName(d, i));
        this.transNames.push(nameEl);
        const trow = speedRow('T' + (i + 1), 'fh-trow', nameEl, () => d.transitions[i], `transitions[${i}]`, false);
        if (this.prefilled.indexOf(i) >= 0) trow.classList.add('prefilled');
        this.table.appendChild(h('div', { class: 'fh-twrap' }, trow));
      }
    });
    if (n > 0) {
      this.table.appendChild(h(
        'div',
        { class: 'fh-erow fh-speedrow fh-maxrow' },
        h('div', { class: 'fh-rowname' }, 'Max (Vne)'),
        h('div', { class: 'fh-vneval' },
          this.fieldInput('vne', formatSpeedField(d.vne, unit), {
            cls: 'fh-speed',
            step: '1',
            label: 'Max (Vne)',
            onInput: (t) => {
              d.vne = storeSpeed(t);
            },
          }),
          h('span', { class: 'fh-unit' }, unitLabel(unit)),
        ),
      ));
    }
    else this.table.appendChild(h('div', { class: 'fh-hint' }, 'No flap rows: the display shows "no flaps". Add a row to start.'));
  }

  /** Drag a row (anywhere but its text field or buttons) to move its label. Mouse and touch only. */
  private armRowDrag(row: HTMLElement, from: number): void {
    const start = (clientX: number, clientY: number, target: EventTarget | null) => {
      if (this.dragStop || overControl(target)) return;
      let moved = false;
      let drop = from;
      let ghost: HTMLElement | null = null;
      let slots: number[] | null = null;
      let gap = 0;
      const move = (x: number, y: number) => {
        if (!moved && Math.abs(y - clientY) < 4) return;
        if (!slots) {
          const rect = row.getBoundingClientRect();
          gap = Math.round(rect.height + 6);
          slots = this.rowEls.map((el) => {
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2;
          });
        }
        moved = true;
        drop = nearestSlot(slots, y);
        toggleClass(row, 'fh-dragging', true);
        this.rowEls.forEach((el, k) => {
          const open = k === drop && k !== from;
          toggleClass(el, 'fh-drop', open);
          el.style.marginTop = open ? gap + 'px' : '';
        });
        ghost = placeGhost(row, ghost, x, y);
      };
      const finish = () => {
        this.dragStop = null;
        window.removeEventListener('mousemove', onMouse);
        window.removeEventListener('mouseup', finish);
        row.removeEventListener('touchmove', onTouch);
        row.removeEventListener('touchend', finish);
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        if (moved && drop !== from && this.draft) this.mutate(moveLabel(this.draft, from, drop));
        else {
          toggleClass(row, 'fh-dragging', false);
          this.rowEls.forEach((el) => {
            toggleClass(el, 'fh-drop', false);
            el.style.marginTop = '';
          });
        }
      };
      const onMouse = (e: MouseEvent) => move(e.clientX, e.clientY);
      const onTouch = (e: TouchEvent) => {
        if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
      };
      this.dragStop = finish;
      window.addEventListener('mousemove', onMouse);
      window.addEventListener('mouseup', finish);
      // On the row, not the window: a window touch listener cannot cancel scrolling.
      row.addEventListener('touchmove', onTouch);
      row.addEventListener('touchend', finish);
    };
    row.addEventListener('mousedown', (e) => {
      if (overControl(e.target)) return;
      e.preventDefault();
      start(e.clientX, e.clientY, e.target);
    });
    row.addEventListener('touchstart', (e) => {
      if (overControl(e.target) || !e.touches[0]) return;
      e.preventDefault();
      start(e.touches[0].clientX, e.touches[0].clientY, e.target);
    });
  }

  private endDrag(): void {
    if (this.dragStop) this.dragStop();
  }


  private renderTools(): void {
    clear(this.tools);
    const d = this.draft;
    if (!d) return;
    const btn = (text: string, cls: string, fn: () => void) => h('button', { class: 'fh-btn ' + cls, type: 'button', onclick: fn }, text);
    this.tools.appendChild(btn('+ Add flap row', 'fh-addrow', () => { const r = addRow(d); this.mutate(r.profile, undefined, r.prefilled); }));
    if (this.undo) this.tools.appendChild(btn('Undo: ' + this.undo.what, 'fh-undo', () => this.doUndo()));
  }

  private doUndo(): void {
    if (!this.undo) return;
    this.draft = this.undo.profile;
    this.undo = null;
    this.prefilled = [];
    this.edited(true);
    this.renderTools();
  }

  private renderValidation(): void {
    clear(this.validBox);
    this.renderTools();
    const v = this.validation;
    if (!v || !this.draft) return;
    const head = v.errors.length
      ? `Not applied: fix ${v.errors.length} error${v.errors.length === 1 ? '' : 's'}` + (v.warnings.length ? `, ${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'}` : '')
      : v.warnings.length
        ? `Valid, ${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'}`
        : 'Valid';
    this.validBox.appendChild(h('div', { class: 'fh-validhead ' + (v.errors.length ? 'err' : v.warnings.length ? 'warn' : 'ok') }, 'Validation: ' + head));
    const list = h('ul', { class: 'fh-issues' });
    v.issues.forEach((i) => list.appendChild(h('li', { class: i.level }, i.message)));
    this.validBox.appendChild(list);
  }

  private updateFieldStates(): void {
    const v = this.validation;
    for (const path of Object.keys(this.fields)) {
      const el = this.fields[path];
      const issues = v ? v.issues.filter((i) => i.path === path) : [];
      const err = issues.some((i) => i.level === 'error');
      const warn = !err && issues.length > 0;
      toggleClass(el, 'err', err);
      toggleClass(el, 'warn', warn);
      el.title = issues.map((i) => i.message).join('\n');
    }
  }

  /** Cheap per-sample update: the live line. */
  updateLive(): void {
    const app = this.app;
    const d = this.draft;
    const s = app.lastSample;
    let live = 'Live: no sim data';
    let liveIdx: number | null = null;
    if (s && s.connected && s.flapIndex !== null) {
      liveIdx = Math.round(s.flapIndex);
      const row = d ? d.flaps.find((r) => r.handle_index === liveIdx) : undefined;
      live = `Live: handle index ${liveIdx}` + (s.flapCount !== null ? ` of ${s.flapCount}` : '') + (row ? ` [flap "${row.label}"]` : '');
    }
    setText(this.liveLine, live);
    this.rowEls.forEach((r) => toggleClass(r, 'live', liveIdx !== null && r.getAttribute('data-handle') === String(liveIdx)));
  }

  // ------------------------------------------------------------ Advanced page

  private renderAdvanced(): void {
    clear(this.advanced);
    const d = this.draft;
    if (!d) return;
    const num = (label: string, get: () => number | null, set: (v: number | null) => void, step = '1', ph = '') =>
      h('div', { class: 'fh-arow' }, h('label', null, label), h('input', { class: 'fh-in', type: 'number', step, value: fmtNum(get()), placeholder: ph, oninput: (e: Event) => { set(numberOrNull((e.target as HTMLInputElement).value)); this.edited(false); } }));
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) =>
      h('div', { class: 'fh-arow' }, h('label', { class: 'fh-check' }, h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); this.edited(false); } }), ' ' + label));
    const text = (label: string, get: () => string, set: (v: string) => void, ph = '') =>
      h('div', { class: 'fh-arow' }, h('label', null, label), h('input', { class: 'fh-in fh-wide', type: 'text', value: get(), placeholder: ph, oninput: (e: Event) => { set((e.target as HTMLInputElement).value); this.edited(false); } }));

    const body = h('div', { class: 'fh-advbody' },
      h('div', { class: 'fh-subtitle' }, 'Display'),
      num('Marker smoothing (ms, 0 = off)', () => d.marker_smoothing_ms, (v) => { d.marker_smoothing_ms = Math.max(0, v ?? 0); }, '50'),
      check('Red text when the current flap is above its VFE', () => d.display.vfe_overlay, (v) => { d.display.vfe_overlay = v; }),
      h('div', { class: 'fh-subtitle' }, 'Ballast slider'),
      h('div', { class: 'fh-arow' }, h('label', null, 'Default ballast'), h('input', { class: 'fh-in', type: 'number', min: '0', max: '100', step: '5', value: String(Math.round(d.ballast.default_fraction * 100)), oninput: (e: Event) => { const v = numberOrNull((e.target as HTMLInputElement).value); d.ballast.default_fraction = Math.max(0, Math.min(100, v ?? 0)) / 100; this.edited(false); } }), h('span', { class: 'fh-pct' }, '%')),
      h('div', { class: 'fh-arow' }, h('label', null, 'Drag snap'), h('input', { class: 'fh-in', type: 'number', min: '0', max: '100', step: '1', value: String(Math.round(d.ballast.drag_snap * 100)), oninput: (e: Event) => { const v = numberOrNull((e.target as HTMLInputElement).value); d.ballast.drag_snap = Math.max(0, Math.min(100, v ?? 0)) / 100; this.edited(false); } }), h('span', { class: 'fh-pct' }, '%')),
      num('Max ballast (litres, optional)', () => d.ballast.max_ballast_litres, (v) => { d.ballast.max_ballast_litres = v; }, '1', 'blank = do not show'),
      h('div', { class: 'fh-subtitle' }, 'Aircraft'),
      text('Match aircraft title containing (comma separated)', () => d.match.title_contains.join(', '), (v) => { d.match.title_contains = v.split(',').map((x) => x.trim()).filter(Boolean); }, 'e.g. AS 33'),
      text('Notes', () => d.notes, (v) => { d.notes = v; }),
    );
    const details = h('details', { class: 'fh-details' }, h('summary', null, 'Advanced'), body);
    this.advanced.appendChild(details);
  }

  private renderAppBox(): void {
    clear(this.appBox);
    const app = this.app;
    const caps = app.host.capabilities;
    const u = app.settings.ui;
    const rows: HTMLElement[] = [];
    if (caps.alwaysOnTop) rows.push(h('div', { class: 'fh-arow' }, h('label', { class: 'fh-check' }, h('input', { type: 'checkbox', class: 'fh-aot', checked: u.always_on_top, onchange: (e: Event) => app.setAlwaysOnTop((e.target as HTMLInputElement).checked) }), ' Keep this window on top of the sim')));
    if (caps.opacity) rows.push(h('div', { class: 'fh-arow' }, h('label', null, 'Opacity'), h('input', { type: 'range', min: '0.3', max: '1', step: '0.05', value: String(u.opacity), oninput: (e: Event) => app.setOpacity(Number((e.target as HTMLInputElement).value)) })));
    rows.push(h('div', { class: 'fh-arow' }, h('label', null, 'Zoom'), h('input', { type: 'range', min: '0.5', max: '2', step: '0.1', value: String(u.zoom), oninput: (e: Event) => app.setZoom(Number((e.target as HTMLInputElement).value)) })));
    if (!app.info.panelOnly) rows.push(h('div', { class: 'fh-arow' }, h('label', { class: 'fh-check' }, h('input', { type: 'checkbox', class: 'fh-demo', checked: u.demo_mode, onchange: (e: Event) => app.setDemoMode((e.target as HTMLInputElement).checked) }), ' Demo mode: use simulated data instead of the sim')));
    if (caps.files) {
      const panelNote = h('div', { class: 'fh-hint' }, 'In VR, press Tab and open Flap Happy. The application has to be running; the desktop is optional in panel-only mode.');
      rows.push(h('div', { class: 'fh-arow' }, h('button', { class: 'fh-btn', type: 'button', onclick: () => void app.host.installCockpitPanel().then((msg) => setText(panelNote, msg)) }, 'Install cockpit panel'), panelNote));
    }
    rows.push(h('div', { class: 'fh-hint' }, 'Version ' + app.info.version + ' | data source: ' + (app.usingSim ? 'simulated' : app.info.source)));
    this.appBox.appendChild(h('details', { class: 'fh-details' }, h('summary', null, 'Window and app'), ...rows));
  }

  // ------------------------------------------------------------- File actions

  private async openFile(): Promise<void> {
    const text = await this.app.host.openJson();
    if (text !== null) this.app.importText(text, 'opened file');
  }

  private async saveAs(): Promise<void> {
    if (!this.draft) return;
    const ok = await this.app.host.saveJson(this.draft.id + '.flaphappy.json', exportProfileJson(this.draft));
    setText(this.saveState, ok ? 'Exported' : 'Export cancelled');
  }

  setImport(imp: ImportDraft | null): void {
    this.closeImport();
    if (!imp) return;
    toggleClass(this.banner, 'on', true);
    if (!imp.profile) {
      this.banner.appendChild(h('div', { class: 'fh-importbox bad' },
        h('div', { class: 'fh-importtitle' }, 'Cannot open this file'),
        h('div', { class: 'fh-importmsg' }, imp.name + ': ' + imp.errors.join('; ')),
        h('div', { class: 'fh-importbtns' }, h('button', { class: 'fh-btn', type: 'button', onclick: () => this.closeImport() }, 'Dismiss'))));
      return;
    }
    const p = imp.profile;
    const v = imp.validation;
    const summary = v && v.ok ? 'valid' + (v.warnings.length ? ` (${v.warnings.length} warnings)` : '') : `incomplete (${v ? v.errors.length : '?'} errors, can still be accepted as a draft)`;
    this.banner.appendChild(
      h('div', { class: 'fh-importbox' },
        h('div', { class: 'fh-importtitle' }, 'Open "' + profileLabel(p.id) + '"?'),
        h('div', { class: 'fh-importmsg' }, 'From ' + imp.name + ': ' + summary + '.'),
        h('div', { class: 'fh-importbtns' },
          h('button', { class: 'fh-btn fh-discard', type: 'button', onclick: () => this.closeImport() }, 'Discard'),
          h('button', { class: 'fh-btn fh-accept', type: 'button', onclick: async () => {
            const known = this.app.metas.some((m) => m.id === p.id);
            if (!known) {
              await this.app.store.save(p);
              await this.app.refreshMetas();
            }
            await this.app.activate(p.id, true);
            this.closeImport();
            if (this.app.profile) this.setDraft(cloneProfile(this.app.profile));
          } }, 'Accept'))),
    );
  }

  private closeImport(): void {
    clear(this.banner);
    toggleClass(this.banner, 'on', false);
  }
}

/** A see-through copy of the row, kept under the pointer. The grab point stays where the drag began. */
function placeGhost(row: HTMLElement, ghost: HTMLElement | null, x: number, y: number): HTMLElement {
  if (!ghost) {
    const rect = row.getBoundingClientRect();
    ghost = row.cloneNode(true) as HTMLElement;
    ghost.className = 'fh-erow fh-frow fh-dragghost';
    ghost.style.width = rect.width + 'px';
    const live = row.querySelectorAll('input');
    const copy = ghost.querySelectorAll('input');
    for (let i = 0; i < live.length && i < copy.length; i++) (copy[i] as HTMLInputElement).value = (live[i] as HTMLInputElement).value;
    document.body.appendChild(ghost);
    ghost.setAttribute('data-off-x', String(x - rect.left));
    ghost.setAttribute('data-off-y', String(y - rect.top));
  }
  const offX = Number(ghost.getAttribute('data-off-x'));
  const offY = Number(ghost.getAttribute('data-off-y'));
  ghost.style.left = (x - offX + window.scrollX) + 'px';
  ghost.style.top = (y - offY + window.scrollY) + 'px';
  return ghost;
}

function nearestSlot(slots: number[], y: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const dist = Math.abs(y - slots[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function overControl(target: EventTarget | null): boolean {
  let el = target instanceof HTMLElement ? target : null;
  while (el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'LABEL') return true;
    if (el.classList.contains('fh-frow')) return false;
    el = el.parentElement;
  }
  return false;
}

function parseTransitionIndex(path: string): number {
  const m = /^transitions\[(\d+)\]/.exec(path);
  return m ? Number(m[1]) : -1;
}
