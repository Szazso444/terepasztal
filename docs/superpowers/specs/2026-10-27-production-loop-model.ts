// Balance model behind the production-loop spec (2026-10-27-production-loop-design.md).
// Not part of the build: it models the designed loop, not today's code. Run with Node 22.6+:
//   node docs/superpowers/specs/2026-10-27-production-loop-model.ts [--json out.json]
// A reference player (greedy rules in `player`) plays the Full chain from the start to Hyper, one
// step per half real minute at 1x. The model is aggregate: one stockpile stands for all town
// stores, and trains are a haulage capacity that a share of all output must pass through. It
// answers two questions: does each age's network sustain itself, and how long does each age take?
// Every number the spec quotes is a constant here.

type Res = Record<string, number>;

// ---- Anchors (spec section 2) ----
const DT = 0.5; // real minutes per step
const DAY = 4; // real minutes per game day at 1x
const SEASON_DAYS = 6;
const WORKER_RATE = 1.5; // units a minute, one worker, 3 tiles out, on road
const PARTICIPATION = 0.5; // share of residents who work
const LEVEL_JOBS = [1, 1.5, 2.25, 3.25, 4.5, 6]; // job multiplier per level
const LEVEL_SKILL = 0.1; // output per worker grows 10 % a level
const HAUL_SHARE = 0.6; // share of all output that rides a train
const FUEL_SHARE = 0.1; // an engine burns this share of what it hauls
const STEAM_WATER = 1.25; // water a steam engine takes per unit of coal
const GROWTH = 0.5 * Number(process.env.GROWTH_MUL ?? 1); // residents a minute per growing house
const NEED_OK = 0.9; // satisfaction a house needs to grow or level up
const HOUSE_CAP = [20, 60, 140, 300, 520, 800];
const START_RESIDENTS = 8;

const AGES = ['steam', 'diesel', 'electric', 'nuclear', 'magnetic', 'hyper'] as const;
// residents living at house level >= level; their needs are met, or the age check fails
const AGE_GOALS = [
  { pop: 0, level: 1 },
  { pop: 550, level: 1 },
  { pop: 700, level: 2 },
  { pop: 1800, level: 3 },
  { pop: 3000, level: 4 },
  { pop: 4600, level: 5 },
];
// GOALS=550,700,1800,3000,4600 tries other populations; GROWTH_MUL=0.8 a slower town
if (process.env.GOALS) process.env.GOALS.split(',').forEach((g, i) => (AGE_GOALS[i + 1].pop = +g));

// ---- Needs (spec section 4): per resident per minute, from the age that adds them ----
interface Need {
  cargo: string;
  age: number;
  perMin: number;
  season?: number[];
}
const NEEDS: Need[] = [
  { cargo: 'food', age: 0, perMin: 0.05 },
  { cargo: 'coal', age: 0, perMin: 0.012, season: [0.5, 0.75, 1.25, 1.5] },
  { cargo: 'goods', age: 1, perMin: 0.02 },
  { cargo: 'power', age: 2, perMin: 0.04 },
  { cargo: 'electronics', age: 3, perMin: 0.01 },
  { cargo: 'plastics', age: 4, perMin: 0.012 },
  { cargo: 'luxury', age: 5, perMin: 0.006 },
];

// ---- Prices (spec section 5): base money per unit, times PRICE_SCALE ----
const PRICE_SCALE = 6;
const PRICE: Res = {
  water: 2,
  wheat: 4,
  wood: 4,
  stone: 4,
  iron_ore: 6,
  coal: 8,
  crude: 8,
  copper_ore: 8,
  food: 8,
  diesel: 15,
  power: 6,
  iron: 20,
  wire: 25,
  goods: 30,
  plastics: 40,
  electronics: 60,
  luxury: 120,
};
/** price multiplier from days of stock: 1.5 in shortage, 1 at 2-4 days, 0.7 in plenty */
function priceMul(days: number) {
  if (days < 1) return 1.5;
  if (days < 2) return 1.5 - 0.5 * (days - 1);
  if (days <= 4) return 1;
  if (days < 5) return 1 - 0.3 * (days - 4);
  return 0.7;
}

// ---- Buildings (spec section 6): L1 rates per minute at full staff ----
interface Def {
  id: string;
  age: number;
  jobs: number;
  in?: Res;
  out: Res;
  cost: Res;
  upkeep: number; // money a minute at L1, times the level
  reserve?: number; // units a site holds before it is worked out
  season?: number[]; // output by season
  lastLevel?: number;
}
const H = (cargo: string, extra: Partial<Def> & { cost: Res; id: string }): Def => ({
  age: 0,
  jobs: 4,
  out: { [cargo]: 4 * WORKER_RATE },
  upkeep: 1,
  ...extra,
});
// prettier-ignore
const DEFS: Def[] = [
  H('wheat', { id: 'farm', cost: { wood: 30, stone: 10 }, season: [1, 1.1, 1.35, 0.5] }),
  H('wood', { id: 'lumber', cost: { wood: 20, stone: 15 }, season: [1, 1, 1, 0.8] }),
  H('stone', { id: 'quarry', cost: { wood: 40, stone: 5 }, reserve: 2000 }),
  H('water', { id: 'pump', cost: { wood: 25, stone: 20 } }),
  H('iron_ore', { id: 'mine', cost: { wood: 30, stone: 20, iron: 5 }, reserve: 2400 }),
  H('coal', { id: 'coal_pit', cost: { wood: 40, stone: 20 }, reserve: 2400 }),
  H('crude', { id: 'oil_derrick', age: 1, cost: { wood: 60, iron: 15 }, reserve: 3000 }),
  H('copper_ore', { id: 'copper_mine', age: 2, cost: { wood: 40, stone: 30, iron: 10 }, reserve: 2400 }),
  { id: 'windmill', age: 0, jobs: 3, in: { wheat: 6 }, out: { food: 6 }, cost: { wood: 45, stone: 25 }, upkeep: 1.5 },
  { id: 'kiln', age: 0, jobs: 3, in: { wood: 6 }, out: { coal: 3 }, cost: { stone: 40, wood: 20 }, upkeep: 1.5, lastLevel: 3 },
  { id: 'ironworks', age: 0, jobs: 4, in: { iron_ore: 4, coal: 2 }, out: { iron: 3 }, cost: { stone: 80, wood: 30, iron: 10 }, upkeep: 2 },
  { id: 'workshop', age: 1, jobs: 4, in: { iron: 2, wood: 2 }, out: { goods: 4 }, cost: { wood: 60, stone: 60, iron: 20 }, upkeep: 2 },
  { id: 'diesel_refinery', age: 1, jobs: 4, in: { crude: 6 }, out: { diesel: 4 }, cost: { stone: 80, iron: 20, wood: 20 }, upkeep: 2 },
  { id: 'power_plant', age: 1, jobs: 6, in: { coal: 3, water: 3 }, out: { power: 12 }, cost: { stone: 100, iron: 20, wood: 40 }, upkeep: 3 },
  { id: 'wire_mill', age: 2, jobs: 4, in: { copper_ore: 4, coal: 1 }, out: { wire: 2 }, cost: { stone: 60, iron: 30, wood: 20 }, upkeep: 2 },
  { id: 'electronics_works', age: 3, jobs: 5, in: { wire: 2, iron: 1 }, out: { electronics: 2 }, cost: { stone: 120, iron: 60, goods: 40 }, upkeep: 3 },
  { id: 'plastics_works', age: 4, jobs: 5, in: { crude: 4 }, out: { plastics: 2 }, cost: { stone: 120, iron: 60, goods: 20 }, upkeep: 3 },
  { id: 'luxury_works', age: 5, jobs: 6, in: { electronics: 1, plastics: 1 }, out: { luxury: 2 }, cost: { stone: 150, iron: 80, electronics: 40 }, upkeep: 4 },
];
const DEF = Object.fromEntries(DEFS.map((d) => [d.id, d]));
/** the building the player builds for a cargo */
function makerOf(s: State, cargo: string): Def | undefined {
  if (cargo === 'coal') {
    // charcoal while wood is plentiful and kilns can still level up, then the pit
    const kilns = s.blds.filter((b) => b.def.id === 'kiln').length;
    return kilns < 2 ? DEF.kiln : DEF.coal_pit;
  }
  return DEFS.find((d) => d.out[cargo]);
}

const HOUSE_COST: Res[] = [
  { wood: 35, stone: 15 },
  { wood: 60, stone: 40 },
  { wood: 80, stone: 140, iron: 30 },
  { stone: 260, iron: 90, goods: 40 },
  { stone: 420, iron: 180, goods: 80 },
  { stone: 640, iron: 320, electronics: 40 },
];
/** money a minute per filled job; it follows the age, as people spend more in later ages */
const WAGE = [1.1, 2.0, 3.6, 6.5, 7.0, 8.0];
const ENGINE_CREW = 3;
const UPGRADE_MUL = 1.5; // building upgrade cost = build cost x level x this

// ---- Engines (spec section 6): one representative engine per age ----
// prettier-ignore
const ENGINES = [
  { haul: 15, fuel: 'coal', upkeep: 3, cost: { iron: 80, wood: 40, stone: 20, coal: 30 } },
  { haul: 45, fuel: 'diesel', upkeep: 5, cost: { iron: 120, stone: 30, goods: 20 } },
  { haul: 70, fuel: 'power', upkeep: 8, cost: { iron: 160, stone: 40, goods: 40 } },
  { haul: 100, fuel: 'power', upkeep: 12, cost: { iron: 220, electronics: 30 } },
  { haul: 140, fuel: 'power', upkeep: 16, cost: { iron: 300, electronics: 60, plastics: 40 } },
  { haul: 200, fuel: 'power', upkeep: 20, cost: { iron: 400, electronics: 100, plastics: 80 } },
];
/** money for a recipe draw; the first draw of each new age is free (spec section 5) */
const RECIPE_DRAW = [4000, 12000, 24000, 40000, 60000, 90000];

// ---- Land ----
const SITES_PER_CHUNK = Number(process.env.SITES ?? 4); // quarry, mine, pit or oil sites a chunk offers
const CHUNK_SLOTS = 14; // buildings (not houses) a chunk holds
/** the n-th chunk costs CHUNK_GROWTH times the one before; land is the late-game money sink */
const CHUNK_BASE = 12000;
const CHUNK_GROWTH = Number(process.env.CHUNK_GROWTH ?? 1.12);
const chunkCost = (n: number) => Math.round(CHUNK_BASE * CHUNK_GROWTH ** (n - 2));

// ---- Start (today's start stock, spec section 7) ----
const START_MONEY = 40000;
const START_STOCK: Res = {
  wood: 465,
  stone: 393,
  iron: 288,
  water: 600,
  wheat: 300,
  food: 600,
  coal: 240,
};
/** stock the player keeps of each building material before it builds more of it */
const RESERVE: Res = { wood: 150, stone: 150, iron: 80, goods: 60, electronics: 40, plastics: 40 };
/** units of one cargo the network's stores hold (the model does not grow it with warehouses) */
const STORE_CAP = 3000;
/** what works leave in store: the reserve, or enough for the age's next engine */
const reserveOf = (s: State, c: string) =>
  Math.max(get(RESERVE, c) / 2, get(ENGINES[s.age].cost, c));

// ---------------------------------------------------------------------------------------------

interface Bld {
  def: Def;
  level: number;
  left: number;
}
interface State {
  t: number;
  age: number;
  money: number;
  stock: Res;
  flow: Res; // net arrivals a minute, smoothed
  houses: number[]; // count by level - 1
  residents: number[]; // residents by house level - 1
  blds: Bld[];
  engines: number[]; // count by age
  chunks: number;
  sitesUsed: number; // deposit sites opened so far, worked out or not
  log: string[];
  sat: Res;
  cool: Res;
  lack: Res; // materials builds lacked lately, as extra demand a minute
  carried: number;
  haul: number;
  staffing: number;
  income: number;
  upkeep: number;
}

const get = (r: Res, k: string) => r[k] ?? 0;
const add = (r: Res, k: string, n: number) => (r[k] = get(r, k) + n);
const can = (s: State, c: Res) => Object.entries(c).every(([k, n]) => get(s.stock, k) >= n);
const pay = (s: State, c: Res) => Object.entries(c).forEach(([k, n]) => add(s.stock, k, -n));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const seasonOf = (t: number) => Math.floor(t / (DAY * SEASON_DAYS)) % 4;
const jobsOf = (b: Bld) => b.def.jobs * LEVEL_JOBS[b.level - 1];
const outMul = (b: Bld) => LEVEL_JOBS[b.level - 1] * (1 + LEVEL_SKILL * (b.level - 1));
const maxLevel = (s: State, d: Def) => Math.min(d.lastLevel ?? 6, s.age - d.age + 1);
const pop = (s: State) => sum(s.residents);
const popAtLeast = (s: State, lvl: number) => sum(s.residents.slice(lvl - 1));

/** demand a minute for a need (residents at the levels that consume it), plus growth room */
function needDemand(s: State, n: Need, room = 0) {
  const r = popAtLeast(s, n.age + 1) * (1 + room);
  return r * n.perMin * (n.season ? n.season[seasonOf(s.t)] : 1);
}
/** fuel a minute the fleet burns of a cargo */
function burn(s: State, cargo: string) {
  let f = 0;
  for (let a = 0; a < ENGINES.length; a++)
    if (ENGINES[a].fuel === cargo) f += FUEL_SHARE * s.engines[a] * ENGINES[a].haul;
  if (cargo === 'water') f += STEAM_WATER * FUEL_SHARE * s.engines[0] * ENGINES[0].haul;
  return f * Math.min(1, s.haul / Math.max(1, totalHaulCap(s)));
}
const totalHaulCap = (s: State) => sum(s.engines.map((n, a) => n * ENGINES[a].haul));

function step(s: State) {
  const season = seasonOf(s.t);
  const workforce = PARTICIPATION * pop(s);
  const jobs = sum(s.blds.map(jobsOf));
  s.staffing = jobs > 0 ? Math.min(1, workforce / jobs) : 0;

  // production; works take their inputs from the store
  const out: Res = {};
  const used: Res = {};
  for (const b of s.blds) {
    const d = b.def;
    let k = outMul(b) * s.staffing * (d.season ? d.season[season] : 1) * DT;
    // works leave the building-material reserve for the builder (a production setting)
    if (d.in)
      for (const [c, n] of Object.entries(d.in))
        k = Math.min(k, Math.max(0, get(s.stock, c) - reserveOf(s, c)) / n);
    const main = Object.values(d.out)[0];
    if (get(s.stock, Object.keys(d.out)[0]) >= STORE_CAP) continue; // the store is full
    if (d.reserve !== undefined) k = Math.min(k, b.left / main);
    if (k <= 0) continue;
    for (const [c, n] of Object.entries(d.in ?? {})) {
      add(s.stock, c, -n * k);
      add(used, c, n * k);
    }
    for (const [c, n] of Object.entries(d.out)) add(out, c, n * k);
    if (d.reserve !== undefined) b.left -= main * k;
  }
  s.blds = s.blds.filter((b) => b.left > 0.5); // worked-out sites close

  // trains: a share of the output rides a train, and engines burn fuel for what they carry
  const total = sum(Object.values(out));
  const need = HAUL_SHARE * total;
  let cap = 0;
  for (let a = 0; a < ENGINES.length; a++) {
    const e = ENGINES[a];
    if (!s.engines[a]) continue;
    const take = Math.min(s.engines[a] * e.haul * DT, Math.max(0, need - cap));
    const fuel = FUEL_SHARE * take;
    const water = e.fuel === 'coal' ? fuel * STEAM_WATER : 0;
    let ok = Math.min(1, get(s.stock, e.fuel) / Math.max(fuel, 1e-9));
    if (water) ok = Math.min(ok, get(s.stock, 'water') / water);
    add(s.stock, e.fuel, -fuel * ok);
    add(used, e.fuel, fuel * ok);
    if (water) {
      add(s.stock, 'water', -water * ok);
      add(used, 'water', water * ok);
    }
    cap += take * ok;
  }
  s.carried = need > 0 ? Math.min(1, cap / need) : 1;
  s.haul = need / DT;
  const arrive = 1 - HAUL_SHARE + HAUL_SHARE * s.carried;
  // engines take on their own fuel where it is made, so fuel never waits for a train
  const fuels = new Set(['water', ...ENGINES.map((e) => e.fuel)]);
  for (const [c, n] of Object.entries(out)) add(s.stock, c, n * (fuels.has(c) ? 1 : arrive));

  // needs and the town market
  let income = 0;
  let allOk = true;
  for (const n of NEEDS) {
    if (n.age > s.age) continue;
    const want = needDemand(s, n) * DT;
    if (want <= 0) continue;
    const have = Math.max(0, get(s.stock, n.cargo));
    const got = Math.min(have, want);
    const days = have / ((want / DT) * DAY);
    add(s.stock, n.cargo, -got);
    add(used, n.cargo, got);
    income += got * PRICE[n.cargo] * PRICE_SCALE * priceMul(days);
    s.sat[n.cargo] = got / want;
    if (got / want < NEED_OK) allOk = false;
  }
  const cargos = new Set([...Object.keys(out), ...Object.keys(used)]);
  for (const c of cargos) {
    const net = (get(out, c) * arrive - get(used, c)) / DT;
    s.flow[c] = 0.9 * get(s.flow, c) + 0.1 * net;
  }

  // upkeep
  let upkeep = 0;
  // wages: every filled job and every engine crew is paid the age's wage
  for (const b of s.blds) upkeep += WAGE[s.age] * jobsOf(b) * s.staffing;
  upkeep += WAGE[s.age] * ENGINE_CREW * sum(s.engines);
  s.money += income - upkeep * DT;
  s.income = income / DT;
  s.upkeep = upkeep;

  // growth: houses fill while every need is met
  if (allOk)
    for (let l = 0; l < s.houses.length; l++) {
      const room = s.houses[l] * HOUSE_CAP[l] - s.residents[l];
      if (room > 0) s.residents[l] += Math.min(room, GROWTH * DT * s.houses[l]);
    }

  // ages
  while (
    s.age < AGES.length - 1 &&
    allOk &&
    popAtLeast(s, AGE_GOALS[s.age + 1].level) >= AGE_GOALS[s.age + 1].pop
  ) {
    s.age++;
    const kinds: Res = {};
    for (const b of s.blds) add(kinds, b.def.id, 1);
    s.log.push(
      `${s.t.toFixed(0)} min: ${AGES[s.age]} (pop ${pop(s).toFixed(0)}, money ${s.money.toFixed(0)}, engines ${sum(s.engines)}, houses ${sum(s.houses)}) ${JSON.stringify(kinds)}`,
    );
  }

  player(s);
  s.t += DT;
}

// ---- The reference player: plans by capacity, the way an Anno player reads chain ratios ----

function ready(s: State, key: string, wait: number) {
  if (get(s.cool, key) > s.t) return false;
  s.cool[key] = s.t + wait;
  return true;
}

/** build one more of a kind: upgrade the lowest one if the age allows, else a new one */
function build(s: State, d: Def): boolean {
  if (d.age > s.age) return false;
  const low = s.blds
    .filter((b) => b.def === d && b.level < maxLevel(s, d))
    .sort((a, b) => a.level - b.level)[0];
  if (low) {
    const c: Res = {};
    for (const [k, n] of Object.entries(d.cost)) c[k] = Math.ceil(n * low.level * UPGRADE_MUL);
    if (can(s, c)) {
      pay(s, c);
      low.level++;
      return true;
    }
  }
  if (s.blds.length + sum(s.houses) / 4 >= s.chunks * CHUNK_SLOTS) {
    const price = chunkCost(s.chunks + 1);
    if (s.money < price) return false;
    s.money -= price;
    s.chunks++;
  }
  // a deposit site needs fresh ground: worked-out sites keep theirs, so new land must be bought
  if (d.reserve !== undefined && s.sitesUsed >= s.chunks * SITES_PER_CHUNK) {
    const price = chunkCost(s.chunks + 1);
    if (s.money < price) return false;
    s.money -= price;
    s.chunks++;
  }
  if (!can(s, d.cost)) return short(s, d.cost);
  if (d.reserve !== undefined) s.sitesUsed++;
  pay(s, d.cost);
  s.blds.push({ def: d, level: 1, left: d.reserve ?? Infinity });
  return true;
}

/** a build lacked materials: ask for more of each missing one for a while */
function short(s: State, c: Res) {
  for (const [k, n] of Object.entries(c))
    if (get(s.stock, k) < n) s.lack[k] = Math.min(20, get(s.lack, k) + 3);
  return false;
}

/** units a minute the buildings can make of a cargo at full staff */
function capacity(s: State, cargo: string) {
  let r = 0;
  for (const b of s.blds) if (b.def.out[cargo]) r += b.def.out[cargo] * outMul(b);
  return r;
}

/** units a minute wanted of a cargo: needs with growth room, fuel, works inputs, building */
function demand(s: State, cargo: string) {
  let d = get(s.lack, cargo) + get(BUILD_RATE, cargo) * (1 + s.age);
  for (const n of NEEDS) if (n.cargo === cargo && n.age <= s.age) d += needDemand(s, n, 0.25);
  for (let a = 0; a < ENGINES.length; a++) {
    const f = FUEL_SHARE * s.engines[a] * ENGINES[a].haul * 0.8;
    if (ENGINES[a].fuel === cargo) d += f;
    if (cargo === 'water' && a === 0) d += f * STEAM_WATER;
  }
  for (const b of s.blds) if (b.def.in?.[cargo]) d += b.def.in[cargo] * outMul(b);
  // houses waiting to level up: their materials, spread over an hour
  for (let l = 1; l <= Math.min(s.age, HOUSE_CAP.length - 1); l++)
    d += (get(HOUSE_COST[l], cargo) * s.houses[l - 1]) / 60;
  // the next house level's need, so houses can move up as soon as the age allows
  for (const n of NEEDS)
    if (n.cargo === cargo && n.age === s.age && n.age > 0 && popAtLeast(s, n.age + 1) === 0)
      d += n.perMin * HOUSE_CAP[n.age] * 2;
  return d;
}

/** building materials the player spends a minute while it expands, times (1 + age) */
const BUILD_RATE: Res = { wood: 3, stone: 3, iron: 1 };

const PLAN_ORDER = [
  'food',
  'coal',
  'water',
  'goods',
  'diesel',
  'power',
  'electronics',
  'plastics',
  'luxury',
  'wood',
  'stone',
  'iron',
  'wheat',
  'iron_ore',
  'crude',
  'copper_ore',
  'wire',
];

function player(s: State) {
  for (const k of Object.keys(s.lack)) s.lack[k] = Math.max(0, s.lack[k] - 0.05 * DT);

  // 1. chains: every cargo made at least as fast as it is wanted (one build a cargo a minute)
  for (const c of PLAN_ORDER) {
    const d = makerOf(s, c);
    if (!d || d.age > s.age) continue;
    const want = demand(s, c);
    if (
      want > 0 &&
      capacity(s, c) < want * (d.season ? 1.3 : 1.05) &&
      get(s.stock, c) < 0.5 * STORE_CAP &&
      ready(s, 'plan:' + c, 1)
    )
      build(s, d);
  }

  // 2. more houses when the network is short-staffed or the town is nearly full
  const room = sum(s.houses.map((h, l) => h * HOUSE_CAP[l])) - pop(s);
  const below = s.houses.slice(0, Math.min(s.age, HOUSE_CAP.length - 1)).some((h) => h > 0);
  if ((s.staffing < 0.98 || (room < 0.15 * pop(s) && !below)) && ready(s, 'house', 1)) {
    if (can(s, HOUSE_COST[0])) {
      pay(s, HOUSE_COST[0]);
      s.houses[0]++;
      s.residents[0] += START_RESIDENTS;
    } else short(s, HOUSE_COST[0]);
  }

  // 3. level houses up while the needs of the next level are met
  for (let l = Math.min(s.age, HOUSE_CAP.length - 1); l >= 1; l--) {
    const ok = NEEDS.filter((n) => n.age <= l).every((n) =>
      n.age === l
        ? get(s.stock, n.cargo) > n.perMin * HOUSE_CAP[l] * DAY
        : get(s.sat, n.cargo) >= NEED_OK,
    );
    if (!ok || !s.houses[l - 1] || !ready(s, 'level:' + l, 0.5)) continue;
    if (can(s, HOUSE_COST[l])) {
      pay(s, HOUSE_COST[l]);
      s.houses[l - 1]--;
      s.houses[l]++;
      const moved = Math.min(s.residents[l - 1], HOUSE_CAP[l - 1]);
      s.residents[l - 1] -= moved;
      s.residents[l] += moved;
    } else short(s, HOUSE_COST[l]);
  }

  // 4. trains: carry everything; newer engines replace older ones
  if (s.carried < 0.97 && ready(s, 'engine', 1)) {
    // the newest engine it can build now, else an older one; the newest one's lack is noted
    const a = [...Array(s.age + 1).keys()].reverse().find((i) => can(s, ENGINES[i].cost));
    if (a !== s.age) short(s, ENGINES[s.age].cost);
    if (a !== undefined) {
      pay(s, ENGINES[a].cost);
      s.engines[a]++;
    }
  }
  for (let a = 0; a < s.age; a++)
    if (s.engines[a] && s.engines[s.age] * ENGINES[s.age].haul > s.haul * 1.1) {
      s.engines[a]--;
      break;
    }
}

// ---------------------------------------------------------------------------------------------

function run(hours: number) {
  const s: State = {
    t: 0,
    age: 0,
    money: START_MONEY,
    stock: { ...START_STOCK },
    flow: {},
    houses: [2, 0, 0, 0, 0, 0],
    residents: [2 * START_RESIDENTS, 0, 0, 0, 0, 0],
    blds: [],
    engines: [3, 0, 0, 0, 0, 0],
    chunks: 1,
    sitesUsed: 0,
    log: [],
    sat: {},
    cool: {},
    lack: {},
    carried: 1,
    haul: 0,
    staffing: 0,
    income: 0,
    upkeep: 0,
  };
  const series: Record<string, number>[] = [];
  for (let i = 0; s.t < hours * 60; i++) {
    step(s);
    if (i % 10 === 0)
      series.push({
        t: +s.t.toFixed(1),
        age: s.age,
        pop: Math.round(pop(s)),
        money: Math.round(s.money),
        incomePerHour: Math.round(s.income * 60),
        upkeepPerHour: Math.round(s.upkeep * 60),
        buildings: s.blds.length,
        engines: sum(s.engines),
        staffing: +s.staffing.toFixed(2),
        carried: +s.carried.toFixed(2),
      });
  }
  return { s, series };
}

const { s, series } = run(Number(process.env.HOURS ?? 12));
const counts: Res = {};
for (const b of s.blds) add(counts, `${b.def.id} L${b.level}`, 1);
console.log('Ages reached:\n  ' + s.log.join('\n  '));
console.log(
  `End: pop ${pop(s).toFixed(0)}, money ${s.money.toFixed(0)}, chunks ${s.chunks}, engines ${s.engines.join('/')}`,
);
console.log('Houses by level: ' + s.houses.join('/'));
console.log('Buildings: ' + JSON.stringify(counts));
const r = (o: Res) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  );
console.log('Stock: ' + r(s.stock));
console.log(
  `staffing ${s.staffing.toFixed(2)}, carried ${s.carried.toFixed(2)}, satisfied ${r(s.sat)}`,
);
console.log('Per age: from-to min | pop at end | income/h | upkeep/h | upkeep share');
for (let a = 0; a < AGES.length; a++) {
  const rows = series.filter((p) => p.age === a);
  if (!rows.length) continue;
  const avg = (k: string) => sum(rows.map((p) => p[k])) / rows.length;
  const inc = avg('incomePerHour');
  const upk = avg('upkeepPerHour');
  console.log(
    `  ${AGES[a].padEnd(9)} ${rows[0].t.toFixed(0).padStart(4)}-${rows.at(-1)!.t.toFixed(0).padStart(4)} | ${String(rows.at(-1)!.pop).padStart(5)} | ${inc.toFixed(0).padStart(8)} | ${upk.toFixed(0).padStart(7)} | ${((100 * upk) / inc).toFixed(0)} %`,
  );
}
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0)
  (await import('node:fs')).writeFileSync(
    process.argv[jsonAt + 1],
    JSON.stringify({ log: s.log, series }, null, 1),
  );
