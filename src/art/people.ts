import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { TILE_W, TILE_H, HALF_W, HALF_H } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf, pickShade } from './pixels';

// ---------------------------------------------------------------------------
// Walking people
// ---------------------------------------------------------------------------

const PW = 6;
const PH = 12;
const SKIN: RGB = [200, 162, 122];
const HAIR: RGB = [56, 40, 28];

interface Outfit {
  body: RGB;
  legs: RGB;
  hat?: RGB;
  skirt?: boolean;
}
/** worker blue, farmer brown, townsman grey, woman red */
const OUTFITS: Outfit[] = [
  { body: [62, 84, 128], legs: [44, 56, 84], hat: [70, 90, 130] },
  { body: PAL.timber[0], legs: PAL.timber[2], hat: PAL.sand[1] },
  { body: [92, 92, 100], legs: [58, 58, 66], hat: [40, 40, 46] },
  { body: PAL.red, legs: [120, 40, 36], skirt: true },
];

/** ~4x10 figure inside a 6x12 buffer (1px margin for the outline). Frame f swaps the legs. */
function walker(o: Outfit, f: number): PixelBuf {
  const b = new PixelBuf(PW, PH);
  // head (y=1..2), hat or hair on top
  b.rect(2, 1, 2, 2, SKIN);
  if (o.hat) {
    b.rect(1, 1, 4, 1, o.hat);
    b.set(2, 0, o.hat);
    b.set(3, 0, o.hat);
  } else {
    b.rect(2, 0, 2, 1, HAIR);
    b.set(1, 1, HAIR);
  }
  // torso y=3..7, 4 wide; slight shade on the right for volume
  b.rect(1, 3, 4, 5, o.body);
  b.rect(4, 3, 1, 5, shade(o.body, 0.8));
  // hands
  b.set(1, 6, SKIN);
  b.set(4, 6, SKIN);
  if (o.skirt) {
    // skirt flares at the hips, legs shorter
    b.rect(1, 7, 4, 2, o.legs);
    b.set(4, 8, shade(o.legs, 0.8));
    const lift = f === 0 ? 0 : 1;
    b.rect(1, 9, 2, 2 - lift, SKIN);
    b.rect(3, 9, 2, 1 + lift, SKIN);
  } else {
    // legs y=8..10: one straight, one lifted a pixel; frames alternate
    const left = f === 0 ? 3 : 2;
    const right = f === 0 ? 2 : 3;
    b.rect(1, 8, 2, left, o.legs);
    b.rect(3, 8, 2, right, o.legs);
    b.set(1, 8 + left - 1, HAIR);
    b.set(4, 8 + right - 1, HAIR);
  }
  b.outline(PAL.outline);
  return b;
}

// ---------------------------------------------------------------------------
// Ground tiles
// ---------------------------------------------------------------------------

/** Sprite pixel -> fractional tile coordinates relative to the tile centre. */
function toTile(px: number, py: number) {
  const dx = px + 0.5 - HALF_W;
  const dy = py + 0.5 - HALF_H;
  return { tx: dx / TILE_W + dy / TILE_H, ty: dy / TILE_H - dx / TILE_W };
}

const DIRT: RGB[] = [PAL.sand[2], [116, 100, 70], PAL.sand[0], [100, 86, 60], PAL.sand[1]];

/** Trodden earth diamond with a nibbled edge so it feathers into grass. */
function pathDirt(v: number): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  const seed = 500 + v;
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const { tx, ty } = toTile(x, y);
      const edge = Math.max(Math.abs(tx), Math.abs(ty));
      if (edge > 0.5) continue;
      // irregular border: drop pixels with rising probability towards the rim
      const n = hash2(x, y, seed + 11);
      if (edge > 0.47 && n < 0.6) continue;
      if (edge > 0.43 && n < 0.25) continue;
      let c = pickShade(x, y, DIRT, seed);
      // worn centre band a touch lighter, ruts darker
      const centre = 1 - (Math.abs(tx) + Math.abs(ty));
      if (centre > 0.55 && hash2(x >> 1, y >> 1, seed + 3) > 0.5) c = shade(c, 1.08);
      const t = hash2(x, y, seed + 41);
      if (t > 0.97) c = shade(DIRT[4], 1.1);
      else if (t < 0.03) c = shade(DIRT[3], 0.8);
      b.set(x, y, c);
    }
  return b;
}

/** Cobbled stone diamond: staggered iso cobbles with dark joints. */
function roadStone(v: number): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  const seed = 600 + v;
  const cell = 0.1;
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const { tx, ty } = toTile(x, y);
      if (Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5) continue;
      const j = Math.floor((ty + 0.5) / cell);
      const ox = j % 2 === 0 ? 0 : cell / 2;
      const i = Math.floor((tx + 0.5 + ox) / cell);
      const fx = (tx + 0.5 + ox) / cell - i;
      const fy = (ty + 0.5) / cell - j;
      const n = hash2(i, j, seed);
      let c: RGB;
      if (fx < 0.14 || fy < 0.18) c = shade(PAL.stone[2], 0.75);
      else {
        c = PAL.stone[Math.min(2, Math.floor(n * 3))];
        if (fx < 0.45 && fy < 0.45) c = shade(c, 1.1);
        else if (fx > 0.8 || fy > 0.8) c = shade(c, 0.9);
        c = shade(c, 0.95 + 0.1 * hash2(x, y, seed + 5));
      }
      // near edges a touch darker to read as separate tiles
      if (Math.abs(tx) + Math.abs(ty) > 0.93 && y > HALF_H) c = shade(c, 0.85);
      b.set(x, y, c);
    }
  return b;
}

// ---------------------------------------------------------------------------
// Level crossings (overlay on a straight track tile)
// ---------------------------------------------------------------------------

const GAUGE = 0.16; // matches src/art/track.ts
const STRIP = 0.2; // half-length of the strip along the track (~40% of the tile)

/**
 * Strip across the rails. `rot` 0 = straight_0 (N-S, along tile y), 1 = straight_1 (E-W, along
 * tile x). `paint(across, along, x, y)` returns the surface colour; the rail heads are left
 * transparent with a dark groove beside each so the rails underneath show through.
 */
function crossing(
  rot: number,
  paint: (c: number, a: number, x: number, y: number) => RGB,
): PixelBuf {
  const b = new PixelBuf(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const { tx, ty } = toTile(x, y);
      const along = rot === 0 ? ty : tx;
      const across = rot === 0 ? tx : ty;
      if (Math.abs(along) > STRIP || Math.abs(across) > 0.5) continue;
      let groove = false;
      let gap = false;
      for (const g of [-GAUGE, GAUGE]) {
        const d = across - g;
        if (Math.abs(d) < 0.018) gap = true;
        else if (d >= 0.018 && d < 0.048) groove = true;
      }
      if (gap) continue;
      if (groove) {
        b.set(x, y, PAL.sleeperDark);
        continue;
      }
      let c = paint(across, along, x, y);
      if (Math.abs(along) > STRIP - 0.025) c = shade(c, 0.8);
      b.set(x, y, c);
    }
  return b;
}

/** Timber planks laid parallel to the rails. */
function crossingDirt(rot: number): PixelBuf {
  const plank = 0.075;
  return crossing(rot, (c, _a, x, y) => {
    const i = Math.floor((c + 0.5) / plank);
    const f = (c + 0.5) / plank - i;
    if (f < 0.14) return PAL.timber[2];
    const base = PAL.timber[Math.floor(hash2(i, rot, 700) * 2)];
    return shade(base, 0.9 + 0.2 * hash2(x, y, 701 + rot));
  });
}

/** Flat grey stone slabs in staggered rows. */
function crossingStone(rot: number): PixelBuf {
  const sw = 0.125;
  const sh = (STRIP * 2) / 3;
  return crossing(rot, (c, a, x, y) => {
    const j = Math.floor((a + STRIP) / sh);
    const ox = j % 2 === 0 ? 0 : sw / 2;
    const i = Math.floor((c + 0.5 + ox) / sw);
    const fx = (c + 0.5 + ox) / sw - i;
    const fy = (a + STRIP) / sh - j;
    if (fx < 0.1 || fy < 0.12) return shade(PAL.stone[2], 0.7);
    const base = PAL.stone[Math.min(2, Math.floor(hash2(i, j, 800 + rot) * 3))];
    const lit = fx < 0.5 && fy < 0.5 ? 1.08 : 1;
    return shade(base, lit * (0.95 + 0.1 * hash2(x, y, 801 + rot)));
  });
}

export function generatePeopleAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  OUTFITS.forEach((o, k) => {
    for (let f = 0; f < 2; f++)
      ab.add(`people/walker_${k}_f${f}`, walker(o, f).toImageData(), PW / 2, PH - 1);
  });
  for (let v = 0; v < 3; v++) {
    ab.add(`people/path_dirt_${v}`, pathDirt(v).toImageData(), HALF_W, HALF_H);
    ab.add(`people/road_stone_${v}`, roadStone(v).toImageData(), HALF_W, HALF_H);
  }
  for (let rot = 0; rot < 2; rot++) {
    ab.add(`people/crossing_dirt_${rot}`, crossingDirt(rot).toImageData(), HALF_W, HALF_H);
    ab.add(`people/crossing_stone_${rot}`, crossingStone(rot).toImageData(), HALF_W, HALF_H);
  }
  return ab.build(256);
}
