import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { Inventory } from '../gacha/inventory';
import type { Fleet } from '../sim/fleet';
import type { Builder } from '../sim/build';
import { locoDef, wagonDef, levelMul, type Item } from '../gacha/items';
import type { Train } from '../sim/trains';
import { cargoDef } from '../sim/cargo';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg, frameForItem } from './spritePreview';

/** Depot: assemble trains from owned rolling stock and assign looped routes. */
export class DepotScreen implements Screen {
  readonly id = 'depot';
  readonly title = STR.depot.title;
  readonly root = el('div', { class: 'cols' });
  private trainsCol = el('div', { class: 'col-body' });
  private consistCol = el('div', { class: 'col-body' });
  private routeCol = el('div', { class: 'col-body' });
  private foot = el('div', { class: 'col-foot' });
  private summary = el('div', { class: 'col-foot' });
  private locoUid: number | null = null;
  private wagonUids: number[] = [];
  private route: number[] = [];
  private editing: Train | null = null;
  private nameInput = el('input', {
    class: 'text',
    type: 'text',
    placeholder: STR.depot.namePlaceholder,
    maxlength: '24',
  });
  onFocusTrain: ((t: Train) => void) | null = null;

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
    this.locoUid = null;
    this.wagonUids = [];
    this.route = [];
    this.nameInput.value = '';
    this.render();
  }

  private edit(t: Train) {
    this.editing = t;
    this.route = [...t.route];
    this.render();
  }

  render() {
    this.renderTrains();
    this.renderConsist();
    this.renderRoute();
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
            text: `${t.locoDef.name} + ${t.wagons.length} · ${routeNames}`,
          }),
          el('div', {
            class: `sub state-${t.state}`,
            text: `${t.blocked && t.state === 'moving' ? STR.depot.state.held : STR.depot.state[t.state]}${next ? ` → ${next.name}` : ''} · ${STR.depot.cargo(Math.round(t.totalCargo()))}${t.lastMessage ? ` · ${t.lastMessage}` : ''}`,
          }),
        ),
        el(
          'div',
          { class: 'row', style: 'margin:0' },
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
      c.append(
        this.itemRow(
          t.locoDef.name,
          t.locoDef.rarity,
          `${STR.depot.speed} ${t.maxSpeed.toFixed(1)} · ${STR.depot.power} ${Math.round(t.power)}`,
          false,
          () => {},
          t.locoDef.id,
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
    c.append(el('div', { class: 'col-title', text: STR.depot.locomotive }));
    const locos = this.inventory.free('loco');
    if (!locos.length) c.append(el('div', { class: 'dim', text: STR.depot.noFreeLoco }));
    for (const it of locos) {
      const d = locoDef(it.defId);
      const m = levelMul(it.level);
      c.append(
        this.itemRow(
          `${d.name} Lv${it.level}`,
          d.rarity,
          `${STR.depot.speed} ${(d.speed * m).toFixed(1)} · ${STR.depot.power} ${Math.round(d.power * m)} · ${STR.depot.wagons} ${d.maxWagons}`,
          this.locoUid === it.uid,
          () => {
            this.locoUid = this.locoUid === it.uid ? null : it.uid;
            this.renderConsist();
          },
          it.defId,
        ),
      );
    }
    c.append(el('div', { class: 'col-title', text: STR.depot.wagons }));
    const wagons = this.inventory.free('wagon');
    if (!wagons.length) c.append(el('div', { class: 'dim', text: STR.depot.noFreeWagons }));
    const maxW = this.locoUid ? locoDef(this.inventory.byUid(this.locoUid)!.defId).maxWagons : 0;
    for (const it of wagons) {
      const d = wagonDef(it.defId);
      const sel = this.wagonUids.includes(it.uid);
      c.append(
        this.itemRow(
          `${d.name} Lv${it.level}`,
          d.rarity,
          `${d.accepts.map((a) => cargoDef(a).name).join(', ')} · ${Math.round(d.capacity * levelMul(it.level))}u · ${d.weight}t`,
          sel,
          () => {
            if (sel) this.wagonUids = this.wagonUids.filter((u) => u !== it.uid);
            else if (this.wagonUids.length < maxW) this.wagonUids.push(it.uid);
            else this.toast(STR.depot.maxWagons(maxW), 'warn');
            this.renderConsist();
          },
          it.defId,
        ),
      );
    }
    // summary
    const s = this.summary;
    s.innerHTML = '';
    const loco = this.locoUid ? this.inventory.byUid(this.locoUid) : null;
    if (loco) {
      const d = locoDef(loco.defId);
      const m = levelMul(loco.level);
      const weight = this.wagonUids.reduce(
        (a, u) => a + wagonDef(this.inventory.byUid(u)!.defId).weight,
        0,
      );
      const power = d.power * m;
      const wrap = el('div', { style: 'flex:1' });
      wrap.append(
        el('div', {
          class: 'sub',
          text: `${STR.depot.wagons} ${this.wagonUids.length}/${d.maxWagons} · ${STR.depot.weight} ${weight}/${Math.round(power)}t`,
        }),
      );
      const meter = el(
        'div',
        { class: `meter ${weight > power ? 'over' : ''}` },
        el('div', { style: `width:${Math.min(100, (weight / power) * 100)}%` }),
      );
      wrap.append(meter);
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
    c.append(el('div', { class: 'col-title', text: STR.depot.stops }));
    if (!this.route.length) c.append(el('div', { class: 'dim', text: STR.depot.noStops }));
    this.route.forEach((id, i) => {
      const st = this.builder.stationById(id);
      const step = el(
        'div',
        { class: 'route-step' },
        el('span', { class: 'idx', text: String(i + 1) }),
        el('span', { class: 'grow', text: st?.name ?? '?' }),
        btn(
          '^',
          () => {
            if (i > 0) [this.route[i - 1], this.route[i]] = [this.route[i], this.route[i - 1]];
            this.renderRoute();
          },
          'small',
        ),
        btn(
          'x',
          () => {
            this.route.splice(i, 1);
            this.renderRoute();
          },
          'small',
        ),
      );
      c.append(step);
    });
    c.append(el('div', { class: 'col-title', text: STR.depot.addStop }));
    if (!this.builder.stations.length)
      c.append(el('div', { class: 'dim', text: STR.depot.noStations }));
    for (const st of this.builder.stations) {
      const hasPlat = this.builder.platformTiles(st).length > 0;
      const row = this.itemRow(
        st.name,
        'N',
        `${
          st
            .producedCargo()
            .map((x) => cargoDef(x).name)
            .join(', ') || '-'
        } → ${st.def.accepts.map((x) => cargoDef(x).name).join(', ')}${hasPlat ? '' : ` · ${STR.station.noPlatform}`}`,
        false,
        () => {
          if (!hasPlat) return;
          this.route.push(st.id);
          this.renderRoute();
        },
      );
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
            if (this.route.length < 2) {
              this.toast(STR.depot.needTwoStops, 'warn');
              return;
            }
            this.fleet.setRoute(t, this.route);
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
            if (!this.locoUid) {
              this.toast(STR.depot.pickLoco, 'warn');
              return;
            }
            const res = this.fleet.create(
              this.locoUid,
              this.wagonUids,
              this.route,
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
    f.append(el('span', { class: 'dim', text: STR.depot.fuelHint(fmtMoney(1)) }));
  }
}
export type { Item };
