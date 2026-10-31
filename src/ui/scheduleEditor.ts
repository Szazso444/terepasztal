import { el, btn } from './dom';
import { STR } from '../strings';
import type { Builder } from '../sim/build';
import type { Commands } from '../sim/commands';
import { defaultStop, type StopPlan, type Train } from '../sim/trains';
import { cargoDef } from '../sim/cargo';

/**
 * Editable stop list shared by the train screen (live trains) and the depot (optional custom
 * route for a new train). Works on the array in place and calls `onChange` after every edit.
 */
export class ScheduleEditor {
  readonly root = el('div', { class: 'schedule-editor' });
  constructor(
    private readonly builder: Builder,
    private readonly onChange: () => void,
  ) {}

  render(schedule: StopPlan[], current = -1) {
    const c = this.root;
    c.innerHTML = '';
    if (!schedule.length) c.append(el('div', { class: 'dim', text: STR.depot.noStops }));
    schedule.forEach((stop, i) => c.append(this.stopRow(schedule, stop, i, i === current)));
    c.append(el('div', { class: 'col-title', text: STR.depot.addStop }));
    if (!this.builder.stations.length)
      c.append(el('div', { class: 'dim', text: STR.depot.noStations }));
    for (const st of this.builder.stations) {
      const hasPlat = this.builder.platformTiles(st).length > 0;
      const tags = [
        st
          .producedCargo()
          .map((x) => cargoDef(x).name)
          .join(', ') || '-',
        st.refuelsFuel ? STR.depot.fuelTag : '',
        st.refuelsWater ? STR.depot.waterTag : '',
        hasPlat ? '' : STR.station.noPlatform,
      ].filter(Boolean);
      const row = el(
        'div',
        { class: `item ${hasPlat ? '' : 'disabled'}` },
        el(
          'div',
          {},
          el('div', { class: 'name', text: st.name }),
          el('div', { class: 'sub', text: tags.join(' · ') }),
        ),
      );
      row.addEventListener('click', () => {
        if (!hasPlat) return;
        schedule.push(defaultStop(st.id));
        this.onChange();
        this.render(schedule, current);
      });
      c.append(row);
    }
  }

  private stopRow(schedule: StopPlan[], stop: StopPlan, i: number, current: boolean) {
    const st = this.builder.stationById(stop.stationId);
    const rerender = () => {
      this.onChange();
      this.render(schedule, current ? i : -1);
    };
    const select = (value: string, opts: [string, string][], on: (v: string) => void) => {
      const s = el('select', { class: 'text small' }) as HTMLSelectElement;
      for (const [v, t] of opts) s.append(el('option', { value: v, text: t }));
      s.value = value;
      s.addEventListener('change', () => {
        on(s.value);
        this.onChange();
      });
      return s;
    };
    const number = (label: string, value: number, set: (v: number) => void) => {
      const wrap = el('label', { class: 'num-opt', title: label });
      const inp = el('input', {
        type: 'number',
        min: '0',
        max: '600',
        step: '5',
        class: 'text small',
      }) as HTMLInputElement;
      inp.value = String(value);
      inp.addEventListener('change', () => {
        set(Math.max(0, Math.min(600, Number(inp.value) || 0)));
        this.onChange();
      });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      wrap.append(el('span', { class: 'dim', text: label }), inp);
      return wrap;
    };
    const toggle = (label: string, on: boolean, set: (v: boolean) => void) =>
      btn(
        label,
        () => {
          set(!on);
          rerender();
        },
        `small ${on ? 'active' : ''}`,
      );
    return el(
      'div',
      { class: `route-step ${current ? 'current' : ''}` },
      el(
        'div',
        { class: 'route-head' },
        el('span', { class: 'idx', text: String(i + 1) }),
        el('span', { class: 'grow', text: (st?.name ?? '?') + (current ? ' ◂' : '') }),
        btn(
          '^',
          () => {
            if (i > 0) [schedule[i - 1], schedule[i]] = [schedule[i], schedule[i - 1]];
            rerender();
          },
          'small',
        ),
        btn(
          'x',
          () => {
            schedule.splice(i, 1);
            rerender();
          },
          'small',
        ),
      ),
      el(
        'div',
        { class: 'route-opts' },
        select(
          stop.load,
          [
            ['auto', STR.depot.opt.loadAuto],
            ['none', STR.depot.opt.loadNone],
          ],
          (v) => (stop.load = v as StopPlan['load']),
        ),
        select(
          stop.unload,
          [
            ['auto', STR.depot.opt.unloadAuto],
            ['all', STR.depot.opt.unloadAll],
            ['none', STR.depot.opt.unloadNone],
          ],
          (v) => (stop.unload = v as StopPlan['unload']),
        ),
        select(
          stop.depart,
          [
            ['auto', STR.depot.opt.departAuto],
            ['forward', STR.depot.opt.departForward],
            ['reverse', STR.depot.opt.departReverse],
          ],
          (v) => (stop.depart = v as StopPlan['depart']),
        ),
        toggle(STR.depot.opt.waitFull, stop.waitFull, (v) => (stop.waitFull = v)),
        toggle(STR.depot.opt.refuel, stop.refuel, (v) => (stop.refuel = v)),
        toggle(STR.depot.opt.pass, stop.pass, (v) => (stop.pass = v)),
        number(STR.depot.opt.minDwell, stop.minDwell ?? 0, (v) => (stop.minDwell = v)),
        number(STR.depot.opt.maxDwell, stop.maxDwell ?? 0, (v) => (stop.maxDwell = v)),
      ),
    );
  }
}

/**
 * The stop editor on a live train, as the Train screen and the train panel show it. It works on a
 * copy of the train's own program, also while a contract job runs its two stops, and hands each
 * edit to the train, which then follows it on schedule (`Commands.setSchedule`). A refused list
 * (fewer than two stops) leaves the train as it was, and the editor shows the train's stops again.
 */
export class TrainStops {
  private readonly editor: ScheduleEditor;
  private train: Train | null = null;
  private stops: StopPlan[] = [];

  constructor(
    builder: Builder,
    private readonly commands: Commands,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
  ) {
    this.editor = new ScheduleEditor(builder, () => this.apply());
  }
  get root() {
    return this.editor.root;
  }
  show(t: Train) {
    this.train = t;
    this.stops = t.program.map(copyStop);
    this.editor.render(this.stops, this.current(t));
  }
  /** The stop being run, when the train runs its own program rather than a contract job. */
  private current(t: Train) {
    return t.program === t.schedule ? t.routeIndex % Math.max(1, t.schedule.length) : -1;
  }
  private apply() {
    const t = this.train;
    if (!t) return;
    const did = this.commands.setSchedule(t, this.stops.map(copyStop));
    if (did.ok) return;
    this.toast(did.message, 'warn');
    // the same array the editor holds, so its own redraw shows the train's stops
    this.stops.splice(0, this.stops.length, ...t.program.map(copyStop));
    this.editor.render(this.stops, this.current(t));
  }
}

/** A stop of its own, so an edit never reaches a stop the train holds. */
function copyStop(s: StopPlan): StopPlan {
  return { ...s };
}
