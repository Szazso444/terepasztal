import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { Stockpile } from '../sim/stockpile';
import type { Economy } from '../sim/economy';
import { CARGO } from '../sim/cargo';
import { rules } from '../sim/rules';

export const BUY_MUL = 1.6;
export const SELL_MUL = 0.6;

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
          '',
        ].map((h) => el('th', { text: h })),
      ),
    );
    for (const c of CARGO) {
      const buy = Math.round(c.price * BUY_MUL * rules.spotPriceMul * 100) / 100;
      const sell = Math.round(c.price * SELL_MUL * rules.spotPriceMul * 100) / 100;
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
          el('td', {}, actions),
        ),
      );
    }
    b.append(table);
    this.foot.innerHTML = '';
    this.foot.append(
      el('span', { class: 'amber num', text: `${STR.hud.money}: ${fmtMoney(this.economy.money)}` }),
      el('span', { style: 'flex:1' }),
      el('span', { class: 'dim', text: STR.market.hint }),
    );
  }
}
