/**
 * Content store. Every data table ships as JSON in this folder; the in-client content editor can
 * replace any table with an edited copy stored in localStorage. Each stored table carries a stamp
 * of the shipped table it was made from and applies only while that table is unchanged, so an
 * override never masks a later shipped change. A stale or malformed table is set aside with a
 * console warning and the shipped one loads in its place. Overrides are applied once, here, at
 * module load so every consumer sees one consistent bundle for the session. Editing content
 * therefore takes effect on the next page load (the editor reloads for you).
 */
import locoJson from './locomotives.json';
import wagonJson from './wagons.json';
import cargoJson from './cargo.json';
import stationJson from './stations.json';
import contractJson from './contracts.json';
import decorJson from './decor.json';
import gachaJson from './gacha.json';
import trackJson from './track.json';
import buildingJson from './buildings.json';
import craftingJson from './crafting.json';
import houseJson from './houses.json';
import cargoFullJson from './cargo_full.json';
import stationFullJson from './stations_full.json';
import buildingFullJson from './buildings_full.json';
import type { SupplyMode } from '../sim/supply';
import type { PartKind } from '../sim/body';
import { MAX_LEVEL } from '../sim/levels';
export type { SupplyMode };

export type Rarity = 'N' | 'R' | 'SR' | 'SSR';
/** Resource amounts, e.g. { wood: 30, stone: 10 }. */
export type Cost = Record<string, number>;
export type CargoClass = 'liquid' | 'mineral' | 'bulk' | 'people';
export type LocoType = 'steam' | 'diesel' | 'electric';
export type VehicleSize = 'tiny' | 'small' | 'medium' | 'large';
/** Track gauge: narrow stock runs on narrow track only, regular stock never does. */
export type Gauge = 'regular' | 'narrow';
export type BodyPlan = 'rigid' | 'tender' | 'garratt' | 'meyer';
/**
 * Bogie sprites under a vehicle: one style for every bogie, or one per body part. A list goes over
 * that part's bogies from its own front (a steam engine's leading truck, then its drivers); "none"
 * draws no bogie there (a Garratt's cradle hangs between its engine units). A style names the
 * sprite rolling/bogie_<style>_f<n>; without it the generic truck of the bogie's kind draws.
 */
export type BogieStyle = string | Partial<Record<PartKind, string | string[]>>;
export type Collector = 'shoe' | 'pantograph' | 'hv' | 'multi';

export interface LocoDef {
  id: string;
  name: string;
  rarity: Rarity;
  type: LocoType;
  era: string;
  body: string;
  paint: string;
  /** tiles per second */
  speed: number;
  /** tonnes the engine can haul (wagons plus payload) */
  power: number;
  /** tonnes */
  weight: number;
  crew: number;
  /** steam and diesel: fuel tank in units of coal / oil; wood burns at half value */
  fuelCap?: number;
  fuelPerTile?: number;
  /** steam only */
  waterCap?: number;
  waterPerTile?: number;
  /** electric only: power units per tile */
  powerPerTile?: number;
  starter?: boolean;
  /**
   * Withdrawn from the game: no banner, starter kit or workshop hands out a new one. The entry
   * stays in the table so copies a player already owns keep loading and running.
   */
  retired?: boolean;
  /** body length class: 1, 2 or 3 tiles (default small) */
  size?: VehicleSize;
  /** rigid body, engine + tender, Garratt (engine, cradle, engine) or Meyer (frame on two engine units) */
  plan?: BodyPlan;
  /** pivot spacing as a fraction of body length (default 0.7) */
  pivotRatio?: number;
  bogieStyle?: BogieStyle;
  /** bogies under a rigid body (3 for the Bo-Bo-Bo large body) */
  bogies?: number;
  /** axles per bogie: 2 (default) or 3 (Co-Co and the like) */
  bogieAxles?: number;
  /** how far the centre bogie may sit off its socket before the model fails a curve */
  maxLateralPlay?: number;
  /** diesel and electric: units of the same control class work in multiple */
  controlClass?: string;
  /** a high-speed type: needs HV catenary for its top speed */
  highSpeed?: boolean;
  /** electric: which supply it can draw from */
  collector?: Collector;
  /** fitted with in-cab signalling equipment (required on high-speed track) */
  inCab?: boolean;
  /** track gauge (default regular) */
  gauge?: Gauge;
}
export interface WagonDef {
  id: string;
  name: string;
  rarity: Rarity;
  era: string;
  body: 'box' | 'hopper' | 'flat' | 'tank' | 'coach' | 'van' | 'cart';
  paint: string;
  /** which cargo class the wagon carries; `accepts` is derived from it at load */
  carries: CargoClass;
  accepts?: string[];
  capacity: number;
  weight: number;
  starter?: boolean;
  /** withdrawn from the game: owned copies keep working, nothing hands out a new one */
  retired?: boolean;
  size?: VehicleSize;
  /** axles per bogie: 2 (default), 3 or 4 */
  bogieAxles?: number;
  bogieStyle?: BogieStyle;
  /** age the wagon belongs to: 0 steam, 1 diesel, 2 electric */
  tier?: number;
  /** speed ceiling, tiles per second (default above every locomotive) */
  vmax?: number;
  /** refuelling wagons: what they carry for the locomotive */
  service?: 'coal' | 'fuel' | 'battery';
  /** refuelling wagons: units of that fuel (or power) the cart adds to the consist's tanks */
  serviceCap?: number;
  /** track gauge (default regular) */
  gauge?: Gauge;
}
export interface CargoDef {
  id: string;
  name: string;
  class: CargoClass;
  basic: boolean;
  /** age the cargo belongs to (display only) */
  tier: number;
  price: number;
  color: string;
  weight: number;
  /** only exists in this production-chain mode (missing: both) */
  supply?: SupplyMode;
}
export interface StationDef {
  id: string;
  name: string;
  flavor: string;
  cost: Cost;
  /** age required to build it (0 steam, 1 diesel, 2 electric) */
  tier: number;
  /** the last age in which it is upgraded and gets a new model (missing: every age) */
  lastTier?: number;
  /** only placeable in this production-chain mode (missing: both) */
  supply?: SupplyMode;
  produces: { cargo: string; level: number }[];
  accepts: string[];
  /** which station sprite family to draw */
  art?: string;
  /** terrain the station harvests; output scales with how much of it lies nearby */
  terrain?: 'grass' | 'forest' | 'rock' | 'water' | 'sand';
  /** local store: holds anything trains bring, per level */
  stockpile?: boolean;
  /** deliveries here enter the player's stockpile (depots) */
  pool?: boolean;
  /** engine shed: trains are built here; limited by owned chunks; two gates on two sides */
  depot?: boolean;
  /** footprint side in tiles (default 1) */
  size?: number;
  /** 1×2 footprint along its axis (rotation 0: x, rotation 1: y) */
  long?: boolean;
  /** depot of this gauge: builds and serves only trains of it (default regular) */
  gauge?: Gauge;
  /** trains refuel coal / wood / oil here */
  fuel?: boolean;
  /** trains refill water here */
  water?: boolean;
  /** false: never a contract endpoint */
  contracts?: boolean;
}
export interface BuildingDef {
  bridge?: { material: 'wood' | 'stone'; capacity: number };
  id: string;
  name: string;
  flavor: string;
  cost: Cost;
  crew: number;
  /** age required to build it (0 steam, 1 diesel, 2 electric) */
  tier: number;
  /** the last age in which it is upgraded and gets a new model (missing: every age) */
  lastTier?: number;
  /** only placeable in this production-chain mode (missing: both) */
  supply?: SupplyMode;
  /** needs a deposit of this kind (a map prop, e.g. `coal` or `oil`) on the tile */
  deposit?: string;
  recipe: { in: Cost; out: Cost };
  /** alternative inputs used when the primary ones run short */
  altIn?: Cost;
  /** recipe batches per in-game week */
  perWeek: number;
  /** feeds the power network */
  power?: boolean;
  /** must stand next to water (hydro plants) */
  needsWater?: boolean;
  /** terrain the building must stand on (collieries on hills) */
  terrain?: 'hill' | 'grass' | 'sand' | 'forest';
  /** taps the pole grid and makes electrified track within `radius` live, passing `throughput` units per second */
  substation?: { radius: number; throughput: number };
}
/**
 * Station tables with one value per level, levels 1 to `MAX_LEVEL` (src/sim/levels.ts). How
 * far a station may rise in an age is a rule, not data: one level per age from the age it appears
 * in (`levelCap`).
 */
export interface StationLevels {
  capacity: number[];
  loadRate: number[];
  platforms: number[];
  production: number[];
  /** share of the station's build cost that lifts it to this level (the first is never paid) */
  upgradeCostMul: number[];
  /** the picture each level draws: levels above today's highest picture repeat it */
  spriteByLevel: number[];
  crew: number[];
}
export interface ContractTemplate {
  id: string;
  name: string;
  minTier: number;
  weight: number;
  amount: [number, number];
  baseDays: number;
  daysPerTile: number;
  payoutMul: number;
  tickets: number;
  /** the rarity's deadline multiplier applies (rush orders get tighter with rarity) */
  rarityDeadline?: boolean;
}
/** Multiplier layer over the templates: any template can roll at any rarity. */
export interface ContractRarityDef {
  id: string;
  name: string;
  weight: number;
  /** payout multiplier */
  rewardMul: number;
  /** ticket multiplier */
  ticketMul: number;
  /** amount multiplier: higher rarities ask for more */
  amountMul: number;
  /** deadline multiplier for templates flagged `rarityDeadline` */
  deadlineMul: number;
  /** at most this many open offers of the rarity at a time */
  maxOpen?: number;
}
export interface ContractConfig {
  offerCount: number;
  offerLifetimeDays: number;
  refreshIntervalDays: number;
  templates: ContractTemplate[];
  rarities: ContractRarityDef[];
  /** fraction of the payout charged for cancelling an active contract */
  cancelFine: number;
  /** fraction of the payout charged when the deadline is missed */
  failFine: number;
}
export interface DecorDef {
  id: string;
  name: string;
  flavor: string;
  cost: Cost;
  crew: number;
  onTrack: boolean;
  /** may also stand on plain buildable tiles (power lines) */
  anyTile?: boolean;
  rotations: number;
  radius?: number;
  loadBoost?: number;
  water?: boolean;
  fuel?: boolean;
  power?: boolean;
  /**
   * Marks a townhouse: people live here and the house registry tracks how many. The number is
   * what a house from an old save starts with.
   */
  residents?: number;
}
/** Townhouse growth rules: capacity per level, how fast people arrive, when towns build more. */
export interface HouseConfig {
  /** residents a house holds at each level, from level 1 */
  capacity: number[];
  /** people who move in the day a house is finished */
  startResidents: number;
  /** in-game days from foundations to a finished house */
  constructionDays: number;
  /** Days per new resident per house while food and housing capacity are available. */
  growthDays: number;
  /** days a full house waits before it grows a storey on its own */
  autoUpgradeDays: number;
  /** what the player pays to lift a house to each level, from level 2 */
  upgradeCost: Cost[];
  /** a town builds a new house once residents reach this share of its housing */
  spawnAt: number;
  /** the spawn multiplier never exceeds this */
  spawnMulCap: number;
  /** train arrivals in the traffic window per +1 on the spawn multiplier */
  trafficPerMul: number;
  /** arrivals older than this many days no longer count as traffic */
  trafficWindowDays: number;
  /** newcomers when a producing station or works is built in the town */
  bonusIndustry: number;
  /** newcomers when the first train reaches the town */
  bonusFirstTrain: number;
}
export interface Banner {
  id: string;
  name: string;
  tier: number;
  pool: string[];
}
export interface GachaConfig {
  rates: Record<Rarity, number>;
  pity: number;
  tenPullGuarantee: string;
  pullCost: number;
  levelCap: number;
  statPerLevel: number;
  banners: Banner[];
}
export interface TrackConfig {
  pieces: Record<string, { name: string; cost: Cost; rotations: number }>;
  terrainCost: Record<string, number>;
  refund: number;
  curveSpeed: number;
  switchSpeed: number;
  bridgeSpeed: number;
  /** consist physics */
  physics: {
    /** tractive effort per tonne of haul rating (effort / mass gives tiles/s²) */
    effortPerTonne: number;
    /** acceleration ceiling, tiles/s² */
    maxAccel: number;
    /** speed ceiling of a wagon without one of its own, tiles/s */
    wagonVmax: number;
    /** share of the summed effort a double-headed consist delivers */
    doubleHeadEfficiency: number;
    /** consumption cut per matching refuelling cart, and the most the carts cut together */
    cartSaving: number;
    cartSavingCap: number;
    /** power units a battery cart takes from the stockpile per tile on live track */
    batteryChargePerTile: number;
  };
}
/** Model quality tiers the crafting tables are keyed by: the shipped rarities plus a reserved 'L'. */
export type CraftRarity = Rarity | 'L';
export type CraftKind = 'loco' | 'wagon';
/**
 * Crafting: recipes are unlocked with money (three cards per draw, keep one), instances are built
 * from stockpile resources with a rarity-dependent failure chance.
 */
export interface CraftingConfig {
  /** money per age (0 steam, 1 diesel, 2 electric), per vehicle kind */
  unlockPrice: Record<CraftKind, number[]>;
  /** cards offered per paid draw */
  cardsPerDraw: number;
  /** draw weight per rarity */
  rarityWeight: Record<CraftRarity, number>;
  /** weight multiplier for recipes the player already owns */
  ownedWeight: number;
  /** resources returned when the chosen card is a recipe already owned */
  ownedRefund: Cost;
  /** base resource cost per kind and body size */
  instanceCost: Record<CraftKind, Record<VehicleSize, Cost>>;
  /** instance cost multiplier per rarity */
  rarityCostMul: Record<CraftRarity, number>;
  /** chance a craft fails, per rarity */
  failChance: Record<CraftRarity, number>;
  /** share of the materials returned after a failed craft */
  failRefund: number;
  /** copies of each starter model a new game begins with */
  starterCopies: Record<CraftKind, number>;
}
export interface ContentBundle {
  locomotives: LocoDef[];
  wagons: WagonDef[];
  cargo: CargoDef[];
  stations: { levels: StationLevels; defs: StationDef[] };
  contracts: ContractConfig;
  decor: DecorDef[];
  buildings: BuildingDef[];
  gacha: GachaConfig;
  track: TrackConfig;
  crafting: CraftingConfig;
  houses: HouseConfig;
}
export type ContentKey = keyof ContentBundle;
export const CONTENT_KEYS: ContentKey[] = [
  'locomotives',
  'wagons',
  'cargo',
  'stations',
  'contracts',
  'decor',
  'buildings',
  'gacha',
  'track',
  'crafting',
  'houses',
];

export const CONTENT_KEY = 'terepasztal.content';
/** Shape of the stored overrides: `{ format, tables: { <key>: { stamp, data } } }`. */
const CONTENT_FORMAT = 2;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Each table as its JSON files compose it, before anything is derived from it. The full
 * production-chain mode ships as a second data set (`*_full.json`, every entry marked
 * `supply: "full"`) appended to the plain tables.
 */
const SHIPPED: Record<ContentKey, () => unknown> = {
  locomotives: () => locoJson,
  wagons: () => wagonJson,
  cargo: () => [...cargoJson, ...cargoFullJson],
  stations: () => ({
    levels: stationJson.levels,
    defs: [...stationJson.defs, ...stationFullJson],
  }),
  contracts: () => contractJson,
  decor: () => decorJson,
  buildings: () => [...buildingJson, ...buildingFullJson],
  gacha: () => gachaJson,
  track: () => trackJson,
  crafting: () => craftingJson,
  houses: () => houseJson,
};

/** Pristine copy of the shipped data; the wagon accept lists are filled in at load, below. */
export const DEFAULT_CONTENT = Object.fromEntries(
  CONTENT_KEYS.map((k) => [k, clone(SHIPPED[k]())]),
) as unknown as ContentBundle;

/** JSON with every object's keys sorted, so equal data always reads the same. */
function canonical(v: unknown): string {
  const sortKeys = (_k: string, x: unknown) => {
    if (!isObj(x)) return x;
    const keys = Object.keys(x).sort();
    return Object.fromEntries(keys.map((k) => [k, x[k]]));
  };
  return JSON.stringify(v, sortKeys) ?? 'undefined';
}

/** 32-bit FNV-1a over the string's code units, as eight hex digits. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A table without the fields `finalize` derives at load (wagon accept lists). */
function withoutDerived(key: ContentKey, data: unknown): unknown {
  if (key !== 'wagons' || !Array.isArray(data)) return data;
  return data.map((w: unknown) => {
    if (!isObj(w)) return w;
    const rest = { ...w };
    delete rest.accepts;
    return rest;
  });
}

/** Stamps of the shipped tables, taken from the JSON files themselves, never from a live bundle. */
const STAMP = Object.fromEntries(
  CONTENT_KEYS.map((k) => [k, fnv1a(canonical(SHIPPED[k]()))]),
) as Record<ContentKey, string>;
/** The shipped tables in the form edited tables are compared against. */
const SHIPPED_PLAIN = Object.fromEntries(
  CONTENT_KEYS.map((k) => [k, canonical(withoutDerived(k, SHIPPED[k]()))]),
) as Record<ContentKey, string>;

/**
 * Stamp of a shipped table: a hash of it as its JSON files compose it. An override is stored with
 * the stamp of the table it was made from and applies only while the shipped table still has it,
 * so an override never masks a later change to the shipped data.
 */
export function contentStamp(key: ContentKey): string {
  return STAMP[key];
}

function sameAsShipped(key: ContentKey, data: unknown) {
  return canonical(withoutDerived(key, data)) === SHIPPED_PLAIN[key];
}

/** The tables of `b` that differ from the shipped ones (derived fields aside). */
export function changedTables(b: ContentBundle): Partial<ContentBundle> {
  const out: Partial<Record<ContentKey, unknown>> = {};
  for (const k of CONTENT_KEYS) if (b[k] !== undefined && !sameAsShipped(k, b[k])) out[k] = b[k];
  return out as Partial<ContentBundle>;
}

/** What became of the stored overrides when the content loaded. */
export interface ContentOverrideReport {
  /** stored tables this session runs on */
  applied: ContentKey[];
  /**
   * stored tables this session ignores: `stale` when the shipped table changed since the override
   * was made (or the override predates stamps), `invalid` when it is malformed or fails validation
   */
  setAside: { key: ContentKey; reason: 'stale' | 'invalid'; problems: string[] }[];
}

function readStored(): string | null {
  try {
    return localStorage.getItem(CONTENT_KEY);
  } catch {
    return null;
  }
}
function parseStored(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const j: unknown = JSON.parse(raw);
    return isObj(j) ? j : null;
  } catch {
    return null;
  }
}

/** The tables the editor stored, applied or not (`contentOverrideReport` says which applied). */
export function readContentOverrides(): Partial<ContentBundle> | null {
  const s = parseStored(readStored());
  if (!s) return null;
  const legacy = s.format === undefined;
  const tables = legacy ? s : isObj(s.tables) ? s.tables : {};
  const out: Partial<Record<ContentKey, unknown>> = {};
  for (const k of CONTENT_KEYS) {
    const e = tables[k];
    const data = legacy ? e : isObj(e) ? e.data : undefined;
    if (data !== undefined) out[k] = data;
  }
  return Object.keys(out).length ? (out as Partial<ContentBundle>) : null;
}
/**
 * Store edited tables, each with the stamp of the shipped table it was made from. Tables equal to
 * the shipped ones are left out, and the stored set is replaced as a whole: a table not given is
 * no longer overridden. Takes effect on the next load.
 */
export function writeContentOverrides(tables: Partial<ContentBundle>) {
  const stored: Partial<Record<ContentKey, { stamp: string; data: unknown }>> = {};
  for (const k of CONTENT_KEYS) {
    const data = tables[k];
    if (data !== undefined && !sameAsShipped(k, data)) stored[k] = { stamp: STAMP[k], data };
  }
  try {
    if (Object.keys(stored).length)
      localStorage.setItem(CONTENT_KEY, JSON.stringify({ format: CONTENT_FORMAT, tables: stored }));
    else localStorage.removeItem(CONTENT_KEY);
    return true;
  } catch {
    return false;
  }
}
export function clearContentOverrides() {
  try {
    localStorage.removeItem(CONTENT_KEY);
  } catch {
    /* ignore */
  }
}

const ID = /^[a-z0-9_]+$/;
const CARGO_CLASSES: string[] = ['liquid', 'mineral', 'bulk', 'people'];
const LOCO_TYPES: string[] = ['steam', 'diesel', 'electric'];
/** station level tables with one value per level */
const PER_LEVEL = [
  'capacity',
  'loadRate',
  'platforms',
  'production',
  'upgradeCostMul',
  'spriteByLevel',
  'crew',
] as const;
const RARITY_NUMBERS = ['weight', 'rewardMul', 'ticketMul', 'amountMul', 'deadlineMul'] as const;

function isCost(c: unknown) {
  return isObj(c) && Object.values(c).every((v) => typeof v === 'number' && v >= 0);
}
/** The entries of a list table; a problem when it is not a list of objects. */
function rows<T>(v: unknown, what: string, out: string[]): T[] {
  if (!Array.isArray(v)) {
    out.push(`${what}: must be a list`);
    return [];
  }
  const ok = v.filter(isObj);
  if (ok.length < v.length) out.push(`${what}: every entry must be an object`);
  return ok as T[];
}
function checkIds(list: { id: unknown }[], what: string, out: string[]) {
  const seen = new Set<unknown>();
  for (const x of list) {
    if (typeof x.id !== 'string' || !ID.test(x.id)) out.push(`${what}: bad id "${String(x.id)}"`);
    if (seen.has(x.id)) out.push(`${what}: duplicate id "${String(x.id)}"`);
    seen.add(x.id);
  }
}
/** Ids a list table offers the tables that refer to it (none when it is malformed). */
function idSet(v: unknown) {
  const out = new Set<string>();
  if (Array.isArray(v)) for (const x of v) if (isObj(x) && typeof x.id === 'string') out.add(x.id);
  return out;
}
/** Ids of the rows a list table marks `retired` (none when it is malformed). */
function retiredIdSet(v: unknown) {
  const out = new Set<string>();
  if (Array.isArray(v))
    for (const x of v)
      if (isObj(x) && typeof x.id === 'string' && x.retired === true) out.add(x.id);
  return out;
}

interface Refs {
  cargo: Set<string>;
  locos: Set<string>;
  wagons: Set<string>;
  /** locomotives and wagons withdrawn from the game: defined, but nothing may hand one out */
  retired: Set<string>;
}
/**
 * One table's checks. They take the table as unknown data and never assume its shape. A problem
 * about a reference belongs to the table that holds it, and tables refer only to tables before
 * them in `CONTENT_KEYS`.
 */
type Check = (t: unknown, ref: Refs, out: string[]) => void;

const CHECKS: Record<ContentKey, Check> = {
  locomotives(t, _ref, out) {
    const locos = rows<LocoDef>(t, 'locomotives', out);
    checkIds(locos, 'locomotive', out);
    for (const l of locos) {
      if (!LOCO_TYPES.includes(l.type)) out.push(`locomotive ${l.id}: bad type "${l.type}"`);
      if (l.type !== 'electric' && !(l.fuelCap && l.fuelPerTile))
        out.push(`locomotive ${l.id}: needs fuelCap and fuelPerTile`);
      if (l.type === 'steam' && !(l.waterCap && l.waterPerTile))
        out.push(`locomotive ${l.id}: needs waterCap and waterPerTile`);
      if (l.type === 'electric' && !l.powerPerTile)
        out.push(`locomotive ${l.id}: needs powerPerTile`);
    }
    // a retired model is never handed out, so it cannot be the one a new game starts with
    if (!locos.some((l) => l.starter && l.retired !== true)) out.push('no starter locomotive');
  },
  wagons(t, _ref, out) {
    const wagons = rows<WagonDef>(t, 'wagons', out);
    checkIds(wagons, 'wagon', out);
    for (const w of wagons)
      if (!CARGO_CLASSES.includes(w.carries)) out.push(`wagon ${w.id}: bad class "${w.carries}"`);
    if (!wagons.some((w) => w.starter && w.retired !== true)) out.push('no starter wagon');
  },
  cargo(t, _ref, out) {
    checkIds(rows<CargoDef>(t, 'cargo', out), 'cargo', out);
  },
  stations(t, ref, out) {
    if (!isObj(t)) {
      out.push('stations: needs levels and defs');
      return;
    }
    const defs = rows<StationDef>(t.defs, 'stations', out);
    checkIds(defs, 'station', out);
    for (const s of defs) {
      if (!isCost(s.cost)) out.push(`station ${s.id}: cost must be a resource map`);
      if (!Array.isArray(s.accepts)) out.push(`station ${s.id}: accepts must be a list`);
      else
        for (const c of s.accepts)
          if (!ref.cargo.has(c)) out.push(`station ${s.id}: unknown cargo "${c}"`);
      if (!Array.isArray(s.produces)) out.push(`station ${s.id}: produces must be a list`);
      else
        for (const p of s.produces as unknown[]) {
          const c = isObj(p) ? p.cargo : undefined;
          if (typeof c !== 'string' || !ref.cargo.has(c))
            out.push(`station ${s.id}: unknown cargo "${String(c)}"`);
        }
    }
    const lv = t.levels;
    if (!isObj(lv)) {
      out.push('station levels: missing');
      return;
    }
    for (const k of PER_LEVEL) {
      const v = lv[k];
      if (
        !Array.isArray(v) ||
        v.length !== MAX_LEVEL ||
        v.some((x) => typeof x !== 'number' || !Number.isFinite(x))
      )
        out.push(`station levels: ${k} needs ${MAX_LEVEL} values`);
    }
  },
  contracts(t, _ref, out) {
    if (!isObj(t)) {
      out.push('contracts: missing configuration');
      return;
    }
    checkIds(
      rows<ContractTemplate>(t.templates, 'contract templates', out),
      'contract template',
      out,
    );
    const rarities = rows<ContractRarityDef>(t.rarities, 'contract rarities', out);
    checkIds(rarities, 'contract rarity', out);
    for (const r of rarities)
      for (const k of RARITY_NUMBERS)
        if (!(typeof r[k] === 'number' && r[k] >= 0))
          out.push(`contract rarity ${r.id}: ${k} must be >= 0`);
  },
  decor(t, _ref, out) {
    const decor = rows<DecorDef>(t, 'decor', out);
    checkIds(decor, 'decor', out);
    for (const d of decor)
      if (!isCost(d.cost)) out.push(`decor ${d.id}: cost must be a resource map`);
  },
  buildings(t, ref, out) {
    const list = rows<BuildingDef>(t, 'buildings', out);
    checkIds(list, 'building', out);
    for (const bd of list) {
      if (!Number.isFinite(bd.perWeek) || bd.perWeek < 0)
        out.push(`building ${bd.id}: perWeek must be non-negative`);
      if (!isCost(bd.cost)) out.push(`building ${bd.id}: cost must be a resource map`);
      const r: unknown = bd.recipe;
      if (!isObj(r) || !isObj(r.in) || !isObj(r.out)) {
        out.push(`building ${bd.id}: recipe needs in and out`);
        continue;
      }
      for (const k of Object.keys(r.in))
        if (!ref.cargo.has(k)) out.push(`building ${bd.id}: unknown input "${k}"`);
      for (const k of Object.keys(r.out))
        if (!ref.cargo.has(k) && k !== 'power')
          out.push(`building ${bd.id}: unknown output "${k}"`);
    }
  },
  gacha(t, ref, out) {
    if (!isObj(t)) {
      out.push('gacha: missing configuration');
      return;
    }
    for (const bn of rows<Banner>(t.banners, 'gacha banners', out)) {
      if (!Array.isArray(bn.pool) || !bn.pool.length) out.push(`banner ${bn.id}: empty pool`);
      else {
        for (const id of bn.pool)
          if (!ref.locos.has(id) && !ref.wagons.has(id))
            out.push(`banner ${bn.id}: unknown item "${id}"`);
        // a pool may still list a retired model (pulls skip it), but something must be left
        if (bn.pool.every((id) => ref.retired.has(id)))
          out.push(`banner ${bn.id}: every item in the pool is retired`);
      }
    }
    const rates = isObj(t.rates) ? Object.values(t.rates) : null;
    if (!rates || rates.some((v) => typeof v !== 'number'))
      out.push('gacha: rates must be numbers');
    else {
      const rateSum = (rates as number[]).reduce((a, v) => a + v, 0);
      if (!(Math.abs(rateSum - 1) <= 0.01))
        out.push(`gacha rates sum to ${rateSum.toFixed(2)}, expected 1`);
    }
  },
  track(t, _ref, out) {
    const pieces = isObj(t) ? t.pieces : undefined;
    if (!isObj(pieces)) {
      out.push('track: missing pieces');
      return;
    }
    for (const [k, p] of Object.entries(pieces))
      if (!isObj(p) || !isCost(p.cost)) out.push(`track ${k}: cost must be a resource map`);
    for (const k of Object.keys(trackJson.pieces))
      if (!pieces[k]) out.push(`track: missing piece "${k}"`);
  },
  crafting(t, ref, out) {
    if (!isObj(t)) {
      out.push('crafting: missing configuration');
      return;
    }
    const cr = t as unknown as CraftingConfig;
    const kinds: CraftKind[] = ['loco', 'wagon'];
    const sizes: VehicleSize[] = ['small', 'medium', 'large'];
    const craftRarities: CraftRarity[] = ['N', 'R', 'SR', 'SSR', 'L'];
    for (const k of kinds) {
      const prices = cr.unlockPrice?.[k];
      if (!Array.isArray(prices) || prices.length < 3 || prices.some((p) => !(p >= 0)))
        out.push(`crafting: unlockPrice.${k} needs three non-negative prices`);
      for (const s of sizes)
        if (!isCost(cr.instanceCost?.[k]?.[s]))
          out.push(`crafting: instanceCost.${k}.${s} must be a resource map`);
      if (!(cr.starterCopies?.[k] >= 0)) out.push(`crafting: starterCopies.${k} must be >= 0`);
    }
    for (const r of craftRarities) {
      if (!(cr.rarityWeight?.[r] >= 0)) out.push(`crafting: rarityWeight.${r} must be >= 0`);
      if (!(cr.rarityCostMul?.[r] >= 0)) out.push(`crafting: rarityCostMul.${r} must be >= 0`);
      const f = cr.failChance?.[r];
      if (!(f >= 0 && f <= 1)) out.push(`crafting: failChance.${r} must be between 0 and 1`);
    }
    if (!(cr.cardsPerDraw >= 1)) out.push('crafting: cardsPerDraw must be at least 1');
    if (!(cr.ownedWeight >= 0)) out.push('crafting: ownedWeight must be >= 0');
    if (!(cr.failRefund >= 0 && cr.failRefund <= 1))
      out.push('crafting: failRefund must be between 0 and 1');
    if (!isCost(cr.ownedRefund)) out.push('crafting: ownedRefund must be a resource map');
    else
      for (const k of Object.keys(cr.ownedRefund))
        if (!ref.cargo.has(k)) out.push(`crafting: unknown refund resource "${k}"`);
  },
  houses(t, _ref, out) {
    const hc = t as HouseConfig;
    if (
      !isObj(hc) ||
      !Array.isArray(hc.capacity) ||
      !hc.capacity.length ||
      hc.capacity.some((v) => !(v > 0))
    )
      out.push('houses: capacity needs one positive value per level');
    else if (!Array.isArray(hc.upgradeCost) || hc.upgradeCost.length < hc.capacity.length - 1)
      out.push('houses: upgradeCost needs one entry per level above the first');
    else {
      for (const c of hc.upgradeCost)
        if (!isCost(c)) out.push('houses: upgradeCost must be resource maps');
      for (const k of ['constructionDays', 'growthDays', 'autoUpgradeDays'] as const)
        if (!(hc[k] > 0)) out.push(`houses: ${k} must be positive`);
    }
  },
};

function failure(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Problems per table; a check that throws becomes a problem of its own table. */
function tableProblems(b: ContentBundle): Map<ContentKey, string[]> {
  const ref: Refs = {
    cargo: idSet(b.cargo),
    locos: idSet(b.locomotives),
    wagons: idSet(b.wagons),
    retired: new Set([...retiredIdSet(b.locomotives), ...retiredIdSet(b.wagons)]),
  };
  const found = new Map<ContentKey, string[]>();
  for (const k of CONTENT_KEYS) {
    const out: string[] = [];
    try {
      CHECKS[k](b[k], ref, out);
    } catch (e) {
      out.push(`${k}: check failed (${failure(e)})`);
    }
    if (out.length) found.set(k, out);
  }
  return found;
}

/**
 * Problems that would break the game if this bundle were applied. Empty means valid. Never
 * throws: a table of the wrong shape is reported, not dereferenced.
 */
export function validateContent(b: ContentBundle): string[] {
  try {
    if (!isObj(b)) return ['content: not a bundle'];
    return [...tableProblems(b).values()].flat();
  } catch (e) {
    return [`content: check failed (${failure(e)})`];
  }
}

type SetAsideEntry = ContentOverrideReport['setAside'][number];

/**
 * The shipped bundle with every stored table that may apply: one stamped with the current shipped
 * table, that validates together with the others. Everything else is set aside, with a warning,
 * and stays in storage until the editor next writes or resets.
 */
function buildContent(): { bundle: ContentBundle; report: ContentOverrideReport } {
  const base = clone(DEFAULT_CONTENT);
  const report: ContentOverrideReport = { applied: [], setAside: [] };
  const raw = readStored();
  if (!raw) return { bundle: base, report };
  const stored = parseStored(raw);
  if (!stored) {
    console.warn('[content] stored overrides are unreadable; the shipped tables load');
    return { bundle: base, report };
  }

  const notes = new Map<ContentKey, string>();
  const setAside = (
    key: ContentKey,
    reason: SetAsideEntry['reason'],
    problems: string[],
    why: string,
  ) => {
    report.setAside.push({ key, reason, problems });
    notes.set(key, why);
  };
  const candidates = new Map<ContentKey, unknown>();
  if (stored.format === undefined) {
    for (const k of CONTENT_KEYS)
      if (stored[k] !== undefined)
        setAside(k, 'stale', [], 'stored in the old whole-bundle format, without a stamp');
  } else if (stored.format !== CONTENT_FORMAT) {
    const tables = isObj(stored.tables) ? stored.tables : {};
    const problem = `unknown storage format ${JSON.stringify(stored.format)}`;
    for (const k of CONTENT_KEYS)
      if (tables[k] !== undefined) setAside(k, 'invalid', [problem], problem);
    if (!report.setAside.length)
      console.warn(
        `[content] stored overrides are unreadable (${problem}); the shipped tables load`,
      );
  } else if (!isObj(stored.tables)) {
    console.warn('[content] stored overrides hold no tables; the shipped tables load');
  } else {
    for (const k of CONTENT_KEYS) {
      const e = stored.tables[k];
      if (e === undefined) continue;
      if (!isObj(e) || typeof e.stamp !== 'string' || e.data === undefined) {
        const problem = `${k}: stored entry needs a stamp and data`;
        setAside(k, 'invalid', [problem], problem);
      } else if (e.stamp !== STAMP[k])
        setAside(k, 'stale', [], `made for shipped table ${e.stamp}, which is now ${STAMP[k]}`);
      else candidates.set(k, e.data);
    }
  }

  const order = (keys: ContentKey[]) => CONTENT_KEYS.filter((k) => keys.includes(k));
  const problemsWith = (keys: ContentKey[]) => {
    const b: Record<string, unknown> = { ...base };
    for (const k of keys) b[k] = candidates.get(k);
    return tableProblems(b as unknown as ContentBundle);
  };
  let applied = [...candidates.keys()];
  const invalid = new Map<ContentKey, string[]>();
  while (applied.length) {
    const found = problemsWith(applied);
    if (!found.size) break;
    // The first stored table with problems of its own: tables refer only to earlier ones, so a
    // broken table is caught before the tables that refer to it.
    let culprit = applied.find((k) => found.has(k));
    let problems = culprit ? found.get(culprit)! : [];
    if (!culprit) {
      // The problems sit in shipped tables: blame the stored table whose absence leaves fewest.
      const all = [...found.values()].flat();
      let fewest = Infinity;
      for (const k of applied) {
        const rest = [...problemsWith(applied.filter((x) => x !== k)).values()].flat();
        if (rest.length >= fewest) continue;
        fewest = rest.length;
        culprit = k;
        problems = all.filter((p) => !rest.includes(p));
      }
      if (!problems.length) problems = all;
    }
    invalid.set(culprit!, problems);
    applied = applied.filter((k) => k !== culprit);
  }
  // Give back every table that was caught only through another one.
  let gaveBack = true;
  while (gaveBack) {
    gaveBack = false;
    for (const k of order([...invalid.keys()])) {
      if (problemsWith([...applied, k]).size) continue;
      applied = order([...applied, k]);
      invalid.delete(k);
      gaveBack = true;
    }
  }
  for (const [k, problems] of invalid) setAside(k, 'invalid', problems, 'fails validation');

  report.applied = order(applied);
  for (const k of report.applied)
    (base as unknown as Record<string, unknown>)[k] = candidates.get(k);
  report.setAside.sort((a, b) => CONTENT_KEYS.indexOf(a.key) - CONTENT_KEYS.indexOf(b.key));
  for (const s of report.setAside)
    console.warn(
      `[content] stored "${s.key}" override set aside (${s.reason}): ${notes.get(s.key)}`,
      ...(s.problems.length ? [s.problems] : []),
    );
  return { bundle: base, report };
}

/** Fill derived fields (wagon accept lists from cargo classes). */
function finalize(b: ContentBundle): ContentBundle {
  for (const w of b.wagons)
    w.accepts = b.cargo.filter((c) => c.class === w.carries).map((c) => c.id);
  return b;
}

const loaded = buildContent();
/** The live bundle every module reads from. */
export const content: ContentBundle = finalize(loaded.bundle);
finalize(DEFAULT_CONTENT);

/** What became of the stored overrides at load: which tables apply, which were set aside and why. */
export function contentOverrideReport(): ContentOverrideReport {
  return clone(loaded.report);
}
/** True when this session runs on at least one stored table. */
export function contentIsCustom() {
  return loaded.report.applied.length > 0;
}
