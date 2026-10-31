import { el, fmtMoney } from './dom';
import { STR } from '../strings';
import { actionButton, note, numberField, page, well, type FootSpec } from './kit';
import type { FrameTabs, Screen } from './modal';
import type { ResourceStore, StoreRegistry } from '../sim/stores';
import type { Economy } from '../sim/economy';
import type { AtlasRegistry } from '../engine/atlas';
import { CARGO, type CargoDef } from '../sim/cargo';
import { daySeconds } from '../sim/rules';
import { inSupplyMode } from '../sim/supply';
import type { TradeDesk } from '../sim/trade';
import type { Commands } from '../sim/commands';
import { resIcon, ScrollKeep, setText } from './economyParts';
import {
  DEAL_BIG_STEP,
  DEAL_MAX,
  DEAL_STEP,
  SPOT_AMOUNTS,
  dealCount,
  dealFrom,
  dealMoney,
  dealSides,
  daysUntil,
  driftTone,
  moneyTone,
  pickMarketTab,
  signedMoney,
  tradeOff,
  tradedGoods,
  type MarketTab,
  type OffReason,
  type TradeKind,
} from './marketView';

/** One spot row: the cells the refresh sets again, and the buttons it switches on and off. */
interface SpotRow {
  good: CargoDef;
  tr: HTMLElement;
  have: HTMLElement;
  buy: HTMLElement;
  sell: HTMLElement;
  trend: HTMLElement;
  buttons: { kind: TradeKind; n: number; button: HTMLButtonElement }[];
}

/** One standing deal's row: the two fields are built again when the deal changes under them. */
interface DealRow {
  good: CargoDef;
  /** what each side's field was built to show; a side that no longer matches the deal is built anew */
  shown: { buy: number; sell: number };
  buyCell: HTMLElement;
  sellCell: HTMLElement;
  buyAt: HTMLElement;
  sellAt: HTMLElement;
  money: HTMLElement;
}

/**
 * Buy and sell resources for money, into and out of the selected store (the top bar's), and set
 * the standing deals that settle with it. Oil is normally bought here until a refinery runs. The
 * rows are built once; the numbers, the prices and the buttons' state move in place, and what is
 * being typed in a deal's field is never swapped away.
 */
export class MarketScreen implements Screen {
  readonly id = 'market';
  readonly title = STR.market.title;
  readonly icon = 'coin';
  readonly frameSize = 'M';
  /** the deal fields are typed in, and Tab goes round them */
  readonly formKeys = true;
  readonly root = page();
  private tab: MarketTab = 'spot';
  /** the good whose row is picked out on the spot prices: the one clicked in the resource bar */
  private picked: string | null = null;
  private pickInView = false;
  private scroll = new ScrollKeep(this.root);
  private goodsShown = '';
  private spot: SpotRow[] = [];
  private deals: DealRow[] = [];
  private storeLine = el('p', { class: 'k-p' });
  private dealsAt = el('p', { class: 'k-p' });
  private funds = el('b');
  private summary = el('div', { class: 'ec-summary' });

  constructor(
    private readonly stores: StoreRegistry,
    private readonly economy: Economy,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private readonly trade: TradeDesk,
    private readonly now: () => number,
    private readonly commands: Commands,
    private readonly atlas: AtlasRegistry | null = null,
  ) {}

  onOpen() {
    this.build();
    // the cells are filled now, not at the next refresh
    this.update();
  }
  onClose() {
    this.picked = null;
  }
  /** Pick a good's row out on the spot prices, which open. Open the screen after, or as it is. */
  pick(resource: string) {
    this.picked = resource;
    this.pickInView = true;
    this.tab = 'spot';
    if (this.root.isConnected) {
      this.scroll.top();
      this.build();
      this.update();
    }
  }
  refresh() {
    this.scroll.restore();
    // the goods change with the production chain, which a load can switch
    if (this.goodsKey() !== this.goodsShown) this.build();
    this.update();
  }

  frameTabs(): FrameTabs {
    return {
      tabs: [
        { id: 'spot', label: STR.market.spot },
        { id: 'deals', label: STR.market.deals, count: dealCount(this.trade.deals.values()) },
      ],
      current: this.tab,
      pick: (id) => {
        this.tab = pickMarketTab(id, this.tab);
        this.scroll.top();
        this.build();
        this.update();
      },
    };
  }
  frameFooter(): FootSpec {
    return { note: STR.market.hint };
  }

  // ---------------------------------------------------------------- building
  private goods(): CargoDef[] {
    return tradedGoods(CARGO, inSupplyMode);
  }
  private goodsKey() {
    return `${this.tab}|${this.goods()
      .map((c) => c.id)
      .join(',')}`;
  }

  private build() {
    const goods = this.goods();
    this.goodsShown = this.goodsKey();
    this.scroll.around(() => {
      this.root.replaceChildren(this.tab === 'spot' ? this.spotWell(goods) : this.dealsWell(goods));
    });
    const row = this.spot.find((r) => r.good.id === this.picked);
    if (this.tab === 'spot' && this.pickInView && row) {
      this.pickInView = false;
      row.tr.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private fundsLabel(): HTMLElement {
    return el('span', { class: 'ec-funds' }, `${STR.hud.money}: `, this.funds);
  }

  private nameCell(c: CargoDef): HTMLElement {
    return el(
      'span',
      { class: 'ec-name' },
      this.atlas ? resIcon(this.atlas, c.id) : null,
      el('span', { text: c.name }),
    );
  }

  private head(labels: string[]): HTMLElement {
    return el(
      'thead',
      {},
      el('tr', {}, ...labels.map((h, i) => el('th', { class: i ? 'r' : '', text: h }))),
    );
  }

  private spotWell(goods: CargoDef[]): HTMLElement {
    this.spot = [];
    const body = el('tbody');
    for (const good of goods) {
      const buttons: SpotRow['buttons'] = [];
      const cell = el('div', { class: 'acts' });
      for (const kind of ['buy', 'sell'] as const)
        for (const n of SPOT_AMOUNTS) {
          const button = actionButton(
            `${kind === 'buy' ? STR.market.buy : STR.market.sell} ${n}`,
            () => this.spotTrade(good, kind, n),
            { cls: 'small' },
          );
          buttons.push({ kind, n, button });
          cell.append(button);
        }
      const tr = el('tr', { class: good.id === this.picked ? 'on' : '' });
      const row: SpotRow = {
        good,
        tr,
        have: el('td', { class: 'r num' }),
        buy: el('td', { class: 'r num' }),
        sell: el('td', { class: 'r num' }),
        trend: el('td', { class: 'r num' }),
        buttons,
      };
      this.spot.push(row);
      tr.append(
        el('td', {}, this.nameCell(good)),
        row.have,
        row.buy,
        row.sell,
        row.trend,
        el('td', { class: 'r' }, cell),
      );
      body.append(tr);
    }
    const table = el(
      'table',
      { class: 'ec-table' },
      this.head([
        STR.market.resource,
        STR.market.have,
        STR.market.buyPrice,
        STR.market.sellPrice,
        STR.market.trend,
        '',
      ]),
      body,
    );
    return well(
      { title: STR.market.spot, right: this.fundsLabel() },
      this.storeLine,
      table,
      note(STR.market.driftHint),
    );
  }

  private dealsWell(goods: CargoDef[]): HTMLElement {
    this.deals = [];
    const body = el('tbody');
    for (const good of goods) {
      const row: DealRow = {
        good,
        shown: { buy: Number.NaN, sell: Number.NaN },
        buyCell: el('td', { class: 'r' }),
        sellCell: el('td', { class: 'r' }),
        buyAt: el('small', { class: 'dim' }),
        sellAt: el('small', { class: 'dim' }),
        money: el('td', { class: 'r num' }),
      };
      this.deals.push(row);
      body.append(
        el(
          'tr',
          {},
          el('td', {}, this.nameCell(good)),
          el('td', { class: 'r' }, el('span', { class: 'ec-field' }, row.buyCell, row.buyAt)),
          el('td', { class: 'r' }, el('span', { class: 'ec-field' }, row.sellCell, row.sellAt)),
          row.money,
        ),
      );
    }
    const table = el(
      'table',
      { class: 'ec-table deals' },
      this.head([
        STR.market.resource,
        STR.market.dealBuy,
        STR.market.dealSell,
        STR.market.perCycle,
      ]),
      body,
    );
    return well(
      { title: STR.market.deals, right: this.fundsLabel() },
      note(STR.market.dealsHint(7)),
      this.dealsAt,
      table,
      this.summary,
    );
  }

  /** One side of a deal's fields, made to show `value`. */
  private dealField(row: DealRow, kind: TradeKind, value: number) {
    const label = kind === 'buy' ? STR.market.dealBuy : STR.market.dealSell;
    const field = numberField({
      min: 0,
      max: DEAL_MAX,
      step: DEAL_STEP,
      bigStep: DEAL_BIG_STEP,
      whole: true,
      value,
      label: `${row.good.name}: ${label}`,
      unit: 'u',
      cls: 'small',
      onChange: (v) => this.setDeal(row, kind, v),
    });
    (kind === 'buy' ? row.buyCell : row.sellCell).replaceChildren(field);
    row.shown[kind] = value;
  }

  // ---------------------------------------------------------------- doing
  private spotTrade(good: CargoDef, kind: TradeKind, n: number) {
    const store = this.stores.selected;
    if (!store) return;
    const done =
      kind === 'buy'
        ? this.commands.spotBuy(good.id, n, store)
        : this.commands.spotSell(good.id, n, store);
    if (!done.ok) return this.toast(done.message, 'warn');
    this.update();
  }

  private setDeal(row: DealRow, kind: TradeKind, amount: number) {
    // a deal set here settles with the store selected now, the others with it too
    this.trade.storeKey = this.stores.selected?.key ?? null;
    const deal = dealFrom(kind, amount);
    this.trade.set(row.good.id, deal);
    // the field that was typed in shows it already, and is left as it is, with the focus and the
    // press it may have under it; the other side is built anew, at nothing
    row.shown[kind] = dealSides(deal)[kind];
    this.update();
  }

  // ---------------------------------------------------------------- the numbers
  private update() {
    setText(this.funds, fmtMoney(this.economy.money));
    const store = this.stores.selected;
    if (this.tab === 'spot') {
      setText(
        this.storeLine,
        store ? STR.market.store(this.stores.label(store)) : STR.market.noStore,
      );
      for (const row of this.spot) this.updateSpot(row, store);
    } else {
      const settles = this.trade.storeIn(this.stores);
      setText(this.dealsAt, settles ? STR.market.dealsAt(this.stores.label(settles)) : '');
      this.dealsAt.hidden = !settles;
      for (const row of this.deals) this.updateDeal(row);
      const bal = this.trade.balancePerCycle();
      const left = Math.max(0, this.trade.nextAt - this.now());
      this.summary.className = `ec-summary ${bal < 0 ? 'bad' : 'good'}`;
      setText(
        this.summary,
        STR.market.dealSummary(signedMoney(bal), daysUntil(left, daySeconds())),
      );
    }
  }

  private offTip(why: OffReason | null): string {
    if (why === 'noStore') return STR.market.noStore;
    if (why === 'noMoney') return STR.roster.noMoney;
    return why === 'nothing' ? STR.market.nothingToSell : '';
  }

  private updateSpot(row: SpotRow, store: ResourceStore | null) {
    const id = row.good.id;
    const drift = this.trade.priceMul(id);
    const { buy, sell } = this.trade.spotQuote(id);
    const have = store ? store.get(id) : 0;
    setText(row.have, store ? `${Math.floor(have)} / ${store.cap(id)}` : '-');
    // a store at its cap is the amber of a thing to know
    row.have.className = `r num ${store && have >= store.cap(id) ? 'warn' : ''}`.trim();
    setText(row.buy, fmtMoney(buy));
    setText(row.sell, fmtMoney(sell));
    setText(
      row.trend,
      this.trade.drifts(id) ? STR.market.driftPct(Math.round((drift - 1) * 100)) : '-',
    );
    row.trend.className = `r num ${this.trade.drifts(id) ? driftTone(drift) : 'dim'}`;
    for (const { kind, button } of row.buttons) {
      const why = tradeOff(kind, {
        hasStore: !!store,
        money: this.economy.money,
        price: kind === 'buy' ? buy : sell,
        have,
      });
      if (button.disabled !== (why !== null)) button.disabled = why !== null;
      const tip = this.offTip(why);
      if (button.title !== tip) button.title = tip;
    }
  }

  private updateDeal(row: DealRow) {
    const id = row.good.id;
    const cur = this.trade.get(id);
    // each side shows the deal as it stands; one changed elsewhere (a load, the other side) is built
    // anew, and the one being typed in never is
    const sides = dealSides(cur);
    for (const kind of ['buy', 'sell'] as const)
      if (row.shown[kind] !== sides[kind]) this.dealField(row, kind, sides[kind]);
    const buyPrice = this.trade.buyPrice(id);
    const sellPrice = this.trade.sellPrice(id);
    setText(row.buyAt, ` @ ${fmtMoney(buyPrice)}`);
    setText(row.sellAt, ` @ ${fmtMoney(sellPrice)}`);
    const money = dealMoney(cur, buyPrice, sellPrice);
    setText(row.money, cur ? signedMoney(money) : '-');
    row.money.className = `r num ${moneyTone(money)}`;
  }
}
