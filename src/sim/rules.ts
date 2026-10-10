/**
 * Tunable game rules. Multipliers and world parameters that the in-client tuning screen can
 * change; consumers read the live `rules` object at use time, so most changes apply instantly.
 * Map parameters only matter when a new map is generated.
 *
 * Three places hold rules. The stored tuning (`RULES_KEY`) is what a new game starts from; the
 * tuning screen writes the values it changes through to it. Each save carries the rules its game
 * was played with, and loading one applies them to that session only (`applyGameRules`), leaving
 * the stored tuning alone. Named presets (`RULE_PRESETS_KEY`) are kept apart from both.
 */
export interface Rules {
  startMoney: number;
  startTickets: number;
  buildCostMul: number;
  /** multiplies the game time an upgrade takes; 0 makes every upgrade instant */
  upgradeTimeMul: number;
  refundRate: number;
  runningCostMul: number;
  spotPriceMul: number;
  trainSpeedMul: number;
  /** top speed on regular track, locomotive speed units (high speed has no cap) */
  lineSpeedRegular: number;
  /** top speed on narrow track, locomotive speed units */
  lineSpeedNarrow: number;
  /** 1: narrow track and the narrow depot can be built; the hook for a later unlock rule */
  narrowUnlocked: number;
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
  /** @deprecated reputation is gone; kept so older callers compile, no effect */
  reputationMul: number;
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
  stockpileCap: number;
  /** units a warehouse holds per level (any goods, in total) */
  warehouseCap: number;
  /** stockpile cap added per depot */
  depotCap: number;
  /** each further station / service / works of the same kind costs this much more (fraction of base) */
  repeatCostStep: number;
  /** multiplies the whole track cost matrix */
  trackCostScale: number;
  /** money per tile a train runs on high-speed track */
  hsAccessCharge: number;
  /** price of fitting in-cab signalling equipment to one locomotive */
  inCabCost: number;
  /** multiplies the starting wood, stone and iron */
  startingResourceScale: number;
  /** a collection train leaves a warehouse alone until it holds this much of a resource */
  collectMin: number;
  /** days between settlements of standing trade deals */
  tradeCycleDays: number;
  powerCap: number;
  /** price of the first ring of chunks around the start; each ring further multiplies it */
  chunkCost: number;
  chunkCostMul: number;
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
  startTickets: 3,
  buildCostMul: 1,
  upgradeTimeMul: 1,
  refundRate: 0.5,
  runningCostMul: 1,
  spotPriceMul: 1,
  trainSpeedMul: 1,
  lineSpeedRegular: 2,
  lineSpeedNarrow: 1.2,
  narrowUnlocked: 1,
  loadRateMul: 1,
  productionMul: 1,
  capacityMul: 1,
  contractOfferCount: 1,
  contractOffersPerChunk: 0.5,
  contractOfferMax: 6,
  contractRefreshDays: 21,
  deadlineMul: 1,
  payoutMul: 1,
  reputationMul: 1,
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
  stockpileCap: 1000,
  warehouseCap: 1000,
  depotCap: 3000,
  repeatCostStep: 0.2,
  trackCostScale: 1,
  hsAccessCharge: 2,
  inCabCost: 6000,
  startingResourceScale: 3,
  collectMin: 100,
  tradeCycleDays: 7,
  powerCap: 100,
  chunkCost: 12000,
  chunkCostMul: 1.6,
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
    key: 'startTickets',
    label: 'Starting tickets',
    group: 'Start',
    min: 0,
    max: 200,
    step: 1,
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
  { key: 'stockpileCap', label: 'Stockpile cap', group: 'Economy', min: 50, max: 5000, step: 50 },
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
    label: 'Stockpile cap per depot',
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
    key: 'hsAccessCharge',
    label: 'High-speed access charge per tile',
    group: 'Economy',
    min: 0,
    max: 20,
    step: 0.5,
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
    key: 'collectMin',
    label: 'Collection: warehouse pile before pickup',
    group: 'Economy',
    min: 0,
    max: 1000,
    step: 10,
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
    key: 'startStock',
    label: 'Starting stockpile x',
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
    hint: 'also the active contracts you may hold there; land bought adds more',
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
    key: 'lineSpeedRegular',
    label: 'Wide line speed',
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
    key: 'narrowUnlocked',
    label: 'Narrow gauge available (0 or 1)',
    group: 'Trains & stations',
    min: 0,
    max: 1,
    step: 1,
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

export const RULES_KEY = 'terepasztal.rules';

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

export function readRules(): Rules {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return { ...DEFAULT_RULES };
    const saved = JSON.parse(raw) as Partial<Rules>;
    if ([2, 6].includes(saved.contractRefreshDays ?? 0)) saved.contractRefreshDays = 21;
    if (saved.contractOfferCount === 2) saved.contractOfferCount = 1;
    if (saved.startMoney === 25000) saved.startMoney = 40000;
    if (saved.startingResourceScale === 1) saved.startingResourceScale = 3;
    return sanitize(saved);
  } catch {
    return { ...DEFAULT_RULES };
  }
}

/** The defaults overlaid by `saved`, clamped to each rule's range. Pure. */
export function rulesFrom(saved?: Partial<Rules>): Rules {
  return sanitize({ ...DEFAULT_RULES, ...saved });
}

/**
 * The live rules object, read at load from the stored tuning. Change it through `setRules` or
 * `applyGameRules`, never by replacing it: most simulation modules hold this reference.
 */
export const rules: Rules = readRules();

/** The stored tuning as written, or an empty object when there is none or it is unreadable. */
function storedTuning(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Change the live rules. With `persist`, the keys in `patch` (at their clamped live values) are
 * written over the stored tuning and nothing else is, so rules a loaded save put in force never
 * leak into what the next new game starts from.
 */
export function setRules(patch: Partial<Rules>, persist = true) {
  Object.assign(rules, sanitize({ ...rules, ...patch }));
  if (!persist) return;
  const stored = storedTuning();
  for (const k of Object.keys(patch))
    if (Object.hasOwn(DEFAULT_RULES, k)) stored[k] = rules[k as keyof Rules];
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

/** Put a saved game's rules in force for this session; the stored tuning is not touched. */
export function applyGameRules(saved?: Partial<Rules>) {
  Object.assign(rules, rulesFrom(saved));
}

/** The live and the stored tuning go back to the defaults. */
export function resetRules() {
  Object.assign(rules, rulesFrom());
  try {
    localStorage.removeItem(RULES_KEY);
  } catch {
    /* ignore */
  }
}

/** The keys of `r` (the live rules by default) that differ from the defaults. */
export function rulesDiffer(r: Rules = rules): (keyof Rules)[] {
  return (Object.keys(DEFAULT_RULES) as (keyof Rules)[]).filter(
    (k) => JSON.stringify(r[k]) !== JSON.stringify(DEFAULT_RULES[k]),
  );
}

// ---------------------------------------------------------------------------------------------
// Named presets: whole tunings the player keeps under a name, stored apart from the tuning.

export const RULE_PRESETS_KEY = 'terepasztal.rulePresets';
/** Longest preset name, in characters. */
export const RULE_PRESET_NAME_MAX = 32;

interface RulePreset {
  savedAt: number;
  rules: Partial<Rules>;
}

/** A preset name as stored: trimmed and cut to `RULE_PRESET_NAME_MAX` characters. */
function presetName(name: string): string {
  return Array.from(String(name).trim()).slice(0, RULE_PRESET_NAME_MAX).join('');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
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

/** Put the whole preset in force and store it as the tuning. */
export function applyRulePreset(name: string): boolean {
  const r = readRulePreset(name);
  if (!r) return false;
  setRules(r);
  return true;
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
