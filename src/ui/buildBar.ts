/**
 * The build bar's logic: which category and type each def is listed under, what is shown and locked,
 * the number keys, the stepping, and what the tooltips say. `BuildBar` holds the state; toolbar.ts
 * draws it. DOM-free, so Node tests read every rule.
 */
import type { BuildingDef, Cost, DecorDef, StationDef, SupplyMode } from '../data/content';
import { content } from '../data/content';
import type { AgeStatus } from '../sim/ages';
import { DECOR_DEFS } from '../sim/build';
import { BUILDING_DEFS } from '../sim/buildings';
import { SUPPLY_DEFS, SUPPLY_KINDS, type SupplyKind } from '../sim/catenary';
import { roadCost } from '../sim/roads';
import { rules } from '../sim/rules';
import { STATION_DEFS } from '../sim/stations';
import { inSupplyMode } from '../sim/supply';
import { LANGUAGE, STR } from '../strings';
import { nextLine, type ReclassDir } from '../world/reclass';
import { Terrain, TERRAIN_NAMES } from '../world/tiles';
import {
  BUILDABLE_CLASSES,
  TRACK_ITEMS,
  itemAge,
  itemKey,
  pieceCost,
  type TrackItem,
} from '../world/track';
import { lockTip } from './ageTooltip';
import type { BuildIcon } from './buildIcons';
import { toolRotations } from './toolRotation';
import {
  dim,
  hint,
  icon,
  num,
  row,
  title,
  type Block,
  type Inline,
  type TipDoc,
} from './tooltipDoc';
import {
  TRACK_GROUPS,
  shortName,
  slotMate,
  stepGroup,
  trackGroupOf,
  trackSlot,
} from './trackGroups';

export type Tool =
  | { kind: 'none' }
  | { kind: 'track'; item: TrackItem }
  | { kind: 'supply'; supply: SupplyKind }
  | { kind: 'station'; defId: string }
  | { kind: 'decor'; defId: string }
  | { kind: 'terrain'; terrain: number }
  | { kind: 'building'; defId: string }
  /** move track under the cursor one standard line up or down */
  | { kind: 'reclass'; dir: ReclassDir }
  /** lay roads by dragging (#328) */
  | { kind: 'road' }
  | { kind: 'remove' };

/** One placeable thing: what the bar shows and what the info panel describes. */
export interface ToolItem {
  key: string;
  tool: Tool;
  name: string;
  cost: Cost;
  /** atlas frame for the preview */
  frame: string;
  /** an inline icon in place of the frame (the Upgrade and Downgrade arrows) */
  icon?: BuildIcon;
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
  /** the words in place of a cost, for a price no table gives */
  costText?: string;
  /** what a works makes; none for a building with no output */
  recipe?: { in: Cost; out: Cost; altIn?: Cost; perWeek: number };
  /** not offered at all right now */
  hidden?: () => boolean;
  /** the type it is listed under, in a category that has types */
  group?: string;
  /** the label of that type */
  typeLabel?: string;
  /** its place in the type, kept when the type changes (`slotMate`) */
  slot?: number;
  /** the name on its tile when the type is shown above it */
  label?: string;
  /** a key of its own, beside its number */
  hot?: string;
}

export type CategoryId = 'track' | 'buildings' | 'tools' | 'works' | 'roads' | 'terrain';

export interface Category {
  id: CategoryId;
  label: string;
  icon: BuildIcon;
  items: ToolItem[];
  editorOnly?: boolean;
  /** not offered in the level editor: a level keeps none of what it lays (roads) */
  playOnly?: boolean;
  /** types the items are listed by; one is open at a time */
  groups?: { id: string; label: string }[];
}

/** Where a def is listed. */
export interface Place {
  category: CategoryId;
  group: string;
}

/** Are there two buildable standard lines for Upgrade and Downgrade to move between? */
export function reclassable() {
  return BUILDABLE_CLASSES.some((c) => nextLine(c, 'up'));
}

export function toolKey(t: Tool): string {
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
      return `reclass:${t.dir}`;
    case 'road':
      return 'road';
    case 'remove':
      return 'remove';
    default:
      return '';
  }
}

// ---------------------------------------------------------------- where a def is listed

/**
 * A station with a `terrain` harvests it: a raw material. `produces` does not say so, as the
 * passenger Station produces passengers. No field marks the town, which the game knows by its id.
 */
export function stationPlace(d: StationDef): Place {
  if (d.terrain) return { category: 'works', group: 'raw' };
  return { category: 'buildings', group: d.id === 'town' ? 'town' : 'stations' };
}

export function decorPlace(d: DecorDef): Place {
  if (d.onTrack) return { category: 'tools', group: d.power ? 'electrification' : 'track' };
  return { category: 'buildings', group: d.residents ? 'town' : 'services' };
}

/**
 * A works tied to what lies in the ground digs it out: a raw material. `deposit` says so of the Oil
 * Derrick, `terrain` of the Colliery, which stands on hills and has no deposit of its own.
 */
export function workPlace(d: BuildingDef): Place {
  if (d.bridge) return { category: 'track', group: 'bridges' };
  if (d.power || d.substation) return { category: 'works', group: 'power' };
  return { category: 'works', group: d.deposit || d.terrain ? 'raw' : 'processing' };
}

/** `defs` in the order of `rank`, equal ranks in data order. */
function ranked<T>(defs: T[], rank: (d: T) => number): T[] {
  return [...defs].sort((a, b) => rank(a) - rank(b));
}

/** Every item the bar can offer, by category. `hasFrame` asks the atlas for a station's sprite. */
export function buildCatalog(hasFrame: (frame: string) => boolean): Category[] {
  const trackItem = (it: TrackItem): ToolItem => {
    const k = itemKey(it);
    const base = content.track.pieces[it.kind]?.name ?? it.kind;
    const clsName =
      it.kind === 'crossing'
        ? `${STR.toolbar.trackClass[it.cls]} × ${STR.toolbar.trackClass[it.cls2 ?? it.cls]}`
        : STR.toolbar.trackClass[it.cls];
    return {
      key: `track:${k}`,
      tool: { kind: 'track', item: it },
      name: clsName ? `${base} (${clsName})` : base,
      cost: pieceCost(it.kind, it.cls, it.cls2),
      costNow: () => pieceCost(it.kind, it.cls, it.cls2),
      frame: `track/${k}_0`,
      desc: STR.toolbar.trackDesc[k] ?? '',
      // a line opens in its age (`rules.lineAgeLocks`)
      get tier() {
        return rules.lineAgeLocks ? itemAge(it) : 0;
      },
      place: it.kind === 'bridge' ? STR.toolbar.place.bridge : STR.toolbar.place.track,
      group: trackGroupOf(it),
      slot: trackSlot(it),
      label: shortName(it, base),
    };
  };
  // listed type by type, each in the order of its slots
  const typeAt = (i: ToolItem) => TRACK_GROUPS.indexOf(i.group as (typeof TRACK_GROUPS)[number]);
  const track = TRACK_ITEMS.map(trackItem).sort(
    (a, b) => typeAt(a) - typeAt(b) || a.slot! - b.slot!,
  );
  const stationItem = (d: StationDef): ToolItem => ({
    key: `station:${d.id}`,
    tool: { kind: 'station', defId: d.id },
    name: d.name,
    cost: d.cost,
    frame: hasFrame(`structures/${d.art}_1`) ? `structures/${d.art}_1` : 'structures/station_1',
    desc: d.flavor,
    tier: d.tier,
    supply: d.supply,
    place: d.depot
      ? STR.toolbar.place.depot
      : d.id === 'town'
        ? STR.toolbar.place.town
        : (STR.toolbar.place.stationOn[d.id] ?? STR.toolbar.place.station),
    group: stationPlace(d).group,
  });
  const decorItem = (d: DecorDef): ToolItem => ({
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
    group: decorPlace(d).group,
  });
  const workItem = (d: BuildingDef): ToolItem => ({
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
    group: workPlace(d).group,
    recipe: Object.keys(d.recipe.out).length
      ? {
          in: d.recipe.in,
          out: d.recipe.out,
          perWeek: d.perWeek,
          ...(d.altIn ? { altIn: d.altIn } : {}),
        }
      : undefined,
  });
  const bridgeItem = (d: BuildingDef, i: number): ToolItem => ({
    group: 'bridges',
    slot: i,
    key: `building:${d.id}`,
    tool: { kind: 'building', defId: d.id },
    name: d.name,
    cost: d.cost,
    frame: `structures/${d.id}`,
    desc: STR.toolbar.bridgeDesc(d.bridge!.capacity, d.flavor),
    tier: d.tier,
    place: STR.toolbar.place.bridgePlatform,
  });
  const reclassItem = (dir: ReclassDir): ToolItem => ({
    key: `reclass:${dir}`,
    tool: { kind: 'reclass', dir },
    name: dir === 'up' ? STR.toolbar.upgrade : STR.toolbar.downgrade,
    cost: {},
    // an upgrade pays the difference between two lines, which depends on the piece
    costText: dir === 'up' ? STR.toolbar.upgradeCost : STR.build.free,
    frame: '',
    icon: dir,
    desc: dir === 'up' ? STR.toolbar.upgradeHint : STR.toolbar.downgradeHint,
    tier: 0,
    place: STR.toolbar.place.reclass,
    hidden: () => !reclassable(),
    group: 'track',
    hot: dir === 'up' ? 'U' : 'Shift+U',
  });
  const supplyItem = (k: SupplyKind): ToolItem => ({
    key: `supply:${k}`,
    tool: { kind: 'supply', supply: k },
    name: STR.toolbar.supply[k],
    cost: SUPPLY_DEFS[k].cost,
    frame: `structures/supply_${k}_ew`,
    desc: STR.toolbar.supplyDesc[k],
    tier: SUPPLY_DEFS[k].tier,
    place: STR.toolbar.placeSupply,
    group: 'electrification',
  });
  const stations = (group: string) => STATION_DEFS.filter((d) => stationPlace(d).group === group);
  const decor = (group: string) => DECOR_DEFS.filter((d) => decorPlace(d).group === group);
  const works = (group: string) => BUILDING_DEFS.filter((d) => workPlace(d).group === group);
  // what carries passengers, then the engine sheds, then the rest
  const stationRank = (d: StationDef) => (d.produces.length ? 0 : d.depot ? 1 : 2);
  // what makes power before what stores it
  const powerRank = (d: BuildingDef) => (d.power ? 0 : 1);
  // roads have no picture of their own yet (#329): the icon is the cobbled road tile
  const road: ToolItem = {
    key: 'road',
    tool: { kind: 'road' },
    name: STR.toolbar.road,
    cost: roadCost(),
    frame: 'people/road_stone_0',
    desc: STR.toolbar.roadDesc,
    tier: 0,
    place: STR.toolbar.place.road,
  };
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
    name: LANGUAGE === 'en' ? TERRAIN_NAMES[t] : STR.tile.terrain[TERRAIN_NAMES[t]],
    cost: {},
    frame:
      t === Terrain.Water ? 'terrain/water_0_f0' : `terrain/${TERRAIN_NAMES[t].toLowerCase()}_0`,
    desc: STR.editor.terrainDesc,
    tier: 0,
    place: '',
  }));
  const categories: Category[] = [
    {
      id: 'track',
      label: STR.toolbar.track,
      icon: 'rail',
      items: [...track, ...works('bridges').map(bridgeItem)],
      groups: TRACK_GROUPS.map((id) => ({
        id,
        label: id === 'bridges' ? STR.toolbar.bridges : STR.toolbar.trackClass[id],
      })),
    },
    {
      id: 'buildings',
      label: STR.toolbar.buildings,
      icon: 'station',
      items: [
        ...ranked(stations('stations'), stationRank).map(stationItem),
        ...stations('town').map(stationItem),
        ...decor('town').map(decorItem),
        ...decor('services').map(decorItem),
      ],
      groups: [
        { id: 'stations', label: STR.toolbar.stations },
        { id: 'town', label: STR.toolbar.town },
        { id: 'services', label: STR.toolbar.services },
      ],
    },
    {
      id: 'tools',
      label: STR.toolbar.tools,
      icon: 'gear',
      items: [
        ...decor('track').map(decorItem),
        reclassItem('up'),
        reclassItem('down'),
        ...decor('electrification').map(decorItem),
        ...SUPPLY_KINDS.map(supplyItem),
      ],
      groups: [
        { id: 'track', label: STR.toolbar.trackTools },
        { id: 'electrification', label: STR.toolbar.electrification },
      ],
    },
    {
      id: 'works',
      label: STR.toolbar.works,
      icon: 'factory',
      items: [
        // by age, stations first in each: what is open stands before what is locked
        ...ranked(
          [...stations('raw').map(stationItem), ...works('raw').map(workItem)],
          (i) => i.tier,
        ),
        ...works('processing').map(workItem),
        ...ranked(works('power'), powerRank).map(workItem),
      ],
      groups: [
        { id: 'raw', label: STR.toolbar.rawMaterials },
        { id: 'processing', label: STR.toolbar.processing },
        { id: 'power', label: STR.toolbar.power },
      ],
    },
    { id: 'roads', label: STR.toolbar.roads, icon: 'road', items: [road], playOnly: true },
    {
      id: 'terrain',
      label: STR.editor.terrain,
      icon: 'mountain',
      items: terrain,
      editorOnly: true,
    },
  ];
  for (const c of categories)
    for (const it of c.items) it.typeLabel = c.groups?.find((g) => g.id === it.group)?.label;
  return categories;
}

// ---------------------------------------------------------------- what is shown

/** What a category offers in the running game: its chain's items, none of them hidden. */
export function modeItems(c: Category): ToolItem[] {
  return c.items.filter((i) => inSupplyMode(i) && !i.hidden?.());
}

export function isLocked(item: ToolItem, tier: number) {
  return item.tier > tier;
}

/** What can be taken up in a category now. */
export function enabledItems(c: Category, tier: number): ToolItem[] {
  return modeItems(c).filter((i) => !isLocked(i, tier));
}

/** The tiles of a type (of the whole category when it has none), a locked one among them. */
export function shownItems(c: Category, group: string | null): ToolItem[] {
  return modeItems(c).filter((i) => group === null || i.group === group);
}

/** The type open in a category: the one used last, if it still offers something, else the first. */
export function currentGroup(c: Category, tier: number, last: string | undefined): string | null {
  if (!c.groups) return null;
  const enabled = enabledItems(c, tier);
  const offers = (g: string) => enabled.some((i) => i.group === g);
  if (last !== undefined && c.groups.some((g) => g.id === last) && offers(last)) return last;
  return c.groups.find((g) => offers(g.id))?.id ?? c.groups[0].id;
}

/** The age a locked type waits for, the first to open one of its items; null when it is open. */
export function typeLockAge(c: Category, group: string, tier: number): number | null {
  const items = shownItems(c, group);
  if (!items.length || items.some((i) => !isLocked(i, tier))) return null;
  return Math.min(...items.map((i) => i.tier));
}

/** The label of a number key by place in the shown list; a place past the ninth has no key. */
export function keyLabel(place: number): string {
  return place < 9 ? String(place + 1) : '';
}

/** The item a number key takes up: none past the list, none when it is locked. */
export function pickAt(shown: ToolItem[], place: number, tier: number): ToolItem | null {
  const it = shown[place];
  return it && !isLocked(it, tier) ? it : null;
}

/** The categories on the row: the editor has Terrain in the place of Roads. */
export function visibleCategories(categories: Category[], editor: boolean): Category[] {
  return categories.filter((c) => (editor ? !c.playOnly : !c.editorOnly));
}

export function stepCategory(ids: CategoryId[], current: CategoryId, dir: 1 | -1): CategoryId {
  return stepGroup(ids, current, dir, () => true) as CategoryId;
}

/** The category and the item a tool belongs to; null for one on no list (Demolish, none). */
export function locate(
  categories: Category[],
  tool: Tool,
): { category: Category; item: ToolItem } | null {
  const key = toolKey(tool);
  for (const category of categories)
    for (const item of category.items) if (item.key === key) return { category, item };
  return null;
}

// ---------------------------------------------------------------- the line over the bar

/**
 * The share Demolish gives back, a whole percent (`Builder.refund`): `rules.refundRate` of the listed
 * cost, as tuned. Null in the level editor, where building is free and nothing comes back.
 */
export function refundPercent(editor: boolean): number | null {
  return editor ? null : Math.round(rules.refundRate * 100);
}

/** What the line at the top of the bar says, `warn` for the demolish hint; '' hides it. */
export function statusLine(
  status: string,
  s: { demolishing: boolean; categoryOpen: boolean; refund: number | null },
): { text: string; warn: boolean } {
  if (status) return { text: status, warn: false };
  if (s.demolishing && !s.categoryOpen)
    return { text: STR.toolbar.demolishOn(s.refund), warn: true };
  return { text: '', warn: false };
}

// ---------------------------------------------------------------- the toasts

/** How far the dock stands off the bottom of the window (`#build-dock` in style.css). */
export const DOCK_BOTTOM = 8;
/** The least the toasts stand off it, where the player's layout has them (`#toasts`). */
export const TOAST_FLOOR = 80;
const TOAST_GAP = 6;

/**
 * How far off the bottom of the window the toasts stand: over the bar at the height it has now,
 * status line and tiles included, as no fixed height holds for every bar. The card stands left of
 * them. `barHeight` is 0 with the dock hidden.
 */
export function toastBottom(barHeight: number): number {
  return Math.max(TOAST_FLOOR, DOCK_BOTTOM + barHeight + TOAST_GAP);
}

// ---------------------------------------------------------------- tooltips

const keyLine = (key: string) => hint(STR.toolbar.keyHint(key));

/** Each resource of a cost by its icon and amount, as the bar and the card draw it. */
function costParts(cost: Cost): Inline[] {
  const out: Inline[] = [];
  for (const [k, v] of Object.entries(cost)) {
    if (v <= 0) continue;
    if (out.length) out.push(' ');
    out.push(icon(k), num(v));
  }
  return out;
}

function costRow(item: ToolItem): Block {
  const parts = costParts(item.costNow?.() ?? item.cost);
  return row(STR.toolbar.secCost, item.costText ?? (parts.length ? parts : STR.build.free));
}

/** A category: its name, what it lists and its key. */
export function categoryTip(c: Category, key: string): TipDoc {
  const list = c.groups?.map((g) => g.label) ?? c.items.map((i) => i.name);
  return [title(c.label), dim(list.join(', ')), keyLine(key)];
}

/** A type: its name and keys and, while it is locked, what unlocks it. */
export function typeTip(label: string, lockAge: number | null, ages: AgeStatus[]): TipDoc {
  return [
    title(label),
    ...(lockAge === null ? [] : lockTip(ages, lockAge)),
    keyLine(STR.toolbar.typeKeys),
  ];
}

/** A Q or E arrow. */
export function arrowTip(dir: 1 | -1): TipDoc {
  return [
    title(dir < 0 ? STR.toolbar.prevType : STR.toolbar.nextType),
    dim(STR.toolbar.typeStep),
    keyLine(dir < 0 ? 'Q' : 'E'),
  ];
}

/** An item: its name, description, cost and key; while it is locked, what unlocks it. */
export function itemTip(item: ToolItem, key: string, tier: number, ages: AgeStatus[]): TipDoc {
  const keys = [key, item.hot].filter(Boolean).join(' · ');
  return [
    title(item.name),
    ...(item.desc ? [dim(item.desc)] : []),
    costRow(item),
    ...(isLocked(item, tier) ? lockTip(ages, item.tier) : []),
    ...(keys ? [keyLine(keys)] : []),
  ];
}

/** The Demolish button. */
export function demolishTip(refund: number | null): TipDoc {
  return [
    title(STR.toolbar.demolish),
    dim(STR.toolbar.demolishTip(refund)),
    hint(STR.toolbar.demolishKeys),
  ];
}

/** The build card's foot: how this tool is used, in words that hold in the game. */
export function controlsHint(item: ToolItem): string {
  const t = item.tool;
  const f = STR.toolbar.foot;
  const use =
    t.kind === 'track' && t.item.kind === 'straight'
      ? f.run
      : t.kind === 'reclass'
        ? f.reclass
        : t.kind === 'supply' || t.kind === 'road'
          ? f.drag
          : t.kind === 'terrain'
            ? f.paint
            : f.click;
  return [use, ...(toolRotations(t) > 1 ? [f.turn] : []), f.cancel].join(' · ');
}

// ---------------------------------------------------------------- the state

/**
 * What the bar shows and holds. Every change of the tool reaches `onSelect`, which gives it to the
 * build controller; what the controller decides comes back through `setActive`, the one place the
 * open category follows the tool. `onChange` asks the toolbar to draw.
 */
export class BuildBar {
  /** the open category */
  open: CategoryId | null = null;
  active: Tool = { kind: 'none' };
  /** the build controller's line (`setStatus`) */
  status = '';
  editor = false;
  /** the type last open in each category that has types */
  private readonly groupOf = new Map<CategoryId, string>();

  constructor(
    readonly categories: Category[],
    private readonly tier: () => number,
    private readonly onSelect: (t: Tool) => void,
    private readonly onChange: () => void,
  ) {}

  category(id: CategoryId) {
    return this.categories.find((c) => c.id === id)!;
  }
  visible() {
    return visibleCategories(this.categories, this.editor);
  }
  /** A category's key: its place on the row, '' while it is not on it. */
  keyOf(id: CategoryId): string {
    const at = this.visible().findIndex((c) => c.id === id);
    return at < 0 ? '' : keyLabel(at);
  }
  setEditor(on: boolean) {
    this.editor = on;
    this.onChange();
  }
  item(t: Tool): ToolItem | null {
    return locate(this.categories, t)?.item ?? null;
  }
  private groupIn(c: Category) {
    return currentGroup(c, this.tier(), this.groupOf.get(c.id));
  }
  /** The type shown in the open category; null with none open or with no types. */
  openGroup(): string | null {
    return this.open ? this.groupIn(this.category(this.open)) : null;
  }
  /** The tiles of the open type, in the order of their number keys. */
  openList(): ToolItem[] {
    return this.open ? shownItems(this.category(this.open), this.openGroup()) : [];
  }
  private openEnabled(): ToolItem[] {
    return this.openList().filter((i) => !isLocked(i, this.tier()));
  }

  openCategory(id: CategoryId, selectFirst = true) {
    const c = this.category(id);
    const first = selectFirst
      ? slotMate(
          shownItems(c, this.groupIn(c)).filter((i) => !isLocked(i, this.tier())),
          0,
        )
      : undefined;
    // nothing there to take up: what is in hand, Demolish too, goes down before the category opens
    if (selectFirst && !first && this.active.kind !== 'none') this.select({ kind: 'none' });
    this.open = id;
    this.onChange();
    if (first) this.select(first.tool);
  }
  /** Close the open category and put down its tool; Demolish belongs to none and stays. */
  closeCategory() {
    this.open = null;
    this.onChange();
    if (this.active.kind !== 'none' && this.active.kind !== 'remove') this.select({ kind: 'none' });
  }
  toggleCategory(id: CategoryId) {
    if (this.open === id) this.closeCategory();
    else this.openCategory(id);
  }
  /** A digit with no category open: the category at that place on the row. */
  openAt(place: number) {
    const c = this.visible()[place];
    if (c) this.openCategory(c.id);
  }
  /** Shift+Q / E: the previous or next category on the row. */
  cycleCategory(dir: 1 | -1) {
    if (!this.open) return;
    const ids = this.visible().map((c) => c.id);
    this.openCategory(stepCategory(ids, this.open, dir));
  }
  /** Open a type, holding the piece in the slot of the one held before. */
  setGroup(id: string) {
    if (!this.open) return;
    const slot = this.item(this.active)?.slot ?? 0;
    this.groupOf.set(this.open, id);
    const pick = slotMate(this.openEnabled(), slot);
    if (pick) this.select(pick.tool);
    this.onChange();
  }
  /** Q / E: step to the previous or next open type. Returns false when the category has none. */
  cycleGroup(dir: 1 | -1) {
    const c = this.open ? this.category(this.open) : null;
    if (!c?.groups) return false;
    const enabled = enabledItems(c, this.tier());
    const current = this.openGroup()!;
    const next = stepGroup(
      c.groups.map((g) => g.id),
      current,
      dir,
      (g) => enabled.some((i) => i.group === g),
    );
    if (next !== current) this.setGroup(next);
    return true;
  }
  /** Tab: step through everything the open category offers, its types too. */
  cycle(dir: number) {
    if (!this.open) return;
    const items = enabledItems(this.category(this.open), this.tier());
    if (!items.length) return;
    const key = toolKey(this.active);
    const cur = items.findIndex((i) => i.key === key);
    const next = cur < 0 ? 0 : (cur + (dir > 0 ? 1 : items.length - 1)) % items.length;
    this.select(items[next].tool);
  }
  /** Number key: the item at that place of the open list. Returns false when none is open. */
  selectIndex(place: number) {
    if (!this.open) return false;
    const pick = pickAt(this.openList(), place, this.tier());
    if (pick) this.select(pick.tool);
    return true;
  }
  select(t: Tool) {
    this.onSelect(t);
    this.setActive(t);
  }
  /** The Upgrade or Downgrade tool: chosen, or put down again when it is the one in hand. */
  toggleReclass(dir: ReclassDir) {
    if (!reclassable()) return;
    const held = this.active.kind === 'reclass' && this.active.dir === dir;
    this.select(held ? { kind: 'none' } : { kind: 'reclass', dir });
  }
  toggleDemolish() {
    this.select(this.active.kind === 'remove' ? { kind: 'none' } : { kind: 'remove' });
  }

  /** Reflect the controller's tool: it brings its category and type; none and Demolish close. */
  setActive(t: Tool) {
    if (toolKey(t) !== toolKey(this.active)) this.status = '';
    this.active = t;
    if (t.kind === 'none' || t.kind === 'remove') {
      if (this.open) this.closeCategory();
    } else {
      const at = locate(this.categories, t);
      if (at && this.open !== at.category.id) this.openCategory(at.category.id, false);
      // a piece picked some other way (Tab, a click on the map) brings its type with it
      if (at?.item.group && this.open) this.groupOf.set(this.open, at.item.group);
    }
    this.onChange();
  }
}
