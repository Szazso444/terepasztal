/**
 * Content store. Every data table ships as JSON in this folder; the in-client content editor can
 * replace any table with an edited copy stored in localStorage. Overrides are applied once, here,
 * at module load so every consumer sees one consistent bundle for the session. Editing content
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
export type { SupplyMode };

export type Rarity = 'N' | 'R' | 'SR' | 'SSR';
/** Resource amounts, e.g. { wood: 30, stone: 10 }. */
export type Cost = Record<string, number>;
export type CargoClass = 'liquid' | 'mineral' | 'bulk' | 'people';
export type LocoType = 'steam' | 'diesel' | 'electric';
export type VehicleSize = 'small' | 'medium' | 'large';
export type BodyPlan = 'rigid' | 'tender' | 'garratt' | 'meyer';
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
  /** body length class: 1, 2 or 3 tiles (default small) */
  size?: VehicleSize;
  /** rigid body, engine + tender, Garratt (engine, cradle, engine) or Meyer (frame on two engine units) */
  plan?: BodyPlan;
  /** pivot spacing as a fraction of body length (default 0.7) */
  pivotRatio?: number;
  /** bogies under a rigid body (3 for the Bo-Bo-Bo large body) */
  bogies?: number;
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
  size?: VehicleSize;
  /** age the wagon belongs to: 0 steam, 1 diesel, 2 electric */
  tier?: number;
  /** speed ceiling, tiles per second (default above every locomotive) */
  vmax?: number;
  /** refuelling wagons: what they carry for the locomotive */
  service?: 'coal' | 'fuel' | 'battery';
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
  /** trains refuel coal / wood / oil here */
  fuel?: boolean;
  /** trains refill water here */
  water?: boolean;
  /** false: never a contract endpoint */
  contracts?: boolean;
}
export interface BuildingDef {
  id: string;
  name: string;
  flavor: string;
  cost: Cost;
  crew: number;
  /** age required to build it (0 steam, 1 diesel, 2 electric) */
  tier: number;
  /** only placeable in this production-chain mode (missing: both) */
  supply?: SupplyMode;
  /** needs a deposit of this kind (a map prop, e.g. `coal` or `oil`) on the tile */
  deposit?: string;
  recipe: { in: Cost; out: Cost };
  /** alternative inputs used when the primary ones run short */
  altIn?: Cost;
  /** recipe batches per in-game day */
  perDay: number;
  /** feeds the power network */
  power?: boolean;
  /** must stand next to water (hydro plants) */
  needsWater?: boolean;
  /** taps the pole grid and makes electrified track within `radius` live, passing `throughput` units per second */
  substation?: { radius: number; throughput: number };
}
export interface StationLevels {
  capacity: number[];
  loadRate: number[];
  platforms: number[];
  production: number[];
  upgradeCostMul: number[];
  spriteByLevel: number[];
  maxLevelByTier: number[];
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
  /** residents a house holds at level 1, 2, 3 */
  capacity: number[];
  /** people who move in the day a house is finished */
  startResidents: number;
  /** in-game days from foundations to a finished house */
  constructionDays: number;
  /** days per new resident per house (while wheat is on hand and there is room) */
  growthDays: number;
  /** days a full house waits before it grows a storey on its own */
  autoUpgradeDays: number;
  /** what the player pays to lift a house to level 2, 3 */
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

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Pristine copy of the shipped data. The full production-chain mode ships as a second data set
 * (`*_full.json`, every entry marked `supply: "full"`) appended to the plain tables.
 */
export const DEFAULT_CONTENT: ContentBundle = {
  locomotives: clone(locoJson) as unknown as LocoDef[],
  wagons: clone(wagonJson) as unknown as WagonDef[],
  cargo: clone([...cargoJson, ...cargoFullJson]) as unknown as CargoDef[],
  stations: {
    levels: clone(stationJson.levels) as unknown as StationLevels,
    defs: clone([...stationJson.defs, ...stationFullJson]) as unknown as StationDef[],
  },
  contracts: clone(contractJson) as ContractConfig,
  decor: clone(decorJson) as unknown as DecorDef[],
  buildings: clone([...buildingJson, ...buildingFullJson]) as unknown as BuildingDef[],
  gacha: clone(gachaJson) as GachaConfig,
  track: clone(trackJson) as unknown as TrackConfig,
  crafting: clone(craftingJson) as unknown as CraftingConfig,
  houses: clone(houseJson) as unknown as HouseConfig,
};

export function readContentOverrides(): Partial<ContentBundle> | null {
  try {
    const raw = localStorage.getItem(CONTENT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<ContentBundle>;
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}
export function writeContentOverrides(bundle: Partial<ContentBundle>) {
  try {
    localStorage.setItem(CONTENT_KEY, JSON.stringify(bundle));
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

/** Problems that would break the game if this bundle were applied. Empty means valid. */
export function validateContent(b: ContentBundle): string[] {
  const out: string[] = [];
  const ids = (list: { id: string }[], what: string) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (!x.id || !/^[a-z0-9_]+$/.test(x.id)) out.push(`${what}: bad id "${x.id}"`);
      if (seen.has(x.id)) out.push(`${what}: duplicate id "${x.id}"`);
      seen.add(x.id);
    }
    return seen;
  };
  const cargo = ids(b.cargo, 'cargo');
  const locos = ids(b.locomotives, 'locomotive');
  const wagons = ids(b.wagons, 'wagon');
  ids(b.stations.defs, 'station');
  ids(b.decor, 'decor');
  ids(b.contracts.templates, 'contract template');
  for (const w of b.wagons)
    if (!['liquid', 'mineral', 'bulk'].includes(w.carries))
      out.push(`wagon ${w.id}: bad class "${w.carries}"`);
  ids(b.buildings, 'building');
  const isCost = (c: unknown) =>
    !!c &&
    typeof c === 'object' &&
    Object.values(c as Cost).every((v) => typeof v === 'number' && v >= 0);
  for (const s of b.stations.defs)
    if (!isCost(s.cost)) out.push(`station ${s.id}: cost must be a resource map`);
  for (const d of b.decor)
    if (!isCost(d.cost)) out.push(`decor ${d.id}: cost must be a resource map`);
  for (const bd of b.buildings) {
    if (!isCost(bd.cost)) out.push(`building ${bd.id}: cost must be a resource map`);
    for (const k of Object.keys(bd.recipe.in))
      if (!cargo.has(k)) out.push(`building ${bd.id}: unknown input "${k}"`);
    for (const k of Object.keys(bd.recipe.out))
      if (!cargo.has(k) && k !== 'power') out.push(`building ${bd.id}: unknown output "${k}"`);
  }
  for (const [k, p] of Object.entries(b.track.pieces))
    if (!isCost(p.cost)) out.push(`track ${k}: cost must be a resource map`);
  for (const l of b.locomotives) {
    if (!['steam', 'diesel', 'electric'].includes(l.type))
      out.push(`locomotive ${l.id}: bad type "${l.type}"`);
    if (l.type !== 'electric' && !(l.fuelCap && l.fuelPerTile))
      out.push(`locomotive ${l.id}: needs fuelCap and fuelPerTile`);
    if (l.type === 'steam' && !(l.waterCap && l.waterPerTile))
      out.push(`locomotive ${l.id}: needs waterCap and waterPerTile`);
    if (l.type === 'electric' && !l.powerPerTile)
      out.push(`locomotive ${l.id}: needs powerPerTile`);
  }
  for (const s of b.stations.defs) {
    for (const c of s.accepts) if (!cargo.has(c)) out.push(`station ${s.id}: unknown cargo "${c}"`);
    for (const p of s.produces)
      if (!cargo.has(p.cargo)) out.push(`station ${s.id}: unknown cargo "${p.cargo}"`);
  }
  for (const bn of b.gacha.banners) {
    if (!bn.pool.length) out.push(`banner ${bn.id}: empty pool`);
    for (const id of bn.pool)
      if (!locos.has(id) && !wagons.has(id)) out.push(`banner ${bn.id}: unknown item "${id}"`);
  }
  if (!b.locomotives.some((l) => l.starter)) out.push('no starter locomotive');
  if (!b.wagons.some((w) => w.starter)) out.push('no starter wagon');
  const lv = b.stations.levels;
  for (const k of [
    'capacity',
    'loadRate',
    'platforms',
    'production',
    'upgradeCostMul',
    'spriteByLevel',
  ] as const)
    if (!Array.isArray(lv[k]) || lv[k].length !== 5)
      out.push(`station levels: ${k} needs 5 values`);
  const rateSum = Object.values(b.gacha.rates).reduce((a, v) => a + v, 0);
  if (Math.abs(rateSum - 1) > 0.01)
    out.push(`gacha rates sum to ${rateSum.toFixed(2)}, expected 1`);
  for (const k of Object.keys(DEFAULT_CONTENT.track.pieces))
    if (!b.track.pieces[k]) out.push(`track: missing piece "${k}"`);
  const cr = b.crafting;
  const kinds: CraftKind[] = ['loco', 'wagon'];
  const sizes: VehicleSize[] = ['small', 'medium', 'large'];
  const craftRarities: CraftRarity[] = ['N', 'R', 'SR', 'SSR', 'L'];
  if (!cr || typeof cr !== 'object') out.push('crafting: missing configuration');
  else {
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
    for (const k of Object.keys(cr.ownedRefund ?? {}))
      if (!cargo.has(k)) out.push(`crafting: unknown refund resource "${k}"`);
  }
  const hc = b.houses;
  if (
    !hc ||
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
  return out;
}

function buildContent(): ContentBundle {
  const base = clone(DEFAULT_CONTENT);
  const o = readContentOverrides();
  if (!o) return base;
  const merged: ContentBundle = { ...base };
  for (const k of CONTENT_KEYS)
    if (o[k] !== undefined) (merged as unknown as Record<string, unknown>)[k] = o[k];
  const problems = validateContent(merged);
  if (problems.length) {
    console.warn('[content] stored overrides rejected:', problems);
    return base;
  }
  return merged;
}

/** Fill derived fields (wagon accept lists from cargo classes). */
function finalize(b: ContentBundle): ContentBundle {
  for (const w of b.wagons)
    w.accepts = b.cargo.filter((c) => c.class === w.carries).map((c) => c.id);
  return b;
}

/** The live bundle every module reads from. */
export const content: ContentBundle = finalize(buildContent());
finalize(DEFAULT_CONTENT);
export function contentIsCustom() {
  return readContentOverrides() !== null;
}
