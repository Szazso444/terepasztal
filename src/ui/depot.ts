import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { Inventory } from '../gacha/inventory';
import { Fleet, MAX_LOCOS, MAX_WAGONS } from '../sim/fleet';
import type { Builder } from '../sim/build';
import { locoDef, wagonDef, levelMul } from '../gacha/items';
import type { Train, StopPlan } from '../sim/trains';
import { ScheduleEditor } from './scheduleEditor';
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
  private scheduleEditor: ScheduleEditor;
  private customRoute = false;

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
    this.scheduleEditor = new ScheduleEditor(builder, () => {});
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
    this.customRoute = false;
    this.nameInput.value = '';
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

  private renderRoute() {
    const c = this.routeCol;
    c.innerHTML = '';
    const auto = this.fleet.autoSchedule();
    const names = auto.map((s) => this.builder.stationById(s.stationId)?.name ?? '?');
    c.append(
      el(
        'div',
        { class: 'row', style: 'margin:0 0 6px 0' },
        btn(
          STR.depot.routeAuto,
          () => {
            this.customRoute = false;
            this.renderRoute();
          },
          `small ${this.customRoute ? '' : 'active'}`,
        ),
        btn(
          STR.depot.routeCustom,
          () => {
            this.customRoute = true;
            this.renderRoute();
          },
          `small ${this.customRoute ? 'active' : ''}`,
        ),
      ),
    );
    if (!this.customRoute) {
      c.append(
        el('div', { class: 'dim', text: STR.depot.routeAutoHint }),
        el('div', {
          class: 'sub',
          style: 'margin-top:6px',
          text: names.length ? names.join(' > ') : STR.depot.noStations,
        }),
      );
    } else {
      this.scheduleEditor.render(this.schedule);
      c.append(this.scheduleEditor.root);
    }
    const f = this.foot;
    f.innerHTML = '';
    f.append(
      this.nameInput,
      btn(
        STR.depot.dispatch,
        () => {
          const res = this.fleet.create(
            this.locoUids,
            this.wagonUids,
            this.customRoute ? this.schedule : [],
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
    f.append(el('span', { class: 'dim', text: STR.depot.scheduleHint }));
  }
}
