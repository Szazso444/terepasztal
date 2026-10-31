import { el } from './dom';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';
import type { Cost } from '../data/content';
import { controlsHint, type ToolItem } from './buildBar';
import { buildIcon, itemPicture } from './buildIcons';
import type { RunPlan } from './autoCrossing';
import { cargoName } from '../sim/cargo';
import type { Placement } from './buildController';
import type { Train } from '../sim/trains';
import type { Builder } from '../sim/build';
import { rules } from '../sim/rules';
import { STR } from '../strings';
import { footprintOf } from '../world/track';
import { btn } from './dom';
import { locoFrame } from '../art/frames';

/**
 * Who pays for the work under the pointer, read from the builder's own verdict on it
 * (`BuildController.placement`), so at the price placing it there costs: the paying store, named;
 * or, refused because no store in reach holds that price, the refusal (with the amounts the
 * nearest store lacks) and the goods it is short of.
 */
export interface Payment {
  ok: boolean;
  text: string;
  /** the goods the nearest store lacks; none when a store pays */
  short: string[];
}

/**
 * The payment the build card shows for `p`; null with nothing under the pointer, nothing to pay
 * (free mode, a free piece), or a refusal for another reason than the price, which the status line
 * gives.
 */
export function paymentOf(builder: Builder, p: Placement | null): Payment | null {
  if (!p) return null;
  const { check, at } = p;
  const stores = builder.stores;
  if (check.ok) {
    const payer = check.payer !== undefined ? stores.byKey(check.payer) : undefined;
    return payer ? { ok: true, text: STR.build.paidFrom(stores.label(payer)), short: [] } : null;
  }
  // refused for want of a store only when its price alone is refused at the tile it is paid at
  const paid = builder.affordable(check.cost, at.x, at.y);
  if (paid.ok) return null;
  const near = stores.nearest(at.x, at.y)[0];
  const short = Object.keys(near ? near.missing(check.cost) : check.cost);
  return { ok: false, text: paid.reason ?? '', short };
}

/** What the card says of a run being dragged. */
export interface RunView {
  /** the tiles it lays on: a curve counts its footprint */
  tiles: number;
  curves: number;
  cost: Cost;
}

/** The part of `plan` its release would lay, as `layRun` goes through it. */
export function runView(plan: RunPlan): RunView {
  let tiles = 0;
  plan.steps.forEach((s, i) => {
    if (i < plan.end && s.ok && !s.stands)
      tiles += footprintOf(s.x, s.y, s.item.kind, s.rot, s.item.cls).length;
  });
  return { tiles, curves: plan.curves, cost: plan.cost };
}

/** How many times a level 1 works runs its recipe in a week, as tuned (src/sim/buildings.ts). */
export function recipeBatches(perWeek: number): number {
  return Math.round(perWeek * rules.productionMul);
}

/** A heading of the card, with a few words at its right end. */
function section(title: string, right = ''): HTMLElement {
  return el('div', { class: 'bi-sec' }, title, right ? el('em', { text: right }) : '');
}

/**
 * The card over the build bar. For a build item: its picture, name and type with a close mark; its
 * description, cost, what it makes, where it goes and, while it is placed on the field, the store
 * that pays for it there (or why none can); while a run is dragged, its tiles and cost; then how
 * the tool is used. When a train is selected in the field view: that train's state, load and tanks.
 */
export class BuildInfo {
  readonly root = el('div', { id: 'build-info', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private shown: ToolItem | null = null;
  private train: Train | null = null;
  private trainKey = '';
  /** what the item's card was last drawn from: a refresh leaves its close mark under the pointer */
  private itemKey = '';
  /** the close mark: put the tool down */
  onClose: (() => void) | null = null;
  onTrainDetails: ((t: Train) => void) | null = null;
  onTrainLocate: ((t: Train) => void) | null = null;
  onTrainClose: (() => void) | null = null;
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly builder: Builder,
    /** the builder's verdict on the work under the pointer (`BuildController.placement`) */
    private readonly placement: () => Placement | null,
    /** the run being dragged (`BuildController.run`): only a straight's tool lays one */
    private readonly run: () => RunPlan | null,
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
    const b = el('div', { class: 'bi-train' });
    this.body.replaceChildren(b);
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
    this.shown = item;
    if (item) this.renderItem(item, true);
    else if (this.train) this.renderTrain(true);
    else this.root.style.display = 'none';
  }
  /** A resource's icon and amount, red when `short` of it. */
  private amount(k: string, v: number, short = false) {
    const e = el(
      'span',
      { class: `bi-res ${short ? 'red' : ''}` },
      spriteImg(this.atlas, `icons/${k}`, 1, 'sprite-preview res-icon'),
      el('span', { text: String(v) }),
    );
    e.setAttribute('title', cargoName(k));
    return e;
  }
  private amounts(cost: Cost) {
    return Object.entries(cost).map(([k, v]) => this.amount(k, v));
  }
  /** A recipe in icons: what goes in (or its alternative), an arrow, what comes out. */
  private recipeLine(r: NonNullable<ToolItem['recipe']>) {
    const line = el('div', { class: 'bi-line' }, ...this.amounts(r.in));
    if (r.altIn) line.append(STR.building.or, ...this.amounts(r.altIn));
    if (Object.keys(r.in).length) line.append('→');
    line.append(...this.amounts(r.out));
    return line;
  }
  private renderItem(item: ToolItem, force: boolean) {
    const cost = Object.entries(item.costNow ? item.costNow() : item.cost).filter(([, v]) => v > 0);
    // red: what the store that would pay lacks; off the field, what the selected store lacks
    const pay = paymentOf(this.builder, this.placement());
    const held = this.builder.stores.selected;
    const short = cost.map(([k, v]) => (pay ? pay.short.includes(k) : (held?.get(k) ?? 0) < v));
    const plan = this.run();
    const run = plan && runView(plan);
    const key = JSON.stringify([item.key, cost, short, pay?.ok, pay?.text, run]);
    if (!force && key === this.itemKey) return;
    this.itemKey = key;
    this.root.style.display = '';
    const costs = el('div', { class: 'bi-line' });
    if (item.costText || !cost.length)
      costs.append(el('span', { class: 'dim', text: item.costText ?? STR.build.free }));
    else cost.forEach(([k, v], i) => costs.append(this.amount(k, v, short[i])));
    const close = btn('', () => this.onClose?.(), 'small bi-x');
    close.append(buildIcon('close', 14));
    this.body.replaceChildren(
      el(
        'div',
        { class: 'bi-head' },
        itemPicture(this.atlas, item, 'bi-ic', 18),
        el('span', { class: 'bi-name', text: item.name }),
        item.typeLabel ? el('span', { class: 'bi-type', text: item.typeLabel }) : '',
        close,
      ),
      el(
        'div',
        { class: 'bi-scroll' },
        item.desc ? el('p', { class: 'bi-p', text: item.desc }) : '',
        section(STR.toolbar.secCost),
        costs,
        ...(item.recipe
          ? [
              section(
                STR.toolbar.secMakes,
                STR.toolbar.batches(recipeBatches(item.recipe.perWeek)),
              ),
              this.recipeLine(item.recipe),
            ]
          : []),
        ...(item.place
          ? [section(STR.toolbar.secWhere), el('p', { class: 'bi-p', text: item.place })]
          : []),
        pay ? el('p', { class: `bi-p ${pay.ok ? '' : 'red'}`, text: pay.text }) : '',
        ...(run
          ? [
              section(STR.toolbar.secRun, STR.toolbar.runSize(run.tiles, run.curves)),
              el('div', { class: 'bi-line' }, ...this.amounts(run.cost)),
            ]
          : []),
      ),
      el('div', { class: 'bi-foot', text: controlsHint(item) }),
    );
  }
  /**
   * Re-render affordability colours and the paying store as the stores and the pointer move. Not
   * under the pointer: the card stands on its bottom edge, so losing the payment line as the pointer
   * comes off the field would move the close mark from under it.
   */
  refresh() {
    if (this.shown && !this.root.matches(':hover')) this.renderItem(this.shown, false);
  }
}
