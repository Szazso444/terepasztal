import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { TILE_W, TILE_H, HALF_W, HALF_H, ELEV_PX } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf, inDiamond, pickShade } from './pixels';

/** Flat diamond ground tile with 2x2-block dithering and a faint darker rim on the near edges. */
function groundTile(shades: RGB[], seed: number, rimDark = 0.82): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y, HALF_W, HALF_H, HALF_W, HALF_H)) continue;
      let c = pickShade(x, y, shades, seed);
      // near (bottom) edges a touch darker to separate tiles like a painted floor
      const edge = Math.abs(x + 0.5 - HALF_W) / HALF_W + Math.abs(y + 0.5 - HALF_H) / HALF_H;
      if (edge > 0.93 && y > HALF_H) c = shade(c, rimDark);
      // sparse tufts / pebbles for a hand-painted feel
      const t = hash2(x, y, seed + 41);
      if (t > 0.975) c = shade(shades[shades.length - 1], 1.12);
      else if (t < 0.02) c = shade(shades[0], 0.8);
      b.set(x, y, c);
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
      const cx = x - phase;
      const cy = y - (phase >> 1);
      const r = hash2(cx >> 2, cy >> 1, seed + 7);
      if (r > 0.9 && ((cy % 4) + 4) % 4 === 0) c = shade(c, 1.25);
      else if (r < 0.06 && ((cy % 5) + 5) % 5 === 0) c = shade(c, 0.85);
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
      groundTile(PAL.rock, 300 + v, 0.7).toImageData(),
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
