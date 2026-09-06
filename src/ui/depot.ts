import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { Inventory } from '../gacha/inventory';
import { Fleet, MAX_LOCOS, MAX_WAGONS } from '../sim/fleet';
import type { Builder } from '../sim/build';
import { locoDef, wagonDef, levelMul } from '../gacha/items';
import { defaultStop, type Train, type StopPlan } from '../sim/trains';
import { cargoDef } from '../sim/cargo';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg, frameForItem } from './spritePreview';

/** Depot: assemble trains from owned rolling stock and program their looped schedule. */
export class DepotScreen implements Screen {
  readonly id = 'depot';
  readonly title = STR.depot.title;
  readonly root = el('div', { class: 'cols' });
  private trainsCol = el('div', { class: 'col-body' });
  private consistCol = el('div', { class: 'col-body' });
  private routeCol = el('div', { class: 'col-body' });
  private foot = el('div', { class: 'col-foot' });
  private summary = el('div', { class: 'col-foot' });
  private locoUids: number[] = [];
  private wagonUids: number[] = [];
  private schedule: StopPlan[] = [];
  private editing: Train | null = null;
  private nameInput = el('input', {
    class: 'text',
    type: 'text',
    placeholder: STR.depot.namePlaceholder,
    maxlength: '24',
  });
  onFocusTrain: ((t: Train) => void) | null = null;
  onDetails: ((t: Train) => void) | null = null;

  constructor(
    private readonly inventory: Inventory,
    private readonly fleet: Fleet,
    private readonly builder: Builder,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private readonly atlas: AtlasRegistry,
  ) {
    const c1 = el(
      'div',
      { class: 'col' },
      el('div', { class: 'col-title', text: STR.depot.trains }),
      this.trainsCol,
    );
    const c2 = el(
      'div',
      { class: 'col' },
      el('div', { class: 'col-title', text: STR.depot.consist }),
      this.consistCol,
      this.summary,
    );
    const c3 = el(
      'div',
      { class: 'col' },
      el('div', { class: 'col-title', text: STR.depot.route }),
      this.routeCol,
      this.foot,
    );
    this.root.append(c1, c2, c3);
  }

  onOpen() {
    this.render();
  }
  refresh() {
    this.renderTrains();
  }

  private startNew() {
    this.editing = null;
    this.locoUids = [];
    this.wagonUids = [];
    this.schedule = [];
    this.nameInput.value = '';
    this.render();
  }

  private edit(t: Train) {
    this.editing = t;
    this.schedule = t.schedule.map((s) => ({ ...s }));
    this.render();
  }

  render() {
    this.renderTrains();
    this.renderConsist();
    this.renderRoute();
  }

  stateLabel(t: Train) {
    if (t.blocked && t.state === 'moving') return STR.depot.state.held;
    return STR.depot.state[t.state] ?? t.state;
  }

  private renderTrains() {
    const c = this.trainsCol;
    c.innerHTML = '';
    c.append(btn(STR.depot.newTrain, () => this.startNew(), this.editing ? '' : 'active'));
    if (!this.fleet.trains.length)
      c.append(el('div', { class: 'dim', text: STR.depot.noTrains, style: 'margin-top:8px' }));
    for (const t of this.fleet.trains) {
      const routeNames = t.route.map((id) => this.builder.stationById(id)?.name ?? '?').join(' > ');
      const next = this.builder.stationById(t.route[t.routeIndex % Math.max(1, t.route.length)]);
      const item = el(
        'div',
        { class: `item ${this.editing === t ? 'selected' : ''}` },
        el(
          'div',
          {},
          el('div', { class: 'name', text: t.name }),
          el('div', {
            class: 'sub',
            text: `${t.locos.map((l) => l.def.name).join(' + ')} + ${t.wagons.length} · ${routeNames}`,
          }),
          el('div', {
            class: `sub state-${t.state}`,
            text: `${this.stateLabel(t)}${next ? ` → ${next.name}` : ''} · ${STR.depot.cargo(Math.round(t.totalCargo()))} · ${Math.round(t.weight)}/${Math.round(t.power)} t${t.lastMessage ? ` · ${t.lastMessage}` : ''}`,
          }),
        ),
        el(
          'div',
          { class: 'row', style: 'margin:0' },
          btn(STR.depot.details, () => this.onDetails?.(t), 'small'),
          btn(STR.depot.locate, () => this.onFocusTrain?.(t), 'small'),
          btn(STR.depot.editRoute, () => this.edit(t), 'small'),
          btn(
            STR.depot.recall,
            () => {
              const salvage = this.fleet.recall(t);
              if (salvage > 0) this.toast(STR.depot.salvaged(fmtMoney(salvage)), 'info');
              if (this.editing === t) this.startNew();
              this.render();
            },
            'small',
          ),
        ),
      );
      c.append(item);
    }
  }

  private renderConsist() {
    const c = this.consistCol;
    c.innerHTML = '';
    if (this.editing) {
      const t = this.editing;
      c.append(el('div', { class: 'dim', text: STR.depot.editingConsist(t.name) }));
      for (const l of t.locos)
        c.append(
          this.itemRow(
            l.def.name,
            l.def.rarity,
            `${STR.depot.speed} ${(l.def.speed * levelMul(l.level)).toFixed(1)} · ${STR.depot.power} ${Math.round(l.def.power * levelMul(l.level))} t`,
            false,
            () => {},
            l.def.id,
          ),
        );
      for (const w of t.wagons)
        c.append(
          this.itemRow(
            w.def.name,
            w.def.rarity,
            w.cargo
              ? `${cargoDef(w.cargo).name} ${Math.round(w.amount)}/${Math.round(w.def.capacity * levelMul(w.level))}`
              : `${STR.depot.empty} ${Math.round(w.def.capacity * levelMul(w.level))}`,
            false,
            () => {},
            w.def.id,
          ),
        );
      this.summary.innerHTML = '';
      return;
    }
    c.append(
      el('div', {
        class: 'col-title',
        text: `${STR.depot.locomotive} (${this.locoUids.length}/${MAX_LOCOS})`,
      }),
    );
    const locos = this.inventory.free('loco');
    if (!locos.length) c.append(el('div', { class: 'dim', text: STR.depot.noFreeLoco }));
    for (const it of locos) {
      const d = locoDef(it.defId);
      const m = levelMul(it.level);
      const sel = this.locoUids.includes(it.uid);
      c.append(
        this.itemRow(
          `${d.name} Lv${it.level}`,
          d.rarity,
          `${STR.roster.type[d.type]} · ${STR.depot.speed} ${(d.speed * m).toFixed(1)} · ${STR.depot.power} ${Math.round(d.power * m)} t · ${STR.roster.crew} ${d.crew}`,
          sel,
          () => {
            if (sel) this.locoUids = this.locoUids.filter((u) => u !== it.uid);
            else if (this.locoUids.length < MAX_LOCOS) this.locoUids.push(it.uid);
            else this.toast(STR.fleet.tooManyLocos(MAX_LOCOS), 'warn');
            this.renderConsist();
          },
          it.defId,
        ),
      );
    }
    c.append(
      el('div', {
        class: 'col-title',
        text: `${STR.depot.wagons} (${this.wagonUids.length}/${MAX_WAGONS})`,
      }),
    );
    const wagons = this.inventory.free('wagon');
    if (!wagons.length) c.append(el('div', { class: 'dim', text: STR.depot.noFreeWagons }));
    for (const it of wagons) {
      const d = wagonDef(it.defId);
      const sel = this.wagonUids.includes(it.uid);
      c.append(
        this.itemRow(
          `${d.name} Lv${it.level}`,
          d.rarity,
          `${STR.roster.carries[d.carries]} · ${Math.round(d.capacity * levelMul(it.level))}u · ${d.weight}t`,
          sel,
          () => {
            if (sel) this.wagonUids = this.wagonUids.filter((u) => u !== it.uid);
            else if (this.wagonUids.length < MAX_WAGONS) this.wagonUids.push(it.uid);
            else this.toast(STR.fleet.tooManyWagons(MAX_WAGONS), 'warn');
            this.renderConsist();
          },
          it.defId,
        ),
      );
    }
    // summary: haul weight vs power
    const s = this.summary;
    s.innerHTML = '';
    if (this.locoUids.length) {
      const power = this.locoUids.reduce((a, u) => {
        const it = this.inventory.byUid(u)!;
        return a + locoDef(it.defId).power * levelMul(it.level);
      }, 0);
      const weight = this.wagonUids.reduce(
        (a, u) => a + wagonDef(this.inventory.byUid(u)!.defId).weight,
        0,
      );
      const wrap = el('div', { style: 'flex:1' });
      wrap.append(
        el('div', { class: 'sub', text: STR.depot.haul(Math.round(weight), Math.round(power)) }),
      );
      wrap.append(
        el(
          'div',
          { class: `meter ${weight > power ? 'over' : ''}` },
          el('div', { style: `width:${Math.min(100, (weight / Math.max(1, power)) * 100)}%` }),
        ),
      );
      s.append(wrap);
    } else s.append(el('div', { class: 'dim', text: STR.depot.pickLoco }));
  }

  private itemRow(
    name: string,
    rarity: string,
    sub: string,
    selected: boolean,
    onClick: () => void,
    defId?: string,
  ) {
    const r = el(
      'div',
      { class: `item ${selected ? 'selected' : ''}` },
      defId ? spriteImg(this.atlas, frameForItem(defId), 1, 'sprite-preview item-art') : null,
      el(
        'div',
        {},
        el('div', { class: `name rarity-${rarity}`, text: name }),
        el('div', { class: 'sub', text: sub }),
      ),
    );
    r.addEventListener('click', onClick);
    return r;
  }

  private stopRow(stop: StopPlan, i: number) {
    const st = this.builder.stationById(stop.stationId);
    const select = (value: string, opts: [string, string][], on: (v: string) => void) => {
      const s = el('select', { class: 'text small' }) as HTMLSelectElement;
      for (const [v, t] of opts) s.append(el('option', { value: v, text: t }));
      s.value = value;
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    const toggle = (label: string, on: boolean, set: (v: boolean) => void) => {
      const b = btn(
        label,
        () => {
          set(!on);
          this.renderRoute();
        },
        `small ${on ? 'active' : ''}`,
      );
      return b;
    };
    return el(
      'div',
      { class: 'route-step' },
      el(
        'div',
        { class: 'route-head' },
        el('span', { class: 'idx', text: String(i + 1) }),
        el('span', { class: 'grow', text: st?.name ?? '?' }),
        btn(
          '^',
          () => {
            if (i > 0)
              [this.schedule[i - 1], this.schedule[i]] = [this.schedule[i], this.schedule[i - 1]];
            this.renderRoute();
          },
          'small',
        ),
        btn(
          'x',
          () => {
            this.schedule.splice(i, 1);
            this.renderRoute();
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

  private renderRoute() {
    const c = this.routeCol;
    c.innerHTML = '';
    c.append(el('div', { class: 'col-title', text: STR.depot.stops }));
    if (!this.schedule.length) c.append(el('div', { class: 'dim', text: STR.depot.noStops }));
    this.schedule.forEach((stop, i) => c.append(this.stopRow(stop, i)));
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
        '→',
        st.def.stockpile
          ? STR.depot.stockpileTag
          : st.def.accepts.map((x) => cargoDef(x).name).join(', ') || '-',
        st.refuelsFuel ? STR.depot.fuelTag : '',
        st.refuelsWater ? STR.depot.waterTag : '',
        hasPlat ? '' : STR.station.noPlatform,
      ].filter(Boolean);
      const row = this.itemRow(st.name, 'N', tags.join(' '), false, () => {
        if (!hasPlat) return;
        this.schedule.push(defaultStop(st.id));
        this.renderRoute();
      });
      if (!hasPlat) row.classList.add('disabled');
      c.append(row);
    }
    const f = this.foot;
    f.innerHTML = '';
    if (this.editing) {
      const t = this.editing;
      f.append(
        btn(
          STR.depot.applyRoute,
          () => {
            if (this.schedule.length < 2) {
              this.toast(STR.depot.needTwoStops, 'warn');
              return;
            }
            this.fleet.setSchedule(
              t,
              this.schedule.map((s) => ({ ...s })),
            );
            this.toast(STR.depot.routeApplied(t.name), 'good');
            this.render();
          },
          'accent',
        ),
      );
    } else {
      f.append(
        this.nameInput,
        btn(
          STR.depot.dispatch,
          () => {
            const res = this.fleet.create(
              this.locoUids,
              this.wagonUids,
              this.schedule,
              this.nameInput.value.trim() || undefined,
            );
            if (typeof res === 'string') this.toast(res, 'warn');
            else {
              this.toast(STR.depot.dispatched(res.name), 'good');
              this.startNew();
            }
          },
          'accent',
        ),
      );
    }
    f.append(el('span', { class: 'dim', text: STR.depot.scheduleHint }));
  }
}
