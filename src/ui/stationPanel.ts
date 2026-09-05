import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Station } from '../sim/stations';
import type { Builder } from '../sim/build';
import { cargoDef } from '../sim/cargo';
import type { ContractBoard } from '../sim/contracts';
import type { GameClock } from '../sim/time';
import { fmtDuration } from './contractsScreen';

/** Side panel for a selected station. */
export class StationPanel {
  readonly root: HTMLElement;
  private body = el('div', { class: 'panel-body' });
  private title = el('span');
  station: Station | null = null;

  constructor(
    private readonly builder: Builder,
    private readonly onClose: () => void,
    private readonly board: ContractBoard,
    private readonly clock: GameClock,
  ) {
    this.root = el(
      'div',
      { id: 'station-panel', class: 'panel' },
      el(
        'div',
        { class: 'panel-title' },
        this.title,
        btn('x', () => this.close(), 'small'),
      ),
      this.body,
    );
    this.root.style.display = 'none';
  }

  open(s: Station) {
    this.station = s;
    this.root.style.display = 'block';
    this.render();
  }
  close() {
    this.station = null;
    this.root.style.display = 'none';
    this.onClose();
  }

  render() {
    const s = this.station;
    if (!s) return;
    this.title.textContent = `${s.name}`;
    const b = this.body;
    b.innerHTML = '';
    const row = (k: string, v: string, cls = '') =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: k }),
        el('span', { class: `v ${cls}`, text: v }),
      );
    b.append(el('div', { class: 'flavor', text: s.def.flavor }));
    b.append(row(STR.station.level(s.level), `${s.def.name}`));
    const produced =
      s
        .producedCargo()
        .map((c) => cargoDef(c).name)
        .join(', ') || '-';
    b.append(row(STR.station.produces, `${produced} (${STR.station.perDay(s.productionPerDay)})`));
    b.append(
      row(STR.station.accepts, s.def.accepts.map((c) => cargoDef(c).name).join(', ') || '-'),
    );
    b.append(row(STR.station.platforms, `${s.occupants.size} / ${s.platforms}`));
    b.append(row(STR.station.loadRate, STR.station.perSec(s.loadRate)));
    b.append(row(STR.station.storage, `${Math.floor(s.totalStored())} / ${s.capacity}`));
    const bars = el('div', { class: 'bars' });
    for (const c of s.producedCargo()) {
      const v = s.stored(c);
      const bar = el(
        'div',
        { class: 'bar' },
        el('div', { class: 'bar-fill', style: `width:${Math.min(100, (v / s.capacity) * 100)}%` }),
        el('span', { class: 'bar-label', text: `${cargoDef(c).name} ${Math.floor(v)}` }),
      );
      bars.append(bar);
    }
    b.append(bars);
    if (this.builder.platformTiles(s).length === 0)
      b.append(el('div', { class: 'red', text: STR.station.noPlatform }));
    if (s.loadBoost > 1)
      b.append(
        el('div', { class: 'cyan', text: STR.station.boost(Math.round((s.loadBoost - 1) * 100)) }),
      );
    // spot market for cargo delivered without a contract
    if (s.def.accepts.length) {
      b.append(
        el('div', { class: 'col-title', style: 'margin-top:6px', text: STR.station.market }),
      );
      for (const c of s.def.accepts) {
        const sat = s.satiety(c);
        b.append(
          el(
            'div',
            { class: 'bar market' },
            el('div', { class: 'bar-fill', style: `width:${Math.round((1 - sat) * 100)}%` }),
            el('span', {
              class: 'bar-label',
              text: `${cargoDef(c).name} ${fmtMoney(s.marketPrice(c, 0))}/u`,
            }),
          ),
        );
      }
      b.append(el('div', { class: 'sub dim', text: STR.station.marketHint }));
    }
    // contracts touching this station
    const mine = this.board.active
      .filter((c) => c.originId === s.id || c.destId === s.id)
      .sort((p, q) => p.expires - q.expires);
    if (mine.length) {
      b.append(
        el('div', { class: 'col-title', style: 'margin-top:6px', text: STR.station.contracts }),
      );
      for (const c of mine) {
        const other = this.builder.stationById(c.originId === s.id ? c.destId : c.originId);
        const rem = this.board.remaining(c, this.clock.time);
        b.append(
          el(
            'div',
            { class: 'kv' },
            el('span', {
              class: 'k',
              text: `${c.originId === s.id ? '→' : '←'} ${other?.name ?? '?'}: ${Math.round(c.amount)} ${cargoDef(c.cargo).name}`,
            }),
            el('span', {
              class: `v ${rem < 0.25 ? 'red' : ''}`,
              text: `${Math.floor(c.delivered)}/${c.amount} · ${fmtDuration(Math.max(0, c.expires - this.clock.time))}`,
            }),
          ),
        );
      }
    }
    const up = this.builder.canUpgrade(s);
    const actions = el('div', { class: 'row' });
    if (s.level < 5) {
      const ub = btn(
        STR.station.upgradeTo(s.level + 1, fmtMoney(s.upgradeCost())),
        () => {
          if (this.builder.upgradeStation(s)) this.render();
        },
        'accent',
      );
      ub.disabled = !up.ok;
      ub.title = up.ok ? '' : (up.reason ?? '');
      actions.append(ub);
      const nx = s.nextLevelUnlocks();
      if (nx.length)
        actions.append(
          el('span', {
            class: 'dim',
            text: STR.station.unlocks(nx.map((c) => cargoDef(c).name).join(', ')),
          }),
        );
    } else actions.append(el('span', { class: 'dim', text: STR.station.maxed }));
    b.append(actions);
    b.append(
      el(
        'div',
        { class: 'row' },
        btn(
          STR.station.rename,
          () => {
            const n = prompt(STR.station.rename, s.name);
            if (n && n.trim()) {
              s.name = n.trim().slice(0, 24);
              this.render();
            }
          },
          'small',
        ),
        btn(
          STR.station.demolish,
          () => {
            this.builder.removeStation(s);
            this.close();
          },
          'small',
        ),
      ),
    );
  }
}
