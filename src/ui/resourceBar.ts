import { el } from './dom';
import { STR } from '../strings';
import type { Stockpile } from '../sim/stockpile';
import { CARGO, cargoName } from '../sim/cargo';
import { inSupplyMode } from '../sim/supply';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';
import type { ResourceStat } from '../sim/stats';

/** Second row under the top bar: every resource with a hover card, population, and the funds block. */
export class ResourceBar {
  readonly root = el('div', { id: 'resbar', class: 'panel' });
  readonly right = el('div', { class: 'res-right' });
  private cells = new Map<string, HTMLElement>();
  private cellRoots = new Map<string, HTMLElement>();
  private cellDefs = new Map<string, (typeof CARGO)[number]>();
  private pop = el('span', { class: 'value' });
  private famine = el('span', { class: 'value red', text: STR.res.famine });
  private card = el('div', { id: 'res-card', class: 'panel' });
  private hovered: string | null = null;
  /** supplied by the game: per-day flows and the cap */
  stats: (() => Record<string, ResourceStat>) | null = null;
  cap: (id: string) => number = () => Infinity;
  private stock: Stockpile | null = null;

  constructor(atlas: AtlasRegistry, onClick: () => void) {
    for (const c of [...CARGO.filter((x) => x.class !== 'people').map((x) => x.id), 'power']) {
      const v = el('span', { class: 'value' });
      const cell = el(
        'div',
        { class: 'res' },
        spriteImg(atlas, `icons/${c}`, 1, 'sprite-preview res-icon'),
        v,
      );
      // cargo of the other production-chain mode stays off the bar
      const def = CARGO.find((x) => x.id === c);
      if (def && !inSupplyMode(def)) cell.style.display = 'none';
      if (def) this.cellDefs.set(c, def);
      cell.addEventListener('mouseenter', () => this.showCard(c, cell));
      cell.addEventListener('mouseleave', () => this.hideCard());
      cell.addEventListener('click', onClick);
      this.cells.set(c, v);
      this.cellRoots.set(c, cell);
      this.root.append(cell);
    }
    const popCell = el(
      'div',
      { class: 'res' },
      spriteImg(atlas, 'icons/population', 1, 'sprite-preview res-icon'),
      this.pop,
    );
    popCell.addEventListener('mouseenter', () => this.showCard('population', popCell));
    popCell.addEventListener('mouseleave', () => this.hideCard());
    this.root.append(popCell, this.famine, el('div', { class: 'spacer' }), this.right);
    this.famine.style.display = 'none';
    this.card.style.display = 'none';
    document.body.append(this.card);
  }

  private showCard(id: string, cell: HTMLElement) {
    this.hovered = id;
    const r = cell.getBoundingClientRect();
    this.card.style.left = `${Math.max(4, Math.min(window.innerWidth - 270, r.left))}px`;
    this.card.style.top = `${r.bottom + 4}px`;
    this.card.style.display = '';
    this.renderCard();
  }
  private hideCard() {
    this.hovered = null;
    this.card.style.display = 'none';
  }
  private renderCard() {
    const id = this.hovered;
    const st = this.stock;
    if (!id || !st) return;
    const c = this.card;
    c.innerHTML = '';
    const row = (k: string, v: string) =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: k }),
        el('span', { class: 'v', text: v }),
      );
    if (id === 'population') {
      c.append(
        el('div', { class: 'panel-title', text: STR.res.population }),
        el(
          'div',
          { class: 'panel-body' },
          el('div', { class: 'bi-desc', text: STR.res.populationHint }),
          row(STR.res.people, String(st.population)),
          row(STR.res.eats, `${st.wheatPerDay().toFixed(1)} ${STR.res.wheatPerDay}`),
        ),
      );
      return;
    }
    const info = STR.res.info[id];
    const stats = this.stats?.()[id];
    const body = el('div', { class: 'panel-body' });
    if (info) body.append(el('div', { class: 'bi-desc', text: info }));
    body.append(row(STR.res.have, `${Math.floor(st.get(id))} / ${this.cap(id)}`));
    if (stats) {
      body.append(row(STR.res.producedDay, stats.produced.toFixed(1)));
      body.append(row(STR.res.consumedDay, stats.consumed.toFixed(1)));
      const net = stats.produced - stats.consumed;
      body.append(row(STR.res.netDay, `${net >= 0 ? '+' : ''}${net.toFixed(1)}`));
    }
    c.append(el('div', { class: 'panel-title', text: cargoName(id) }), body);
  }

  update(stock: Stockpile, cap: (id: string) => number) {
    this.stock = stock;
    this.cap = cap;
    for (const [id, v] of this.cells) {
      const def = this.cellDefs.get(id);
      const shown = !def || inSupplyMode(def);
      const root = this.cellRoots.get(id)!;
      if ((root.style.display === 'none') === shown) root.style.display = shown ? '' : 'none';
      if (!shown) continue;
      const have = Math.floor(stock.get(id));
      const c = cap(id);
      const text = `${have}`;
      if (v.textContent !== text) v.textContent = text;
      v.classList.toggle('red', have === 0);
      v.classList.toggle('amber', have >= c);
    }
    const p = `${stock.population}`;
    if (this.pop.textContent !== p) this.pop.textContent = p;
    this.famine.style.display = stock.famine ? '' : 'none';
    if (this.hovered) this.renderCard();
  }
}
