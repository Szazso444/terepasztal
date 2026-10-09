import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { hash2 } from '../engine/rng';
import { mix, PAL, type RGB } from './palette';
import { PixelBuf } from './pixels';

/** Additive lantern glow: dithered radial falloff, slightly squashed to sit on the ground. */
function glow(w: number, h: number, seed: number): PixelBuf {
  const b = new PixelBuf(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - w / 2) / (w / 2);
      const ny = (y + 0.5 - h / 2) / (h / 2);
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d);
      // ordered dither so the falloff reads as painted rather than smooth
      const n = hash2(x >> 1, y >> 1, seed);
      const a = Math.round(Math.min(255, f * 255 * (0.8 + n * 0.4)));
      if (a < 8) continue;
      b.set(x, y, PAL.amber, a);
    }
  return b;
}

function smoke(r: number, seed: number): PixelBuf {
  const s = r * 2 + 2;
  const b = new PixelBuf(s, s);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const nx = (x + 0.5 - s / 2) / r;
      const ny = (y + 0.5 - s / 2) / r;
      const d = Math.sqrt(nx * nx + ny * ny) + (hash2(x, y, seed) - 0.5) * 0.35;
      if (d >= 1) continue;
      const shade = 170 + Math.floor(hash2(x >> 1, y >> 1, seed + 3) * 44) - (ny > 0 ? 34 : 0);
      b.set(x, y, [shade + 6, shade + 2, shade - 8], d > 0.8 ? 90 : 170);
    }
  return b;
}

/** Diagonal rain streak. */
function rainDrop(): PixelBuf {
  const b = new PixelBuf(4, 10);
  for (let i = 0; i < 9; i++) b.set(3 - Math.floor(i / 3), i, [186, 212, 216], i < 2 ? 70 : 130);
  return b;
}

/** Soft fog blob, dithered, used in a drifting layer. */
function fogPatch(seed: number): PixelBuf {
  const s = 96;
  const b = new PixelBuf(s, s / 2);
  for (let y = 0; y < s / 2; y++)
    for (let x = 0; x < s; x++) {
      const nx = (x + 0.5 - s / 2) / (s / 2);
      const ny = (y + 0.5 - s / 4) / (s / 4);
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d >= 1) continue;
      const n = hash2(x >> 2, y >> 1, seed);
      const a = Math.round((1 - d) * (1 - d) * 120 * (0.7 + n * 0.6));
      if (a < 6) continue;
      b.set(x, y, [198, 208, 204], Math.min(255, a));
    }
  return b;
}

/** Ground light: diamond-shaped additive patch for per-tile lighting near lanterns. */
function lightDiamond(): PixelBuf {
  const b = new PixelBuf(64, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) {
      const e = Math.abs(x + 0.5 - 32) / 32 + Math.abs(y + 0.5 - 16) / 16;
      if (e > 1) continue;
      const n = hash2(x >> 1, y >> 1, 77);
      const a = Math.round((1 - e) * 110 * (0.8 + n * 0.4));
      if (a < 4) continue;
      b.set(x, y, PAL.amber, a);
    }
  return b;
}

/*
 * The upgrade halo: a ring, a beam and sparks, drawn as light on transparent for additive
 * blending, so they carry no contour and no ground shadow. Warm gold is the amber accent touched
 * with brass; the hot core is amber run halfway to the cream white. Each frame is mirror-symmetric
 * about its anchor's vertical, so trimming the transparent margin never moves the anchor.
 */
const HALO_GOLD = mix(PAL.amber, PAL.brass, 0.3);
const HALO_HOT = mix(PAL.amber, PAL.white, 0.55);

/**
 * Golden ring lying on the ground, one tile across in the 2:1 projection: a thin hot core in a
 * soft band. The near arc burns a little brighter than the far one, so the ring reads as flat on
 * the ground rather than as an upright hoop, and eight faint beads give the gold some sparkle.
 */
function haloRing(): PixelBuf {
  const w = 64;
  const h = 32;
  const b = new PixelBuf(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - w / 2) / (w / 2);
      const ny = (y + 0.5 - h / 2) / (h / 2);
      const d = Math.sqrt(nx * nx + ny * ny);
      const off = Math.abs(d - 0.8);
      if (off >= 0.2) continue;
      const core = Math.max(0, 1 - off / 0.08);
      const band = Math.max(core, (1 - off / 0.2) ** 2 * 0.6);
      // the ink is decided before the shading so the far arc keeps the same extent as the near
      if (band * 255 < 6) continue;
      const near = 0.82 + 0.18 * Math.max(-1, Math.min(1, ny / 0.8));
      const bead = 0.9 + 0.1 * Math.cos(8 * Math.atan2(ny, nx));
      const a = Math.round(Math.min(255, band * near * bead * 255));
      b.set(x, y, mix(HALO_GOLD, HALO_HOT, core * near), Math.max(4, a));
    }
  return b;
}

/**
 * Column of light standing on the ground: a soft hot core with gold edges, brightest just above
 * its foot and fading to nothing at the top so it can be stretched to any height. The foot follows
 * the near arc of a 2:1 base, lowest at the centre, and fades in over a few pixels rather than
 * ending in a hard line; faint paired streaks keep the light moving upwards.
 */
function haloBeam(): PixelBuf {
  const w = 40;
  const h = 80;
  const b = new PixelBuf(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - w / 2) / (w / 2);
      const across = (1 - nx * nx) ** 2;
      const core = Math.max(0, 1 - Math.abs(nx) / 0.35);
      const up = (h - 1 - y) / (h - 1);
      // how far the base's near arc stands above the frame's bottom at this column
      const arc = (w / 4) * (1 - Math.sqrt(Math.max(0, 1 - nx * nx)));
      const foot = Math.max(0, Math.min(1, (h - y - arc) / 5));
      const along = (1 - up) ** 1.6 * foot;
      if (across * along * 255 < 6) continue;
      // streaks by mirrored column pairs, so both halves of the beam match
      const streak = 0.88 + 0.24 * hash2(Math.floor(Math.abs(nx) * 10), 0, 95);
      const a = Math.round(Math.min(255, across * along * streak * 230));
      b.set(x, y, mix(HALO_GOLD, HALO_HOT, core), Math.max(4, a));
    }
  return b;
}

/** Spark: a four-pointed star of a few pixels, white-gold at the heart, on a 7x7 grid. */
function spark(): PixelBuf {
  const b = new PixelBuf(7, 7);
  const c = 3;
  const arm: [RGB, number][] = [
    [HALO_HOT, 255],
    [mix(HALO_HOT, HALO_GOLD, 0.4), 210],
    [HALO_GOLD, 140],
    [HALO_GOLD, 60],
  ];
  for (let i = 3; i >= 0; i--) {
    const [col, a] = arm[i];
    b.set(c - i, c, col, a);
    b.set(c + i, c, col, a);
    b.set(c, c - i, col, a);
    b.set(c, c + i, col, a);
  }
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.set(c + dx, c + dy, HALO_GOLD, 90);
  return b;
}

export function generateFxAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  const rd = rainDrop();
  ab.add('fx/rain', rd.toImageData(), 2, 9);
  for (let i = 0; i < 3; i++) {
    const fp = fogPatch(20 + i);
    ab.add(`fx/fog_${i}`, fp.toImageData(), fp.w / 2, fp.h / 2);
  }
  ab.add('fx/light_tile', lightDiamond().toImageData(), 32, 16);
  const g = glow(64, 40, 1);
  ab.add('fx/glow', g.toImageData(), 32, 20);
  const gs = glow(28, 18, 2);
  ab.add('fx/glow_small', gs.toImageData(), 14, 9);
  for (let i = 0; i < 3; i++) {
    const p = smoke(3 + i * 2, 10 + i);
    ab.add(`fx/smoke_${i}`, p.toImageData(), p.w / 2, p.h / 2);
  }
  // the upgrade halo: ring and spark at their centres, the beam at its foot
  const ring = haloRing();
  ab.add('fx/halo_ring', ring.toImageData(), ring.w / 2, ring.h / 2);
  const beam = haloBeam();
  ab.add('fx/halo_beam', beam.toImageData(), beam.w / 2, beam.h);
  const sp = spark();
  ab.add('fx/spark', sp.toImageData(), sp.w / 2, sp.h / 2);
  return ab.build(256);
}
