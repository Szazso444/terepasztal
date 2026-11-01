/**
 * The small signs of life on buildings, as numbers: how fast a windmill's sails turn, where a puff
 * of a chimney's plume is, how far the quarry crane's load swings. Pure functions of the wind
 * (src/sim/wind.ts), with no sprites and no state; `buildingLife.ts` draws them. The constants are
 * the published demo's: v9.1 for the sails and the crane (`app.js`: `MILL_REV`, `millGust`,
 * `craneDraw`), v9.2 "Smoke: Tall" for the plumes (`smokeDrawTall`).
 */

const TAU = 2 * Math.PI;

/**
 * How gusty the wind is at a world point at a time, 0..1: smooth bands of gusts and lulls that
 * travel downwind, so that a sail and a plume at one point feel the same gust at the same moment
 * and two mills do not keep step. It is the gust's shape, not its force: 0 in a calm. The wind's
 * own `gust` flutters the whole map at once; this is what spreads a gust over the map. `dir` is
 * `WindState.dir`.
 */
export function gustAt(
  strength: number,
  dir: { x: number; y: number },
  x: number,
  y: number,
  t: number,
) {
  if (strength <= 0) return 0;
  const u = x * dir.x + y * dir.y - (40 + 200 * strength) * t,
    v = y * dir.x - x * dir.y,
    a = Math.sin(u / 61 + 1.3 * Math.sin(v / 173 + t * 0.21)),
    b = Math.sin(u / 37 + 1.7 + 0.9 * Math.sin(v / 97 - t * 0.17)),
    c = Math.sin(v / 251 + u / 409 + t * 0.05),
    g = 0.5 + 0.27 * a + 0.13 * b + 0.1 * c;
  return g * g * (3 - 2 * g);
}

/** The sails in a mean gust: [wind strength, turns a second]. */
const MILL_REV = [
  [0, 0],
  [0.35, 0.1],
  [0.7, 0.17],
  [1, 0.24],
] as const;

/** The sails' turns a second at wind strength `s` with no gust in it: 0 when calm. */
export function millSpeed(s: number) {
  for (let i = 1; i < MILL_REV.length; i++)
    if (s <= MILL_REV[i][0]) {
      const [s0, r0] = MILL_REV[i - 1],
        [s1, r1] = MILL_REV[i];
      return r0 + ((r1 - r0) * (Math.max(s, s0) - s0)) / (s1 - s0);
    }
  return MILL_REV[MILL_REV.length - 1][1];
}
/** What a gust does to the sails' speed: 0.65 in a deep lull to 1.35 in the strongest gust. */
export const millGust = (gust: number) => 0.65 + 0.7 * gust;
/** The sails' turns a second at wind strength `s` and the gust at the hub. */
export const millRev = (s: number, gust: number) => millSpeed(s) * millGust(gust);
/** The sails' angle `dt` seconds on at `rev` turns a second, in [0, 2 pi). */
export function millPhase(phase: number, rev: number, dt: number) {
  const next = (phase + TAU * rev * dt) % TAU;
  return next < 0 ? next + TAU : next;
}
/** `value` eased toward `target` over `dt` seconds with the time constant `tau`. */
export const ease = (value: number, target: number, dt: number, tau: number) =>
  value + (target - value) * (1 - Math.exp(-dt / tau));

/** A plume is this many puffs overlapping into one column, and one pinned at the pot's mouth. */
export const PLUME_PUFFS = 16;
/** Of the house chimneys about this share is lit, the author's pick; a works chimney always smokes. */
export const PLUME_LIT = 2 / 3;

export interface PuffShape {
  /** world px up from the pot */
  rise: number;
  /** world px downwind from the pot */
  drift: number;
  /** radius in world px, before the wind draws it out */
  radius: number;
  /** how far the wind draws it out along itself: 1 is round */
  stretch: number;
  /** how flat the wind presses it across itself: 1 is round */
  flat: number;
  /** 0 at the very start and end of its life */
  alpha: number;
}

/** A plume's seconds from the pot to gone at strength `s`; `rate` is its own pace, about 1. */
export const plumeLife = (s: number, work: boolean, rate = 1) =>
  ((work ? 8.5 : 9.5) * (1 - 0.3 * s)) / rate;

/** A pinned puff's opacity: it hides where each new puff fades in, at the pot's mouth. */
export const pinnedAlpha = (s: number, work: boolean) =>
  (work ? 0.95 : 0.88) * 0.8 * 0.9 * (1 - 0.1 * s);

/**
 * A puff `age` of its life (0..1) up a plume, at wind strength `s` and gust `gust`. It climbs about
 * 2.7 storeys in a calm and less the harder it blows, bends downwind more with height, spreads and
 * fades as it climbs, and in a hard wind it is drawn out into a streak.
 */
export function plumePuff(age: number, s: number, gust: number, work = false): PuffShape {
  const height = (work ? 48 : 42) * (1 - 0.7 * s * s),
    opacity = (work ? 0.95 : 0.88) * 0.8;
  return {
    rise: height * (0.8 * age + 0.2 * (1 - (1 - age) * (1 - age))),
    drift: s * (12 + 38 * s) * (0.7 + 0.6 * gust) * Math.pow(age, 1.7),
    radius: (work ? 1.7 : 1.5) + (work ? 4.6 : 4.2) * Math.pow(age, 0.7) * (1 + 0.4 * s),
    stretch: 1 + 1.7 * s * s * Math.min(1, age * 3),
    flat: 1 - 0.3 * s,
    alpha: opacity * Math.min(1, age * PLUME_PUFFS) * Math.pow(1 - age, 0.85) * (1 - 0.1 * s),
  };
}

/**
 * The angle (radians, toward +x at the load) the crane's load hangs at from its pivot: a lean
 * downwind, a gust's push and the pendulum's own swing of about 2.6 s. Still in a calm. `windX` is
 * the wind's direction across the screen, -1..1.
 */
export const cranePhase = (t: number, s: number, gust: number, windX = 1) =>
  windX * s * (0.05 + 0.07 * gust) + s * (0.02 + 0.03 * gust) * Math.sin(t * 2.42 + 0.7);

/**
 * How each plant sways: [amplitude, turns a second]. Conifers are stiff and quick, birches the
 * loosest, the broadleaves between them, a palm loose and slow; a dead tree barely moves.
 */
export const TREE_SWAY: Readonly<Record<string, readonly [number, number]>> = {
  oak: [0.8, 0.42],
  tree: [0.9, 0.48],
  birch: [1.15, 0.58],
  pine: [0.7, 0.66],
  spruce: [0.62, 0.72],
  palm: [1, 0.36],
  deadtree: [0.25, 0.9],
  mangrove: [0.62, 0.6],
  willow: [0.85, 0.42],
  reeds: [2.2, 0.95],
};

/** One tree's own swing: its amplitude, its angular speed and its phase. */
export interface TreeMotion {
  amp: number;
  om: number;
  ph: number;
}

/**
 * How far a tree's top leans downwind at time `t`, a share of its height: a steady lean that grows
 * in a gust, and its own swing about that, of two partials so that it never quite repeats, wider
 * in a gust. A breeze moves the top about a world px either way; a storm leans it about a tenth of
 * its height in the strongest gusts. Nothing in a calm.
 */
export function treeLean(tree: TreeMotion, s: number, gust: number, t: number) {
  if (s <= 0) return 0;
  const osc = Math.sin(t * tree.om + tree.ph) + 0.3 * Math.sin(t * tree.om * 1.83 + tree.ph * 1.7);
  return tree.amp * (s * (0.025 + 0.045 * gust) + (0.011 + 0.026 * s) * (0.4 + 0.6 * gust) * osc);
}

/** A lot in [0, 1) that stays the same for the same three numbers. */
export function lot(a: number, b: number, c: number) {
  const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
