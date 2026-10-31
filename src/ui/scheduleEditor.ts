import { el } from './dom';
import { STR } from '../strings';
import type { Builder } from '../sim/build';
import type { StopPlan } from '../sim/trains';
import { cargoDef } from '../sim/cargo';
import {
  actionButton,
  listRow,
  note,
  numberField,
  sectionHeader,
  segmented,
  toggleSwitch,
} from './kit';
import {
  DWELL_BIG_STEP,
  DWELL_STEP,
  MAX_DWELL,
  appendStop,
  editorSignature,
  moveStopUp,
  removeStopAt,
  stationRow,
  type StationRow,
} from './depotView';

/**
 * Editable stop list shared by the train screen (live trains) and the depot (optional custom
 * route for a new train). Works on the array in place and calls `onChange` after every edit.
 * `render` draws it now; `sync` is for the half-second refresh and draws again only when what it
 * shows has changed, and never while a number is being typed.
 */
export class ScheduleEditor {
  readonly root = el('div', { class: 'dp-editor' });
  private schedule: StopPlan[] = [];
  private current = -1;
  /** what the stops and the station list were drawn from */
  private drawn = '';

  constructor(
    private readonly builder: Builder,
    private readonly onChange: () => void,
  ) {}

  private stations(): StationRow[] {
    return this.builder.stations.map((st) =>
      stationRow({
        id: st.id,
        name: st.name,
        produces: st.producedCargo().map((x) => cargoDef(x).name),
        refuelsFuel: st.refuelsFuel,
        refuelsWater: st.refuelsWater,
        hasPlatform: this.builder.platformTiles(st).length > 0,
      }),
    );
  }

  /** Draw the stops of `schedule` now; `current` is the stop the train heads for (-1: none). */
  render(schedule: StopPlan[], current = -1) {
    this.schedule = schedule;
    this.current = current;
    this.draw();
  }

  /** The refresh: draw again only if something shown has changed. */
  sync(schedule: StopPlan[], current = -1) {
    const same = schedule === this.schedule;
    if (same && editorSignature(schedule, current, this.stations()) === this.drawn) return;
    // a number being typed in stays as it is until the field is left
    const typing = document.activeElement;
    if (same && typing instanceof HTMLInputElement && this.root.contains(typing)) return;
    this.render(schedule, current);
  }

  private draw() {
    const rows = this.stations();
    this.drawn = editorSignature(this.schedule, this.current, rows);
    const stops = el('div', { class: 'dp-stops' });
    if (!this.schedule.length) stops.append(note(STR.depot.noStops));
    this.schedule.forEach((s, i) => stops.append(this.stopBlock(i, s)));
    const add = el('div', { class: 'dp-add' });
    if (!rows.length) add.append(note(STR.depot.noStations));
    for (const r of rows) add.append(this.addRow(r));
    this.root.replaceChildren(stops, sectionHeader(STR.depot.addStop, String(rows.length)), add);
  }

  /** An edit the controls already show: tell the owner and remember what is drawn. */
  private edited() {
    this.onChange();
    this.drawn = editorSignature(this.schedule, this.current, this.stations());
  }
  /** An edit that changes the list: tell the owner and draw it again. */
  private restructured() {
    this.onChange();
    this.draw();
  }

  private addRow(r: StationRow): HTMLElement {
    const add = () => {
      if (!r.hasPlatform) return;
      appendStop(this.schedule, r.id);
      this.restructured();
    };
    const tags = r.tags.filter((t) => t !== STR.station.noPlatform).join(' · ');
    const sub = el('span', {}, tags);
    if (!r.hasPlatform)
      sub.append(tags ? ' · ' : '', el('span', { class: 'k-bad', text: STR.station.noPlatform }));
    return listRow({
      title: r.name,
      sub: [sub],
      cls: r.hasPlatform ? '' : 'off',
      onClick: r.hasPlatform ? add : undefined,
      right: [
        actionButton(STR.depot.add, add, {
          cls: 'small',
          icon: 'plus',
          disabled: !r.hasPlatform,
          title: r.hasPlatform ? undefined : STR.depot.noPlatformHint(r.name),
        }),
      ],
    });
  }

  /** A label in front of a control. */
  private opt(label: string, control: HTMLElement, title?: string): HTMLElement {
    const o = el('span', { class: 'dp-o' }, el('small', { text: label }), control);
    if (title) o.title = title;
    return o;
  }

  /** A switch with its label beside it; the label turns it too. */
  private switch(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const sw = toggleSwitch(label, get, (v) => {
      set(v);
      this.edited();
    });
    sw.classList.add('sm');
    const text = el('small', { text: label });
    text.addEventListener('click', () => sw.click());
    return el('span', { class: 'dp-o' }, sw, text);
  }

  private dwell(
    label: string,
    title: string,
    value: number,
    set: (v: number) => void,
  ): HTMLElement {
    return this.opt(
      label,
      numberField({
        value,
        label: title,
        min: 0,
        max: MAX_DWELL,
        step: DWELL_STEP,
        bigStep: DWELL_BIG_STEP,
        unit: STR.depot.dwellUnit,
        cls: 'small',
        onChange: (v) => {
          set(v);
          this.edited();
        },
      }),
      title,
    );
  }

  private seg<T extends string>(
    options: [T, string, string][],
    value: T,
    set: (v: T) => void,
  ): HTMLElement {
    return segmented({
      options: options.map(([id, label, title]) => ({ id, label, title })),
      value,
      cls: 'small',
      onChange: (id) => {
        set(id as T);
        this.edited();
      },
    });
  }

  private stopBlock(i: number, stop: StopPlan): HTMLElement {
    const st = this.builder.stationById(stop.stationId);
    const name = el('span', { class: 'dp-sn', text: st?.name ?? '?' });
    if (i === this.current) name.append(el('em', { class: 'dp-cur', text: `▸ ${STR.depot.next}` }));
    const o = STR.depot;
    return el(
      'div',
      { class: `dp-stop ${i === this.current ? 'on' : ''}`.trim() },
      el(
        'div',
        { class: 'dp-sh' },
        el('b', { class: 'dp-si', text: String(i + 1) }),
        name,
        actionButton(
          '',
          () => {
            if (moveStopUp(this.schedule, i)) this.restructured();
          },
          {
            cls: 'small dp-ico',
            icon: 'up',
            disabled: i === 0,
            title: i === 0 ? o.firstStop : o.moveUp,
          },
        ),
        actionButton(
          '×',
          () => {
            if (removeStopAt(this.schedule, i)) this.restructured();
          },
          { cls: 'small dp-ico', title: o.removeStop },
        ),
      ),
      el(
        'div',
        { class: 'dp-so' },
        this.opt(
          o.stopLoad,
          this.seg(
            [
              ['auto', o.auto, o.opt.loadAuto],
              ['none', o.nothing, o.opt.loadNone],
            ],
            stop.load,
            (v) => (stop.load = v),
          ),
        ),
        this.opt(
          o.stopUnload,
          this.seg(
            [
              ['auto', o.auto, o.opt.unloadAuto],
              ['all', o.all, o.opt.unloadAll],
              ['none', o.nothing, o.opt.unloadNone],
            ],
            stop.unload,
            (v) => (stop.unload = v),
          ),
        ),
        this.opt(
          o.stopDepart,
          this.seg(
            [
              ['auto', o.auto, o.opt.departAuto],
              ['forward', o.forward, o.opt.departForward],
              ['reverse', o.reverse, o.opt.departReverse],
            ],
            stop.depart,
            (v) => (stop.depart = v),
          ),
        ),
      ),
      el(
        'div',
        { class: 'dp-so' },
        this.switch(
          o.opt.waitFull,
          () => stop.waitFull,
          (v) => (stop.waitFull = v),
        ),
        this.switch(
          o.opt.refuel,
          () => stop.refuel,
          (v) => (stop.refuel = v),
        ),
        this.switch(
          o.opt.pass,
          () => stop.pass,
          (v) => (stop.pass = v),
        ),
        this.dwell(o.dwellMin, o.dwellMinHint, stop.minDwell ?? 0, (v) => (stop.minDwell = v)),
        this.dwell(o.dwellMax, o.dwellMaxHint, stop.maxDwell ?? 0, (v) => (stop.maxDwell = v)),
      ),
    );
  }
}
