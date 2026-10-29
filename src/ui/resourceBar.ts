import { el, btn } from './dom';
import { STR } from '../strings';
import { RESOURCE_IDS, type ResourceStore } from '../sim/stores';
import { CARGO, cargoName } from '../sim/cargo';
import { inSupplyMode } from '../sim/supply';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';
import { ShownFlows } from '../sim/stats';

/**
 * Second row under the top bar: the store it shows (a button that steps to the next one), every
 * resource held there with a hover card, population, and the funds block.
 */
export class ResourceBar {
  readonly root = el('div', { id: 'resbar', class: 'panel' });
  readonly right = el('div', { class: 'res-right' });
  /** the name of the store shown; a click asks for the next one (`onNextStore`) */
  private storeBtn = btn('', () => this.onNextStore?.(), 'small res-store');
  private cells = new Map<string, HTMLElement>();
  private cellRoots = new Map<string, HTMLElement>();
  private cellDefs = new Map<string, (typeof CARGO)[number]>();
  private pop = el('span', { class: 'value' });
  private famine = el('span', { class: 'value red', text: STR.res.famine });
  private card = el('div', { id: 'res-card', class: 'panel' });
  private hovered: string | null = null;
  /** the rolling weekly flows of the store shown, worked out on `refreshFlows` */
  private flows = new ShownFlows(RESOURCE_IDS);
  /** Supplied by the game: residents, and the food they and the crews eat a week. */
  people: (() => { residents: number; foodPerWeek: number }) | null = null;
  /** the store button was clicked: show the next store */
  onNextStore: (() => void) | null = null;
  private store: ResourceStore | null = null;
  private totals = new Map<string, number>();

  constructor(atlas: AtlasRegistry, onClick: () => void) {
    this.storeBtn.title = STR.res.nextStore;
    this.root.append(this.storeBtn);
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
    const st = this.store;
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
      const p = this.people?.() ?? { residents: 0, foodPerWeek: 0 };
      c.append(
        el('div', { class: 'panel-title', text: STR.res.population }),
        el(
          'div',
          { class: 'panel-body' },
          el('div', { class: 'bi-desc', text: STR.res.populationHint }),
          row(STR.res.people, String(p.residents)),
          row(STR.res.eats, `${p.foodPerWeek.toFixed(1)} ${STR.res.foodPerWeek}`),
        ),
      );
      return;
    }
    const info = STR.res.info[id];
    const stats = this.flows.of(st)[id];
    const body = el('div', { class: 'panel-body' });
    if (info) body.append(el('div', { class: 'bi-desc', text: info }));
    body.append(row(STR.res.have, `${Math.floor(st.get(id))} / ${st.cap(id)}`));
    body.append(
      el('div', { class: 'dim', text: STR.res.allStores(Math.floor(this.totals.get(id) ?? 0)) }),
    );
    if (stats) {
      body.append(el('div', { class: 'dim', text: STR.res.historyNote }));
      body.append(row(STR.res.producedDay, stats.produced.toFixed(1)));
      body.append(row(STR.res.consumedDay, stats.consumed.toFixed(1)));
      const net = stats.produced - stats.consumed;
      body.append(row(STR.res.netDay, `${net >= 0 ? '+' : ''}${net.toFixed(1)}`));
    }
    c.append(el('div', { class: 'panel-title', text: cargoName(id) }), body);
  }

  /**
   * Show `store` (with the grid's power beside it), named `label` on the store button; `totals` is
   * what every store holds together, for the hover card.
   */
  update(store: ResourceStore, label: string, totals: Map<string, number>) {
    this.store = store;
    this.totals = totals;
    if (this.storeBtn.textContent !== label) this.storeBtn.textContent = label;
    const stats = this.flows.of(store);
    for (const [id, v] of this.cells) {
      const def = this.cellDefs.get(id);
      const shown = !def || inSupplyMode(def);
      const root = this.cellRoots.get(id)!;
      if ((root.style.display === 'none') === shown) root.style.display = shown ? '' : 'none';
      if (!shown) continue;
      const have = Math.floor(store.get(id));
      const c = store.cap(id);
      const text = `${have}`;
      if (v.textContent !== text) v.textContent = text;
      const net = (stats[id]?.produced ?? 0) - (stats[id]?.consumed ?? 0);
      v.classList.toggle('red', net < -0.01);
      v.classList.toggle('good', net > 0.01);
      v.classList.toggle('amber', Math.abs(net) <= 0.01 && have >= c);
      root.title = STR.res.netTitle(`${net >= 0 ? '+' : ''}${net.toFixed(1)}`);
    }
    const p = `${this.people?.().residents ?? 0}`;
    if (this.pop.textContent !== p) this.pop.textContent = p;
    this.famine.style.display = store.famine ? '' : 'none';
    if (this.hovered) this.renderCard();
  }
  /** The weekly flows are worked out again at the next `update` (the panels' refresh). */
  refreshFlows() {
    this.flows.refresh();
  }
}
