import { el, btn } from './dom';
import { STR } from '../strings';
import type { Train } from '../sim/trains';
import type { Builder } from '../sim/build';
import { levelMul } from '../gacha/items';
import { daySeconds } from '../sim/rules';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';

/**
 * Right-hand list of trains: the ones on screen in the field view, all of them in the overview.
 * Compact cards: state, speed, capacity, tanks, fuel, one row per wagon and the weekly flows.
 */
export class TrainSide {
  readonly root = el('div', { id: 'train-side', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private count = el('span', { class: 'num' });
  private titleText = el('span');
  onHover: ((t: Train | null) => void) | null = null;
  onDetails: ((t: Train) => void) | null = null;
  onLocate: ((t: Train) => void) | null = null;
  private lastKey = '';
  private hovered: Train | null = null;

  constructor(
    private readonly builder: Builder,
    private readonly atlas: AtlasRegistry,
  ) {
    this.root.append(el('div', { class: 'panel-title' }, this.titleText, this.count), this.body);
    this.root.addEventListener('mouseleave', () => this.setHover(null));
  }
  private setHover(t: Train | null) {
    if (this.hovered === t) return;
    this.hovered = t;
    this.onHover?.(t);
  }
  private icon(res: string) {
    return spriteImg(this.atlas, `icons/${res}`, 1, 'sprite-preview res-icon');
  }
  /** "12 [icon]" pair */
  private amount(res: string, v: number, cls = '') {
    return el(
      'span',
      { class: `ts-amt ${cls}` },
      el('span', { text: v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10) }),
      this.icon(res),
    );
  }

  /** Per-week amounts from the last loop: amount per loop / loop length in days × 7. */
  private weekly(t: Train, rec: Record<string, number>, filter?: (k: string) => boolean) {
    const tr = t.lastTrip;
    if (!tr || tr.endedAt <= tr.startedAt) return null;
    const days = (tr.endedAt - tr.startedAt) / daySeconds();
    const out: [string, number][] = [];
    for (const [k, v] of Object.entries(rec)) {
      if (filter && !filter(k)) continue;
      const wk = (v / days) * 7;
      if (wk >= 0.05) out.push([k, wk]);
    }
    return out.length ? out : null;
  }

  update(trains: Train[], all: boolean, force = false) {
    const key =
      (all ? 'A' : 'V') +
      trains
        .map(
          (t) =>
            `${t.id}:${t.state}:${Math.round(t.speed * 20)}:${Math.round(t.coal)}:${Math.round(t.water)}:${Math.round(t.oil)}:${t.fuelPreference}:${t.lastTrip?.endedAt ?? 0}:${Math.round(t.weight)}:${t.wagons.map((w) => `${w.cargo}${Math.round(w.amount)}`).join()}`,
        )
        .join('|');
    if (key === this.lastKey && !force) return;
    this.lastKey = key;
    this.titleText.textContent = all ? STR.trainSide.titleAll : STR.trainSide.title;
    this.count.textContent = String(trains.length);
    const b = this.body;
    b.innerHTML = '';
    if (!trains.length) {
      b.append(
        el('div', { class: 'dim', text: all ? STR.trainSide.none : STR.trainSide.noneVisible }),
      );
      return;
    }
    for (const t of trains) b.append(this.card(t));
  }

  private card(t: Train) {
    const row = (k: string, ...v: (HTMLElement | string)[]) =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: k }),
        el(
          'span',
          { class: 'v' },
          ...v.map((x) => (typeof x === 'string' ? el('span', { text: x }) : x)),
        ),
      );
    const next = this.builder.stationById(t.route[t.routeIndex % Math.max(1, t.route.length)]);
    const state = `${t.blocked && t.state === 'moving' ? STR.depot.state.held : (STR.depot.state[t.state] ?? t.state)}${next ? ` → ${next.name}` : ''}`;
    const card = el('div', { class: `ts-card state-${t.state}` });
    card.append(
      el(
        'div',
        { class: 'ts-head' },
        el('span', { class: 'name', text: t.name }),
        el(
          'span',
          { class: 'row', style: 'margin:0;gap:3px' },
          btn(STR.depot.details, () => this.onDetails?.(t), 'small'),
          btn(STR.depot.locate, () => this.onLocate?.(t), 'small'),
        ),
      ),
      el('div', { class: `sub state-${t.state}`, text: state }),
    );
    card.append(
      row(
        STR.trainSide.speed,
        `${t.speed.toFixed(2)} / ${t.maxSpeed.toFixed(2)} ${STR.trainSide.tilesPerSec}`,
      ),
    );
    const capRow = row(
      STR.trainSide.capacity,
      `${Math.round(t.weight)} / ${Math.round(t.power)} t`,
    );
    if (t.weight > t.power) capRow.classList.add('red');
    card.append(capRow);
    const type = t.locoDef.type;
    const tanks: HTMLElement[] = [];
    const use: HTMLElement[] = [];
    if (type === 'steam') {
      tanks.push(
        this.amount(t.fuelKind, t.coal, t.coal < t.coalRate * 8 ? 'red' : ''),
        el('span', { class: 'dim', text: `/${Math.round(t.coalCap)}` }),
        this.amount('water', t.water, t.water < t.waterRate * 8 ? 'red' : ''),
        el('span', { class: 'dim', text: `/${Math.round(t.waterCap)}` }),
      );
      use.push(this.amount(t.fuelKind, t.coalRate), this.amount('water', t.waterRate));
    } else if (type === 'diesel') {
      tanks.push(
        this.amount('oil', t.oil, t.oil < t.oilRate * 8 ? 'red' : ''),
        el('span', { class: 'dim', text: `/${Math.round(t.oilCap)}` }),
      );
      use.push(this.amount('oil', t.oilRate));
    } else use.push(this.amount('power', t.powerRate));
    if (tanks.length) card.append(row(STR.trainSide.tanks, ...tanks));
    const fuelRow = row(
      STR.trainSide.fuel,
      ...use,
      el('span', { class: 'dim', text: STR.trainSide.perTile }),
    );
    if (type === 'steam') {
      for (const k of ['coal', 'wood'] as const)
        fuelRow.lastElementChild!.append(
          btn(
            STR.train[k],
            () => {
              t.fuelPreference = k;
              this.lastKey = '';
            },
            `tiny ${t.fuelPreference === k ? 'active' : ''}`,
          ),
        );
    }
    if (t.eco) fuelRow.classList.add('amber');
    card.append(fuelRow);
    // wagons: one row each
    const wag = el('div', { class: 'ts-wagons' });
    for (const w of t.wagons) {
      const cap = Math.round(w.def.capacity * levelMul(w.level));
      wag.append(
        el(
          'div',
          { class: 'ts-wagon' },
          spriteImg(
            this.atlas,
            `rolling/wagon_${w.def.body}_${w.def.size ?? 'small'}_${w.def.paint}_f0`,
            1,
            'sprite-preview ts-wagon-art',
          ),
          el('span', { class: 'ts-wagon-name', text: w.def.name }),
          w.cargo
            ? el(
                'span',
                { class: 'ts-amt' },
                el('span', { text: `${Math.round(w.amount)}/${cap}` }),
                this.icon(w.cargo),
              )
            : el('span', { class: 'dim', text: `0/${cap}` }),
        ),
      );
    }
    card.append(wag);
    // weekly flows in one block
    const consumed = this.weekly(t, t.lastTrip?.fuel ?? {}, (k) => !k.startsWith('refuel_'));
    const collected = this.weekly(t, t.lastTrip?.loaded ?? {});
    const delivered = this.weekly(t, t.lastTrip?.delivered ?? {});
    const week = el(
      'div',
      { class: 'ts-week' },
      el('div', { class: 'ts-week-title', text: STR.trainSide.perWeek }),
    );
    const line = (label: string, items: [string, number][] | null) =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: label }),
        el(
          'span',
          { class: 'v' },
          ...(items
            ? items.map(([k, v]) => this.amount(k, v))
            : [el('span', { class: 'dim', text: STR.trainSide.noData })]),
        ),
      );
    week.append(
      line(STR.trainSide.consumes, consumed),
      line(STR.trainSide.collects, collected),
      line(STR.trainSide.delivers, delivered),
    );
    card.append(week);
    card.addEventListener('mouseenter', () => this.setHover(t));
    return card;
  }
}
