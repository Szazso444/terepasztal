import { el, btn } from './dom';
import { fmtCost } from '../sim/stockpile';
import { BUILDING_DEFS } from '../sim/buildings';
import { STR } from '../strings';
import { TRACK_ITEMS, itemKey, pieceCost, type TrackItem } from '../world/track';
import type { WideClass } from '../world/reclass';
import { SUPPLY_KINDS, SUPPLY_DEFS, type SupplyKind } from '../sim/catenary';
import { STATION_DEFS } from '../sim/stations';
import { DECOR_DEFS, decorDef } from '../sim/build';
import { Terrain, TERRAIN_NAMES } from '../world/tiles';
import type { Cost } from '../data/content';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';
import { content, type SupplyMode } from '../data/content';
import { inSupplyMode } from '../sim/supply';
import {
  TRACK_GROUPS,
  trackGroupOf,
  trackSlot,
  shortName,
  stepGroup,
  slotMate,
} from './trackGroups';

export type Tool =
  | { kind: 'none' }
  | { kind: 'track'; item: TrackItem }
  | { kind: 'supply'; supply: SupplyKind }
  | { kind: 'station'; defId: string }
  | { kind: 'decor'; defId: string }
  | { kind: 'terrain'; terrain: number }
  | { kind: 'building'; defId: string }
  /** convert track under the cursor to a class: an upgrade to high speed or a downgrade to wide */
  | { kind: 'reclass'; target: WideClass }
  | { kind: 'remove' };

/** One placeable thing: what the toolbar shows and what the info panel describes. */
export interface ToolItem {
  key: string;
  tool: Tool;
  name: string;
  cost: Cost;
  /** atlas frame for the preview */
  frame: string;
  desc: string;
  /** age required (0 steam, 1 diesel, 2 electric) */
  tier: number;
  /** only offered in this production-chain mode */
  supply?: SupplyMode;
  /** where it can go and what it needs, shown under the description */
  place: string;
  /** Chebyshev reach shown as a highlight while placing (services, power lines) */
  reach?: number;
  /** cost of the next one, with the repeat surcharge (set by the game) */
  costNow?: () => Cost;
  /** not offered at all right now (quests) */
  hidden?: () => boolean;
  /** the type it is listed under, in a category that has types */
  group?: string;
  /** its place in the type: the number key that picks it, counted from 0 */
  slot?: number;
  /** the name on its button when the type is shown above it */
  label?: string;
}
export type CategoryId = 'track' | 'stations' | 'decor' | 'utility' | 'works' | 'terrain';
interface Category {
  id: CategoryId;
  label: string;
  items: ToolItem[];
  editorOnly?: boolean;
  /** types the items are listed by; one is open at a time */
  groups?: { id: string; label: string }[];
}

function toolKey(t: Tool): string {
  switch (t.kind) {
    case 'track':
      return `track:${itemKey(t.item)}`;
    case 'supply':
      return `supply:${t.supply}`;
    case 'station':
      return `station:${t.defId}`;
    case 'decor':
      return `decor:${t.defId}`;
    case 'terrain':
      return `terrain:${t.terrain}`;
    case 'building':
      return `building:${t.defId}`;
    case 'reclass':
      return `reclass:${t.target}`;
    case 'remove':
      return 'remove';
    default:
      return '';
  }
}

/**
 * Bottom build bar. Row one holds the categories (plus Remove); opening a category shows its
 * items with an icon, name and cost. Number keys pick an item, Tab steps through them; hovering
 * an item feeds the info panel. A category with types (track) shows one type at a time: the
 * number keys count inside it, and Q and E step between the types.
 */
export class Toolbar {
  readonly root: HTMLElement;
  readonly categories: Category[];
  private catButtons = new Map<string, HTMLButtonElement>();
  private itemButtons = new Map<string, HTMLButtonElement>();
  private itemRow = el('div', { class: 'tb-row tb-items' });
  private groupRow = el('div', { class: 'tb-row tb-types' });
  /** the type last open in each category that has types */
  private groupOf = new Map<CategoryId, string>();
  private status = el('span', { class: 'tb-status dim' });
  private hint = el('span', { class: 'tb-status dim', style: 'margin-left:auto' });
  readonly extra = el('div', { class: 'tb-group' });
  private removeBtn: HTMLButtonElement;
  private reclassBtns: Record<WideClass, HTMLButtonElement>;
  open: CategoryId | null = null;
  active: Tool = { kind: 'none' };
  onHover: ((item: ToolItem | null) => void) | null = null;

  /** Items of the open category that belong to the running production-chain mode. */
  private modeItems() {
    if (!this.open) return [];
    return this.category(this.open).items.filter((i) => inSupplyMode(i));
  }

  setEditor(on: boolean) {
    for (const c of this.categories)
      if (c.editorOnly) this.catButtons.get(c.id)!.style.display = on ? '' : 'none';
  }

  constructor(
    private readonly onSelect: (t: Tool) => void,
    private readonly tierProvider: () => number,
    private readonly atlas: AtlasRegistry,
  ) {
    const track: ToolItem[] = TRACK_ITEMS.map((it) => {
      const k = itemKey(it);
      const base = content.track.pieces[it.kind]?.name ?? it.kind;
      const clsName =
        it.kind === 'crossing'
          ? `${STR.toolbar.trackClass[it.cls]} × ${STR.toolbar.trackClass[it.cls2 ?? it.cls]}`
          : it.cls === 'regular'
            ? ''
            : STR.toolbar.trackClass[it.cls];
      return {
        key: `track:${k}`,
        tool: { kind: 'track', item: it },
        name: clsName ? `${base} (${clsName})` : base,
        cost: pieceCost(it.kind, it.cls, it.cls2),
        costNow: () => pieceCost(it.kind, it.cls, it.cls2),
        frame: `track/${k}_0`,
        desc: STR.toolbar.trackDesc[k] ?? '',
        tier: 0,
        place: it.kind === 'bridge' ? STR.toolbar.place.bridge : STR.toolbar.place.track,
        group: trackGroupOf(it),
        slot: trackSlot(it),
        label: shortName(it, base),
      };
    });
    // listed type by type, each in the order of its number keys
    const typeAt = (i: ToolItem) => TRACK_GROUPS.indexOf(i.group as (typeof TRACK_GROUPS)[number]);
    track.sort((a, b) => typeAt(a) - typeAt(b) || a.slot! - b.slot!);
    const stations: ToolItem[] = STATION_DEFS.map((d) => ({
      key: `station:${d.id}`,
      tool: { kind: 'station', defId: d.id },
      name: d.name,
      cost: d.cost,
      frame: atlas.has(`structures/${d.art}_1`) ? `structures/${d.art}_1` : 'structures/station_1',
      desc: d.flavor,
      tier: d.tier,
      supply: d.supply,
      place: d.depot
        ? STR.toolbar.place.depot
        : d.id === 'town'
          ? STR.toolbar.place.town
          : STR.toolbar.place.station,
    }));
    const decorItem = (d: (typeof DECOR_DEFS)[number]): ToolItem => ({
      key: `decor:${d.id}`,
      tool: { kind: 'decor', defId: d.id },
      name: d.name,
      cost: d.cost,
      frame: d.id === 'signal' ? 'structures/signal_green' : `structures/${d.id}`,
      desc: d.flavor,
      tier: 0,
      place: d.power
        ? STR.toolbar.place.powerLine
        : d.onTrack
          ? STR.toolbar.place.onTrack
          : d.radius
            ? STR.toolbar.place.service(d.radius)
            : STR.toolbar.place.building,
      reach: d.power ? 2 : d.radius,
    });
    const services = DECOR_DEFS.filter((d) => !d.onTrack && !d.residents).map(decorItem);
    stations.push(...DECOR_DEFS.filter((d) => d.residents).map(decorItem));
    const utility = DECOR_DEFS.filter((d) => d.onTrack).map(decorItem);
    for (const k of SUPPLY_KINDS)
      utility.push({
        key: `supply:${k}`,
        tool: { kind: 'supply', supply: k },
        name: STR.toolbar.supply[k],
        cost: SUPPLY_DEFS[k].cost,
        frame: `structures/supply_${k}_ew`,
        desc: STR.toolbar.supplyDesc[k],
        tier: SUPPLY_DEFS[k].tier,
        place: STR.toolbar.placeSupply,
      });
    const works: ToolItem[] = BUILDING_DEFS.filter((d) => !d.bridge).map((d) => ({
      key: `building:${d.id}`,
      tool: { kind: 'building', defId: d.id },
      name: d.name,
      cost: d.cost,
      frame: `structures/${d.id}`,
      desc: d.flavor,
      tier: d.tier,
      supply: d.supply,
      place: d.power
        ? STR.toolbar.place.plant
        : d.deposit
          ? STR.toolbar.place.deposit(d.deposit)
          : STR.toolbar.place.works,
      reach: d.power ? 2 : undefined,
    }));
    track.push(
      ...BUILDING_DEFS.filter((d) => d.bridge).map((d, i) => ({
        group: 'bridges',
        slot: i,
        key: 'building:' + d.id,
        tool: { kind: 'building' as const, defId: d.id },
        name: d.name,
        cost: d.cost,
        frame: 'structures/' + d.id,
        desc: `${d.bridge!.capacity} t capacity. ${d.flavor}`,
        tier: d.tier,
        place: 'On water. Lay track on the platform after building it.',
      })),
    );
    const terrain: ToolItem[] = [
      Terrain.Grass,
      Terrain.Forest,
      Terrain.Hill,
      Terrain.Water,
      Terrain.Rock,
      Terrain.Sand,
      Terrain.Mountain,
    ].map((t) => ({
      key: `terrain:${t}`,
      tool: { kind: 'terrain', terrain: t },
      name: TERRAIN_NAMES[t],
      cost: {},
      frame:
        t === Terrain.Water ? 'terrain/water_0_f0' : `terrain/${TERRAIN_NAMES[t].toLowerCase()}_0`,
      desc: STR.editor.terrainDesc,
      tier: 0,
      place: '',
    }));
    this.categories = [
      {
        id: 'track',
        label: STR.toolbar.track,
        items: track,
        groups: TRACK_GROUPS.map((id) => ({
          id,
          label: id === 'bridges' ? STR.toolbar.bridges : STR.toolbar.trackClass[id],
        })),
      },
      { id: 'stations', label: STR.toolbar.stations, items: stations },
      { id: 'works', label: STR.toolbar.buildings, items: works },
      { id: 'decor', label: STR.toolbar.services, items: services },
      { id: 'utility', label: STR.toolbar.utility, items: utility },
      { id: 'terrain', label: STR.editor.terrain, items: terrain, editorOnly: true },
    ];
    const catRow = el('div', { class: 'tb-row tb-cats' });
    for (const c of this.categories) {
      const b = btn(c.label, () => this.toggleCategory(c.id), 'tb-cat');
      this.catButtons.set(c.id, b);
      catRow.append(b);
      if (c.editorOnly) b.style.display = 'none';
    }
    this.removeBtn = btn(STR.toolbar.remove, () => this.select({ kind: 'remove' }), 'tb-cat');
    this.removeBtn.title = STR.toolbar.removeHint;
    const reclass = (target: WideClass, label: string, hint: string) => {
      const b = btn(label, () => this.toggleReclass(target), 'tb-cat');
      b.title = hint;
      return b;
    };
    this.reclassBtns = {
      high_speed: reclass('high_speed', STR.toolbar.upgrade, STR.toolbar.upgradeHint),
      regular: reclass('regular', STR.toolbar.downgrade, STR.toolbar.downgradeHint),
    };
    catRow.append(
      this.removeBtn,
      this.reclassBtns.high_speed,
      this.reclassBtns.regular,
      this.extra,
    );
    this.itemRow.style.display = 'none';
    this.groupRow.style.display = 'none';
    this.root = el(
      'div',
      { id: 'toolbar', class: 'panel' },
      catRow,
      this.groupRow,
      this.itemRow,
      el('div', { class: 'tb-row tb-statusrow' }, this.status, this.hint),
    );
  }

  category(id: CategoryId) {
    return this.categories.find((c) => c.id === id)!;
  }
  private toggleCategory(id: CategoryId) {
    if (this.open === id) this.closeCategory();
    else this.openCategory(id);
  }
  openCategory(id: CategoryId, selectFirst = true) {
    this.open = id;
    for (const [k, b] of this.catButtons) b.classList.toggle('active', k === id);
    this.removeBtn.classList.remove('active');
    this.renderItems();
    const items = this.openItems();
    if (selectFirst && items.length) this.select(slotMate(items, 0)!.tool);
  }
  closeCategory() {
    this.open = null;
    for (const b of this.catButtons.values()) b.classList.remove('active');
    this.itemRow.style.display = 'none';
    this.itemRow.innerHTML = '';
    this.groupRow.style.display = 'none';
    this.groupRow.innerHTML = '';
    this.itemButtons.clear();
    this.hint.textContent = '';
    this.onHover?.(null);
    const keeps = this.active.kind === 'remove' || this.active.kind === 'reclass';
    if (this.active.kind !== 'none' && !keeps) this.select({ kind: 'none' });
  }
  private enabledItems() {
    if (!this.open) return [];
    const tier = this.tierProvider();
    return this.modeItems().filter((i) => i.tier <= tier && !i.hidden?.());
  }
  /** The open category's types, when it has any. */
  private groupsOfOpen() {
    return this.open ? (this.category(this.open).groups ?? null) : null;
  }
  /** The type shown in the open category: the one used last, if it still has something to offer. */
  private openGroup(): string | null {
    const groups = this.groupsOfOpen();
    if (!groups) return null;
    const enabled = this.enabledItems();
    const offers = (g: string) => enabled.some((i) => i.group === g);
    const last = this.groupOf.get(this.open!);
    if (last !== undefined && groups.some((g) => g.id === last) && offers(last)) return last;
    return groups.find((g) => offers(g.id))?.id ?? groups[0].id;
  }
  /** Enabled items of the open type (of the whole category when it has no types). */
  private openItems() {
    const g = this.openGroup();
    return this.enabledItems().filter((i) => g === null || i.group === g);
  }
  /** Open a type, holding the piece in the slot of the one held before. */
  private setGroup(id: string) {
    if (!this.open) return;
    const slot = this.item(this.active)?.slot ?? 0;
    this.groupOf.set(this.open, id);
    const pick = slotMate(this.openItems(), slot);
    if (pick) this.select(pick.tool);
    this.renderItems();
  }
  /** Q / E: step to the previous or next type. Returns false when the open category has none. */
  cycleGroup(dir: 1 | -1) {
    const groups = this.groupsOfOpen();
    if (!groups) return false;
    const enabled = this.enabledItems();
    const current = this.openGroup()!;
    const next = stepGroup(
      groups.map((g) => g.id),
      current,
      dir,
      (g) => enabled.some((i) => i.group === g),
    );
    if (next !== current) this.setGroup(next);
    return true;
  }
  /** Step through the open category (Tab). */
  cycle(dir: number) {
    const items = this.enabledItems();
    if (!items.length) return;
    const key = toolKey(this.active);
    const cur = items.findIndex((i) => i.key === key);
    const next = cur < 0 ? 0 : (cur + (dir > 0 ? 1 : items.length - 1)) % items.length;
    this.select(items[next].tool);
  }
  /** Number key: pick the n-th item of the open type or category. Returns false when none is open. */
  selectIndex(n: number) {
    if (!this.open) return false;
    const items = this.openItems();
    if (n < items.length) this.select(items[n].tool);
    return true;
  }
  item(t: Tool): ToolItem | null {
    const key = toolKey(t);
    for (const c of this.categories) for (const i of c.items) if (i.key === key) return i;
    return null;
  }

  private renderItems() {
    const row = this.itemRow;
    row.innerHTML = '';
    this.itemButtons.clear();
    if (!this.open) return;
    row.style.display = '';
    const tier = this.tierProvider();
    const items = this.modeItems();
    const groups = this.groupsOfOpen();
    const shown = this.openGroup();
    this.groupRow.innerHTML = '';
    this.groupRow.style.display = groups ? '' : 'none';
    if (groups) {
      const enabledItems = this.enabledItems();
      this.groupRow.append(el('span', { class: 'tb-key', text: 'Q' }));
      for (const g of groups) {
        const b = btn(g.label, () => this.setGroup(g.id), 'tb-type');
        b.disabled = !enabledItems.some((i) => i.group === g.id);
        b.classList.toggle('active', g.id === shown);
        this.groupRow.append(b);
      }
      this.groupRow.append(el('span', { class: 'tb-key', text: 'E' }));
    }
    let n = 0;
    for (const it of items) {
      if (shown !== null && it.group !== shown) continue;
      const enabled = it.tier <= tier && !it.hidden?.();
      if (enabled) n++;
      const b = el(
        'button',
        { class: 'btn tb-item' },
        el('span', { class: 'tb-key', text: enabled && n <= 9 ? String(n) : '' }),
        spriteImg(this.atlas, it.frame, 1, 'sprite-preview tb-icon'),
        el(
          'span',
          { class: 'tb-text' },
          el('span', { class: 'tb-name', text: shown !== null ? (it.label ?? it.name) : it.name }),
          el('span', { class: 'tb-cost', text: fmtCost(it.cost) }),
        ),
      ) as HTMLButtonElement;
      b.disabled = !enabled;
      if (!enabled) b.title = STR.build.tierLocked(it.tier);
      b.addEventListener('click', () => this.select(it.tool));
      b.addEventListener('mouseenter', () => this.onHover?.(it));
      b.addEventListener('mouseleave', () => this.onHover?.(null));
      this.itemButtons.set(it.key, b);
      row.append(b);
    }
    this.hint.textContent = groups ? STR.toolbar.typeHint : STR.toolbar.cycleHint;
    const key = toolKey(this.active);
    for (const [k, b] of this.itemButtons) b.classList.toggle('active', k === key);
  }

  select(t: Tool) {
    this.onSelect(t);
    this.setActive(t);
  }
  /** The Upgrade or Downgrade tool: chosen, or put down again when it is the one in hand. */
  toggleReclass(target: WideClass) {
    const held = this.active.kind === 'reclass' && this.active.target === target;
    this.select(held ? { kind: 'none' } : { kind: 'reclass', target });
  }

  /** Reflect the controller's tool: opens the matching category, closes on none. */
  setActive(t: Tool) {
    this.active = t;
    const key = toolKey(t);
    for (const [target, b] of Object.entries(this.reclassBtns))
      b.classList.toggle('active', t.kind === 'reclass' && t.target === target);
    if (t.kind === 'none') {
      if (this.open) this.closeCategory();
      this.removeBtn.classList.remove('active');
      return;
    }
    const cat =
      t.kind === 'track'
        ? 'track'
        : t.kind === 'station'
          ? 'stations'
          : t.kind === 'decor'
            ? decorDef(t.defId).onTrack
              ? 'utility'
              : 'decor'
            : t.kind === 'building'
              ? BUILDING_DEFS.find((d) => d.id === t.defId)?.bridge
                ? 'track'
                : 'works'
              : t.kind === 'terrain'
                ? 'terrain'
                : null;
    if (cat && this.open !== cat) this.openCategory(cat, false);
    // a piece picked some other way (Tab, a click on the map) brings its type with it
    const group = this.item(t)?.group;
    if (group && this.open && group !== this.openGroup()) {
      this.groupOf.set(this.open, group);
      this.renderItems();
    }
    this.removeBtn.classList.toggle('active', t.kind === 'remove');
    for (const [k, b] of this.itemButtons) b.classList.toggle('active', k === key);
  }

  refresh() {
    if (this.open) this.renderItems();
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }
}
