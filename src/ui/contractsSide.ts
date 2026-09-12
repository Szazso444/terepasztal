import { el } from './dom';
import { STR } from '../strings';
import type { ContractBoard } from '../sim/contracts';
import type { Builder } from '../sim/build';
import type { GameClock } from '../sim/time';
import { cargoDef } from '../sim/cargo';
import { fmtDuration } from './contractsScreen';

/** Compact always-visible list of active contracts with countdown timers. */
export class ContractsSide {
  readonly root = el('div', { id: 'contracts-side', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private count = el('span', { class: 'num' });
  onOpenBoard: (() => void) | null = null;

  constructor(
    private readonly board: ContractBoard,
    private readonly builder: Builder,
    private readonly clock: GameClock,
  ) {
    const title = el(
      'div',
      { class: 'panel-title' },
      el('span', { text: STR.contracts.sideTitle }),
      this.count,
    );
    title.style.cursor = 'pointer';
    title.addEventListener('click', () => this.onOpenBoard?.());
    this.root.append(title, this.body);
  }

  update() {
    const now = this.clock.time;
    const active = this.board.active.sort((p, q) => p.expires - q.expires);
    const offers = this.board.offers.length;
    this.count.textContent = offers ? STR.contracts.offersBadge(offers) : '';
    this.body.innerHTML = '';
    if (!active.length) {
      this.body.append(
        el('div', {
          class: 'dim',
          text: offers ? STR.contracts.sideEmptyOffers : STR.contracts.sideEmpty,
        }),
      );
      return;
    }
    for (const c of active.slice(0, 8)) {
      const rem = this.board.remaining(c, now);
      const row = el(
        'div',
        { class: `side-contract ${rem < 0.25 ? 'urgent' : ''}` },
        el(
          'div',
          { class: 'sc-line' },
          el('span', {
            class: `crarity-${c.rarity}`,
            text: `${Math.round(c.amount)} ${cargoDef(c.cargo).name}`,
          }),
          el('span', { class: 'num', text: fmtDuration(Math.max(0, c.expires - now)) }),
        ),
        el(
          'div',
          { class: 'sc-line sub' },
          el('span', {
            text: `${this.builder.stationById(c.originId)?.name ?? '?'} → ${this.builder.stationById(c.destId)?.name ?? '?'}`,
          }),
          el('span', { class: 'num', text: `${Math.floor(c.delivered)}/${c.amount}` }),
        ),
        el(
          'div',
          { class: 'meter' },
          el('div', { style: `width:${(c.delivered / c.amount) * 100}%` }),
        ),
        el('div', { class: 'meter time' }, el('div', { style: `width:${rem * 100}%` })),
      );
      this.body.append(row);
    }
  }
}
