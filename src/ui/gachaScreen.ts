import { el, btn } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import {
  BANNERS,
  RATES,
  PITY,
  PULL_COST,
  type Banner,
  type PullResult,
  type Gacha,
} from '../gacha/gacha';
import { RARITIES, itemDef, dupesNeeded } from '../gacha/items';
import type { Economy } from '../sim/economy';

/** Banner selection, rates, pity counter, 1x / 10x pulls and a card reveal sequence. */
export class GachaScreen implements Screen {
  readonly id = 'gacha';
  readonly title = STR.gacha.title;
  readonly root = el('div', { class: 'gacha' });
  private bannerCol = el('div', { class: 'col-body' });
  private stage = el('div', { class: 'gacha-stage' });
  private foot = el('div', { class: 'col-foot' });
  private banner: Banner = BANNERS[0];
  private revealing = false;

  constructor(
    private readonly gacha: Gacha,
    private readonly economy: Economy,
    private readonly now: () => number,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
  ) {
    const left = el(
      'div',
      { class: 'col', style: 'flex:0 0 280px' },
      el('div', { class: 'col-title', text: STR.gacha.banners }),
      this.bannerCol,
    );
    const right = el(
      'div',
      { class: 'col' },
      el('div', { class: 'col-title', text: STR.gacha.pull }),
      this.stage,
      this.foot,
    );
    this.root.append(el('div', { class: 'cols' }, left, right));
  }
  onOpen() {
    this.render();
    this.renderIdle();
  }
  refresh() {
    if (!this.revealing) this.renderFoot();
  }

  private render() {
    const c = this.bannerCol;
    c.innerHTML = '';
    for (const b of BANNERS) {
      const locked = b.tier > this.economy.tier;
      const row = el(
        'div',
        { class: `item ${this.banner === b ? 'selected' : ''} ${locked ? 'disabled' : ''}` },
        el(
          'div',
          {},
          el('div', { class: 'name', text: b.name }),
          el('div', {
            class: 'sub',
            text: locked ? STR.build.tierLocked(b.tier) : STR.gacha.poolSize(b.pool.length),
          }),
        ),
      );
      if (!locked)
        row.addEventListener('click', () => {
          this.banner = b;
          this.render();
          this.renderIdle();
        });
      c.append(row);
    }
    const rates = el(
      'div',
      { style: 'margin-top:10px' },
      el('div', { class: 'col-title', text: STR.gacha.rates }),
    );
    for (const r of RARITIES)
      rates.append(
        el(
          'div',
          { class: 'kv' },
          el('span', { class: `k rarity-${r}`, text: r }),
          el('span', { class: 'v', text: `${(RATES[r] * 100).toFixed(0)}%` }),
        ),
      );
    rates.append(
      el('div', { class: 'sub dim', style: 'margin-top:6px', text: STR.gacha.rules(PITY) }),
    );
    c.append(rates);
    this.renderFoot();
  }

  private renderFoot() {
    const f = this.foot;
    f.innerHTML = '';
    const pity = el('span', { class: 'num', text: STR.gacha.pity(this.gacha.pity, PITY) });
    const tickets = el('span', {
      class: 'num amber',
      text: `${STR.hud.tickets}: ${this.economy.tickets}`,
    });
    const b1 = btn(STR.gacha.pull1(PULL_COST), () => this.doPull(1), 'accent');
    const b10 = btn(STR.gacha.pull10(PULL_COST * 10), () => this.doPull(10), 'accent');
    b1.disabled = this.revealing || this.economy.tickets < PULL_COST;
    b10.disabled = this.revealing || this.economy.tickets < PULL_COST * 10;
    f.append(tickets, pity, el('span', { style: 'flex:1' }), b1, b10);
  }

  private renderIdle() {
    this.stage.innerHTML = '';
    this.stage.append(
      el(
        'div',
        { class: 'gacha-idle' },
        el('div', { class: 'gacha-banner-name', text: this.banner.name }),
        el('div', { class: 'dim', text: STR.gacha.idleHint }),
      ),
    );
    // preview of the pool grouped by rarity
    const pool = el('div', { class: 'gacha-pool' });
    for (const r of [...RARITIES].reverse()) {
      const ids = this.banner.pool.filter((id) => itemDef(id).rarity === r);
      if (!ids.length) continue;
      pool.append(
        el('div', {
          class: `sub rarity-${r}`,
          text: `${r}: ${ids.map((id) => itemDef(id).name).join(', ')}`,
        }),
      );
    }
    this.stage.append(pool);
  }

  private doPull(n: 1 | 10) {
    const cost = PULL_COST * n;
    if (this.economy.tickets < cost) {
      this.toast(STR.gacha.noTickets, 'warn');
      return;
    }
    this.economy.tickets -= cost;
    const results = this.gacha.pull(this.banner, n, this.now());
    this.reveal(results);
  }

  private reveal(results: PullResult[]) {
    this.revealing = true;
    this.renderFoot();
    this.stage.innerHTML = '';
    const grid = el('div', { class: 'gacha-grid' });
    this.stage.append(grid);
    const cards: HTMLElement[] = [];
    results.forEach((r, i) => {
      const d = itemDef(r.defId);
      const card = el(
        'div',
        { class: `gcard rarity-${r.rarity} pending` },
        el('div', { class: 'gcard-back', text: '?' }),
        el(
          'div',
          { class: 'gcard-front' },
          el('div', { class: `gcard-rarity rarity-${r.rarity}`, text: r.rarity }),
          el('div', { class: 'gcard-name', text: d.name }),
          el('div', {
            class: 'gcard-kind',
            text: r.item.kind === 'loco' ? STR.gacha.loco : STR.gacha.wagon,
          }),
          el('div', { class: 'gcard-era', text: d.era }),
          el('div', {
            class: `gcard-dupe ${r.duplicate ? '' : 'new'}`,
            text: r.duplicate
              ? r.leveled
                ? STR.gacha.levelUp(r.item.level)
                : STR.gacha.dupe(r.item.dupes, dupesNeeded(r.item.level))
              : STR.gacha.newItem,
          }),
          r.forced ? el('div', { class: 'gcard-forced', text: STR.gacha.guaranteed }) : null,
        ),
      );
      card.addEventListener('click', () => card.classList.replace('pending', 'flipped'));
      grid.append(card);
      cards.push(card);
      setTimeout(
        () => {
          card.classList.replace('pending', 'flipped');
        },
        350 + i * 260,
      );
    });
    const total = 350 + results.length * 260 + 500;
    setTimeout(() => {
      this.revealing = false;
      this.foot.innerHTML = '';
      this.foot.append(
        btn(
          STR.gacha.collect,
          () => {
            this.renderIdle();
            this.renderFoot();
          },
          'accent',
        ),
      );
      const ssr = results.filter((r) => r.rarity === 'SSR').length;
      if (ssr) this.toast(STR.gacha.ssrToast(ssr), 'good');
    }, total);
  }
}
