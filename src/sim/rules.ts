/**
 * Tunable game rules. Multipliers and world parameters that the in-client tuning screen can
 * change; consumers read the live `rules` object at use time, so most changes apply instantly.
 * Map parameters only matter when a new map is generated.
 *
 * The live `rules` start every page load as the shipped rules (`DEFAULT_RULES`), overlaid with
 * the tuning staged for that load when there is one: `stageNewGameTuning` hands a saved preset
 * across the reload a new game costs, and the load takes it once. Nothing is kept as the tuning
 * new games start from, so a number once dragged never starts a later game. What the tuning
 * screen changes lives in `rules` for the session. Each save carries the rules its game was
 * played with, and loading one applies them to that session only (`applyGameRules`). Named
 * presets (`RULE_PRESETS_KEY`) are the saved tunings, kept apart in localStorage.
 */
export interface Rules {
  startMoney: number;
  buildCostMul: number;
  /** multiplies the game time an upgrade takes; 0 makes every upgrade instant */
  upgradeTimeMul: number;
  refundRate: number;
  runningCostMul: number;
  spotPriceMul: number;
  trainSpeedMul: number;
  /** top speed on Branch Line, locomotive speed units (Main and Trunk Line have no cap) */
  lineSpeedBranch: number;
  /** top speed on Narrow Gauge, locomotive speed units */
  lineSpeedNarrow: number;
  /** extra route cost per line size a train runs above its own class's line (0.25 = +25 %) */
  smallOnBigLine: number;
  /** 1: narrow track and the narrow depot can be built; the hook for a later unlock rule */
  narrowUnlocked: number;
  /** 1: each line is built only from its age on (Main Diesel, Trunk Electric, ...); 0: every line at once */
  lineAgeLocks: number;
  loadRateMul: number;
  productionMul: number;
  capacityMul: number;
  /** open offers, and active contracts the player may hold, on the start chunk alone */
  contractOfferCount: number;
  /** offers (and active contracts) added per chunk owned beyond the first, rounded down */
  contractOffersPerChunk: number;
  /** most open offers, and most active contracts, however much land is owned */
  contractOfferMax: number;
  contractRefreshDays: number;
  deadlineMul: number;
  payoutMul: number;
  failPenaltyMul: number;
  daySeconds: number;
  seasonDays: number;
  rainChanceMul: number;
  fogChanceMul: number;
  mapSize: number;
  waterLevel: number;
  hillLevel: number;
  rockLevel: number;
  forestDensity: number;
  wheatPerCrew: number;
  /** units of each good a town's store holds before any warehouse */
  townStoreCap: number;
  /** tiles round a store within which building draws on it (Chebyshev) */
  buildReach: number;
  /**
   * tiles round a store within which a coaling stage, a water tower or a supplied station outside
   * every town fills trains from it (Chebyshev; `StoreRegistry.fuelSupplierFor`)
   */
  fuelReach: number;
  /** units a warehouse holds per level (any goods, in total) */
  warehouseCap: number;
  /** units of each good a depot holds */
  depotCap: number;
  /** each further station / service / works of the same kind costs this much more (fraction of base) */
  repeatCostStep: number;
  /** multiplies the whole track cost matrix */
  trackCostScale: number;
  /** price of fitting in-cab signalling equipment to one locomotive */
  inCabCost: number;
  /** multiplies the starting wood, stone and iron */
  startingResourceScale: number;
  powerCap: number;
  /** price of the first ring of chunks around the start; each ring further multiplies it */
  chunkCost: number;
  chunkCostMul: number;
  /** price of moving one level of ground with Raise or Lower, per tile per level */
  groundCost: number;
  /** price of digging one tile with the Drill */
  drillCost: number;
  /** price of a portal, which makes itself where a dug line breaks out onto a slope */
  portalCost: number;
  /** stone added to the stock by each tile dug */
  drillStone: number;
  startStock: number;
}

export interface RuleMeta {
  key: keyof Rules;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
  /** takes effect only for a newly generated map */
  newGame?: boolean;
}

export const DEFAULT_RULES: Rules = {
  startMoney: 40000,
  buildCostMul: 1,
  upgradeTimeMul: 1,
  refundRate: 0.5,
  runningCostMul: 1,
  spotPriceMul: 1,
  trainSpeedMul: 1,
  lineSpeedBranch: 2,
  lineSpeedNarrow: 1.2,
  smallOnBigLine: 0.25,
  narrowUnlocked: 1,
  lineAgeLocks: 1,
  loadRateMul: 1,
  productionMul: 1,
  capacityMul: 1,
  contractOfferCount: 1,
  contractOffersPerChunk: 0.5,
  contractOfferMax: 6,
  contractRefreshDays: 21,
  deadlineMul: 1,
  payoutMul: 1,
  failPenaltyMul: 1,
  daySeconds: 240,
  seasonDays: 6,
  rainChanceMul: 1,
  fogChanceMul: 1,
  mapSize: 160,
  waterLevel: 0.36,
  hillLevel: 0.64,
  rockLevel: 0.76,
  forestDensity: 0.56,
  wheatPerCrew: 1,
  townStoreCap: 300,
  buildReach: 24,
  fuelReach: 8,
  warehouseCap: 1000,
  depotCap: 3000,
  repeatCostStep: 0.2,
  trackCostScale: 1,
  inCabCost: 6000,
  startingResourceScale: 3,
  powerCap: 100,
  chunkCost: 12000,
  chunkCostMul: 1.6,
  groundCost: 100,
  drillCost: 500,
  portalCost: 2000,
  drillStone: 2,
  startStock: 1,
};

export const RULE_META: RuleMeta[] = [
  {
    key: 'startMoney',
    label: 'Starting funds',
    group: 'Start',
    min: 0,
    max: 500000,
    step: 1000,
    newGame: true,
  },
  {
    key: 'buildCostMul',
    label: 'Build cost x',
    group: 'Economy',
    min: 0,
    max: 5,
    step: 0.05,
    hint: '0 = free building',
  },
  {
    key: 'upgradeTimeMul',
    label: 'Upgrade time x',
    group: 'Economy',
    min: 0,
    max: 4,
    step: 0.1,
    hint: 'game time an upgrade keeps a building closed; 0 = every upgrade is instant',
  },
  { key: 'refundRate', label: 'Refund rate', group: 'Economy', min: 0, max: 1, step: 0.05 },
  { key: 'runningCostMul', label: 'Fuel use x', group: 'Economy', min: 0, max: 5, step: 0.1 },
  {
    key: 'wheatPerCrew',
    label: 'Food per person per week',
    group: 'Economy',
    min: 0,
    max: 5,
    step: 0.1,
  },
  {
    key: 'townStoreCap',
    label: 'Town store (Townhouse)',
    group: 'Economy',
    min: 0,
    max: 5000,
    step: 50,
  },
  {
    key: 'buildReach',
    label: 'Building draws from stores within',
    group: 'Economy',
    min: 0,
    max: 100,
    step: 1,
    hint: 'tiles from a store',
  },
  {
    key: 'fuelReach',
    label: 'Trackside fuel draws from stores within',
    group: 'Economy',
    min: 0,
    max: 50,
    step: 1,
    hint: 'tiles from a store, outside towns',
  },
  {
    key: 'warehouseCap',
    label: 'Warehouse store per level',
    group: 'Economy',
    min: 0,
    max: 5000,
    step: 100,
  },
  {
    key: 'depotCap',
    label: 'Depot store cap',
    group: 'Economy',
    min: 0,
    max: 20000,
    step: 250,
  },
  {
    key: 'repeatCostStep',
    label: 'Extra cost per repeat build',
    group: 'Economy',
    min: 0,
    max: 2,
    step: 0.05,
  },
  {
    key: 'inCabCost',
    label: 'In-cab signalling fit-out',
    group: 'Economy',
    min: 0,
    max: 50000,
    step: 500,
  },
  {
    key: 'trackCostScale',
    label: 'Track cost scale',
    group: 'Economy',
    min: 0.25,
    max: 4,
    step: 0.25,
  },
  {
    key: 'startingResourceScale',
    label: 'Starting resource scale',
    group: 'Economy',
    min: 0.25,
    max: 4,
    step: 0.25,
  },
  {
    key: 'chunkCost',
    label: 'Chunk price (first ring)',
    group: 'Economy',
    min: 0,
    max: 200000,
    step: 1000,
  },
  {
    key: 'chunkCostMul',
    label: 'Chunk price added per ring (×first)',
    group: 'Economy',
    min: 1,
    max: 4,
    step: 0.1,
  },
  { key: 'powerCap', label: 'Power battery', group: 'Economy', min: 0, max: 2000, step: 50 },
  {
    key: 'groundCost',
    label: 'Raise or lower ground, per tile per level',
    group: 'Economy',
    min: 0,
    max: 2000,
    step: 10,
  },
  {
    key: 'drillCost',
    label: 'Drill, per tile dug',
    group: 'Economy',
    min: 0,
    max: 5000,
    step: 50,
  },
  {
    key: 'portalCost',
    label: 'Tunnel portal',
    group: 'Economy',
    min: 0,
    max: 20000,
    step: 100,
  },
  {
    key: 'drillStone',
    label: 'Stone from each tile dug',
    group: 'Economy',
    min: 0,
    max: 20,
    step: 1,
  },
  {
    key: 'startStock',
    label: 'Starting goods x',
    group: 'Start',
    min: 0,
    max: 10,
    step: 0.5,
    newGame: true,
  },
  { key: 'spotPriceMul', label: 'Spot price x', group: 'Economy', min: 0, max: 5, step: 0.1 },
  { key: 'payoutMul', label: 'Contract payout x', group: 'Contracts', min: 0, max: 5, step: 0.1 },
  { key: 'failPenaltyMul', label: 'Miss penalty x', group: 'Contracts', min: 0, max: 5, step: 0.1 },
  {
    key: 'deadlineMul',
    label: 'Deadline length x',
    group: 'Contracts',
    min: 0.2,
    max: 5,
    step: 0.1,
  },
  {
    key: 'contractOfferCount',
    label: 'Open offers on the start chunk',
    group: 'Contracts',
    min: 1,
    max: 12,
    step: 1,
    hint: 'also the active contracts you may hold there; land bought adds more; never above "Most open offers", this start value included',
  },
  {
    key: 'contractOffersPerChunk',
    label: 'Open offers per chunk bought',
    group: 'Contracts',
    min: 0,
    max: 2,
    step: 0.05,
    hint: 'adds to offers and active contracts, rounded down; 0 = land adds none',
  },
  {
    key: 'contractOfferMax',
    label: 'Most open offers',
    group: 'Contracts',
    min: 1,
    max: 24,
    step: 1,
    hint: 'the cap on offers and on active contracts, however much land you own',
  },
  {
    key: 'contractRefreshDays',
    label: 'Offer refresh (days)',
    group: 'Contracts',
    min: 1,
    max: 90,
    step: 1,
  },
  {
    key: 'trainSpeedMul',
    label: 'Train speed x',
    group: 'Trains & stations',
    min: 0.2,
    max: 4,
    step: 0.1,
  },
  {
    key: 'lineSpeedBranch',
    label: 'Branch Line speed',
    group: 'Trains & stations',
    min: 0.5,
    max: 5,
    step: 0.1,
  },
  {
    key: 'lineSpeedNarrow',
    label: 'Narrow line speed',
    group: 'Trains & stations',
    min: 0.3,
    max: 5,
    step: 0.1,
  },
  {
    key: 'smallOnBigLine',
    label: 'Small train on big line',
    group: 'Trains & stations',
    min: 0,
    max: 2,
    step: 0.05,
    hint: "extra route cost per line size above the train class's own; 0.25 = +25 %",
  },
  {
    key: 'narrowUnlocked',
    label: 'Narrow gauge available (0 or 1)',
    group: 'Trains & stations',
    min: 0,
    max: 1,
    step: 1,
  },
  {
    key: 'lineAgeLocks',
    label: 'Lines open by age (0 or 1)',
    group: 'Trains & stations',
    min: 0,
    max: 1,
    step: 1,
    hint: 'Main Line from the Diesel Age, Trunk Line from the Electric Age; 0 opens every line at once',
  },
  {
    key: 'loadRateMul',
    label: 'Loading speed x',
    group: 'Trains & stations',
    min: 0.2,
    max: 5,
    step: 0.1,
  },
  {
    key: 'productionMul',
    label: 'Production x',
    group: 'Trains & stations',
    min: 0,
    max: 5,
    step: 0.1,
  },
  {
    key: 'capacityMul',
    label: 'Storage capacity x',
    group: 'Trains & stations',
    min: 0.2,
    max: 5,
    step: 0.1,
  },
  {
    key: 'daySeconds',
    label: 'Day length (real seconds at 1x)',
    group: 'Time & weather',
    min: 30,
    max: 1200,
    step: 10,
  },
  {
    key: 'seasonDays',
    label: 'Season length (days)',
    group: 'Time & weather',
    min: 1,
    max: 30,
    step: 1,
  },
  {
    key: 'rainChanceMul',
    label: 'Rain chance x',
    group: 'Time & weather',
    min: 0,
    max: 3,
    step: 0.1,
  },
  {
    key: 'fogChanceMul',
    label: 'Fog chance x',
    group: 'Time & weather',
    min: 0,
    max: 3,
    step: 0.1,
  },
  {
    key: 'mapSize',
    label: 'Map size (tiles)',
    group: 'Map',
    min: 32,
    max: 480,
    step: 32,
    newGame: true,
  },
  {
    key: 'waterLevel',
    label: 'Water level',
    group: 'Map',
    min: 0.1,
    max: 0.6,
    step: 0.01,
    newGame: true,
  },
  {
    key: 'hillLevel',
    label: 'Hill level',
    group: 'Map',
    min: 0.45,
    max: 0.9,
    step: 0.01,
    newGame: true,
  },
  {
    key: 'rockLevel',
    label: 'Rock level',
    group: 'Map',
    min: 0.5,
    max: 1,
    step: 0.01,
    newGame: true,
  },
  {
    key: 'forestDensity',
    label: 'Forest threshold',
    group: 'Map',
    min: 0.3,
    max: 0.9,
    step: 0.01,
    newGame: true,
    hint: 'lower = more forest',
  },
];
if (LANGUAGE === 'hu')
  for (const m of RULE_META) {
    m.group = HU_RULE_GROUPS[m.group] ?? m.group;
    Object.assign(m, HU_RULES[m.key]);
  }

/**
 * The key the stored tuning used to live under. Nothing reads or writes it any more; a page load
 * deletes it, so numbers dragged under an older build do not start any game.
 */
export const RULES_KEY = 'terepasztal.rules';
/** sessionStorage key of the tuning staged for the next page load (`stageNewGameTuning`). */
export const NEW_GAME_TUNING_KEY = 'terepasztal.newGameTuning';

function sanitize(r: Partial<Rules>): Rules {
  const out: Rules = { ...DEFAULT_RULES };
  for (const m of RULE_META) {
    const v = r[m.key];
    if (typeof v === 'number' && Number.isFinite(v))
      (out as unknown as Record<string, number>)[m.key] = Math.min(m.max, Math.max(m.min, v));
  }
  out.mapSize = Math.max(32, Math.round(out.mapSize / 32) * 32);
  return out;
}

/** The defaults overlaid by `saved`, clamped to each rule's range. Pure. */
export function rulesFrom(saved?: Partial<Rules>): Rules {
  return sanitize({ ...DEFAULT_RULES, ...saved });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Delete the tuning an older build stored. It is dropped, not converted: nothing reads it. */
function discardStoredTuning() {
  try {
    localStorage.removeItem(RULES_KEY);
  } catch {
    /* no storage, or it refuses: nothing was read from it either */
  }
}

/**
 * Take the tuning staged for this page load, exactly once: the staged value is removed as it is
 * read. It is no tuning at all when absent, malformed, or when sessionStorage is missing, throws
 * or will not remove it (the next load would find it again).
 */
function takeStagedTuning(): Partial<Rules> | undefined {
  try {
    const raw = sessionStorage.getItem(NEW_GAME_TUNING_KEY);
    if (raw === null) return undefined;
    sessionStorage.removeItem(NEW_GAME_TUNING_KEY);
    const v: unknown = JSON.parse(raw);
    return isRecord(v) ? (v as Partial<Rules>) : undefined;
  } catch {
    return undefined;
  }
}

discardStoredTuning();
/** The tuning this page load was started with, taken once, before anything can stage another. */
const loadTuning = takeStagedTuning();

/**
 * The rules this page load starts from: the shipped rules, overlaid with the tuning staged for
 * this load when it has one (clamped to each rule's range, no value remapped). It reads no
 * stored tuning. A tuning staged since the load is for the next one, and changes made to the
 * live `rules` do not show here, so it returns the same rules whenever it is called.
 */
export function readRules(): Rules {
  return rulesFrom(loadTuning);
}

/**
 * The live rules object, built from `readRules()` at load. Change it through `setRules`,
 * `applyRulePreset` or `applyGameRules`, never by replacing it: most simulation modules hold
 * this reference.
 */
export const rules: Rules = readRules();

/**
 * Change the live rules for this session, each value clamped to its range. Nothing is stored:
 * the next page load starts from the shipped rules again.
 */
export function setRules(patch: Partial<Rules>) {
  Object.assign(rules, sanitize({ ...rules, ...patch }));
}

/** Put a saved game's rules in force for this session; nothing is stored. */
export function applyGameRules(saved?: Partial<Rules>) {
  Object.assign(rules, rulesFrom(saved));
}

/** The live rules go back to the shipped rules. Nothing is stored, so no storage is touched. */
export function resetRules() {
  Object.assign(rules, rulesFrom());
}

/** The keys of `r` (the live rules by default) that differ from the defaults. */
export function rulesDiffer(r: Rules = rules): (keyof Rules)[] {
  return (Object.keys(DEFAULT_RULES) as (keyof Rules)[]).filter(
    (k) => JSON.stringify(r[k]) !== JSON.stringify(DEFAULT_RULES[k]),
  );
}

// ---------------------------------------------------------------------------------------------
// Named presets: whole tunings the player keeps under a name, in localStorage apart from the
// live rules. A preset reaches a game by `applyRulePreset` (this session) or `stageNewGameTuning`
// (the next page load).

export const RULE_PRESETS_KEY = 'terepasztal.rulePresets';
/** Longest preset name, in characters. */
export const RULE_PRESET_NAME_MAX = 32;

interface RulePreset {
  savedAt: number;
  rules: Partial<Rules>;
}

/**
 * A preset name as stored: trimmed, cut to `RULE_PRESET_NAME_MAX` characters and trimmed again,
 * so a name cut just after a space is stored in the form every lookup asks for.
 */
function presetName(name: string): string {
  return Array.from(String(name).trim()).slice(0, RULE_PRESET_NAME_MAX).join('').trim();
}

/**
 * The stored presets. A value that is not valid JSON or not `{ format: 1, presets: {...} }` reads
 * as none; a single entry without a numeric `savedAt` and a `rules` object is skipped.
 */
function readPresets(): Map<string, RulePreset> {
  const out = new Map<string, RulePreset>();
  try {
    const raw = localStorage.getItem(RULE_PRESETS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(v) || v.format !== 1 || !isRecord(v.presets)) return out;
    for (const [name, p] of Object.entries(v.presets))
      if (isRecord(p) && typeof p.savedAt === 'number' && Number.isFinite(p.savedAt))
        if (isRecord(p.rules)) out.set(name, { savedAt: p.savedAt, rules: p.rules });
  } catch {
    /* unreadable: no presets */
  }
  return out;
}

function writePresets(presets: Map<string, RulePreset>): boolean {
  try {
    localStorage.setItem(
      RULE_PRESETS_KEY,
      JSON.stringify({ format: 1, presets: Object.fromEntries(presets) }),
    );
    return true;
  } catch {
    return false;
  }
}

/** The saved presets, newest first. */
export function listRulePresets(): { name: string; savedAt: number }[] {
  return [...readPresets()]
    .map(([name, p]) => ({ name, savedAt: p.savedAt }))
    .sort((a, b) => b.savedAt - a.savedAt || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Keep `r` (the live rules by default) under `name`, replacing a preset of that name. */
export function saveRulePreset(name: string, r: Rules = rules): boolean {
  const n = presetName(name);
  if (!n) return false;
  const presets = readPresets();
  presets.set(n, { savedAt: Date.now(), rules: rulesFrom(r) });
  return writePresets(presets);
}

/** The preset's rules, clamped to each rule's range, or null when there is no such preset. */
export function readRulePreset(name: string): Rules | null {
  const p = readPresets().get(presetName(name));
  return p ? rulesFrom(p.rules) : null;
}

/**
 * Put the whole preset, clamped to each rule's range, in force for this session. Nothing is
 * stored; false, with the live rules untouched, when there is no such preset.
 */
export function applyRulePreset(name: string): boolean {
  const r = readRulePreset(name);
  if (!r) return false;
  setRules(r);
  return true;
}

/**
 * Hand a saved preset to the next page load, which is what a new game costs: its rules (read and
 * clamped now, not the name) go to sessionStorage, and that load takes them once as its starting
 * rules. `null` clears any staged tuning, so the next load starts from the shipped rules. False,
 * with nothing staged, for a name that is no preset or when sessionStorage refuses. It never
 * writes localStorage.
 */
export function stageNewGameTuning(name: string | null): boolean {
  const r = name === null ? null : readRulePreset(name);
  try {
    if (r) sessionStorage.setItem(NEW_GAME_TUNING_KEY, JSON.stringify(r));
    else sessionStorage.removeItem(NEW_GAME_TUNING_KEY);
    return name === null || r !== null;
  } catch {
    try {
      sessionStorage.removeItem(NEW_GAME_TUNING_KEY);
    } catch {
      /* it refuses that too; the failure is reported either way */
    }
    return false;
  }
}

export function deleteRulePreset(name: string): boolean {
  const presets = readPresets();
  if (!presets.delete(presetName(name))) return false;
  return writePresets(presets);
}
export function daySeconds() {
  return rules.daySeconds;
}

/** Economic rates use seven in-game days; seasons and daylight retain their calendar. */
export function weekSeconds() {
  return daySeconds() * 7;
}
import { HU_RULES, HU_RULE_GROUPS } from '../data/names.hu';
import { LANGUAGE } from '../strings';
