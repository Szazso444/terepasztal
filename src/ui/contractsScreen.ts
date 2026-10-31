import { el, fmtMoney } from './dom';
import { contractRarityLabel } from './labels';
import { STR } from '../strings';
import {
  actionButton,
  card,
  cardGrid,
  emptyState,
  formRow,
  note,
  page,
  toggleSwitch,
  type FootSpec,
} from './kit';
import type { FrameTabs, Screen } from './modal';
import type { Confirm } from './menu';
import type { ContractBoard, Contract } from '../sim/contracts';
import type { Builder } from '../sim/build';
import type { GameClock } from '../sim/time';
import type { AtlasRegistry } from '../engine/atlas';
import { cargoDef } from '../sim/cargo';
import { fragment, liveMeter, resIcon, ScrollKeep, setText } from './economyParts';
import {
  activeByDeadline,
  contractTabs,
  deliveredShare,
  emptyKind,
  fmtDuration,
  payoutLost,
  pickTab,
  recentContracts,
  statusTone,
  timeIsLow,
  type ContractTab,
} from './contractsView';

export { fmtDuration };

/**
 * Contracts: the offers to accept, the ones being worked and the last ones finished, one tab each.
 * A card is built when its contract changes state; the clock, the delivery and the deadline bars
 * move in place, so a button under the pointer is never swapped away between press and release.
 */
export class ContractsScreen implements Screen {
  /** read and set the auto-accept switch (all rarities accepted, or all prompted); set by the game */
  autoAccept: { get: () => boolean; set: (v: boolean) => void } | null = null;
  readonly id = 'contracts';
  readonly title = STR.contracts.title;
  readonly icon = 'scroll';
  readonly root = page();
  /** set by the game: name of the train working a contract (null: none in service) */
  trainName: ((id: number) => string | null) | null = null;
  /** set by the game: draw the frame's tab strip now, after a tab changes from inside */
  redraw: (() => void) | null = null;
  private tab: ContractTab = 'offers';
  private scroll = new ScrollKeep(this.root);
  /** what the tab on show was built from; the same again builds nothing */
  private shown = '';
  /** the numbers that change by the minute, set again at every refresh */
  private live: (() => void)[] = [];

  constructor(
    private readonly board: ContractBoard,
    private readonly builder: Builder,
    private readonly clock: GameClock,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    /** the game's dialog, for the question before a contract is cancelled */
    private readonly prompt: Confirm,
    private readonly atlas: AtlasRegistry | null = null,
  ) {}

  onOpen() {
    this.build(true);
  }
  refresh() {
    this.scroll.restore();
    this.build(false);
    for (const run of this.live) run();
  }

  frameTabs(): FrameTabs {
    return {
      tabs: contractTabs(
        {
          offers: this.board.offers.length,
          active: this.board.active.length,
          history: recentContracts(this.board.contracts).length,
        },
        {
          offers: STR.contracts.offers,
          active: STR.contracts.active,
          history: STR.contracts.history,
        },
      ),
      current: this.tab,
      pick: (id) => {
        this.tab = pickTab(id, this.tab);
        this.scroll.top();
        this.build(true);
      },
    };
  }
  frameFooter(): FootSpec {
    const s = this.board.stats;
    return { note: STR.contracts.stats(s.completed, s.failed) };
  }

  /** Switch to a tab from inside (the empty Active tab points at the offers). */
  private show(tab: ContractTab) {
    this.tab = tab;
    this.scroll.top();
    this.build(true);
    this.redraw?.();
  }

  private stationName(id: number) {
    return this.builder.stationById(id)?.name ?? '?';
  }

  // ---------------------------------------------------------------- what the tab is made of
  private contractsOf(tab: ContractTab): Contract[] {
    if (tab === 'offers') return this.board.offers;
    if (tab === 'active') return activeByDeadline(this.board.active);
    return recentContracts(this.board.contracts);
  }

  /**
   * What decides how the tab looks apart from the numbers that move: which cards, in which state,
   * with which train, and whether Accept is allowed.
   */
  private stateKey(list: readonly Contract[]): string {
    return JSON.stringify([
      this.tab,
      this.board.activeFull(),
      this.board.limit(),
      list.length ? true : this.board.canGenerate(),
      this.autoAccept?.get() ?? null,
      list.map((c) => [
        c.id,
        c.status,
        c.trainId === null ? null : (this.trainName?.(c.trainId) ?? null),
        this.stationName(c.originId),
        this.stationName(c.destId),
      ]),
    ]);
  }

  private build(force: boolean) {
    const list = this.contractsOf(this.tab);
    const key = this.stateKey(list);
    if (!force && key === this.shown) return;
    this.shown = key;
    this.live = [];
    this.scroll.around(() => {
      this.root.replaceChildren(...this.draw(list));
    });
    for (const run of this.live) run();
  }

  private draw(list: readonly Contract[]): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (this.tab === 'offers') out.push(...this.offersHead(list.length > 0));
    if (!list.length) {
      out.push(this.empty());
      return out;
    }
    out.push(
      cardGrid(
        list.map((c) => this.card(c)),
        470,
      ),
    );
    return out;
  }

  private empty(): HTMLElement {
    const kind = emptyKind(this.tab, this.board.canGenerate());
    const see =
      this.tab === 'active'
        ? actionButton(STR.contracts.seeOffers, () => this.show('offers'), { cls: 'small' })
        : null;
    return emptyState({ text: STR.contracts[kind], action: see, icon: 'scroll' });
  }

  /** The auto-accept row on top of the offers, and the reason Accept is off when it is. */
  private offersHead(hasOffers: boolean): HTMLElement[] {
    const out: HTMLElement[] = [];
    const auto = this.autoAccept;
    if (auto) {
      const on = auto.get();
      const sw = toggleSwitch(
        STR.contracts.autoLabel,
        () => auto.get(),
        (v) => {
          auto.set(v);
          this.build(true);
        },
      );
      sw.title = STR.contracts.autoHint;
      const row = formRow(
        STR.contracts.autoLabel,
        sw,
        on ? STR.contracts.autoSubOn : STR.contracts.autoSubOff,
      );
      row.title = STR.contracts.autoHint;
      out.push(el('div', { class: 'k-well ec-auto' }, row));
    }
    // the land owned caps the active contracts: past it, Accept is refused and says why, once up
    // here since a disabled button's hover may never show
    if (hasOffers && this.board.activeFull())
      out.push(note(STR.contracts.activeFull(this.board.limit()), 'warn'));
    return out;
  }

  // ---------------------------------------------------------------- one card
  private card(c: Contract): HTMLElement {
    const lost = payoutLost(c.status);
    const cargo = cargoDef(c.cargo);
    const route = el('span', {
      class: 'ec-route',
      text: `${this.stationName(c.originId)} → ${this.stationName(c.destId)}`,
    });
    const rarityName = STR.contracts.rarity[c.rarity] ?? c.rarity;
    const body: HTMLElement[] = [];
    const foot: (HTMLElement | null)[] = [];
    if (c.status === 'offer') this.offerParts(c, body, foot);
    else if (c.status === 'active') this.activeParts(c, body, foot);
    else foot.push(this.statusChip(c));
    return card({
      rarity: c.rarity,
      rarityLabel: el(
        'span',
        { class: `ec-rar crarity-${c.rarity}` },
        contractRarityLabel(c.rarity),
        rarityName,
      ),
      title: c.name,
      right: el('span', { class: `ec-pay ${lost ? 'lost' : ''}`.trim(), text: fmtMoney(c.payout) }),
      sub: fragment(
        this.atlas ? resIcon(this.atlas, c.cargo) : null,
        el('b', { text: STR.contracts.cargoAmount(Math.round(c.amount), cargo.name) }),
        route,
      ),
      body: fragment(...body),
      foot: fragment(...foot),
    });
  }

  private offerParts(c: Contract, body: HTMLElement[], foot: (HTMLElement | null)[]) {
    body.push(
      el(
        'div',
        { class: 'k-card-s' },
        `${STR.contracts.deadline}: `,
        el('b', { text: fmtDuration(c.duration) }),
      ),
    );
    const expires = el('span', { class: 'k-note ec-grow' });
    this.live.push(() =>
      setText(
        expires,
        STR.contracts.offerExpires(fmtDuration(Math.max(0, c.expires - this.clock.time))),
      ),
    );
    // the land owned caps the active contracts: past it, Accept is refused and says why
    const full = this.board.activeFull();
    const refusal = STR.contracts.activeFull(this.board.limit());
    foot.push(
      expires,
      actionButton(
        STR.contracts.decline,
        () => {
          this.board.decline(c);
          this.build(true);
        },
        { cls: 'small' },
      ),
      actionButton(
        STR.contracts.accept,
        () => {
          if (this.board.accept(c, this.clock.time))
            this.toast(STR.contracts.accepted(c.name), 'good');
          // an offer that expired since the board was drawn just leaves it
          else if (this.board.activeFull())
            this.toast(STR.contracts.activeFull(this.board.limit()), 'warn');
          this.build(true);
        },
        { cls: 'small pri', disabled: full, title: full ? refusal : undefined },
      ),
    );
  }

  private activeParts(c: Contract, body: HTMLElement[], foot: (HTMLElement | null)[]) {
    const time = liveMeter(STR.contracts.timeLeft);
    const got = liveMeter(STR.contracts.done);
    this.live.push(() => {
      const left = Math.max(0, c.expires - this.clock.time);
      const rem = this.board.remaining(c, this.clock.time);
      time.set(fmtDuration(left), rem, timeIsLow(rem) ? 'bad' : '');
      got.set(`${Math.floor(c.delivered)} / ${c.amount}`, deliveredShare(c), '');
    });
    body.push(time.root, got.root);
    const train = c.trainId === null ? null : this.trainName?.(c.trainId);
    foot.push(
      train
        ? el(
            'span',
            { class: 'k-note ec-grow' },
            `${STR.contracts.train}: `,
            el('b', { text: train }),
          )
        : el('span', { class: 'k-note ec-grow warn', text: STR.contracts.noTrain }),
      actionButton(
        STR.contracts.cancelFine(fmtMoney(this.board.cancelFine(c))),
        () => void this.cancel(c),
        { cls: 'small danger' },
      ),
    );
  }

  private statusChip(c: Contract): HTMLElement {
    const text =
      c.status === 'done'
        ? STR.contracts.done
        : c.status === 'failed'
          ? STR.contracts.failed
          : c.status === 'cancelled'
            ? STR.contracts.cancelled
            : STR.contracts.expired;
    return el('span', { class: `ec-chip ${statusTone(c.status)}`, text });
  }

  private async cancel(c: Contract) {
    const fine = fmtMoney(this.board.cancelFine(c));
    const ok = await this.prompt.confirm(
      STR.contracts.cancelTitle,
      STR.contracts.confirmCancel(c.name, fine),
      { yes: STR.contracts.cancelTitle, no: STR.contracts.keepContract, danger: true },
    );
    if (!ok) return;
    if (this.board.cancel(c)) this.toast(STR.contracts.cancelledMsg(c.name, fine), 'warn');
    this.build(true);
  }
}
