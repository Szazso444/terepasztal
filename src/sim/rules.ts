/**
 * Tunable game rules. Multipliers and world parameters that the in-client tuning screen can
 * change; consumers read the live `rules` object at use time, so most changes apply instantly.
 * Map parameters only matter when a new map is generated. Rules are stored with each save.
 */
export interface Rules {
  startMoney: number;
  startTickets: number;
  startReputation: number;
  buildCostMul: number;
  refundRate: number;
  runningCostMul: number;
  spotPriceMul: number;
  trainSpeedMul: number;
  loadRateMul: number;
  productionMul: number;
  capacityMul: number;
  contractOfferCount: number;
  contractRefreshDays: number;
  deadlineMul: number;
  payoutMul: number;
  reputationMul: number;
  failPenaltyMul: number;
  tierThresholds: number[];
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
  /** stockpile cap added per warehouse level */
  warehouseCap: number;
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
  startMoney: 25000,
  startTickets: 3,
  startReputation: 0,
  buildCostMul: 1,
  refundRate: 0.5,
  runningCostMul: 1,
  spotPriceMul: 1,
  trainSpeedMul: 1,
  loadRateMul: 1,
  productionMul: 1,
  capacityMul: 1,
  contractOfferCount: 3,
  contractRefreshDays: 1.5,
  deadlineMul: 1,
  payoutMul: 1,
  reputationMul: 1,
  failPenaltyMul: 1,
  tierThresholds: [0, 120, 350, 750, 1400],
  daySeconds: 240,
  seasonDays: 6,
  rainChanceMul: 1,
  fogChanceMul: 1,
  mapSize: 288,
  waterLevel: 0.36,
  hillLevel: 0.64,
  rockLevel: 0.76,
  forestDensity: 0.56,
  wheatPerCrew: 0.5,
  stockpileCap: 400,
  warehouseCap: 1000,
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
    key: 'startReputation',
    label: 'Starting reputation',
    group: 'Start',
    min: 0,
    max: 2000,
    step: 10,
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
  { key: 'refundRate', label: 'Refund rate', group: 'Economy', min: 0, max: 1, step: 0.05 },
  { key: 'runningCostMul', label: 'Fuel use x', group: 'Economy', min: 0, max: 5, step: 0.1 },
  {
    key: 'wheatPerCrew',
    label: 'Wheat per crew per day',
    group: 'Economy',
    min: 0,
    max: 5,
    step: 0.1,
  },
  { key: 'stockpileCap', label: 'Stockpile cap', group: 'Economy', min: 50, max: 5000, step: 50 },
  {
    key: 'warehouseCap',
    label: 'Cap per warehouse level',
    group: 'Economy',
    min: 0,
    max: 5000,
    step: 100,
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
    label: 'Chunk price growth per ring',
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
  {
    key: 'reputationMul',
    label: 'Reputation reward x',
    group: 'Contracts',
    min: 0,
    max: 5,
    step: 0.1,
  },
  { key: 'failPenaltyMul', label: 'Miss penalty x', group: 'Contracts', min: 0, max: 5, step: 0.1 },
  {
    key: 'deadlineMul',
    label: 'Deadline length x',
    group: 'Contracts',
    min: 0.2,
    max: 5,
    step: 0.1,
  },
  { key: 'contractOfferCount', label: 'Open offers', group: 'Contracts', min: 1, max: 12, step: 1 },
  {
    key: 'contractRefreshDays',
    label: 'Offer refresh (days)',
    group: 'Contracts',
    min: 0.05,
    max: 2,
    step: 0.05,
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
  if (
    Array.isArray(r.tierThresholds) &&
    r.tierThresholds.length >= 2 &&
    r.tierThresholds.every((x) => typeof x === 'number')
  )
    out.tierThresholds = [...r.tierThresholds].map((x) => Math.max(0, Math.round(x)));
  out.tierThresholds[0] = 0;
  out.mapSize = Math.max(32, Math.round(out.mapSize / 32) * 32);
  return out;
}

export function readRules(): Rules {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw ? sanitize(JSON.parse(raw) as Partial<Rules>) : { ...DEFAULT_RULES };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

/** The live rules object. Mutate fields through `setRules` so persistence stays in sync. */
export const rules: Rules = readRules();

export function setRules(patch: Partial<Rules>, persist = true) {
  Object.assign(rules, sanitize({ ...rules, ...patch }));
  if (persist)
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify(rules));
    } catch {
      /* ignore */
    }
}
export function resetRules() {
  setRules({ ...DEFAULT_RULES });
}
export function rulesDiffer(): (keyof Rules)[] {
  return (Object.keys(DEFAULT_RULES) as (keyof Rules)[]).filter(
    (k) => JSON.stringify(rules[k]) !== JSON.stringify(DEFAULT_RULES[k]),
  );
}
export function daySeconds() {
  return rules.daySeconds;
}
