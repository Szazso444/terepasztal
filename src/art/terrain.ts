import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { TILE_W, TILE_H, HALF_W, HALF_H, ELEV_PX, ART_SCALE } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { PAL, mix, shade, type RGB } from './palette';
import { PixelBuf, inDiamond, pickShade } from './pixels';

/**
 * Scale a base (ART_SCALE 1) pixel literal to the current art scale. TILE_W/TILE_H/HALF_W/HALF_H/
 * ELEV_PX already carry the scale, so the tile canvas, diamonds and anchors are NOT wrapped here;
 * only the raw literal sizes of surface detail (radii, insets, offsets, feature widths) pass
 * through S so they stay proportional to the now-larger tile.
 */
const S = (n: number) => n * ART_SCALE;

/** Per-pixel decorator hook for ground tiles: return a colour to override the dithered base. */
type Deco = (x: number, y: number, c: RGB) => RGB | null;

/**
 * Flat diamond ground tile: broad quiet patches from `pickShade`, a few short tufts, no rim.
 * Neighbouring tiles share the same generator so patches continue across the seam.
 */
function groundTile(shades: RGB[], seed: number, tufts = 0.006, deco?: Deco): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      let c = pickShade(x, y, shades, seed);
      // tufts: single pixels, close to the base colour, so ground reads as texture not pattern
      const t = hash2(x, y, seed + 41);
      if (t > 1 - tufts) c = shade(shades[3] ?? shades[1], 1.04);
      else if (t < tufts * 0.6) c = shade(shades[2], 0.94);
      if (deco) c = deco(x, y, c) ?? c;
      b.set(x, y, c);
    }
  return b;
}

// biome ground palettes (kept local: they are only used by the tile generators)
const PLAINS: RGB[] = [
  [128, 148, 74],
  [140, 160, 82],
  [116, 134, 66],
  [152, 172, 92],
];
const TAIGA: RGB[] = [
  [92, 122, 92],
  [104, 134, 100],
  [80, 108, 82],
  [116, 146, 110],
];
const LICHEN: RGB[] = [
  [150, 164, 138],
  [164, 176, 150],
];
const SWAMP: RGB[] = [
  [96, 108, 58],
  [108, 120, 66],
  [82, 94, 50],
  [118, 130, 74],
];
const PEAT: RGB = [70, 76, 42];
const POOL: RGB[] = [
  [86, 138, 138],
  [100, 152, 150],
  [72, 120, 124],
];
const DESERT: RGB[] = [
  [216, 196, 146],
  [226, 208, 160],
  [204, 184, 134],
  [234, 218, 172],
];
const WARM_ROCK: RGB[] = [
  [186, 156, 112],
  [204, 174, 128],
  [160, 132, 92],
];
const EARTH: RGB[] = [
  [154, 128, 86],
  [166, 140, 96],
  [138, 114, 76],
  [178, 152, 108],
];
const FLOWER_DOTS: RGB[] = [
  [238, 232, 208],
  [232, 196, 92],
  [208, 104, 96],
  [172, 136, 196],
];
const SNOW: RGB = [232, 236, 232];
const SNOW_SHADE: RGB = [196, 206, 208];

/** Warm meadow with the occasional tiny wildflower cluster; large open patches stay quiet. */
function plainsTile(seed: number): PixelBuf {
  return groundTile(PLAINS, seed, 0.004, (x, y) => {
    // one cluster centre per 16x8 cell in a few cells only; blooms sit within 2px of it
    const cx = x >> 4;
    const cy = y >> 3;
    if (hash2(cx, cy, seed + 71) < 0.965) return null;
    const ox = (cx << 4) + 4 + Math.floor(hash2(cx, cy, seed + 72) * 8);
    const oy = (cy << 3) + 2 + Math.floor(hash2(cx, cy, seed + 73) * 4);
    const dx = x - ox;
    const dy = y - oy;
    if (Math.abs(dx) > S(2) || Math.abs(dy) > S(1)) return null;
    const f = hash2(x, y, seed + 74);
    if (f < 0.72) return null;
    return FLOWER_DOTS[Math.floor(hash2(cx, cy, seed + 75) * FLOWER_DOTS.length)];
  });
}

/** Cool blue-green ground with pale lichen patches and a few fallen needles. */
function taigaTile(seed: number): PixelBuf {
  return groundTile(TAIGA, seed, 0.004, (x, y, c) => {
    const l =
      hash2(x >> 4, y >> 3, seed + 61) * 0.6 +
      hash2((x + 6) >> 3, (y + 2) >> 2, seed + 62) * 0.25 +
      hash2(x >> 1, y >> 1, seed + 64) * 0.15;
    if (l > 0.8) return mix(LICHEN[0], LICHEN[1], hash2(x >> 1, y, seed + 65));
    const n = hash2(x >> 1, y, seed + 73);
    if (n > 0.982) return shade(c, 0.72);
    return null;
  });
}

/** Peat ground with shallow teal pockets ringed by a paler wet edge and a few reed marks. */
function swampTile(seed: number): PixelBuf {
  return groundTile(SWAMP, seed, 0.005, (x, y, c) => {
    const w =
      hash2(x >> 4, (y + 2) >> 3, seed + 61) * 0.55 +
      hash2((x + 4) >> 3, y >> 2, seed + 62) * 0.3 +
      hash2(x >> 1, y >> 1, seed + 64) * 0.15;
    if (w > 0.74) {
      // pool: quiet teal with one glint per pocket
      const g = hash2(x >> 1, y, seed + 63);
      if (g > 0.985) return POOL[1];
      return POOL[g < 0.3 ? 2 : 0];
    }
    if (w > 0.66) return mix(c, PEAT, 0.6);
    const r = hash2(x, y >> 1, seed + 66);
    if (r > 0.992) return shade(c, 1.18);
    return null;
  });
}

/** Oat sand: quiet dunes, a few warm rock chips and very faint wind ripples. */
function desertTile(seed: number): PixelBuf {
  return groundTile(DESERT, seed, 0.0, (x, y, c) => {
    const rockN = hash2(x >> 2, y >> 1, seed + 53);
    if (rockN > 0.985) return WARM_ROCK[Math.floor(hash2(x, y, seed + 54) * 3)];
    const wob = hash2(x >> 4, y >> 3, seed + 51) * 4;
    const u = x * 0.5 + y + wob;
    const r = ((Math.floor(u) % 11) + 11) % 11;
    const brk = hash2(x >> 1, y, seed + 52);
    if (r === 0 && brk > 0.35) return shade(c, 0.94);
    return null;
  });
}

/** Bare flattened earth left after a cut: warm soil with a few pebbles. */
function hillcutTile(seed: number): PixelBuf {
  return groundTile(EARTH, seed, 0.004, (x, y, c) => {
    const g = hash2(x >> 1, y, seed + 81);
    if (g > 0.988) return shade(PAL.rock[3], 1.02);
    if (g < 0.006) return shade(c, 0.82);
    return null;
  });
}

/** Stone field: low exposed stone on pale ground with several rounded boulders and chips. */
function stoneFieldTile(seed: number): PixelBuf {
  const b = groundTile(PAL.rock, seed, 0.003, (x, y, c) => {
    const g = hash2(x >> 1, y, seed + 81);
    if (g > 0.985) return shade(PAL.rock[3], 1.06);
    if (g < 0.01) return shade(PAL.rock[2], 0.86);
    return c;
  });
  // boulders on a separate layer so they get their own contour, then clipped to the diamond
  const layer = new PixelBuf(TILE_W, TILE_H);
  const count = 3 + Math.floor(hash2(seed, 1, 5) * 3);
  const stones: RGB[] = [
    shade(PAL.rock[0], 1.02),
    shade(PAL.rock[1], 1.06),
    shade(PAL.rock[3], 1.02),
    shade(PAL.rock[3], 1.12),
  ];
  const stoneOutline = shade(PAL.rock[2], 0.62);
  for (let i = 0; i < count; i++) {
    const rx = S(3) + Math.floor(hash2(i, seed, 2) * S(4));
    const ry = Math.max(S(2), Math.round(rx * (0.55 + hash2(i, seed, 3) * 0.2)));
    const slot = (i + Math.floor(hash2(seed, 2, 6) * 5)) % 5;
    const slotX = [0.28, 0.72, 0.5, 0.5, 0.5][slot];
    const slotY = [0.5, 0.5, 0.3, 0.7, 0.5][slot];
    let cx = (slotX + (hash2(i, seed, 10) - 0.5) * 0.22) * TILE_W;
    let cy = (slotY + (hash2(i, seed, 20) - 0.5) * 0.24) * TILE_H;
    const limit = 1 - (rx + S(1)) / HALF_W - (ry + S(1)) / HALF_H;
    const e = Math.abs(cx - HALF_W) / HALF_W + Math.abs(cy - HALF_H) / HALF_H;
    if (e > limit) {
      cx = HALF_W + ((cx - HALF_W) * limit) / e;
      cy = HALF_H + ((cy - HALF_H) * limit) / e;
    }
    // ground shadow touching the stone base, then the stone itself
    for (let sx = Math.floor(cx - rx); sx <= Math.ceil(cx + rx); sx++)
      for (let sy = Math.floor(cy + ry * 0.5); sy <= Math.ceil(cy + ry) + S(1); sy++) {
        const g = b.get(sx, sy);
        if (g) b.set(sx, sy, shade(g, 0.8));
      }
    layer.ellipse(cx, cy, rx, ry, stones, seed + 90 + i, 0.7);
    // flat lit top face and a crack line on the bigger ones
    for (let sx = Math.floor(cx - rx * 0.5); sx <= Math.ceil(cx + rx * 0.2); sx++)
      if (layer.alpha(sx, Math.round(cy - ry * 0.5)))
        layer.set(sx, Math.round(cy - ry * 0.5), stones[3]);
    if (rx >= S(5))
      layer.line(
        Math.round(cx),
        Math.round(cy + ry * 0.2),
        Math.round(cx + rx * 0.5),
        Math.round(cy + ry * 0.8),
        shade(PAL.rock[2], 0.8),
      );
  }
  for (let i = 0; i < 4; i++) {
    const px = S(10) + Math.floor(hash2(i, seed, 40) * (TILE_W - S(20)));
    const py = S(6) + Math.floor(hash2(i, seed, 41) * (TILE_H - S(12)));
    if (layer.alpha(px, py)) continue;
    layer.set(px, py, stones[3]);
    layer.set(px + S(1), py, stones[1]);
  }
  layer.outline(stoneOutline, 200);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const a = layer.alpha(x, y);
      if (a === 0 || !inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      const c = layer.get(x, y)!;
      if (a === 255) b.set(x, y, c);
      else {
        const g = b.get(x, y) ?? c;
        b.set(x, y, mix(g, c, 0.7));
      }
    }
  return b;
}

/**
 * Quiet teal water. A few short horizontal glints drift one pixel per frame; `phase` in 0..3
 * selects the animation frame. The glint set is fixed per tile so frames tile with neighbours.
 */
function waterTile(seed: number, phase: number): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      let c = pickShade(x, y, PAL.water, seed);
      // each 8x4 cell owns at most one glint: a 3px light dash on row `phase` of the cell,
      // shifted right by the frame so the highlight travels
      const cellX = x >> 3;
      const cellY = y >> 2;
      const r = hash2(cellX, cellY, seed + 7);
      if (r > 0.86) {
        const gx =
          ((cellX << 3) + Math.floor(hash2(cellX, cellY, seed + 8) * 5) + phase) % TILE_W;
        const gy = (cellY << 2) + ((phase + Math.floor(hash2(cellX, cellY, seed + 9) * 4)) % 4);
        if (y === gy && x >= gx && x < gx + S(3)) c = shade(PAL.water[3], 1.1);
      } else if (r < 0.08 && ((y + 2) & 3) === phase && (x & 7) < 3) c = shade(c, 0.92);
      b.set(x, y, c);
    }
  return b;
}

/** Out-of-map fog: subdued slate-teal, distinct from both ocean and buildable land. */
function voidTile(seed: number): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  const shades: RGB[] = [
    [44, 58, 62],
    [50, 66, 70],
    [38, 50, 54],
  ];
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      b.set(x, y, pickShade(x, y, shades, seed));
    }
  return b;
}

/** Raised hill: grassy top lifted by ELEV_PX with two visible earthen side faces below. */
function hillTile(seed: number): PixelBuf {
  const h = TILE_H + ELEV_PX;
  const b = new PixelBuf(TILE_W, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < TILE_W; x++) {
      const inTop = inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H);
      const inGround = inDiamond(x, y - ELEV_PX, HALF_W, HALF_H, HALF_W, HALF_H);
      const belowTopCentre = y + 0.5 >= HALF_H;
      if (!inTop && (inGround || (belowTopCentre && y < h))) {
        const dxn = Math.abs(x + 0.5 - HALF_W) / HALF_W;
        const topEdgeY = HALF_H + (1 - dxn) * HALF_H;
        const groundEdgeY = topEdgeY + ELEV_PX;
        if (y + 0.5 > topEdgeY && y + 0.5 <= groundEdgeY) {
          const base = x < HALF_W ? PAL.hillSideL : PAL.hillSideR;
          const n = hash2(x >> 2, y >> 1, seed + 3);
          const d = y - Math.floor(topEdgeY);
          // grass roots hang over the top edge, a stone course near the foot
          const strata = d <= S(1) ? 0.9 : d % 4 === 3 ? 0.9 : 1;
          b.set(x, y, shade(base, (0.92 + n * 0.16) * strata));
          if (d === 0 && hash2(x, 1, seed + 4) > 0.4) b.set(x, y, shade(PAL.grass[2], 0.9));
        }
      }
    }
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      let c = pickShade(x, y, PAL.grass, seed);
      const edge = Math.abs(x + 0.5 - HALF_W) / HALF_W + Math.abs(y + 0.5 - HALF_H) / HALF_H;
      // a lit crest along the top edges, bare earth showing where the ground drops away
      if (edge > 0.9 && y > HALF_H) c = mix(c, PAL.hill[0], 0.7);
      else if (edge > 0.9) c = shade(c, 1.08);
      else if (hash2(x >> 2, y >> 1, seed + 11) > 0.9) c = PAL.hill[1];
      b.set(x, y, c);
    }
  return b;
}

/** Mountain: unmistakable raised rock mass twice a hill's lift, grey cliffs and a snow crown. */
function mountainTile(seed: number): PixelBuf {
  const lift = ELEV_PX * 2;
  const h = TILE_H + lift;
  const b = new PixelBuf(TILE_W, h);
  const cliff: RGB[] = [
    [134, 130, 122],
    [150, 146, 138],
    [114, 110, 102],
  ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < TILE_W; x++) {
      const inTop = inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H);
      if (inTop) continue;
      const dxn = Math.abs(x + 0.5 - HALF_W) / HALF_W;
      const topEdgeY = HALF_H + (1 - dxn) * HALF_H;
      const groundEdgeY = topEdgeY + lift;
      if (y + 0.5 > topEdgeY && y + 0.5 <= groundEdgeY) {
        const lit = x < HALF_W ? 1.08 : 0.82;
        const n = hash2(x >> 2, y >> 1, seed + 3);
        const d = y - Math.floor(topEdgeY);
        // strata bands and a couple of vertical fissures
        const strata = d % 5 === 4 ? 0.84 : 1;
        const crack = hash2(x >> 1, seed, 5) > 0.93 && d > S(2) ? 0.7 : 1;
        b.set(x, y, shade(cliff[Math.floor(n * 3)], lit * strata * crack));
      }
    }
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      let c = pickShade(x, y, PAL.rock, seed);
      const cd = Math.abs(x + 0.5 - HALF_W) / HALF_W + Math.abs(y + 0.5 - HALF_H) / HALF_H;
      // a rocky ridge across the top face rising to a snow-capped peak near the centre
      const ridge = 1 - cd;
      const wob = (hash2(x >> 2, y >> 1, seed + 10) - 0.5) * 0.16;
      if (ridge + wob > 0.6) {
        const sn = hash2(x >> 1, y >> 1, seed + 11);
        c = sn > 0.25 ? (x < HALF_W ? SNOW : SNOW_SHADE) : shade(c, 1.12);
      } else if (ridge + wob > 0.5 && hash2(x >> 1, y, seed + 12) > 0.55) c = SNOW_SHADE;
      else if (ridge > 0.3 && hash2(x >> 2, y >> 1, seed + 14) > 0.7) c = shade(c, 0.88);
      else if (cd > 0.9 && y > HALF_H) c = shade(c, 0.86);
      else if (hash2(x >> 1, y, seed + 13) > 0.94) c = shade(c, 1.12);
      b.set(x, y, c);
    }
  return b;
}

/** Cursor / ghost diamond outline. */
function cursorTile(c: RGB, fill?: RGB): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const e = Math.abs(x + 0.5 - HALF_W) / HALF_W + Math.abs(y + 0.5 - HALF_H) / HALF_H;
      if (e <= 1 && e > 0.9) b.set(x, y, c);
      else if (e <= 0.9 && fill && (x + y) % 2 === 0) b.set(x, y, fill, 110);
    }
  return b;
}

/** Neutral paving with narrow connected streets; the 3x3 phase pattern joins continuously. */
function cityTile(tx: number, ty: number): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  const pave: RGB[] = [
    [176, 170, 156],
    [186, 180, 166],
    [164, 158, 144],
  ];
  const street: RGB = [112, 114, 110];
  const kerbC: RGB = [206, 200, 184];
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      const u = ((x - HALF_W) / HALF_W + (y - HALF_H) / HALF_H) / 2;
      const v = ((y - HALF_H) / HALF_H - (x - HALF_W) / HALF_W) / 2;
      const road = (tx === 0 && Math.abs(u) < 0.26) || (ty === 0 && Math.abs(v) < 0.26);
      const kerb =
        (tx === 0 && Math.abs(Math.abs(u) - 0.28) < 0.04) ||
        (ty === 0 && Math.abs(Math.abs(v) - 0.28) < 0.04);
      let c: RGB;
      if (kerb) c = kerbC;
      else if (road) c = shade(street, 0.96 + 0.08 * hash2(x >> 2, y >> 1, 5));
      else {
        c = pickShade(x, y, pave, 700 + tx * 3 + ty);
        // flagstone joints
        if ((x + 2 * y) % 8 === 0 || (x - 2 * y + 400) % 12 === 0) c = shade(c, 0.9);
      }
      b.set(x, y, c);
      if (
        road &&
        ((tx === 0 && Math.abs(u) < 0.015 && Math.abs(v) < 0.12) ||
          (ty === 0 && Math.abs(v) < 0.015 && Math.abs(u) < 0.12))
      )
        b.set(x, y, [196, 184, 132]);
    }
  return b;
}

export function generateTerrainAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  const groundAnchor = { ax: HALF_W, ay: HALF_H };
  for (let v = 0; v < 4; v++) {
    ab.add(
      `terrain/grass_${v}`,
      groundTile(PAL.grass, 100 + v).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/forest_${v}`,
      groundTile(PAL.forestFloor, 200 + v, 0.008, (x, y, c) => {
        // leaf litter: a few warm fallen leaves, twig marks in the shade
        const n = hash2(x >> 1, y, 250 + v);
        if (n > 0.992) return mix(c, PAL.timber[1], 0.6);
        if (n < 0.004) return shade(c, 0.78);
        return null;
      }).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/rock_${v}`,
      stoneFieldTile(300 + v).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/hillcut_${v}`,
      hillcutTile(400 + v).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/sand_${v}`,
      groundTile(PAL.sand, 500 + v, 0.003).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/plains_${v}`,
      plainsTile(900 + v).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/taiga_${v}`,
      taigaTile(1000 + v).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/swamp_${v}`,
      swampTile(1100 + v).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/desert_${v}`,
      desertTile(1200 + v).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
  }
  for (let v = 0; v < 3; v++) {
    for (let f = 0; f < 4; f++)
      ab.add(
        `terrain/water_${v}_f${f}`,
        waterTile(600 + v, f).toImageData(),
        groundAnchor.ax,
        groundAnchor.ay,
      );
    ab.add(`terrain/hill_${v}`, hillTile(700 + v).toImageData(), HALF_W, HALF_H + ELEV_PX);
    ab.add(
      `terrain/mountain_${v}`,
      mountainTile(750 + v).toImageData(),
      HALF_W,
      HALF_H + ELEV_PX * 2,
    );
    ab.add(`terrain/void_${v}`, voidTile(800 + v).toImageData(), groundAnchor.ax, groundAnchor.ay);
  }
  ab.add('terrain/cursor', cursorTile(PAL.white).toImageData(), HALF_W, HALF_H);
  ab.add('terrain/ghost_ok', cursorTile(PAL.cyan, PAL.cyan).toImageData(), HALF_W, HALF_H);
  ab.add('terrain/ghost_bad', cursorTile(PAL.red, PAL.red).toImageData(), HALF_W, HALF_H);
  ab.add('terrain/select', cursorTile(PAL.amber).toImageData(), HALF_W, HALF_H);
  for (let tx = 0; tx < 3; tx++)
    for (let ty = 0; ty < 3; ty++)
      ab.add(`terrain/city_${tx}_${ty}`, cityTile(tx, ty).toImageData(), HALF_W, HALF_H);
  // translucent dark diamond used to fog locked regions
  const fog = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++)
      if (inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) fog.set(x, y, [24, 34, 38], 150);
  ab.add('terrain/fog', fog.toImageData(), HALF_W, HALF_H);
  return ab.build(1024);
}
