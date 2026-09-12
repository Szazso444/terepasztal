import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { ContractBoard, Contract } from '../sim/contracts';
import type { Builder } from '../sim/build';
import type { GameClock } from '../sim/time';
import { cargoDef } from '../sim/cargo';
import { daySeconds } from '../sim/rules';

export function fmtDuration(sec: number) {
  const days = sec / daySeconds();
  if (days >= 1) return `${days.toFixed(1)}d`;
  const h = Math.floor(days * 24);
  const m = Math.floor(((days * 24) % 1) * 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Contract board: open offers to accept, active contracts with progress, recent history. */
export class ContractsScreen implements Screen {
  /** read and set the auto-accept switch (all rarities accepted, or all prompted); set by the game */
  autoAccept: { get: () => boolean; set: (v: boolean) => void } | null = null;
  private autoBtn = btn(
    '',
    () => {
      if (!this.autoAccept) return;
      this.autoAccept.set(!this.autoAccept.get());
      this.syncAutoBtn();
    },
    'tiny',
  );
  private syncAutoBtn() {
    const on = this.autoAccept?.get() ?? false;
    this.autoBtn.textContent = on ? STR.contracts.autoOn : STR.contracts.autoOff;
    this.autoBtn.className = `tiny ${on ? 'active' : ''}`;
    this.autoBtn.style.marginLeft = '8px';
    this.autoBtn.title = STR.contracts.autoHint;
  }
  readonly id = 'contracts';
  readonly title = STR.contracts.title;
  readonly root = el('div', { class: 'cols' });
  private offersCol = el('div', { class: 'col-body' });
  private activeCol = el('div', { class: 'col-body' });
  private historyCol = el('div', { class: 'col-body' });
  private statsFoot = el('div', { class: 'col-foot' });
  /** set by the game: name of the train working a contract (null: none in service) */
  trainName: ((id: number) => string | null) | null = null;

  constructor(
    private readonly board: ContractBoard,
    private readonly builder: Builder,
    private readonly clock: GameClock,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
  ) {
    this.root.append(
      el(
        'div',
        { class: 'col' },
        el('div', { class: 'col-title' }, el('span', { text: STR.contracts.offers }), this.autoBtn),
        this.offersCol,
      ),
      el(
        'div',
        { class: 'col' },
        el('div', { class: 'col-title', text: STR.contracts.active }),
        this.activeCol,
      ),
      el(
        'div',
        { class: 'col' },
        el('div', { class: 'col-title', text: STR.contracts.history }),
        this.historyCol,
        this.statsFoot,
      ),
    );
  }
  onOpen() {
    this.render();
  }
  refresh() {
    this.render();
  }

  private stationName(id: number) {
    return this.builder.stationById(id)?.name ?? '?';
  }

  private card(c: Contract, actions: HTMLElement[] = []) {
    const now = this.clock.time;
    const rem = this.board.remaining(c, now);
    const lines = [
      el(
        'div',
        { class: 'name' },
        el('span', {
          class: `crarity-${c.rarity}`,
          text: `${STR.contracts.rarity[c.rarity] ?? c.rarity} · `,
        }),
        el('span', { class: 'amber', text: `${c.name}: ` }),
        `${Math.round(c.amount)} ${cargoDef(c.cargo).name}`,
      ),
      el('div', {
        class: 'sub',
        text: `${this.stationName(c.originId)} → ${this.stationName(c.destId)}`,
      }),
      el(
        'div',
        { class: 'sub' },
        el('span', { class: 'green', text: fmtMoney(c.payout) }),
        `  +${c.tickets} ${STR.hud.tickets.toLowerCase()}`,
      ),
    ];
    if (c.status === 'offer')
      lines.push(
        el('div', {
          class: 'sub',
          text: `${STR.contracts.deadline}: ${fmtDuration(c.duration)} · ${STR.contracts.offerExpires(fmtDuration(Math.max(0, c.expires - now)))}`,
        }),
      );
    if (c.status === 'active') {
      lines.push(
        el('div', {
          class: `sub ${rem < 0.25 ? 'red' : ''}`,
          text: `${STR.contracts.timeLeft}: ${fmtDuration(Math.max(0, c.expires - now))}`,
        }),
      );
      lines.push(
        el(
          'div',
          { class: 'meter' },
          el('div', { style: `width:${(c.delivered / c.amount) * 100}%` }),
        ),
      );
      lines.push(el('div', { class: 'sub', text: `${Math.floor(c.delivered)} / ${c.amount}` }));
      const train = c.trainId === null ? null : this.trainName?.(c.trainId);
      lines.push(
        train
          ? el('div', { class: 'sub', text: `${STR.contracts.train}: ${train}` })
          : el('div', { class: 'sub amber', text: STR.contracts.noTrain }),
      );
    }
    if (c.status === 'done')
      lines.push(el('div', { class: 'sub green', text: STR.contracts.done }));
    if (c.status === 'failed')
      lines.push(el('div', { class: 'sub red', text: STR.contracts.failed }));
    if (c.status === 'expired')
      lines.push(el('div', { class: 'sub dim', text: STR.contracts.expired }));
    if (c.status === 'cancelled')
      lines.push(el('div', { class: 'sub dim', text: STR.contracts.cancelled }));
    return el(
      'div',
      { class: 'item', style: 'cursor:default;align-items:flex-start' },
      el('div', { style: 'flex:1' }, ...lines),
      el('div', { class: 'row', style: 'margin:0;flex-direction:column' }, ...actions),
    );
  }

  render() {
    this.syncAutoBtn();
    const o = this.offersCol;
    o.innerHTML = '';
    const offers = this.board.offers;
    if (!offers.length)
      o.append(
        el('div', {
          class: 'dim',
          text: this.board.canGenerate() ? STR.contracts.noOffers : STR.contracts.needStations,
        }),
      );
    for (const c of offers)
      o.append(
        this.card(c, [
          btn(
            STR.contracts.accept,
            () => {
              this.board.accept(c, this.clock.time);
              this.toast(STR.contracts.accepted(c.name), 'good');
              this.render();
            },
            'accent small',
          ),
          btn(
            STR.contracts.decline,
            () => {
              this.board.decline(c);
              this.render();
            },
            'small',
          ),
        ]),
      );
    const a = this.activeCol;
    a.innerHTML = '';
    const active = this.board.active.sort((p, q) => p.expires - q.expires);
    if (!active.length) a.append(el('div', { class: 'dim', text: STR.contracts.noActive }));
    for (const c of active) {
      const fine = fmtMoney(this.board.cancelFine(c));
      a.append(
        this.card(c, [
          btn(
            STR.contracts.cancelFine(fine),
            () => {
              if (!confirm(STR.contracts.confirmCancel(c.name, fine))) return;
              if (this.board.cancel(c))
                this.toast(STR.contracts.cancelledMsg(c.name, fine), 'warn');
              this.render();
            },
            'small',
          ),
        ]),
      );
    }
    const h = this.historyCol;
    h.innerHTML = '';
    const hist = this.board.contracts
      .filter((c) => c.status === 'done' || c.status === 'failed' || c.status === 'cancelled')
      .slice(-12)
      .reverse();
    if (!hist.length) h.append(el('div', { class: 'dim', text: STR.contracts.noHistory }));
    for (const c of hist) h.append(this.card(c));
    this.statsFoot.innerHTML = '';
    this.statsFoot.append(
      el('span', {
        class: 'dim',
        text: STR.contracts.stats(this.board.stats.completed, this.board.stats.failed),
      }),
    );
  }
}
