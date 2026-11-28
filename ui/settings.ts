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
import { formatSpeedField, heightToMetres, heightUnitLabel, metresToHeight, unitLabel, unitToKnots, type SpeedUnit, type WeightUnit, formatWeightField, weightToKilograms, kilogramsToWeight } from '../core/units';
import { validateProfile } from '../core/validate';
import { deriveLink } from '../core/display-model';
import { canSaveWeightMode, liveWeight, profileForWeightMode, weightModeForProfile, type WeightMode } from '../core/weight';
import { clear, fmtNum, h, numberOrNull, setText, toggleClass } from './dom';
import type { App } from './app';
import type { PanelInstallStatus,PanelInstallResult,PanelDestination } from '../core/panel-install';

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
  private weightMode: WeightMode = 'manual';
  private previousWeights: Profile['weight_kg'] | null = null;
  private saveAsBtn: HTMLButtonElement | null = null;
  private validation: ValidationResult | null = null;
  private prefilled: number[] = [];
  private undo: { profile: Profile; what: string } | null = null;
  private fields: Record<string, Field> = {};
  private transNames: HTMLElement[] = [];
  private rowEls: HTMLElement[] = [];
  private saveBtn: HTMLButtonElement;
  private saveState: HTMLElement;
  private dirty = false;
  private disposed = false;
  private liveValidationContext = '';

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
  private aglInputs: HTMLInputElement[] = [];
  private aglUnits: HTMLElement[] = [];

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

    const back = app.info.mainWindow ? null : h('button', { class: 'fh-btn fh-back', type: 'button', onclick: () => this.close() }, '\u2190 Back to display');
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
    if (this.disposed) return;
    const imp = this.app.consumeImport();
    if (this.app.unsaved) this.draft = cloneProfile(this.app.unsaved);
    else if (this.app.profile) this.draft = cloneProfile(this.app.profile);
    this.weightMode = this.app.unsaved ? this.app.unsavedWeightMode : weightModeForProfile(this.draft);
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
    this.disposed = true;
    this.endDrag();
    if (this.dirty && this.draft) this.app.setUnsaved(this.draft, this.weightMode);
  }

  private close(): void {
    this.app.closeSettings();
  }

  // ------------------------------------------------------------------ Drafts

  private revalidate(): void {
    const activeDraft = !this.app.info.mainWindow || this.draft?.id === this.app.profile?.id;
    this.validation = this.draft ? validateProfile(this.draft, { liveHandleCount: activeDraft ? this.app.liveCount() : null, requireWeightAnchors: this.weightMode === 'live' }) : null;
  }

  /** After any edit: re-validate and refresh field states. The file is written only from Save. */
  private edited(structural: boolean): void {
    this.revalidate();
    if (structural) this.renderTable();
    this.updateFieldStates();
    this.renderValidation();
    this.updateLive();
    this.dirty = true;
    if (this.draft) this.app.setUnsaved(this.draft, this.weightMode);
    toggleClass(this.saveState, 'dirty', true);
    setText(this.saveState, 'Unsaved');
    this.paintSaveState();
  }

  async saveNow(): Promise<void> {
    const draft = this.draft;
    if (!draft || !canSaveWeightMode(draft, this.weightMode)) return;
    const d = profileForWeightMode(draft, this.weightMode);
    this.draft = d;
    const applied = !!(this.validation && this.validation.ok);
    const did = await this.app.saveProfile(d, this.weightMode);
    this.dirty = false;
    toggleClass(this.saveState, 'dirty', false);
    setText(this.saveState, applied && did ? 'Saved and applied' : applied ? 'Saved' : 'Saved as incomplete. Not applied: fix errors');
    this.paintSaveState();
    this.updateLive();
  }

  private paintSaveState(): void {
    const canSave = canSaveWeightMode(this.draft, this.weightMode);
    this.saveBtn.disabled = !this.dirty || !canSave;
    if (this.saveAsBtn) this.saveAsBtn.disabled = !canSave;
    toggleClass(this.saveBtn, 'dirty', this.dirty);
  }

  private setDraft(p: Profile | null): void {
    this.draft = p;
    this.weightMode = weightModeForProfile(p);
    this.previousWeights = null;
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

  private setHeight(unit: 'ft' | 'm'): void {
    this.app.setHeightUnit(unit);
    this.renderProfileBar();
    this.syncAglFields();
  }

  private syncAglFields(): void {
    const unit = this.app.settings.height === 'm' ? 'm' : 'ft';
    const keys: Array<'bottom_m' | 'top_m' | 'low_m' | 'high_m'> = ['bottom_m', 'top_m', 'low_m', 'high_m'];
    for (let i = 0; i < this.aglInputs.length; i++) this.aglInputs[i].value = String(metresToHeight(this.app.settings.agl[keys[i]], unit));
    for (let i = 0; i < this.aglUnits.length; i++) setText(this.aglUnits[i], heightUnitLabel(unit));
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
    const height = app.settings.height === 'm' ? 'm' : 'ft';
    const unitBtn = (id: SpeedUnit, label: string) =>
      h('button', { class: 'fh-btn fh-unitbtn' + (unit === id ? ' on' : ''), type: 'button', onclick: () => this.setUnits(id) }, label);
    const heightBtn = (id: 'ft' | 'm', label: string) =>
      h('button', { class: 'fh-btn fh-unitbtn' + (height === id ? ' on' : ''), type: 'button', onclick: () => this.setHeight(id) }, label);
    const weight = app.settings.weight_unit;
    const weightBtn = (id: WeightUnit) => h('button', { class: 'fh-btn fh-unitbtn' + (weight === id ? ' on' : ''), type: 'button', 'data-weight-unit': id, onclick: () => { app.setWeightUnit(id); this.renderProfileBar(); this.renderTable(); this.updateFieldStates(); this.updateLive(); } }, id);
    const shown = this.draft ? h('span', { class: 'fh-profilename' }, profileLabel(this.draft.id)) : null;
    const u = app.settings.ui;
    const sw = (cls: string, on: boolean, label: string, set: (v: boolean) => void, enabled = true) =>
      h('label', { class: 'fh-slide' + (enabled ? '' : ' off') }, h('input', { type: 'checkbox', class: cls, 'aria-label': label, checked: on, disabled: !enabled, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), h('span', { class: 'fh-slidetrack' }, h('span', { class: 'fh-slideknob' })));
    const row = (label: string, control: HTMLElement, enabled = true) => h('div', { class: 'fh-optrow' }, h('span', { class: 'fh-unitlab' + (enabled ? '' : ' off') }, label), control);
    const toggles = h('div', { class: 'fh-toggles' }, h('div', { class: 'fh-optrow' }, h('span', { class: 'fh-unitlab' }, 'Speed'), h('span', { class: 'fh-units' }, unitBtn('kt', 'kt'), unitBtn('kmh', 'km/h'))), h('div', { class: 'fh-optrow' }, h('span', { class: 'fh-unitlab' }, 'Altitude'), h('span', { class: 'fh-units fh-height' }, heightBtn('ft', 'ft'), heightBtn('m', 'm'))), row('Weight', h('span', { class: 'fh-units' }, weightBtn('kg'), weightBtn('lb'))), row('Simple flap indicator', sw('fh-simple-flap', u.simple_flap, 'Simple flap indicator', (v) => { const focused = document.activeElement?.classList.contains('fh-simple-flap'); app.setSimpleFlap(v); this.renderProfileBar(); if (focused) this.profileBar.querySelector<HTMLInputElement>('.fh-simple-flap')?.focus(); })), row('Flap transitions', sw('fh-show-transitions', u.show_transitions, 'Flap transitions', (v) => app.setShowTransitions(v), !u.simple_flap), !u.simple_flap), row('Weight / ballast bar', sw('fh-show-ballast', u.show_ballast, 'Weight / ballast bar', (v) => app.setShowBallast(v))), h('div', { class: 'fh-optrow' }, h('span', { class: 'fh-unitlab' }, 'AGL bar'), sw('fh-show-agl', u.show_agl, 'AGL bar', (v) => { app.setShowAgl(v); this.renderProfileBar(); }), h('span', { class: 'fh-unitlab fh-beside' + (u.show_agl ? '' : ' off') }, 'Wind speed'), sw('fh-show-wind', u.show_wind, 'Wind speed', (v) => app.setShowWind(v), u.show_agl)));
    this.saveAsBtn = files ? h('button', { class: 'fh-btn fh-saveas', type: 'button', disabled: !canSaveWeightMode(this.draft, this.weightMode), onclick: () => void this.saveAs() }, 'Save As...') as HTMLButtonElement : null;
    const profile = h('div', { class: 'fh-prow' }, h('label', null, 'Profile'), shown, files ? h('button', { class: 'fh-btn fh-open', type: 'button', onclick: () => void this.openFile() }, 'Open...') : null, this.saveAsBtn, app.host.capabilities.openFolder ? h('button', { class: 'fh-btn', type: 'button', onclick: () => app.host.openProfilesFolder() }, 'Open profiles folder') : null);
    this.profileBar.appendChild(toggles);
    this.profileBar.appendChild(profile);
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
        h('label', { class: 'fh-sub' }, 'Light / None'),
        this.fieldInput(path + '.no_ballast_kt', formatSpeedField(s.no_ballast_kt, unit), { cls: 'fh-speed', step: '1', onInput: (t) => { get().no_ballast_kt = storeSpeed(t); }, label: title + ' Light weight / No Ballast' }),
        h('label', { class: 'fh-sub' }, 'Heavy / Max'),
        this.fieldInput(path + '.max_ballast_kt', formatSpeedField(s.max_ballast_kt, unit), { cls: 'fh-speed', step: '1', placeholder: isEnd ? 'same' : '', onInput: (t) => { get().max_ballast_kt = storeSpeed(t); }, label: title + ' Heavy weight / Max Ballast' }),
        h('span', { class: 'fh-unit' }, unitLabel(unit)),
      );
    };

    const mode = h('select', { class: 'fh-in fh-weight-mode', 'aria-label': 'Flying weight mode', onchange: (e: Event) => this.selectWeightMode((e.target as HTMLSelectElement).value as WeightMode) },
      h('option', { value: 'manual' }, 'Manual ballast slider'), h('option', { value: 'live' }, 'Live flying weight')) as HTMLSelectElement;
    // The DOM helper sets value before appending options; select explicitly afterwards.
    mode.value = this.weightMode;
    this.table.appendChild(h('div', { class: 'fh-erow' }, h('label', { class: 'fh-rowname' }, 'Weight mode'), mode));
    if (this.weightMode === 'live') this.table.appendChild(h('div', { class: 'fh-erow' },
      h('label', { class: 'fh-rowname' }, 'Flying weights (' + this.app.settings.weight_unit + ')'),
      h('label', { class: 'fh-sub' }, 'Light'),
      this.fieldInput('weight_kg.light', formatWeightField(d.weight_kg.light, this.app.settings.weight_unit), { cls: 'fh-speed', step: '1', label: 'Light flying weight (' + this.app.settings.weight_unit + ')', onInput: (t) => { const v = numberOrNull(t); d.weight_kg.light = v === null ? null : weightToKilograms(v, this.app.settings.weight_unit); } }),
      h('label', { class: 'fh-sub' }, 'Heavy'),
      this.fieldInput('weight_kg.heavy', formatWeightField(d.weight_kg.heavy, this.app.settings.weight_unit), { cls: 'fh-speed', step: '1', label: 'Heavy flying weight (' + this.app.settings.weight_unit + ')', onInput: (t) => { const v = numberOrNull(t); d.weight_kg.heavy = v === null ? null : weightToKilograms(v, this.app.settings.weight_unit); } })));
    this.table.appendChild(h('div', { class: 'fh-hint' }, this.weightMode === 'live' ? 'Enter both positive loaded weights (Light below Heavy) before saving. The display uses live MSFS aircraft weight.' : 'No flying weights are required. The display uses the saved manual slider position with the No/Max Ballast speeds.'));
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

  private selectWeightMode(mode: WeightMode): void {
    if (!this.draft || mode === this.weightMode || (mode !== 'manual' && mode !== 'live')) return;
    if (mode === 'manual') {
      this.previousWeights = { ...this.draft.weight_kg };
      this.draft.weight_kg = { light: null, heavy: null };
    } else if (this.previousWeights) {
      this.draft.weight_kg = { ...this.previousWeights };
    }
    this.weightMode = mode;
    this.edited(true);
    this.table.querySelector<HTMLElement>('.fh-weight-mode')?.focus();
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
    const editingOther = app.info.mainWindow && !!d && d.id !== app.profile?.id;
    if (app.info.mainWindow) {
      const context = (d?.id ?? '') + ':' + (editingOther ? 'inactive' : app.liveCount());
      if (context !== this.liveValidationContext) {
        this.liveValidationContext = context;
        this.revalidate();
        this.updateFieldStates();
        this.renderValidation();
      }
    }
    let live = 'Live: no sim data';
    let liveIdx: number | null = null;
    if (s && s.connected && s.flapIndex !== null) {
      liveIdx = Math.round(s.flapIndex);
      const row = !editingOther && d ? d.flaps.find((r) => r.handle_index === liveIdx) : undefined;
      live = `Live: handle index ${liveIdx}` + (s.flapCount !== null ? ` of ${s.flapCount}` : '') + (row ? ` [flap "${row.label}"]` : '');
    }
    const kg = liveWeight(null, s, deriveLink(s, app.lastRx, Date.now()) === 'live').kg;
    const weight = kg === null ? 'unavailable' : `${Math.round(kilogramsToWeight(kg, app.settings.weight_unit))} ${app.settings.weight_unit}`;
    setText(this.liveLine, `${live} · Aircraft weight: ${weight}`);
    if (editingOther) this.liveLine.textContent += ' | Active flight profile: ' + (app.profile ? profileLabel(app.profile.id) : 'waiting') + ' (editing a separate draft)';
    this.rowEls.forEach((r) => toggleClass(r, 'live', !editingOther && liveIdx !== null && r.getAttribute('data-handle') === String(liveIdx)));
  }

  // ------------------------------------------------------------ Advanced page

  private renderAdvanced(): void {
    clear(this.advanced);
    const d = this.draft;
    if (!d) return;
    const num = (label: string, get: () => number | null, set: (v: number | null) => void, step = '1', ph = '') =>
      h('div', { class: 'fh-arow' }, h('label', null, label), h('input', { class: 'fh-in', type: 'number', step, value: fmtNum(get()), placeholder: ph, oninput: (e: Event) => { set(numberOrNull((e.target as HTMLInputElement).value)); this.edited(false); } }));
    const text = (label: string, get: () => string, set: (v: string) => void, ph = '') =>
      h('div', { class: 'fh-arow' }, h('label', null, label), h('input', { class: 'fh-in fh-wide', type: 'text', value: get(), placeholder: ph, oninput: (e: Event) => { set((e.target as HTMLInputElement).value); this.edited(false); } }));

    const height = this.app.settings.height === 'm' ? 'm' : 'ft';
    this.aglInputs = [];
    this.aglUnits = [];
    const aglField = (label: string, key: 'bottom_m' | 'top_m' | 'low_m' | 'high_m') => {
      const input = h('input', { class: 'fh-in', type: 'number', min: '0', step: '1', value: String(metresToHeight(this.app.settings.agl[key], height)), oninput: (e: Event) => { const v = numberOrNull((e.target as HTMLInputElement).value); if (v === null || v < 0) return; this.app.setAglEdge(key, heightToMetres(v, this.app.settings.height === 'm' ? 'm' : 'ft')); } }) as HTMLInputElement;
      const unitEl = h('span', { class: 'fh-pct' }, heightUnitLabel(height));
      this.aglInputs.push(input);
      this.aglUnits.push(unitEl);
      return h('span', { class: 'fh-aglfield' }, h('label', null, label), input, unitEl);
    };
    const body = h('div', { class: 'fh-advbody' },
      h('div', { class: 'fh-subtitle' }, 'Display'),
      num('Marker smoothing (ms, 0 = off)', () => d.marker_smoothing_ms, (v) => { d.marker_smoothing_ms = Math.max(0, v ?? 0); }, '50'),
      h('div', { class: 'fh-arow' }, h('label', null, 'Bar shading'), h('label', { class: 'fh-slide' }, h('input', { type: 'checkbox', class: 'fh-bar-shading', 'aria-label': 'Bar shading', checked: this.app.settings.ui.bar_shading, onchange: (e: Event) => this.app.setBarShading((e.target as HTMLInputElement).checked) }), h('span', { class: 'fh-slidetrack' }, h('span', { class: 'fh-slideknob' })))),
      h('div', { class: 'fh-subtitle' }, 'AGL bar'),
      h('div', { class: 'fh-sub' }, 'The bar runs from Bottom to Top and turns green from Low to High.'),
      h('div', { class: 'fh-arow' }, aglField('Bottom', 'bottom_m'), aglField('Top', 'top_m')),
      h('div', { class: 'fh-arow' }, aglField('Low', 'low_m'), aglField('High', 'high_m')),
      h('div', { class: 'fh-subtitle' }, 'Manual ballast fallback (profiles without both flying weights)'),
      h('div', { class: 'fh-arow' }, h('label', null, 'Default ballast'), h('input', { class: 'fh-in', type: 'number', min: '0', max: '100', step: '5', value: String(Math.round(d.ballast.default_fraction * 100)), oninput: (e: Event) => { const v = numberOrNull((e.target as HTMLInputElement).value); d.ballast.default_fraction = Math.max(0, Math.min(100, v ?? 0)) / 100; this.edited(false); } }), h('span', { class: 'fh-pct' }, '%')),
      h('div', { class: 'fh-arow' }, h('label', null, 'Drag snap'), h('input', { class: 'fh-in', type: 'number', min: '0', max: '100', step: '1', value: String(Math.round(d.ballast.drag_snap * 100)), oninput: (e: Event) => { const v = numberOrNull((e.target as HTMLInputElement).value); d.ballast.drag_snap = Math.max(0, Math.min(100, v ?? 0)) / 100; this.edited(false); } }), h('span', { class: 'fh-pct' }, '%')),
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
    if (caps.alwaysOnTop) rows.push(h('div', { class: 'fh-arow' }, h('label', { class: 'fh-check' }, h('input', { type: 'checkbox', class: 'fh-aot', checked: u.always_on_top, onchange: (e: Event) => app.setAlwaysOnTop((e.target as HTMLInputElement).checked) }), ' Keep the external panel on top of the sim')));
    if (caps.opacity) rows.push(h('div', { class: 'fh-arow' }, h('label', null, 'External panel opacity'), h('input', { type: 'range', min: '0.3', max: '1', step: '0.05', value: String(u.opacity), oninput: (e: Event) => app.setOpacity(Number((e.target as HTMLInputElement).value)) })));
    rows.push(h('div', { class: 'fh-arow' }, h('label', null, 'Zoom'), h('input', { type: 'range', min: '0.5', max: '2', step: '0.1', value: String(u.zoom), oninput: (e: Event) => app.setZoom(Number((e.target as HTMLInputElement).value)) })));
    rows.push(h('div', { class: 'fh-arow' }, h('label', { class: 'fh-check' }, h('input', { type: 'checkbox', class: 'fh-demo', checked: u.demo_mode, onchange: (e: Event) => app.setDemoMode((e.target as HTMLInputElement).checked) }), ' Demo mode: use simulated data instead of the sim')));
    if (caps.files) {
      rows.push(h('div',{class:'fh-arow'},h('label',{class:'fh-check'},h('input',{type:'checkbox',class:'fh-auto-hide-external',checked:u.auto_hide_external,onchange:(e:Event)=>app.setAutoHideExternal((e.target as HTMLInputElement).checked)}),' Auto-hide from external views (in-sim panel only)')));
    }
    if (app.host.panelStatus) rows.push(this.panelInstallBox());
    rows.push(h('div', { class: 'fh-hint' }, 'Version ' + app.info.version + ' | data source: ' + (app.usingSim ? 'simulated' : app.info.source)));
    this.appBox.appendChild(h('details', { class: 'fh-details' }, h('summary', null, 'Window and app'), ...rows));
  }

  private panelInstallBox(): HTMLElement {
    const app=this.app, host=app.host;
    let busy=false, status:PanelInstallStatus|null=null, generation=0;
    const choice=()=>app.settings.panel_destination;
    const selector=h('select',{'aria-label':'Panel destination'},h('option',{value:'community'},'Default Community'),h('option',{value:'custom'},'Custom folder')) as HTMLSelectElement;
    const target=h('input',{type:'text',readonly:true,'aria-label':'Custom package parent',class:'fh-panel-path'}) as HTMLInputElement;
    const browse=h('button',{type:'button',class:'fh-btn'},'Browse') as HTMLButtonElement;
    const custom=h('div',{class:'fh-arow'},target,browse);
    const enabled=h('input',{type:'checkbox','aria-label':'Enable in-sim panel'}) as HTMLInputElement;
    const version=h('div',{class:'fh-hint'});
    const location=h('div',{class:'fh-hint'});
    const note=h('div',{class:'fh-hint',role:'status'});
    const update=h('button',{type:'button',class:'fh-btn'},'Update') as HTMLButtonElement;
    function paint(message?:string){
      selector.value=choice().kind;selector.disabled=busy;custom.hidden=choice().kind!=='custom';
      custom.style.display=custom.hidden?'none':'';
      target.value=choice().customParent??'';browse.disabled=busy;
      enabled.checked=status?.installed??false;enabled.disabled=busy||!status||!(status.installed?status.canRemove:status.action==='Install');
      update.hidden=status?.action!=='Update'||!status.installed;update.disabled=busy;
      location.hidden=choice().kind!=='community';setText(location,status?.community?'Community: '+status.community:'Community not detected');
      setText(version,status?.installedVersion?'Installed version: '+status.installedVersion:'Installed version: —');
      setText(note,message??status?.message??'Checking installation…');
    }
    function apply(next:PanelInstallStatus){
      status=next;
      if(JSON.stringify(choice())!==JSON.stringify(next.destination)){app.settings.panel_destination=next.destination;app.persistSoon();}
      app.setPanelUpdateIndicator(next);
    }
    async function refresh(next?:PanelDestination){
      const id=++generation;
      if(next){app.settings.panel_destination=next;app.persistSoon();}
      busy=true;status=null;paint();
      try{const result=await host.panelStatus!(choice());if(id===generation)apply(result);}
      catch(e){if(id===generation){busy=false;paint(String(e));return;}}
      if(id===generation){busy=false;paint();}
    }
    async function mutate(action:()=>Promise<PanelInstallResult>){
      if(busy)return;busy=true;paint();
      try{const result=await action();apply(result.status);busy=false;paint(result.ok?undefined:result.message);}
      catch(e){busy=false;paint(String(e));}
    }
    selector.onchange=()=>void refresh({...choice(),kind:selector.value==='custom'?'custom':'community'});
    browse.onclick=async()=>{if(busy)return;busy=true;paint();try{const selected=await host.browsePanelParent!();busy=false;if(selected)await refresh({kind:'custom',customParent:selected});else paint();}catch(e){busy=false;paint(String(e));}};
    enabled.onchange=()=>{const value=enabled.checked;void mutate(()=>host.setPanelInstalled!(choice(),value));};
    update.onclick=()=>void mutate(()=>host.updatePanel!(choice()));
    const box=h('div',{class:'fh-panel-install'},h('strong',null,'In-sim panel'),h('div',{class:'fh-arow'},h('label',{class:'fh-check'},enabled,' Enable in-sim panel')),h('div',{class:'fh-arow'},h('label',null,'Install destination'),selector),custom,location,version,h('div',{class:'fh-arow'},update,note));
    void refresh();return box;
  }

  // ------------------------------------------------------------- File actions

  private async openFile(): Promise<void> {
    const text = await this.app.host.openJson();
    if (text !== null) this.app.importText(text, 'opened file');
  }

  private async saveAs(): Promise<void> {
    if (!this.draft || !canSaveWeightMode(this.draft, this.weightMode)) return;
    const p = profileForWeightMode(this.draft, this.weightMode);
    const ok = await this.app.host.saveJson(p.id + '.flaphappy.json', exportProfileJson(p));
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
