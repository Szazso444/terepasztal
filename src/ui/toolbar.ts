import type { AtlasRegistry } from '../engine/atlas';
import type { AgeStatus } from '../sim/ages';
import { AGE_ORDER, STR } from '../strings';
import { LINES, type TrackClass } from '../world/track';
import { ageIcon } from './ageIcon';
import { ageName } from './ageTooltip';
import {
  BuildBar,
  arrowTip,
  buildCatalog,
  categoryTip,
  demolishTip,
  isLocked,
  itemTip,
  keyLabel,
  refundPercent,
  statusLine,
  toolKey,
  typeLockAge,
  typeTip,
  type Category,
  type CategoryId,
  type Tool,
  type ToolItem,
} from './buildBar';
import { buildIcon, itemPicture } from './buildIcons';
import { btn, el } from './dom';
import { lineBadge } from './lineBadge';
import { fmtInt } from './numberFormat';
import { spriteImg } from './spritePreview';
import { ttTerm, type Tooltip } from './tooltip';
import type { TipDoc } from './tooltipDoc';
import { tipBuild } from './tooltipRender';

export type { CategoryId, Tool, ToolItem } from './buildBar';

/** The badges of a track piece's lines: one, or both of a crossing between two lines. */
function pieceBadges(it: ToolItem): HTMLElement[] {
  if (it.tool.kind !== 'track') return [];
  const { cls, cls2 } = it.tool.item;
  return cls2 && cls2 !== cls ? [lineBadge(cls), lineBadge(cls2)] : [lineBadge(cls)];
}

/** A button of what cannot be used yet: not `disabled`, as its tooltip needs the pointer's events. */
function lockedButton(cls: string): HTMLButtonElement {
  return el('button', { class: `btn ${cls} lock`, 'aria-disabled': 'true' });
}

/** The lock and the icon of the age that opens it. */
function lockMark(tier: number): HTMLElement {
  return el('span', { class: 'tb-lock' }, buildIcon('lock', 12), ageIcon(AGE_ORDER[tier] ?? ''));
}

/**
 * The bottom build bar, drawn from `BuildBar`. From the bottom up: the categories with Demolish at
 * the right end and, with a category open, the types above them (when it has any) under their Q and
 * E arrows, then its items as tiles. The controller's status takes a line at the top while it has
 * something to say. Every button is a term of the tooltip layer, and hovering a tile feeds the info
 * panel.
 */
export class Toolbar {
  /**
   * `#build-dock`, the root in `#ui-root` (`input.ts` hit-tests its children): the overview hides
   * it, and with it the build card that `createPlayUi` stands in it over the bar.
   */
  readonly root: HTMLElement;
  readonly bar: BuildBar;
  /** the bar itself */
  private panel: HTMLElement;
  private catTerms = new Map<CategoryId, HTMLElement>();
  private catButtons = new Map<CategoryId, HTMLButtonElement>();
  private catKeys = new Map<CategoryId, HTMLElement>();
  private tiles = new Map<string, HTMLButtonElement>();
  private statusRow = el('div', { class: 'tb-status' });
  private typeRow = el('div', { class: 'tb-types' });
  private itemRow = el('div', { class: 'tb-items' });
  private removeBtn: HTMLButtonElement;
  /** what the types and tiles were last drawn for */
  private laid = '';
  onHover: ((item: ToolItem | null) => void) | null = null;

  constructor(
    onSelect: (t: Tool) => void,
    private readonly tierProvider: () => number,
    private readonly atlas: AtlasRegistry,
    private readonly tooltip: Tooltip,
    /** progress towards every age, read when a locked tooltip opens */
    private readonly ages: () => AgeStatus[],
  ) {
    this.bar = new BuildBar(
      buildCatalog((frame) => atlas.has(frame)),
      tierProvider,
      onSelect,
      () => this.paint(),
    );
    const catRow = el('div', { class: 'tb-cats' });
    for (const c of this.bar.categories) {
      const b = btn('', () => this.bar.toggleCategory(c.id), 'tb-cat');
      const key = el('kbd', { class: 'tb-kbd' });
      b.append(buildIcon(c.icon, 18), el('span', { class: 'tb-cat-name', text: c.label }), key);
      const term = this.term(b, () => categoryTip(c, this.bar.keyOf(c.id)));
      this.catButtons.set(c.id, b);
      this.catKeys.set(c.id, key);
      this.catTerms.set(c.id, term);
      catRow.append(term);
    }
    this.removeBtn = btn('', () => this.bar.toggleDemolish(), 'tb-cat tb-dem');
    this.removeBtn.append(
      buildIcon('demolish', 18),
      el('span', { class: 'tb-cat-name', text: STR.toolbar.demolish }),
      el('kbd', { class: 'tb-kbd', text: 'X' }),
    );
    catRow.append(
      el('span', { class: 'tb-spacer' }),
      this.term(this.removeBtn, () => demolishTip(refundPercent(this.bar.editor))),
    );
    this.layCategories();
    this.panel = el(
      'div',
      { id: 'toolbar', class: 'panel' },
      this.statusRow,
      this.typeRow,
      this.itemRow,
      catRow,
    );
    this.root = el('div', { id: 'build-dock' }, this.panel);
    this.tooltip.bindTerms(this.panel);
    this.paint(true);
  }

  /** The bar alone: the card stands over it, in the dock, left of the toasts. */
  get barRoot() {
    return this.panel;
  }
  get categories() {
    return this.bar.categories;
  }
  get open() {
    return this.bar.open;
  }
  get active() {
    return this.bar.active;
  }
  item(t: Tool) {
    return this.bar.item(t);
  }
  select(t: Tool) {
    this.bar.select(t);
  }
  setActive(t: Tool) {
    this.bar.setActive(t);
  }
  setEditor(on: boolean) {
    this.bar.setEditor(on);
    this.layCategories();
  }
  refresh() {
    this.paint(true);
  }
  setStatus(text: string) {
    if (this.bar.status === text) return;
    this.bar.status = text;
    this.paintStatus();
  }

  /** `target` as a term whose tooltip is `doc`; `bindTerms` wires it. */
  private term(target: HTMLElement, doc: () => TipDoc) {
    return ttTerm(target, tipBuild(this.atlas, doc));
  }

  /** The visible categories, without a gap, each with the key of its place on the row. */
  private layCategories() {
    for (const c of this.bar.categories) {
      const key = this.bar.keyOf(c.id);
      this.catTerms.get(c.id)!.style.display = key ? '' : 'none';
      this.catKeys.get(c.id)!.textContent = key;
    }
  }

  private paint(force = false) {
    const bar = this.bar;
    for (const [id, b] of this.catButtons) b.classList.toggle('active', id === bar.open);
    this.removeBtn.classList.toggle('active', bar.active.kind === 'remove');
    const laid = `${bar.open}|${bar.openGroup()}`;
    if (force || laid !== this.laid) {
      this.laid = laid;
      this.renderRows();
    }
    const key = toolKey(bar.active);
    for (const [k, b] of this.tiles) b.classList.toggle('active', k === key);
    this.paintStatus();
  }

  private paintStatus() {
    const bar = this.bar;
    const line = statusLine(bar.status, {
      demolishing: bar.active.kind === 'remove',
      categoryOpen: bar.open !== null,
      refund: refundPercent(bar.editor),
    });
    if (this.statusRow.textContent !== line.text) this.statusRow.textContent = line.text;
    this.statusRow.style.display = line.text ? '' : 'none';
    this.statusRow.classList.toggle('warn', line.warn);
  }

  private renderRows() {
    // a tooltip resting on a button of these rows goes with it: no mouseleave will come
    if (this.panel.matches(':hover')) this.tooltip.stack.termLeave(-1);
    const bar = this.bar;
    const c = bar.open ? bar.category(bar.open) : null;
    if (!c && this.tiles.size) this.onHover?.(null);
    this.tiles.clear();
    this.typeRow.innerHTML = '';
    this.itemRow.innerHTML = '';
    this.typeRow.style.display = c ? '' : 'none';
    this.itemRow.style.display = c ? '' : 'none';
    this.panel.classList.toggle('open', !!c);
    if (!c) return;
    this.renderTypes(c);
    this.renderTiles();
    this.tooltip.bindTerms(this.panel);
  }

  private renderTypes(c: Category) {
    const row = this.typeRow;
    if (c.groups) {
      const tier = this.tierProvider();
      const shown = this.bar.openGroup();
      row.append(this.arrow(-1));
      for (const g of c.groups) {
        const lock = typeLockAge(c, g.id, tier);
        const b =
          lock === null
            ? btn(g.label, () => this.bar.setGroup(g.id), 'tb-type')
            : lockedButton('tb-type');
        if (lock !== null) b.textContent = g.label;
        if (g.id in LINES) b.prepend(lineBadge(g.id as TrackClass));
        if (lock !== null) b.prepend(lockMark(lock));
        b.classList.toggle('active', g.id === shown);
        row.append(this.term(b, () => typeTip(g.label, lock, this.ages())));
      }
      row.append(this.arrow(1));
    }
    const hint = c.groups ? STR.toolbar.typeHint : STR.toolbar.cycleHint;
    row.append(el('em', { class: 'tb-hint', text: hint }));
  }

  /** A Q or E arrow: the key on the side of the type row it faces. */
  private arrow(dir: 1 | -1) {
    const b = btn('', () => this.bar.cycleGroup(dir), 'tb-qe');
    const key = el('kbd', { class: 'tb-kbd', text: dir < 0 ? 'Q' : 'E' });
    if (dir < 0) b.append(buildIcon('chevl', 14), key);
    else b.append(key, buildIcon('chevr', 14));
    return this.term(b, () => arrowTip(dir));
  }

  private renderTiles() {
    const tier = this.tierProvider();
    const typed = this.bar.openGroup() !== null;
    this.bar.openList().forEach((it, place) => {
      const locked = isLocked(it, tier);
      const tile = locked
        ? lockedButton('tb-item')
        : btn('', () => this.bar.select(it.tool), 'tb-item');
      const badges = pieceBadges(it);
      tile.append(
        el('kbd', { class: 'tb-kbd', text: keyLabel(place) }),
        badges.length ? el('span', { class: 'tb-badges' }, ...badges) : '',
        itemPicture(this.atlas, it, 'tb-icon', 24),
        el('span', { class: 'tb-name', text: typed ? (it.label ?? it.name) : it.name }),
        this.costLine(it, locked),
      );
      tile.addEventListener('mouseenter', () => this.onHover?.(it));
      tile.addEventListener('mouseleave', () => this.onHover?.(null));
      this.tiles.set(it.key, tile);
      this.itemRow.append(
        this.term(tile, () => itemTip(it, keyLabel(place), this.tierProvider(), this.ages())),
      );
    });
  }

  /** A tile's last line: its cost in icons, the words for it, or the age it waits for. */
  private costLine(it: ToolItem, locked: boolean) {
    const line = el('span', { class: 'tb-cost' });
    if (locked) {
      // the age's own word: "Age" does not fit a tile
      const age = ageName(AGE_ORDER[it.tier] ?? '').split(' ')[0];
      line.append(lockMark(it.tier), age);
      return line;
    }
    const parts = Object.entries(it.costNow?.() ?? it.cost).filter(([, v]) => v > 0);
    if (it.costText || !parts.length) {
      line.append(it.costText ?? STR.build.free);
      return line;
    }
    for (const [k, v] of parts)
      line.append(
        el(
          'span',
          { class: 'tb-res' },
          spriteImg(this.atlas, `icons/${k}`, 1, 'sprite-preview res-icon'),
          fmtInt(v),
        ),
      );
    return line;
  }
}
