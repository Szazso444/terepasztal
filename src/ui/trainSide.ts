import { el, btn } from './dom';
import { STR } from '../strings';
import type { Train } from '../sim/trains';
import type { Builder } from '../sim/build';
import { levelMul } from '../gacha/items';
import { cargoName } from '../sim/cargo';
import { daySeconds } from '../sim/rules';

/**
 * Right-hand list of trains: the ones on screen in the field view, all of them in the overview.
 * Each card shows the working numbers (speed, crew, weight, tanks, use per tile), a fuel switch
 * for steam engines, wagon capacities and a per-week estimate from the last completed loop.
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

  constructor(private readonly builder: Builder) {
    this.root.append(el('div', { class: 'panel-title' }, this.titleText, this.count), this.body);
    this.root.addEventListener('mouseleave', () => this.setHover(null));
  }
  private setHover(t: Train | null) {
    if (this.hovered === t) return;
    this.hovered = t;
    this.onHover?.(t);
  }

  /** Per-week rate from the last loop: amount per loop / loop length in days × 7. */
  private weekly(t: Train, rec: Record<string, number>, filter?: (k: string) => boolean) {
    const tr = t.lastTrip;
    if (!tr || tr.endedAt <= tr.startedAt) return null;
    const days = (tr.endedAt - tr.startedAt) / daySeconds();
    const out: string[] = [];
    for (const [k, v] of Object.entries(rec)) {
      if (filter && !filter(k)) continue;
      const wk = (v / days) * 7;
      if (wk >= 0.05) out.push(`${Math.round(wk * 10) / 10} ${cargoName(k)}`);
    }
    return out.length ? out.join(', ') : null;
  }

  update(trains: Train[], all: boolean, force = false) {
    const key =
      (all ? 'A' : 'V') +
      trains
        .map(
          (t) =>
            `${t.id}:${t.state}:${Math.round(t.coal)}:${Math.round(t.water)}:${Math.round(t.oil)}:${t.fuelPreference}:${t.lastTrip?.endedAt ?? 0}:${Math.round(t.weight)}`,
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
    const row = (k: string, v: string, cls = '') =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: k }),
        el('span', { class: `v ${cls}`, text: v }),
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
    card.append(row(STR.train.speed, `${t.maxSpeed.toFixed(2)} ${STR.trainSide.tilesPerSec}`));
    card.append(row(STR.train.crew, String(t.crew)));
    card.append(
      row(
        STR.trainSide.weight,
        `${Math.round(t.weight)} / ${Math.round(t.power)} t`,
        t.weight > t.power ? 'red' : '',
      ),
    );
    const type = t.locoDef.type;
    const use: string[] = [];
    if (type === 'steam') {
      card.append(
        row(
          STR.trainSide.fuelWater,
          `${Math.round(t.coal)}/${Math.round(t.coalCap)} ${t.fuelKind} · ${Math.round(t.water)}/${Math.round(t.waterCap)} ${STR.train.water.toLowerCase()}`,
          t.coal < t.coalRate * 5 || t.water < t.waterRate * 5 ? 'red' : '',
        ),
      );
      use.push(`${t.coalRate.toFixed(2)} ${t.fuelKind}`, `${t.waterRate.toFixed(2)} water`);
    } else if (type === 'diesel') {
      card.append(
        row(
          STR.trainSide.fuelWater,
          `${Math.round(t.oil)}/${Math.round(t.oilCap)} oil`,
          t.oil < t.oilRate * 5 ? 'red' : '',
        ),
      );
      use.push(`${t.oilRate.toFixed(2)} oil`);
    } else use.push(`${t.powerRate.toFixed(2)} power`);
    card.append(row(STR.train.perTile, use.join(', ')));
    // fuel type
    const fuelRow = el(
      'div',
      { class: 'kv' },
      el('span', { class: 'k', text: STR.trainSide.fuelType }),
    );
    if (type === 'steam') {
      const sw = el('span', { class: 'row', style: 'margin:0;gap:2px' });
      for (const k of ['coal', 'wood'] as const)
        sw.append(
          btn(
            STR.train[k],
            () => {
              t.fuelPreference = k;
              this.update([], false, true);
              this.lastKey = '';
            },
            `small ${t.fuelPreference === k ? 'active' : ''}`,
          ),
        );
      fuelRow.append(sw);
    } else fuelRow.append(el('span', { class: 'v', text: STR.roster.type[type] }));
    card.append(fuelRow);
    // wagons
    const caps = t.wagons.map((w) => {
      const cap = Math.round(w.def.capacity * levelMul(w.level));
      return w.cargo
        ? `${Math.round(w.amount)}/${cap} ${cargoName(w.cargo)}`
        : `${cap} ${STR.depot.empty.toLowerCase()}`;
    });
    card.append(row(STR.trainSide.wagons(t.wagons.length), caps.join(' · ') || '-'));
    // weekly estimates
    const consumed = this.weekly(t, t.lastTrip?.fuel ?? {}, (k) => !k.startsWith('refuel_'));
    const collected = this.weekly(t, t.lastTrip?.loaded ?? {});
    const delivered = this.weekly(t, t.lastTrip?.delivered ?? {});
    card.append(row(STR.trainSide.consumesWeek, consumed ?? STR.trainSide.noData));
    card.append(row(STR.trainSide.collectsWeek, collected ?? STR.trainSide.noData));
    card.append(row(STR.trainSide.deliversWeek, delivered ?? STR.trainSide.noData));
    card.addEventListener('mouseenter', () => this.setHover(t));
    return card;
  }
}
