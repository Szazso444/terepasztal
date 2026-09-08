import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { Train } from '../sim/trains';
import type { Fleet } from '../sim/fleet';
import type { Builder } from '../sim/build';
import type { Stockpile } from '../sim/stockpile';
import { cargoDef } from '../sim/cargo';
import { levelMul } from '../gacha/items';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg, frameForItem } from './spritePreview';
import { ScheduleEditor } from './scheduleEditor';

/** One train in detail: engines, tanks, weight, wagons, schedule and the last loop's statistics. */
export class TrainScreen implements Screen {
  readonly id = 'train';
  title: string = STR.train.title;
  readonly root = el('div', { class: 'cols' });
  private left = el('div', { class: 'col-body' });
  private right = el('div', { class: 'col-body' });
  private foot = el('div', { class: 'col-foot' });
  train: Train | null = null;
  onLocate: ((t: Train) => void) | null = null;
  private scheduleEditor: ScheduleEditor;

  constructor(
    private readonly fleet: Fleet,
    private readonly builder: Builder,
    private readonly stock: Stockpile,
    private readonly atlas: AtlasRegistry,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
  ) {
    this.scheduleEditor = new ScheduleEditor(builder, () => {
      if (this.train) this.fleet.setSchedule(this.train, this.train.schedule);
    });
    this.root.append(
      el(
        'div',
        { class: 'col' },
        el('div', { class: 'col-title', text: STR.train.consist }),
        this.left,
        this.foot,
      ),
      el(
        'div',
        { class: 'col' },
        el('div', { class: 'col-title', text: STR.train.tripStats }),
        this.right,
      ),
    );
  }
  open(t: Train) {
    this.train = t;
    this.title = `${STR.train.title}: ${t.name}`;
  }
  onOpen() {
    this.render();
  }
  refresh() {
    this.render();
  }

  private bar(label: string, value: number, max: number, cls = '') {
    return el(
      'div',
      { class: 'kv-bar' },
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: label }),
        el('span', { class: 'v', text: `${Math.round(value)} / ${Math.round(max)}` }),
      ),
      el(
        'div',
        { class: `meter ${cls}` },
        el('div', { style: `width:${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }),
      ),
    );
  }

  private render() {
    const t = this.train;
    const l = this.left;
    const r = this.right;
    l.innerHTML = '';
    r.innerHTML = '';
    this.foot.innerHTML = '';
    if (!t || !this.fleet.byId(t.id)) {
      l.append(el('div', { class: 'dim', text: STR.train.gone }));
      return;
    }
    const row = (k: string, v: string, cls = '') =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: k }),
        el('span', { class: `v ${cls}`, text: v }),
      );
    const next = this.builder.stationById(t.route[t.routeIndex % Math.max(1, t.route.length)]);
    l.append(
      row(
        STR.train.state,
        `${t.blocked && t.state === 'moving' ? STR.depot.state.held : (STR.depot.state[t.state] ?? t.state)}${next ? ` → ${next.name}` : ''}`,
        `state-${t.state}`,
      ),
    );
    if (t.lastMessage) l.append(row(STR.train.note, t.lastMessage));
    l.append(row(STR.train.speed, `${t.maxSpeed.toFixed(2)} tiles/s`));
    l.append(row(STR.train.crew, String(t.crew)));
    l.append(this.bar(STR.train.haul, t.weight, t.power, t.weight > t.power ? 'over' : ''));
    // engines and tanks
    l.append(el('div', { class: 'col-title', text: STR.train.engines }));
    for (const lo of t.locos) {
      l.append(
        el(
          'div',
          { class: 'item', style: 'cursor:default' },
          spriteImg(this.atlas, frameForItem(lo.def.id), 1, 'sprite-preview item-art'),
          el(
            'div',
            {},
            el('div', {
              class: `name rarity-${lo.def.rarity}`,
              text: `${lo.def.name} Lv${lo.level}`,
            }),
            el('div', {
              class: 'sub',
              text: `${STR.roster.type[lo.def.type]} · ${Math.round(lo.def.power * levelMul(lo.level))} t · ${STR.roster.fuelLine(lo.def)}`,
            }),
          ),
        ),
      );
    }
    if (t.hasSteam) {
      l.append(
        this.bar(
          `${STR.train.fuel} (${t.fuelKind})`,
          t.coal,
          t.coalCap,
          t.coal < t.coalRate * 5 ? 'over' : '',
        ),
      );
      l.append(
        this.bar(STR.train.water, t.water, t.waterCap, t.water < t.waterRate * 5 ? 'over' : ''),
      );
    }
    if (t.hasDiesel)
      l.append(this.bar(STR.train.oil, t.oil, t.oilCap, t.oil < t.oilRate * 5 ? 'over' : ''));
    if (t.hasElectric)
      l.append(
        row(
          STR.train.power,
          `${t.powerRate.toFixed(2)} / tile · ${STR.train.stockPower(Math.floor(this.stock.get('power')))}`,
        ),
      );
    const rate = [
      t.coalRate > 0 ? `${t.coalRate.toFixed(2)} ${t.fuelKind}` : '',
      t.waterRate > 0 ? `${t.waterRate.toFixed(2)} water` : '',
      t.oilRate > 0 ? `${t.oilRate.toFixed(2)} oil` : '',
      t.powerRate > 0 ? `${t.powerRate.toFixed(2)} power` : '',
    ].filter(Boolean);
    l.append(row(STR.train.perTile, rate.join(', ') || '-'));
    l.append(
      row(
        STR.train.range,
        t.rangeTiles === Infinity ? '∞' : `${Math.floor(t.rangeTiles)} ${STR.train.tiles}`,
      ),
    );
    l.append(
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'dim', text: STR.train.routing }),
        ...(['schedule', 'production', 'collection', 'transport'] as const).map((m) =>
          btn(
            STR.train.mode[m],
            () => {
              t.mode = m;
              this.render();
            },
            `small ${t.mode === m ? 'active' : ''}`,
          ),
        ),
      ),
    );
    l.append(el('div', { class: 'sub dim', text: STR.train.modeHint[t.mode] }));
    if (t.hasSteam) {
      l.append(
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'dim', text: STR.train.prefer }),
          btn(
            STR.train.coal,
            () => {
              t.fuelPreference = 'coal';
              this.render();
            },
            `small ${t.fuelPreference === 'coal' ? 'active' : ''}`,
          ),
          btn(
            STR.train.wood,
            () => {
              t.fuelPreference = 'wood';
              this.render();
            },
            `small ${t.fuelPreference === 'wood' ? 'active' : ''}`,
          ),
        ),
      );
    }
    // wagons
    l.append(el('div', { class: 'col-title', text: STR.depot.wagons }));
    for (const w of t.wagons) {
      const cap = w.def.capacity * levelMul(w.level);
      l.append(
        el(
          'div',
          { class: 'item', style: 'cursor:default' },
          spriteImg(this.atlas, frameForItem(w.def.id), 1, 'sprite-preview item-art'),
          el(
            'div',
            { style: 'flex:1' },
            el('div', { class: `name rarity-${w.def.rarity}`, text: w.def.name }),
            el('div', {
              class: 'sub',
              text: w.cargo
                ? `${cargoDef(w.cargo).name} ${Math.round(w.amount)}/${Math.round(cap)} · ${(w.def.weight + w.amount * cargoDef(w.cargo).weight).toFixed(1)} t`
                : `${STR.depot.empty} · ${cap} u · ${w.def.weight} t`,
            }),
          ),
        ),
      );
    }
    // trip stats
    const fmtRec = (rec: Record<string, number>) =>
      Object.entries(rec)
        .filter(([, v]) => v >= 0.05)
        .map(([k, v]) => `${Math.round(v * 10) / 10} ${k.replace('refuel_', '+')}`)
        .join(', ') || '-';
    const tripBlock = (title: string, tr: typeof t.trip | null) => {
      const box = el(
        'div',
        { class: 'content-entry' },
        el('div', { class: 'content-head' }, el('span', { class: 'name', text: title })),
      );
      if (!tr) {
        box.append(el('div', { class: 'dim', text: STR.train.noTrip }));
        return box;
      }
      box.append(
        row(STR.train.distance, `${Math.round(tr.distance)} ${STR.train.tiles}`),
        row(
          STR.train.fuelUsed,
          fmtRec(
            Object.fromEntries(Object.entries(tr.fuel).filter(([k]) => !k.startsWith('refuel_'))),
          ),
        ),
        row(
          STR.train.refuelled,
          fmtRec(
            Object.fromEntries(Object.entries(tr.fuel).filter(([k]) => k.startsWith('refuel_'))),
          ),
        ),
        row(STR.train.gathered, fmtRec(tr.loaded)),
        row(STR.train.delivered, fmtRec(tr.delivered)),
        row(STR.train.income, fmtMoney(tr.income)),
      );
      return box;
    };
    r.append(tripBlock(STR.train.lastLoop, t.lastTrip), tripBlock(STR.train.currentLoop, t.trip));
    r.append(el('div', { class: 'col-title', text: STR.depot.stops }));
    this.scheduleEditor.render(t.schedule, t.routeIndex % Math.max(1, t.schedule.length));
    r.append(
      this.scheduleEditor.root,
      el('div', { class: 'dim', text: STR.depot.scheduleLiveHint }),
    );
    // footer actions
    const needsFuel =
      (t.hasSteam && (t.coal < t.coalCap * 0.999 || t.water < t.waterCap * 0.999)) ||
      (t.hasDiesel && t.oil < t.oilCap * 0.999);
    const eb = btn(
      STR.train.emergency,
      () => {
        const taken = t.refuel(this.stock, { fuel: true, water: true }, 2);
        const got = Object.entries(taken)
          .map(([k, v]) => `${Math.round(v)} ${k}`)
          .join(', ');
        this.toast(
          got ? STR.train.emergencyDone(got) : STR.train.emergencyNone,
          got ? 'good' : 'warn',
        );
        this.render();
      },
      'small',
    );
    eb.disabled = !needsFuel;
    eb.title = STR.train.emergencyHint;
    this.foot.append(
      eb,
      btn(STR.depot.locate, () => this.onLocate?.(t), 'small'),
    );
  }
}
