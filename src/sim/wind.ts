/**
 * Wind: the game's own weather, with no player setting. A pure function of the world seed, the game
 * time and (for the rain and fog it goes with) how much of each shows. It holds no
 * state and writes nothing to the save: `Weather` (weather.ts) evaluates it once per tick and
 * keeps the result in `weather.wind` for the renderers, and anything that wants the wind at some
 * other time calls `windAt` itself.
 *
 * The levels are calm, breeze, windy and storm; lighter ones are commoner (`WIND_WEIGHTS`). On top
 * of the level there is a continuous `strength` (0..1), a `gust` that flutters around it, and a
 * `fromRad` heading that drifts slowly. Nothing steps between ticks.
 *
 * How it is built:
 * - The base wind is value noise in time: a hashed uniform number per lattice point, smoothstep
 *   interpolated, one point every `STRENGTH_SPAN_DAYS`. Interpolated uniforms are not uniform, so
 *   the value goes through its own distribution function (`baseQuantile`, tabulated once) to get a
 *   quantile `q` that is uniform on 0..1 for any seed. A piecewise-linear map of `q` to strength
 *   then fixes how long each level lasts, in `BASE_WEIGHTS`.
 * - Rain multiplies the odds of the windier levels (it adds `RAIN_PUSH` times how much rain shows to
 *   the log-odds of `q`) and fog divides them (`FOG_PUSH`); `Weather` eases both amounts, so the
 *   wind follows the rain in and out. So a storm is most often a rainy day, but dry windy days
 *   and calm rain both happen. `BASE_WEIGHTS` are the dry mix, set so that with the weather
 *   running at its default odds the long-run mix is `WIND_WEIGHTS`.
 * - Direction is a prevailing heading from the seed plus a slow wander.
 *
 * Headings are compass headings of where the wind blows FROM, in radians clockwise from the top
 * of the screen at view rotation 0 (0 = north = screen up, pi/2 = east = screen right). `dir` is
 * the unit vector it blows along on the screen, `tile` the same direction in tile space, so the
 * iso projection of `tile` points along `dir`. Renderers that rotate the view rotate both.
 */
import { worldToTile } from '../engine/iso';
import { daySeconds } from './rules';

export const WIND_LEVELS = ['calm', 'breeze', 'windy', 'storm'] as const;
export type WindLevel = (typeof WIND_LEVELS)[number];

/** Share of the time at each level over a long span, weather running with the default odds. */
export const WIND_WEIGHTS: Record<WindLevel, number> = {
  calm: 0.4,
  breeze: 0.35,
  windy: 0.18,
  storm: 0.07,
};

/** Share of the time at each level before rain and fog act on it (they only lean it windier). */
export const BASE_WEIGHTS: Record<WindLevel, number> = {
  calm: 0.46,
  breeze: 0.39,
  windy: 0.12,
  storm: 0.03,
};

/** The strength a level stands for (what a renderer pinned to a level uses). */
export const WIND_LEVEL_STRENGTH: Record<WindLevel, number> = {
  calm: 0,
  breeze: 0.35,
  windy: 0.7,
  storm: 1,
};

/** Strength at which the level changes: halfway between the nominal strengths. */
const LEVEL_BREAKS = [0.175, 0.525, 0.85] as const;

export function windLevelOf(strength: number): WindLevel {
  return strength < LEVEL_BREAKS[0]
    ? 'calm'
    : strength < LEVEL_BREAKS[1]
      ? 'breeze'
      : strength < LEVEL_BREAKS[2]
        ? 'windy'
        : 'storm';
}

/** Days between the lattice points of the base strength, and of the direction's wander. */
export const STRENGTH_SPAN_DAYS = 0.75;
export const DIRECTION_SPAN_DAYS = 2.5;
/** How far (radians, either way) the heading wanders from the prevailing one. */
export const DIRECTION_WANDER = 1;
/** Log-odds added to the base quantile by rain showing fully: rain at 1 makes the odds e^3 times. */
export const RAIN_PUSH = 3;
/** Log-odds taken off by fog showing fully. */
export const FOG_PUSH = 1;
/** Gust flutter, in game seconds per cycle: two sines that do not line up. */
const GUST_PERIODS = [7.3, 3.1] as const;

/** How much rain and fog show, each 0..1 and eased by `Weather`, so the wind follows them in and out. */
export interface WindWeather {
  readonly rain: number;
  readonly fog: number;
}

export interface WindState {
  level: WindLevel;
  /** 0..1, continuous; the level is a band of it */
  strength: number;
  /** 0..1, strength with a flutter of about -20% to +30% on it (0 when calm); varies in seconds */
  gust: number;
  /** compass heading the wind blows from, [0, 2 pi) */
  fromRad: number;
  /** unit vector the wind blows along, on the screen at view rotation 0 (y grows down) */
  dir: { x: number; y: number };
  /** the same direction in tile space, unit length */
  tile: { x: number; y: number };
}

// --- hashing --------------------------------------------------------------------------------

/** Seed of a world's wind from any integer the world is known by (Weather uses its RNG's start). */
export function windSeedOf(n: number): number {
  return mix(n >>> 0, 0x57494e44, 0);
}

/** Integer mixer: well spread over 32 bits for small changes in any argument. */
function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35), 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15) ^ Math.imul(c, 0x165667b1), 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Uniform [0, 1) from (seed, channel, lattice index). */
function lattice(seed: number, channel: number, i: number): number {
  return mix(seed, channel, i + 0x100000) / 4294967296;
}

const smooth = (f: number) => f * f * (3 - 2 * f);

/** Smoothstep value noise: uniform lattice values joined by smoothstep ramps, in [0, 1]. */
function valueNoise(seed: number, channel: number, x: number): number {
  const i = Math.floor(x);
  const a = lattice(seed, channel, i);
  const b = lattice(seed, channel, i + 1);
  return a + (b - a) * smooth(x - i);
}

// --- the base distribution ------------------------------------------------------------------

const BINS = 1024;
let cdf: Float64Array | undefined;

/**
 * Distribution function of `valueNoise` (the same for every seed and channel): value = a + (b - a)
 * s(f) for independent uniform a, b, f, tabulated on a fine grid the first time it is needed.
 */
function baseQuantile(v: number): number {
  if (!cdf) {
    const counts = new Float64Array(BINS);
    const N = 96;
    const M = 48;
    let total = 0;
    for (let k = 0; k < M; k++) {
      const s = smooth((k + 0.5) / M);
      for (let i = 0; i < N; i++) {
        const a = (i + 0.5) / N;
        for (let j = 0; j < N; j++) {
          const b = (j + 0.5) / N;
          counts[Math.min(BINS - 1, Math.floor((a + (b - a) * s) * BINS))]++;
          total++;
        }
      }
    }
    cdf = new Float64Array(BINS + 1);
    for (let i = 0; i < BINS; i++) cdf[i + 1] = cdf[i] + counts[i] / total;
  }
  const x = Math.min(Math.max(v, 0), 1) * BINS;
  const i = Math.min(BINS - 1, Math.floor(x));
  return cdf[i] + (cdf[i + 1] - cdf[i]) * (x - i);
}

/** Quantile -> strength, piecewise linear through the base weights' cumulative shares. */
const QUANTILE_KNOTS = (() => {
  let c = 0;
  const q = [0];
  for (const l of WIND_LEVELS.slice(0, 3)) q.push((c += BASE_WEIGHTS[l]));
  q.push(1);
  return q;
})();
const STRENGTH_KNOTS = [0, ...LEVEL_BREAKS, 1];

function strengthOfQuantile(q: number): number {
  const c = Math.min(Math.max(q, 0), 1);
  for (let k = 1; k < QUANTILE_KNOTS.length; k++) {
    if (c <= QUANTILE_KNOTS[k]) {
      const u = (c - QUANTILE_KNOTS[k - 1]) / (QUANTILE_KNOTS[k] - QUANTILE_KNOTS[k - 1]);
      return STRENGTH_KNOTS[k - 1] + (STRENGTH_KNOTS[k] - STRENGTH_KNOTS[k - 1]) * u;
    }
  }
  return 1;
}

// --- the query ------------------------------------------------------------------------------

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The wind at game time `time` (seconds) in the world whose wind seed is `seed`. */
export function windAt(seed: number, time: number, weather?: WindWeather): WindState {
  const t = Math.max(0, time);
  const day = daySeconds();

  let q = baseQuantile(valueNoise(seed, 1, t / (STRENGTH_SPAN_DAYS * day)));
  if (weather) {
    const e = 1e-9;
    const qc = Math.min(Math.max(q, e), 1 - e);
    const logit =
      Math.log(qc / (1 - qc)) + RAIN_PUSH * clamp01(weather.rain) - FOG_PUSH * clamp01(weather.fog);
    q = 1 / (1 + Math.exp(-logit));
  }
  const strength = strengthOfQuantile(q);

  const wave =
    0.5 +
    0.5 *
      (0.6 * Math.sin((2 * Math.PI * t) / GUST_PERIODS[0] + lattice(seed, 2, 0) * 2 * Math.PI) +
        0.4 * Math.sin((2 * Math.PI * t) / GUST_PERIODS[1] + lattice(seed, 3, 0) * 2 * Math.PI));
  const gust = clamp01(strength * (0.8 + 0.5 * wave));

  const tau = 2 * Math.PI;
  const prevailing = lattice(seed, 4, 0) * tau;
  const wander = (valueNoise(seed, 5, t / (DIRECTION_SPAN_DAYS * day)) * 2 - 1) * DIRECTION_WANDER;
  const fromRad = (((prevailing + wander) % tau) + tau) % tau;

  const dir = { x: -Math.sin(fromRad), y: Math.cos(fromRad) };
  // The screen vector, taken back to tile space with the game's own inverse projection.
  const tl = worldToTile(dir.x, dir.y);
  const len = Math.hypot(tl.x, tl.y);
  return {
    level: windLevelOf(strength),
    strength,
    gust,
    fromRad,
    dir,
    tile: { x: tl.x / len, y: tl.y / len },
  };
}
