import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { Stockpile } from '../sim/stockpile';
import type { Economy } from '../sim/economy';
import { CARGO } from '../sim/cargo';
import { rules, daySeconds } from '../sim/rules';
import { inSupplyMode } from '../sim/supply';

import { TradeDesk, BUY_MUL, SELL_MUL } from '../sim/trade';
export { BUY_MUL, SELL_MUL };

/** Buy and sell resources for money. Oil is normally bought here until a refinery runs. */
export class MarketScreen implements Screen {
  readonly id = 'market';
  readonly title = STR.market.title;
  readonly root = el('div', { class: 'cols', style: 'flex-direction:column' });
  private body = el('div', { class: 'col-body' });
  private foot = el('div', { class: 'col-foot' });
  constructor(
    private readonly stock: Stockpile,
    private readonly economy: Economy,
    private readonly cap: (id: string) => number,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private readonly trade: TradeDesk,
    private readonly now: () => number,
  ) {
    this.root.append(el('div', { class: 'col' }, this.body, this.foot));
  }
  onOpen() {
    this.render();
  }
  refresh() {
    this.render();
  }
  private render() {
    const b = this.body;
    b.innerHTML = '';
    const table = el('table', { class: 'market' });
    table.append(
      el(
        'tr',
        {},
        ...[
          STR.market.resource,
          STR.market.have,
          STR.market.buyPrice,
          STR.market.sellPrice,
          STR.market.trend,
          '',
        ].map((h) => el('th', { text: h })),
      ),
    );
    for (const c of CARGO) {
      if (c.class === 'people' || !inSupplyMode(c)) continue;
      const drift = this.trade.priceMul(c.id);
      const buy = Math.round(c.price * BUY_MUL * rules.spotPriceMul * drift * 100) / 100;
      const sell = Math.round(c.price * SELL_MUL * rules.spotPriceMul * drift * 100) / 100;
      const actions = el('div', { class: 'row', style: 'margin:0' });
      for (const n of [10, 100]) {
        const bb = btn(
          `${STR.market.buy} ${n}`,
          () => {
            const room = Math.max(0, this.cap(c.id) - this.stock.get(c.id));
            const qty = Math.min(n, Math.floor(room));
            const price = qty * buy;
            if (qty <= 0) return this.toast(STR.market.full, 'warn');
            if (!this.economy.spend(price)) return;
            this.stock.add(c.id, qty, this.cap(c.id));
            this.render();
          },
          'small',
        );
        bb.disabled = this.economy.money < buy * Math.min(n, 1);
        actions.append(bb);
      }
      for (const n of [10, 100]) {
        const sb = btn(
          `${STR.market.sell} ${n}`,
          () => {
            const qty = Math.min(n, Math.floor(this.stock.get(c.id)));
            if (qty <= 0) return;
            this.stock.take(c.id, qty);
            this.economy.earn(qty * sell);
            this.render();
          },
          'small',
        );
        sb.disabled = this.stock.get(c.id) < 1;
        actions.append(sb);
      }
      table.append(
        el(
          'tr',
          {},
          el('td', { text: c.name }),
          el('td', {
            class: 'num',
            text: `${Math.floor(this.stock.get(c.id))} / ${this.cap(c.id)}`,
          }),
          el('td', { class: 'num', text: fmtMoney(buy) }),
          el('td', { class: 'num', text: fmtMoney(sell) }),
          el('td', {
            class: `num ${drift > 1.02 ? 'red' : drift < 0.98 ? 'good' : 'dim'}`,
            text: this.trade.drifts(c.id)
              ? STR.market.driftPct(Math.round((drift - 1) * 100))
              : '-',
          }),
          el('td', {}, actions),
        ),
      );
    }
    b.append(table);
    b.append(el('div', { class: 'sub dim', text: STR.market.driftHint }));
    // standing deals: so much per cycle, settled automatically
    const cycleDays = rules.tradeCycleDays;
    const left = Math.max(0, this.trade.nextAt - this.now());
    b.append(
      el('div', { class: 'col-title', style: 'margin-top:12px', text: STR.market.deals }),
      el('div', { class: 'sub dim', text: STR.market.dealsHint(cycleDays) }),
    );
    const dt = el('table', { class: 'market' });
    dt.append(
      el(
        'tr',
        {},
        ...[STR.market.resource, STR.market.dealBuy, STR.market.dealSell, STR.market.perCycle].map(
          (h) => el('th', { text: h }),
        ),
      ),
    );
    for (const c of CARGO) {
      if (c.class === 'people' || !inSupplyMode(c)) continue;
      const cur = this.trade.get(c.id);
      const input = (kind: 'buy' | 'sell') => {
        const inp = el('input', {
          type: 'number',
          min: '0',
          max: '5000',
          step: '10',
          class: 'text small',
          style: 'width:64px',
        }) as HTMLInputElement;
        inp.value = String(kind === 'buy' ? Math.max(0, cur) : Math.max(0, -cur));
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        inp.addEventListener('change', () => {
          const v = Math.max(0, Math.min(5000, Math.floor(Number(inp.value) || 0)));
          this.trade.set(c.id, kind === 'buy' ? v : -v);
          this.render();
        });
        return inp;
      };
      const money = cur > 0 ? -cur * this.trade.buyPrice(c.id) : -cur * this.trade.sellPrice(c.id);
      dt.append(
        el(
          'tr',
          {},
          el('td', { text: c.name }),
          el(
            'td',
            {},
            input('buy'),
            el('span', { class: 'dim', text: ` @ ${fmtMoney(this.trade.buyPrice(c.id))}` }),
          ),
          el(
            'td',
            {},
            input('sell'),
            el('span', { class: 'dim', text: ` @ ${fmtMoney(this.trade.sellPrice(c.id))}` }),
          ),
          el('td', {
            class: `num ${money < 0 ? 'red' : money > 0 ? 'good' : 'dim'}`,
            text: cur ? fmtMoney(money) : '-',
          }),
        ),
      );
    }
    b.append(dt);
    const bal = this.trade.balancePerCycle();
    b.append(
      el('div', {
        class: `sub ${bal < 0 ? 'red' : 'good'}`,
        text: STR.market.dealSummary(fmtMoney(bal), Math.ceil(left / daySeconds())),
      }),
    );
    this.foot.innerHTML = '';
    this.foot.append(
      el('span', { class: 'amber num', text: `${STR.hud.money}: ${fmtMoney(this.economy.money)}` }),
      el('span', { style: 'flex:1' }),
      el('span', { class: 'dim', text: STR.market.hint }),
    );
  }
}
