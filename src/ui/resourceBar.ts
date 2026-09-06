import { el } from './dom';
import { STR } from '../strings';
import type { Stockpile } from '../sim/stockpile';
import { CARGO } from '../sim/cargo';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';

/** Second row under the top bar: every resource, population and wheat upkeep. */
export class ResourceBar {
  readonly root = el('div', { id: 'resbar', class: 'panel' });
  private cells = new Map<string, HTMLElement>();
  private pop = el('span', { class: 'value' });
  private famine = el('span', { class: 'value red', text: STR.res.famine });

  constructor(atlas: AtlasRegistry, onClick: () => void) {
    for (const c of [...CARGO.map((x) => x.id), 'power']) {
      const v = el('span', { class: 'value' });
      const cell = el(
        'div',
        { class: 'res' },
        spriteImg(atlas, `icons/${c}`, 1, 'sprite-preview res-icon'),
        v,
      );
      cell.title = c === 'power' ? STR.res.power : (CARGO.find((x) => x.id === c)?.name ?? c);
      this.cells.set(c, v);
      this.root.append(cell);
    }
    const popCell = el(
      'div',
      { class: 'res' },
      el('span', { class: 'label', text: STR.res.population }),
      this.pop,
    );
    popCell.title = STR.res.populationHint;
    this.root.append(popCell, this.famine);
    this.famine.style.display = 'none';
    this.root.addEventListener('click', onClick);
    this.root.title = STR.res.openMarket;
  }

  update(stock: Stockpile, cap: (id: string) => number) {
    for (const [id, v] of this.cells) {
      const have = Math.floor(stock.get(id));
      const c = cap(id);
      const text = `${have}`;
      if (v.textContent !== text) v.textContent = text;
      v.classList.toggle('red', have === 0);
      v.classList.toggle('amber', have >= c);
    }
    const p = `${stock.population} · ${stock.wheatPerDay().toFixed(1)} ${STR.res.wheatPerDay}`;
    if (this.pop.textContent !== p) this.pop.textContent = p;
    this.famine.style.display = stock.famine ? '' : 'none';
  }
}
