import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { TILE_W, TILE_H, HALF_W, HALF_H, ELEV_PX } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { PAL, mix, shade, type RGB } from './palette';
import { PixelBuf, inDiamond, pickShade } from './pixels';

/** Per-pixel decorator hook for ground tiles: return a colour to override the dithered base. */
type Deco = (x: number, y: number, c: RGB) => RGB | null;

/** Flat diamond ground tile with 2x2-block dithering and a faint darker rim on the near edges. */
function groundTile(shades: RGB[], seed: number, rimDark = 0.82, deco?: Deco): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      let c = pickShade(x, y, shades, seed);
      // sparse tufts / pebbles for a hand-painted feel
      const t = hash2(x, y, seed + 41);
      if (t > 0.975) c = shade(shades[shades.length - 1], 1.12);
      else if (t < 0.02) c = shade(shades[0], 0.8);
      if (deco) c = deco(x, y, c) ?? c;
      // near (bottom) edges a touch darker to separate tiles like a painted floor
      const edge = Math.abs(x + 0.5 - HALF_W) / HALF_W + Math.abs(y + 0.5 - HALF_H) / HALF_H;
      if (edge > 0.93 && y > HALF_H) c = shade(c, rimDark);
      b.set(x, y, c);
    }
  return b;
}

// biome ground palettes (kept local: they are only used by the tile generators)
const PLAINS: RGB[] = [
  [92, 106, 56],
  [104, 118, 64],
  [82, 96, 50],
  [114, 128, 72],
];
const TAIGA: RGB[] = [
  [54, 76, 66],
  [62, 86, 74],
  [46, 66, 58],
  [70, 94, 80],
];
const SWAMP: RGB[] = [
  [60, 62, 38],
  [68, 70, 44],
  [50, 52, 32],
  [76, 78, 52],
];
const DESERT: RGB[] = [
  [166, 150, 108],
  [176, 162, 120],
  [154, 138, 98],
  [184, 170, 128],
];
const FLOWER_DOTS: RGB[] = [
  [204, 196, 160],
  [208, 172, 72],
  [176, 84, 76],
  [150, 110, 170],
];

/** Warm yellow-green meadow with the occasional tiny flower dot. */
function plainsTile(seed: number): PixelBuf {
  return groundTile(PLAINS, seed, 0.84, (x, y) => {
    const f = hash2(x, y, seed + 71);
    if (f > 0.988) return FLOWER_DOTS[Math.floor(hash2(x, y, seed + 72) * FLOWER_DOTS.length)];
    return null;
  });
}

/** Cold blue-green grass with frost specks and dark fallen needles. */
function taigaTile(seed: number): PixelBuf {
  return groundTile(TAIGA, seed, 0.8, (x, y) => {
    const f = hash2(x, y, seed + 71);
    if (f > 0.991) return [176, 190, 186];
    if (f > 0.982) return [128, 146, 146];
    // needles: short dark 2px marks, keyed on the left pixel so they stay whole
    const n = hash2(x >> 1, y, seed + 73);
    if (n > 0.965 && (x & 1) === 0) return [28, 42, 34];
    if (hash2((x - 1) >> 1, y, seed + 73) > 0.965 && (x & 1) === 1) return [28, 42, 34];
    return null;
  });
}

/** Dark muddy ground with wet patches and small puddle glints. */
function swampTile(seed: number): PixelBuf {
  return groundTile(SWAMP, seed, 0.78, (x, y, c) => {
    // low-frequency blobs: wet, darker soil
    const w =
      hash2(x >> 4, (y + 2) >> 3, seed + 61) * 0.55 +
      hash2((x + 4) >> 3, y >> 2, seed + 62) * 0.3 +
      hash2(x >> 1, y >> 1, seed + 64) * 0.15;
    if (w > 0.62) {
      const g = hash2(x >> 1, y, seed + 63);
      // puddle glint: a pale blue-grey 2px mark inside the wet patch
      if (g > 0.985) return [110, 130, 134];
      if (g > 0.965) return [66, 80, 80];
      return shade(c, 0.7);
    }
    return null;
  });
}

/** Pale sand with faint wind ripples running along the iso diagonal. */
function desertTile(seed: number): PixelBuf {
  return groundTile(DESERT, seed, 0.86, (x, y, c) => {
    // ripple phase follows the NE-SW iso axis with a slow wobble so lines are not ruler-straight
    const wob = hash2(x >> 4, y >> 3, seed + 51) * 3;
    const u = x * 0.5 + y + wob;
    const r = ((Math.floor(u) % 9) + 9) % 9;
    const brk = hash2(x >> 1, y, seed + 52);
    if (r === 0 && brk > 0.2) return shade(c, 0.84);
    if (r === 1 && brk > 0.45) return shade(c, 1.1);
    return null;
  });
}

/** Stone field: grey ground with several boulders and chips embedded straight into the tile. */
function stoneFieldTile(seed: number): PixelBuf {
  const b = groundTile(PAL.rock, seed, 0.7, (x, y, c) => {
    // gravel: a few darker and lighter chips
    const g = hash2(x >> 1, y, seed + 81);
    if (g > 0.985) return shade(PAL.rock[3], 1.1);
    if (g < 0.012) return shade(PAL.rock[2], 0.8);
    return c;
  });
  // boulders on a separate layer so they get their own outline, then clipped to the diamond
  const layer = new PixelBuf(TILE_W, TILE_H);
  const count = 3 + Math.floor(hash2(seed, 1, 5) * 3);
  const stones: RGB[] = [
    shade(PAL.stone[2], 1.05),
    shade(PAL.stone[0], 1.18),
    shade(PAL.stone[1], 1.25),
    shade(PAL.stone[1], 1.4),
  ];
  const stoneOutline = shade(PAL.rock[2], 0.5);
  for (let i = 0; i < count; i++) {
    const rx = 3 + Math.floor(hash2(i, seed, 2) * 4);
    const ry = Math.max(2, Math.round(rx * (0.55 + hash2(i, seed, 3) * 0.2)));
    // scatter: each stone owns a slot around the tile (left, right, top, bottom, centre) and
    // jitters inside it; the slot is then clamped so the stone stays inside the diamond
    const slot = (i + Math.floor(hash2(seed, 2, 6) * 5)) % 5;
    const slotX = [0.28, 0.72, 0.5, 0.5, 0.5][slot];
    const slotY = [0.5, 0.5, 0.3, 0.7, 0.5][slot];
    let cx = (slotX + (hash2(i, seed, 10) - 0.5) * 0.22) * TILE_W;
    let cy = (slotY + (hash2(i, seed, 20) - 0.5) * 0.24) * TILE_H;
    const limit = 1 - (rx + 1) / HALF_W - (ry + 1) / HALF_H;
    const e = Math.abs(cx - HALF_W) / HALF_W + Math.abs(cy - HALF_H) / HALF_H;
    if (e > limit) {
      cx = HALF_W + ((cx - HALF_W) * limit) / e;
      cy = HALF_H + ((cy - HALF_H) * limit) / e;
    }
    // ground shadow under the stone, then the stone itself
    for (let sx = Math.floor(cx - rx); sx <= Math.ceil(cx + rx); sx++)
      for (let sy = Math.floor(cy + ry * 0.4); sy <= Math.ceil(cy + ry) + 1; sy++) {
        const g = b.get(sx, sy);
        if (g) b.set(sx, sy, shade(g, 0.72));
      }
    layer.ellipse(cx, cy, rx, ry, stones, seed + 90 + i, 0.7);
    // small highlight and a crack line on the bigger ones
    layer.set(Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.4), shade(stones[1], 1.18));
    if (rx >= 5)
      layer.line(
        Math.round(cx),
        Math.round(cy + ry * 0.2),
        Math.round(cx + rx * 0.5),
        Math.round(cy + ry * 0.8),
        shade(PAL.stone[2], 0.8),
      );
  }
  for (let i = 0; i < 4; i++) {
    const px = 10 + Math.floor(hash2(i, seed, 40) * (TILE_W - 20));
    const py = 6 + Math.floor(hash2(i, seed, 41) * (TILE_H - 12));
    if (layer.alpha(px, py)) continue;
    layer.set(px, py, stones[3]);
    layer.set(px + 1, py, stones[1]);
  }
  layer.outline(stoneOutline, 200);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const a = layer.alpha(x, y);
      if (a === 0 || !inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      const c = layer.get(x, y)!;
      if (a === 255) b.set(x, y, c);
      else {
        // soften the outline into the ground instead of a hard ring
        const g = b.get(x, y) ?? c;
        b.set(x, y, mix(g, c, 0.8));
      }
    }
  return b;
}

/** Water with a slow travelling ripple; `phase` in 0..3 selects the animation frame. */
function waterTile(seed: number, phase: number): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      let c = pickShade(x, y, PAL.water, seed);
      // ripple crests drift one pixel per frame; the crest set is fixed per tile so frames tile
      // seamlessly with their neighbours
      // each 4x4 cell owns one crest row; the lit row is the frame index, so frame 3 -> 0 is one
      // more step down and the cycle is seamless
      const r = hash2(x >> 2, y >> 2, seed + 7);
      if (r > 0.9 && (y & 3) === phase) c = shade(c, 1.25);
      else if (r < 0.06 && ((y + 2) & 3) === phase) c = shade(c, 0.85);
      b.set(x, y, c);
    }
  return b;
}

/** Out-of-map "abyss": near-black sea used for the border ring beyond the playable area. */
function voidTile(seed: number): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  const shades: RGB[] = [
    [14, 18, 26],
    [18, 24, 32],
    [10, 14, 20],
  ];
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      b.set(x, y, pickShade(x, y, shades, seed));
    }
  return b;
}

/** Raised hill: top diamond lifted by ELEV_PX with two visible earthen side faces below. */
function hillTile(seed: number): PixelBuf {
  const h = TILE_H + ELEV_PX;
  const b = new PixelBuf(TILE_W, h);
  // side faces: fill the region between lifted diamond and ground diamond lower edges
  for (let y = 0; y < h; y++)
    for (let x = 0; x < TILE_W; x++) {
      const inTop = inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H);
      const inGround = inDiamond(x, y - ELEV_PX, HALF_W, HALF_H, HALF_W, HALF_H);
      const belowTopCentre = y + 0.5 >= HALF_H;
      if (!inTop && (inGround || (belowTopCentre && y < h))) {
        // between the two diamonds' lower edges
        const dxn = Math.abs(x + 0.5 - HALF_W) / HALF_W;
        const topEdgeY = HALF_H + (1 - dxn) * HALF_H; // lower boundary of top diamond at this x
        const groundEdgeY = topEdgeY + ELEV_PX;
        if (y + 0.5 > topEdgeY && y + 0.5 <= groundEdgeY) {
          const base = x < HALF_W ? PAL.hillSideL : PAL.hillSideR;
          const n = hash2(x >> 1, y >> 1, seed + 3);
          const strata = (y - Math.floor(topEdgeY)) % 4 === 0 ? 0.85 : 1;
          b.set(x, y, shade(base, (0.9 + n * 0.2) * strata));
        }
      }
    }
  // top surface
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      let c = pickShade(x, y, PAL.hill, seed);
      const edge = Math.abs(x + 0.5 - HALF_W) / HALF_W + Math.abs(y + 0.5 - HALF_H) / HALF_H;
      if (edge > 0.9 && y > HALF_H) c = shade(c, 0.75);
      // some grass tufts on the top
      if (hash2(x >> 1, y >> 1, seed + 11) > 0.93) c = PAL.grass[1];
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
      groundTile(PAL.forestFloor, 200 + v).toImageData(),
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
      groundTile(PAL.hill, 400 + v).toImageData(),
      groundAnchor.ax,
      groundAnchor.ay,
    );
    ab.add(
      `terrain/sand_${v}`,
      groundTile(PAL.sand, 500 + v).toImageData(),
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
    ab.add(`terrain/void_${v}`, voidTile(800 + v).toImageData(), groundAnchor.ax, groundAnchor.ay);
  }
  ab.add('terrain/cursor', cursorTile(PAL.white).toImageData(), HALF_W, HALF_H);
  ab.add('terrain/ghost_ok', cursorTile(PAL.cyan, PAL.cyan).toImageData(), HALF_W, HALF_H);
  ab.add('terrain/ghost_bad', cursorTile(PAL.red, PAL.red).toImageData(), HALF_W, HALF_H);
  ab.add('terrain/select', cursorTile(PAL.amber).toImageData(), HALF_W, HALF_H);
  // solid dark diamond used to fog locked regions
  const fog = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++)
      if (inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) fog.set(x, y, [8, 8, 10], 150);
  ab.add('terrain/fog', fog.toImageData(), HALF_W, HALF_H);
  return ab.build(1024);
}
