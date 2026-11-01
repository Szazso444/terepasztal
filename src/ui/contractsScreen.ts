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
  segmented,
  toggleSwitch,
  well,
  type FootSpec,
} from './kit';
import type { FrameTabs, Screen } from './modal';
import type { Confirm } from './menu';
import { contractTitle, type ContractBoard, type Contract } from '../sim/contracts';
import type { Builder } from '../sim/build';
import {
  CONTRACT_RARITIES,
  contractPolicyFor,
  uniformContractPolicy,
  type ContractPolicy,
  type Settings,
} from '../sim/save';
import type { GameClock } from '../sim/time';
import type { AtlasRegistry } from '../engine/atlas';
import { cargoDef } from '../sim/cargo';
import { fmtDuration } from './numberFormat';
import { fragment, liveMeter, resIcon, ScrollKeep, setText } from './economyParts';
import {
  activeByDeadline,
  contractTabs,
  deliveredShare,
  emptyKind,
  payoutLost,
  pickTab,
  recentContracts,
  statusTone,
  tabOfStatus,
  tabOnReturn,
  timeIsLow,
  type AutoState,
  type ContractTab,
} from './contractsView';

/**
 * Contracts: the offers to accept, the ones being worked and the last ones finished, one tab each,
 * and what becomes of a new offer of each rarity on the Settings tab. A card is built when its
 * contract changes state; the clock, the delivery and the deadline bars move in place, so a button
 * under the pointer is never swapped away between press and release.
 */
export class ContractsScreen implements Screen {
  /**
   * What the policies of the rarities add up to, and setting them all one way (accept, or ask);
   * set by the game
   */
  autoAccept: { state: () => AutoState; set: (v: boolean) => void } | null = null;
  /** set by the game: the settings the Settings tab changes, and how a change is applied */
  policy: { settings: Settings; onChange: () => void } | null = null;
  readonly id = 'contracts';
  readonly title = STR.contracts.title;
  readonly icon = 'scroll';
  /** the Settings tab's controls, as they were in Settings: Tab goes round them */
  readonly formKeys = true;
  readonly root = page();
  /** set by the game: name of the train working a contract (null: none in service) */
  trainName: ((id: number) => string | null) | null = null;
  /** set by the game: draw the frame's tab strip now, after a tab changes from inside */
  redraw: (() => void) | null = null;
  private tab: ContractTab = 'offers';
  /** the card picked out: the one a click in the outliner asked for */
  private focused: number | null = null;
  private focusEl: HTMLElement | null = null;
  private scrollToFocus = false;
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
  onClose() {
    this.focused = null;
    this.tab = tabOnReturn(this.tab);
  }
  /** Pick a contract out: its tab opens and its card is lit and in view. Open the screen after. */
  focusContract(id: number) {
    const c = this.board.byId(id);
    const tab = c ? tabOfStatus(c.status) : null;
    if (!c || !tab) return;
    this.focused = id;
    this.tab = tab;
    this.scrollToFocus = true;
    this.scroll.top();
    this.build(true);
    this.redraw?.();
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
          settings: STR.contracts.settingsTab,
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

  /** Stand on a tab: the empty Active tab points at the offers, Contract settings at Settings. */
  show(tab: ContractTab) {
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
    if (tab === 'settings') return [];
    if (tab === 'offers') return this.board.offers;
    if (tab === 'active') return activeByDeadline(this.board.active);
    return recentContracts(this.board.contracts);
  }

  /**
   * What decides how the tab looks apart from the numbers that move: which cards, in which state,
   * with which train, and whether Accept is allowed.
   */
  private stateKey(list: readonly Contract[]): string {
    // the Settings tab changes by its own controls alone
    if (this.tab === 'settings') return this.tab;
    return JSON.stringify([
      this.tab,
      this.board.activeFull(),
      this.board.limit(),
      list.length ? true : this.board.canGenerate(),
      this.autoAccept?.state() ?? null,
      this.focused,
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
    this.focusEl = null;
    this.scroll.around(() => {
      this.root.replaceChildren(...this.draw(list));
    });
    // asked for before the screen is open, it is brought into view as it opens
    if (this.scrollToFocus && this.focusEl && this.root.isConnected) {
      this.scrollToFocus = false;
      (this.focusEl as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    }
    for (const run of this.live) run();
  }

  private draw(list: readonly Contract[]): HTMLElement[] {
    if (this.tab === 'settings') return this.settingsTab();
    const out: HTMLElement[] = [];
    if (this.tab === 'offers') out.push(...this.offersHead(list.length > 0));
    if (!list.length) {
      out.push(this.empty(this.tab));
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

  private empty(tab: Exclude<ContractTab, 'settings'>): HTMLElement {
    const kind = emptyKind(tab, this.board.canGenerate());
    const see =
      tab === 'active'
        ? actionButton(STR.contracts.seeOffers, () => this.show('offers'), { cls: 'small' })
        : null;
    return emptyState({ text: STR.contracts[kind], action: see, icon: 'scroll' });
  }

  /** One row per rarity: what happens to a new offer of that rarity. */
  private settingsTab(): HTMLElement[] {
    const policy = this.policy;
    if (!policy) return [];
    const { settings, onChange } = policy;
    const POLICIES: ContractPolicy[] = ['accept', 'prompt', 'deny'];
    const rows = CONTRACT_RARITIES.map((r) =>
      formRow(
        el('span', { class: `crarity-${r}` }, contractRarityLabel(r), STR.contracts.rarity[r] ?? r),
        segmented({
          options: POLICIES.map((p) => ({ id: p, label: STR.settings.policy[p] })),
          value: contractPolicyFor(settings, r),
          onChange: (id) => {
            if (!settings.contractPolicy)
              settings.contractPolicy = uniformContractPolicy(contractPolicyFor(settings, r));
            settings.contractPolicy[r] = id as ContractPolicy;
            onChange();
          },
        }),
      ),
    );
    return [well(STR.settings.contractPolicy, ...rows, note(STR.settings.contractPolicyHint))];
  }

  /** The auto-accept row on top of the offers, and the reason Accept is off when it is. */
  private offersHead(hasOffers: boolean): HTMLElement[] {
    const out: HTMLElement[] = [];
    const auto = this.autoAccept;
    if (auto) {
      const state = auto.state();
      const sw = toggleSwitch(
        STR.contracts.autoLabel,
        () => auto.state() === 'accept',
        (v) => void this.setAuto(auto, v),
      );
      sw.title = STR.contracts.autoHint;
      const link = actionButton(STR.contracts.perRarity, () => this.show('settings'), {
        cls: 'small',
        icon: 'gear',
        title: STR.contracts.perRarityHint,
      });
      const row = formRow(
        STR.contracts.autoLabel,
        fragment(link, sw),
        state === 'accept'
          ? STR.contracts.autoSubOn
          : state === 'prompt'
            ? STR.contracts.autoSubOff
            : STR.contracts.autoSubMixed,
      );
      row.title = STR.contracts.autoHint;
      out.push(el('div', { class: 'k-well ec-auto' }, row));
    }
    // the land owned caps the active contracts: past it, Accept is refused and says why, once up
    // here since a disabled button's hover may never show
    if (hasOffers && this.board.activeFull())
      out.push(note(STR.contracts.activeFull(this.board.limit()), 'ec-warn'));
    return out;
  }

  /**
   * Flip the switch. From a mix it would replace what the player chose for each rarity, so it asks
   * first; an answer of no leaves every choice, and the switch back where it was.
   */
  private async setAuto(auto: NonNullable<ContractsScreen['autoAccept']>, on: boolean) {
    if (
      auto.state() === 'mixed' &&
      !(await this.prompt.confirm(STR.contracts.autoAllTitle, STR.contracts.autoAllText, {
        yes: STR.contracts.autoAllYes,
        no: STR.contracts.keepContract,
      }))
    ) {
      this.build(true);
      return;
    }
    auto.set(on);
    this.build(true);
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
    const built = card({
      rarity: c.rarity,
      on: this.focused === c.id,
      cls: 'ec-ct',
      rarityLabel: el(
        'span',
        { class: `ec-rar crarity-${c.rarity}` },
        contractRarityLabel(c.rarity),
        rarityName,
      ),
      title: contractTitle(c.name),
      right: el('span', { class: `ec-pay ${lost ? 'lost' : ''}`.trim(), text: fmtMoney(c.payout) }),
      sub: fragment(
        this.atlas ? resIcon(this.atlas, c.cargo) : null,
        el('b', { text: STR.contracts.cargoAmount(Math.round(c.amount), cargo.name) }),
        route,
      ),
      body: fragment(...body),
      foot: fragment(...foot),
    });
    if (this.focused === c.id) this.focusEl = built;
    return built;
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
            this.toast(STR.contracts.accepted(contractTitle(c.name)), 'good');
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
        : el('span', { class: 'k-note ec-grow ec-warn', text: STR.contracts.noTrain }),
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
      STR.contracts.confirmCancel(contractTitle(c.name), fine),
      { yes: STR.contracts.cancelTitle, no: STR.contracts.keepContract, danger: true },
    );
    if (!ok) return;
    if (this.board.cancel(c))
      this.toast(STR.contracts.cancelledMsg(contractTitle(c.name), fine), 'warn');
    this.build(true);
  }
}
