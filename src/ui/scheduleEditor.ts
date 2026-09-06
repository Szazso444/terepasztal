import { el, btn } from './dom';
import { STR } from '../strings';
import type { Builder } from '../sim/build';
import { defaultStop, type StopPlan } from '../sim/trains';
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
      ),
    );
  }
}
