import { el } from './dom';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';
import type { ToolItem } from './toolbar';
import { cargoName } from '../sim/cargo';
import type { ResourceStore } from '../sim/stores';
import type { Cost } from '../data/content';
import type { Train } from '../sim/trains';
import type { Builder } from '../sim/build';
import { STR } from '../strings';
import { btn } from './dom';
import { locoFrame } from '../art/frames';

/**
 * Card above the survey map: preview, name, cost with icons and a description of a build item,
 * and over a field tile the store that would pay for it there (or why none can); or, when a train
 * is selected in the field view, that train's state, load and tanks.
 */
export class BuildInfo {
  readonly root = el('div', { id: 'build-info', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private shown: ToolItem | null = null;
  private train: Train | null = null;
  private trainKey = '';
  onTrainDetails: ((t: Train) => void) | null = null;
  onTrainLocate: ((t: Train) => void) | null = null;
  onTrainClose: (() => void) | null = null;
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly builder: Builder,
    /** the field tile under the pointer, null over a panel: where the work would be paid for */
    private readonly at: () => { x: number; y: number } | null,
  ) {
    this.root.append(this.body);
    this.root.style.display = 'none';
  }
  /** Show (or clear) the selected train; a hovered toolbar item takes precedence while hovered. */
  showTrain(t: Train | null) {
    this.train = t;
    this.trainKey = '';
    if (!this.shown) this.renderTrain(true);
  }
  /** Re-render the train card when its state changed (cheap key check). */
  refreshTrain() {
    if (this.train && !this.shown) this.renderTrain(false);
  }
  private renderTrain(force: boolean) {
    const t = this.train;
    if (!t) {
      this.root.style.display = 'none';
      return;
    }
    const next = this.builder.stationById(t.route[t.routeIndex % Math.max(1, t.route.length)]);
    const state = `${t.blocked && t.state === 'moving' ? STR.depot.state.held : STR.depot.state[t.state]}${next ? ` → ${next.name}` : ''}`;
    const loads = t.wagons
      .map((w) => (w.cargo ? `${Math.round(w.amount)} ${cargoName(w.cargo).toLowerCase()}` : '·'))
      .join(', ');
    const tanks = [
      t.coalCap > 0 ? `${STR.train.fuel} ${Math.round(t.coal)}/${Math.round(t.coalCap)}` : '',
      t.waterCap > 0 ? `${STR.train.water} ${Math.round(t.water)}/${Math.round(t.waterCap)}` : '',
      t.oilCap > 0 ? `${cargoName(t.oilKind)} ${Math.round(t.oil)}/${Math.round(t.oilCap)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const key = `${t.id}|${t.name}|${state}|${loads}|${tanks}|${t.mode}|${t.lastMessage}|${t.hungry}`;
    if (!force && key === this.trainKey) return;
    this.trainKey = key;
    this.root.style.display = '';
    const b = this.body;
    b.innerHTML = '';
    const frame = locoFrame(this.atlas, t.locoDef, 3);
    b.append(
      el(
        'div',
        { class: 'bi-top' },
        spriteImg(this.atlas, frame, 1, 'sprite-preview bi-art'),
        el(
          'div',
          { class: 'bi-text' },
          el('div', { class: 'name', text: t.name }),
          el('div', { class: 'sub', text: state }),
          el('div', { class: 'sub dim', text: `${STR.train.routing}: ${STR.train.mode[t.mode]}` }),
        ),
      ),
      el('div', { class: 'bi-desc', text: `${STR.depot.wagons}: ${loads || '-'}` }),
      t.hungry ? el('div', { class: 'bi-desc red', text: STR.train.hungry }) : '',
      el('div', {
        class: 'bi-desc',
        text: tanks || `${Math.round(t.weight)} / ${Math.round(t.power)} t`,
      }),
      t.lastMessage ? el('div', { class: 'bi-place', text: t.lastMessage }) : '',
      el(
        'div',
        { class: 'row', style: 'margin:4px 0 0 0' },
        btn(STR.depot.details, () => this.onTrainDetails?.(t), 'small'),
        btn(STR.depot.locate, () => this.onTrainLocate?.(t), 'small'),
        btn('x', () => this.onTrainClose?.(), 'small'),
      ),
    );
  }
  show(item: ToolItem | null) {
    if (!item) {
      this.shown = null;
      if (this.train) this.renderTrain(true);
      else this.root.style.display = 'none';
      return;
    }
    this.shown = item;
    this.root.style.display = '';
    const b = this.body;
    b.innerHTML = '';
    const costs = el('div', { class: 'bi-cost' });
    const cost = item.costNow ? item.costNow() : item.cost;
    const entries = Object.entries(cost).filter(([, v]) => v > 0);
    if (!entries.length) costs.append(el('span', { class: 'dim', text: STR.build.free }));
    const { from, line } = this.payment(cost, entries.length > 0);
    for (const [k, v] of entries) {
      const have = from?.get(k) ?? 0;
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
      item.place ? el('div', { class: 'bi-place', text: item.place }) : '',
      line ? el('div', { class: `bi-place ${line.ok ? '' : 'red'}`, text: line.text }) : '',
    );
  }
  /**
   * Who pays `cost`: over a field tile the store that would (`Builder.payerAt`), named, or the
   * reason none can, with the nearest store's goods to mark what is short; off the field the
   * selected store's goods, and nothing said.
   */
  private payment(
    cost: Cost,
    priced: boolean,
  ): { from: ResourceStore | null; line: { ok: boolean; text: string } | null } {
    const stores = this.builder.stores;
    const at = this.at();
    if (!at || !priced || this.builder.free) return { from: stores.selected, line: null };
    const payer = this.builder.payerAt(cost, at.x, at.y);
    if (payer)
      return { from: payer, line: { ok: true, text: STR.build.paidFrom(stores.label(payer)) } };
    const why = this.builder.affordable(cost, at.x, at.y).reason ?? '';
    return { from: stores.nearest(at.x, at.y)[0] ?? null, line: { ok: false, text: why } };
  }
  /** Re-render affordability colours and the paying store when the stores or the tile changed. */
  refresh() {
    if (this.shown) this.show(this.shown);
  }
}
