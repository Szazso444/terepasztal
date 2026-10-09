/**
 * The upgrade halo as a pure function of time: a golden ring rises from the ground around the
 * building, a column of light stands up through it and a few sparks drift upwards. `Halos` in
 * `halo.ts` draws one frame of it; nothing here knows about Pixi or about pixels.
 */

/** How long the halo plays, in real seconds, at every game speed. */
export const HALO_SECONDS = 1.6;

export interface HaloFrame {
  /**
   * The ring lying around the footprint: `rise` above the ground in shares of the building's
   * height, `scale` its width in shares of the footprint's.
   */
  ring: { rise: number; scale: number; alpha: number };
  /** The column of light standing on the footprint: `height` in shares of the building's height. */
  beam: { height: number; alpha: number };
  /**
   * Offsets from the footprint's centre on screen (y down, like the screen), in shares of the
   * footprint's width. The list is always `SPARKS` long; a spark not alive has alpha 0.
   */
  sparks: { x: number; y: number; alpha: number }[];
  /** True once the halo has played out; nothing shows from then on. */
  done: boolean;
}

/** How many sparks a full halo throws; a smaller one may draw only the first few. */
export const SPARKS = 8;

/** The ring stops at the roof line. */
const RING_TOP = 1;
/** The ring starts a little wider than the footprint and closes in as it rises. */
const RING_WIDE = 1.15;
const RING_NARROW = 0.85;
/** Share of the halo it takes the ring to flare to full light. */
const RING_FLARE = 0.15;
/** The beam stands up to this many building heights. */
const BEAM_TOP = 1.8;
const BEAM_PEAK = 0.75;

/** Ease in and out: slow off the ground, fast through the middle, slow at the top. */
function smooth(u: number) {
  return u * u * (3 - 2 * u);
}
/** Ease out: fast at first, settling at the end. */
function settle(u: number) {
  return 1 - (1 - u) * (1 - u);
}
function frac(v: number) {
  return v - Math.floor(v);
}

interface Spark {
  /** when it appears and how long it lives, in shares of the halo */
  birth: number;
  life: number;
  x0: number;
  y0: number;
  /** how far it drifts sideways and climbs over its life, in shares of the footprint's width */
  drift: number;
  climb: number;
  phase: number;
}

/**
 * The sparks, spread by low-discrepancy sequences rather than a random stream so every halo is
 * the same and the function stays pure. Each starts on an ellipse inscribed in the footprint's
 * diamond (half-diagonals 1/2 and 1/4 of its width), so it is inside the footprint at birth.
 */
const SPARK_TABLE: readonly Spark[] = Array.from({ length: SPARKS }, (_, i) => {
  const a = frac((i + 1) * 0.6180339887);
  const b = frac((i + 1) * 0.7548776662);
  const c = frac((i + 1) * 0.569840291);
  const angle = (i / SPARKS) * Math.PI * 2 + a * 0.5;
  const r = (0.55 + 0.4 * b) / Math.SQRT2;
  return {
    birth: 0.06 + 0.42 * a,
    life: 0.38 + 0.12 * b,
    x0: 0.5 * r * Math.cos(angle),
    y0: 0.25 * r * Math.sin(angle),
    drift: (a - 0.5) * 0.12,
    climb: 0.55 + 0.45 * c,
    phase: c * Math.PI * 2,
  };
});

/** The halo `t` real seconds after it started. Pure: the same `t` always gives the same frame. */
export function haloAt(t: number): HaloFrame {
  const done = t >= HALO_SECONDS;
  const k = done ? 1 : Math.max(0, t / HALO_SECONDS);
  const lift = smooth(k);
  const ringAlpha = done
    ? 0
    : k < RING_FLARE
      ? k / RING_FLARE
      : Math.pow((1 - k) / (1 - RING_FLARE), 1.5);
  const sparks = SPARK_TABLE.map((s) => {
    const u = Math.min(1, Math.max(0, (k - s.birth) / s.life));
    const e = settle(u);
    const alive = !done && u > 0 && u < 1;
    // a twinkle on a soft rise and fall, never below 0.4 of the envelope
    const alpha = alive
      ? Math.sin(Math.PI * u) * (0.7 + 0.3 * Math.cos(u * 6 * Math.PI + s.phase))
      : 0;
    return { x: s.x0 + s.drift * e, y: s.y0 - s.climb * e, alpha };
  });
  return {
    ring: {
      rise: RING_TOP * lift,
      scale: RING_WIDE + (RING_NARROW - RING_WIDE) * lift,
      alpha: ringAlpha,
    },
    beam: {
      height: BEAM_TOP * settle(k),
      alpha: done ? 0 : BEAM_PEAK * Math.sin(Math.PI * k) ** 2,
    },
    sparks,
    done,
  };
}
