/**
 * A conifer, drawn rather than rendered.
 *
 *   node art-src/draw/conifer.mjs out.png [seed] [variant]
 *
 * Where the broadleaf is clumps, this is fronds: tiers of needle sprays that leave the trunk,
 * reach out and droop, each tapering to a point. The silhouette is the ends of those sprays, which
 * is why a rendered cone never looks like one -- a cone's edge is a line, and this edge is a few
 * hundred needle tips.
 *
 * Light from the upper left again, and applied the same way: the side of the tree a spray is on
 * picks its band, and how far out along the spray picks the step within it.
 */
import { Buf, Rng } from './pixels.mjs';

const NEEDLE = [
  [132, 152, 92], // sunlit sage, the top edge of a bough
  [88, 118, 74],
  [58, 88, 62],
  [38, 64, 50],
  [24, 44, 38], // the deep shade under a tier
];
const BARK = { lit: [146, 114, 78], mid: [104, 78, 52], dark: [66, 48, 32] };
const OUTLINE = [26, 34, 30];
const BLOCK = 3;

/** variant -> height, base width, how many tiers, how far the sprays droop */
const VARIANTS = [
  { h: 300, w: 186, tiers: 10, droop: 0.95, taper: 0.8 },
  { h: 340, w: 196, tiers: 11, droop: 0.85, taper: 0.86 },
  { h: 268, w: 178, tiers: 9, droop: 1.05, taper: 0.74 },
];

/**
 * One bough: out from the trunk, drooping, with needles hanging off its length.
 *
 * The shading runs down each bough, not across the tree. A conifer's top surfaces catch the sun
 * and its undersides go almost black, and that repeats at every tier -- which is what gives the
 * reference its banded look. Shading left-lit and right-dark instead, as the first attempt did,
 * splits the tree down the trunk and reads as two halves of different trees.
 */
function spray(buf, rng, x0, y0, dir, len, droop, band) {
  const steps = Math.max(5, Math.round(len / (BLOCK * 0.9)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dir * len * t;
    const y = y0 + droop * len * t * t; // the droop is the whole character of a conifer bough
    // the needles thin out toward the tip, and the last few are sparse, which is the silhouette
    // Needles are ticks, not a stack. Each one steps down and outward a few blocks, so the
    // bough's lower edge is a comb of diagonals -- which is the whole texture of a fir, and what
    // stacking blocks straight down cannot give: that reads as a roof tile, and a tier of them
    // as a pagoda.
    if (t > 0.82 && rng.f() > 0.5) continue;
    const ticks = Math.max(2, Math.round((1 - t * 0.5) * len * 0.09)) + 1;
    for (let n = 0; n < ticks; n++) {
      const tickLen = 2 + rng.int(0, 2) + Math.round((1 - t) * 2);
      for (let m = 0; m < tickLen; m++) {
        // down and outward together: the tick leans the way the bough points
        const px = x + dir * m * BLOCK * 0.8;
        const py = y + n * BLOCK * 1.5 + m * BLOCK;
        const step = m === 0 ? (n === 0 ? 0 : 1) : m < tickLen - 1 ? 2 : 3;
        const c = NEEDLE[Math.min(NEEDLE.length - 1, band + step)];
        for (let j = 0; j < BLOCK; j++) for (let k = 0; k < BLOCK; k++) buf.set(px + k, py + j, c);
      }
    }
  }
}

export function conifer(seed = 1, variant = 0) {
  const v = VARIANTS[variant % VARIANTS.length];
  const rng = new Rng(seed);
  const W = Math.ceil(v.w * 2.5);
  const H = v.h + 30;
  const buf = new Buf(W, H);
  const cx = W / 2;
  const base = H - 6;

  // trunk: visible at the foot, hidden by the sprays above, with a root flare like the broadleaf's
  buf.taper(cx, base, cx, base - v.h * 0.96, v.w * 0.055, v.w * 0.012, BARK.mid);
  buf.taper(
    cx - v.w * 0.02,
    base,
    cx - v.w * 0.02,
    base - v.h * 0.5,
    v.w * 0.02,
    v.w * 0.008,
    BARK.lit,
  );
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    buf.taper(
      cx,
      base - rng.r(6, 16),
      cx + side * v.w * rng.r(0.09, 0.2),
      base + rng.r(0, 3),
      v.w * rng.r(0.02, 0.035),
      1.4,
      i % 3 === 0 ? BARK.dark : BARK.mid,
    );
  }

  // tiers from the crown down, each wider than the one above it
  for (let i = 0; i < v.tiers; i++) {
    const t = i / (v.tiers - 1);
    const y = base - v.h * (0.94 - t * 0.86);
    const reach = v.w * 0.5 * Math.pow(t, v.taper) * rng.r(0.9, 1.06) + v.w * 0.04;
    const droop = v.droop * (0.5 + t);
    // One or two boughs a side, not a fan of them: packed any tighter the tiers merge into a
    // solid triangle and the dark gaps between them -- which are most of the silhouette -- close up.
    const perSide = t > 0.45 ? 2 : 1;
    for (const dir of [-1, 1]) {
      // No left-light, right-dark split. Every bough is lit on top and dark underneath, both
      // sides; banding by side instead draws a seam down the trunk and reads as two half-trees.
      const band = 0;
      for (let s = 0; s < perSide; s++) {
        const jitter = rng.r(-0.18, 0.18);
        spray(
          buf,
          rng,
          cx + dir * v.w * 0.01,
          y + s * BLOCK * 3.4 + rng.r(-2, 2),
          dir,
          reach * (1 + jitter) * (1 - s * 0.13),
          droop * rng.r(0.8, 1.2),
          band,
        );
      }
    }
  }
  // a leader above the top tier, so the tree ends in a point
  spray(buf, rng, cx, base - v.h * 0.97, -1, v.w * 0.08, 0.2, 1);
  spray(buf, rng, cx, base - v.h * 0.97, 1, v.w * 0.08, 0.2, 2);

  buf.outline(OUTLINE);
  return buf.trim(1);
}

if (process.argv[1]?.endsWith('conifer.mjs')) {
  const [, , out, seed = '1', variant = '0'] = process.argv;
  if (!out) {
    console.error('usage: node art-src/draw/conifer.mjs <out.png> [seed] [variant]');
    process.exit(2);
  }
  const b = conifer(Number(seed), Number(variant));
  console.log(b.write(out), `${b.w}x${b.h}`);
}
