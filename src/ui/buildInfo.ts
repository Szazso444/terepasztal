import { el } from './dom';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';
import type { ToolItem } from './toolbar';
import { cargoName } from '../sim/cargo';
import type { Stockpile } from '../sim/stockpile';

/** Card above the survey map: preview, name, cost with icons and a description of a build item. */
export class BuildInfo {
  readonly root = el('div', { id: 'build-info', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private shown: ToolItem | null = null;
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly stock: Stockpile,
  ) {
    this.root.append(this.body);
    this.root.style.display = 'none';
  }
  show(item: ToolItem | null) {
    if (!item) {
      this.shown = null;
      this.root.style.display = 'none';
      return;
    }
    this.shown = item;
    this.root.style.display = '';
    const b = this.body;
    b.innerHTML = '';
    const costs = el('div', { class: 'bi-cost' });
    const entries = Object.entries(item.cost).filter(([, v]) => v > 0);
    if (!entries.length) costs.append(el('span', { class: 'dim', text: 'free' }));
    for (const [k, v] of entries) {
      const have = this.stock.get(k);
      costs.append(
        el(
          'span',
          { class: `bi-res ${have < v ? 'red' : ''}` },
          spriteImg(this.atlas, `icons/${k}`, 1, 'sprite-preview res-icon'),
          el('span', { text: String(v) }),
        ),
      );
      costs.lastElementChild!.setAttribute('title', cargoName(k));
    }
    b.append(
      el(
        'div',
        { class: 'bi-top' },
        spriteImg(this.atlas, item.frame, 1, 'sprite-preview bi-art'),
        el('div', { class: 'bi-text' }, el('div', { class: 'name', text: item.name }), costs),
      ),
      el('div', { class: 'bi-desc', text: item.desc }),
    );
  }
  /** Re-render affordability colours when the stockpile changed. */
  refresh() {
    if (this.shown) this.show(this.shown);
  }
}
