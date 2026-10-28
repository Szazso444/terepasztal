import { el } from './dom';
import { STR } from '../strings';
import { RESOURCE_IDS, type Stockpile } from '../sim/stockpile';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';
import type { ResourceStat } from '../sim/stats';
import { supplyMode, type SupplyMode } from '../sim/supply';
import { fmtMoney } from './numberFormat';
import { ttTerm, type Tooltip } from './tooltip';
import { tipBuild } from './tooltipRender';
import { resourceTip, type ResourceSnapshot } from './tooltipContent';
import { RESOURCE_GROUPS, barGroups } from './resourceOrder';

/** What the stockpile holds: these have a cap and open the market when clicked. */
const STOCKPILED = new Set(RESOURCE_IDS);

/**
 * Second row under the top bar: funds first, then the resources in their groups (`RESOURCE_GROUPS`),
 * each cell a term whose tooltip links the buildings that make and use it. A resource shows once its
 * age has come or it is in stock (`barGroups`); the famine warning and `right` (tickets, age) end it.
 */
export class ResourceBar {
  readonly root = el('div', { id: 'resbar', class: 'panel' });
  readonly right = el('div', { class: 'res-right' });
  /** each resource's value, and the term around its cell that is hidden or shown */
  private values = new Map<string, HTMLElement>();
  private cells = new Map<string, HTMLElement>();
  /** each group's wrapper, with the separator before it (none before the first) */
  private groups: { root: HTMLElement; sep: HTMLElement | null }[] = [];
  private famine = el('span', { class: 'value red', text: STR.res.famine });
  /** Supplied by the game: actual rolling weekly flows. */
  stats: (() => Record<string, ResourceStat>) | null = null;
  private stock: Stockpile | null = null;
  private cap: (id: string) => number = () => Infinity;
  private money = 0;
  private tier = 0;
  /**
   * What the shown cells were worked out from: the age, the production chain (a load can switch
   * it) and the resources that were in stock.
   */
  private laidTier = -1;
  private laidSupply: SupplyMode | null = null;
  private inStock = new Set<string>();

  constructor(atlas: AtlasRegistry, tooltip: Tooltip, onClick: () => void) {
    RESOURCE_GROUPS.forEach((ids, i) => {
      const group = el('div', { class: 'res-group' });
      for (const id of ids) {
        const v = el('span', { class: 'value' });
        const cell = el(
          'div',
          { class: 'res' },
          spriteImg(atlas, `icons/${id}`, 1, 'sprite-preview res-icon'),
          v,
        );
        const term = ttTerm(
          cell,
          tipBuild(atlas, () => resourceTip(this.snapshot(id))),
        );
        if (STOCKPILED.has(id)) term.addEventListener('click', onClick);
        this.values.set(id, v);
        this.cells.set(id, term);
        group.append(term);
      }
      const sep = i ? el('div', { class: 'res-sep' }) : null;
      if (sep) this.root.append(sep);
      this.root.append(group);
      this.groups.push({ root: group, sep });
    });
    this.root.append(this.famine, el('div', { class: 'spacer' }), this.right);
    this.famine.style.display = 'none';
    tooltip.bindTerms(this.root);
  }

  /** What a cell's tooltip shows, read when it opens. */
  private snapshot(id: string): ResourceSnapshot {
    const tier = this.tier;
    const st = this.stock;
    if (id === 'money')
      return { id, have: this.money, cap: Infinity, produced: 0, consumed: 0, tier };
    if (id === 'population')
      // births are not counted anywhere yet; what the people eat is the week's food
      return {
        id,
        have: st?.population ?? 0,
        cap: Infinity,
        produced: 0,
        consumed: st?.foodPerWeek() ?? 0,
        tier,
      };
    const flow = this.stats?.()[id];
    return {
      id,
      have: st?.get(id) ?? 0,
      cap: STOCKPILED.has(id) ? this.cap(id) : Infinity,
      produced: flow?.produced ?? 0,
      consumed: flow?.consumed ?? 0,
      tier,
    };
  }

  /** Show the cells and groups `barGroups` lists, and hide the rest. */
  private layout(stock: Stockpile) {
    const shown = new Set(barGroups(this.tier, (id) => stock.get(id)).flat());
    for (const [id, cell] of this.cells) {
      const on = shown.has(id);
      if ((cell.style.display === 'none') === on) cell.style.display = on ? '' : 'none';
    }
    let before = false;
    RESOURCE_GROUPS.forEach((ids, i) => {
      const { root, sep } = this.groups[i];
      const on = ids.some((id) => shown.has(id));
      root.style.display = on ? '' : 'none';
      if (sep) sep.style.display = on && before ? '' : 'none';
      before ||= on;
    });
  }

  update(stock: Stockpile, cap: (id: string) => number, money: number, tier: number) {
    this.stock = stock;
    this.cap = cap;
    this.money = money;
    this.tier = tier;
    // the shown cells change only with the age or the chain, or when a stock crosses zero
    let relayout = tier !== this.laidTier || supplyMode() !== this.laidSupply;
    for (const id of this.cells.keys()) {
      const has = stock.get(id) > 0;
      if (has === this.inStock.has(id)) continue;
      if (has) this.inStock.add(id);
      else this.inStock.delete(id);
      relayout = true;
    }
    if (relayout) {
      this.laidTier = tier;
      this.laidSupply = supplyMode();
      this.layout(stock);
    }
    const stats = this.stats?.();
    for (const [id, v] of this.values) {
      if (this.cells.get(id)!.style.display === 'none') continue;
      if (id === 'money' || id === 'population') {
        const text = id === 'money' ? fmtMoney(money) : `${stock.population}`;
        if (v.textContent !== text) v.textContent = text;
        continue;
      }
      const have = Math.floor(stock.get(id));
      const text = `${have}`;
      if (v.textContent !== text) v.textContent = text;
      const net = (stats?.[id]?.produced ?? 0) - (stats?.[id]?.consumed ?? 0);
      v.classList.toggle('red', net < -0.01);
      v.classList.toggle('good', net > 0.01);
      v.classList.toggle('amber', Math.abs(net) <= 0.01 && have >= cap(id));
    }
    this.famine.style.display = stock.famine ? '' : 'none';
  }
}
