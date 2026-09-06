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

export type Rarity = 'N' | 'R' | 'SR' | 'SSR';

export interface LocoDef {
  id: string;
  name: string;
  rarity: Rarity;
  era: string;
  body: 'steam' | 'diesel';
  paint: string;
  speed: number;
  power: number;
  maxWagons: number;
  costPerTile: number;
  starter?: boolean;
}
export interface WagonDef {
  id: string;
  name: string;
  rarity: Rarity;
  era: string;
  body: 'box' | 'hopper' | 'flat' | 'tank';
  paint: string;
  load: 'crates' | 'heap' | 'logs' | 'none';
  accepts: string[];
  capacity: number;
  weight: number;
  starter?: boolean;
}
export interface CargoDef {
  id: string;
  name: string;
  tier: number;
  price: number;
  color: string;
  weight: number;
}
export interface StationDef {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  tier: number;
  produces: { cargo: string; level: number }[];
  accepts: string[];
}
export interface StationLevels {
  capacity: number[];
  loadRate: number[];
  platforms: number[];
  production: number[];
  upgradeCostMul: number[];
  spriteByLevel: number[];
  maxLevelByTier: number[];
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
  reputation: [number, number];
  tickets: number;
}
export interface ContractConfig {
  offerCount: number;
  offerLifetimeDays: number;
  refreshIntervalDays: number;
  templates: ContractTemplate[];
  failReputationMul: number;
}
export interface DecorDef {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  onTrack: boolean;
  rotations: number;
  radius?: number;
  loadBoost?: number;
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
  pieces: Record<string, { name: string; cost: number; rotations: number }>;
  terrainCost: Record<string, number>;
  refund: number;
  curveSpeed: number;
  switchSpeed: number;
  bridgeSpeed: number;
}
export interface ContentBundle {
  locomotives: LocoDef[];
  wagons: WagonDef[];
  cargo: CargoDef[];
  stations: { levels: StationLevels; defs: StationDef[] };
  contracts: ContractConfig;
  decor: DecorDef[];
  gacha: GachaConfig;
  track: TrackConfig;
}
export type ContentKey = keyof ContentBundle;
export const CONTENT_KEYS: ContentKey[] = [
  'locomotives',
  'wagons',
  'cargo',
  'stations',
  'contracts',
  'decor',
  'gacha',
  'track',
];

export const CONTENT_KEY = 'terepasztal.content';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Pristine copy of the shipped data. */
export const DEFAULT_CONTENT: ContentBundle = {
  locomotives: clone(locoJson) as LocoDef[],
  wagons: clone(wagonJson) as WagonDef[],
  cargo: clone(cargoJson) as CargoDef[],
  stations: clone(stationJson) as { levels: StationLevels; defs: StationDef[] },
  contracts: clone(contractJson) as ContractConfig,
  decor: clone(decorJson) as DecorDef[],
  gacha: clone(gachaJson) as GachaConfig,
  track: clone(trackJson) as TrackConfig,
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
    for (const c of w.accepts) if (!cargo.has(c)) out.push(`wagon ${w.id}: unknown cargo "${c}"`);
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

/** The live bundle every module reads from. */
export const content: ContentBundle = buildContent();
export function contentIsCustom() {
  return readContentOverrides() !== null;
}
