import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { TILE_W, TILE_H, HALF_W, HALF_H } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { PERSON_PX } from '../render/assetScale';
import { PROFESSIONS, type Profession } from '../sim/people';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf, pickShade } from './pixels';

// ---------------------------------------------------------------------------
// Walking people
// ---------------------------------------------------------------------------

const PW = 6;
const PH = 12;
const SKIN: RGB = [214, 178, 138];
const HAIR: RGB = [68, 48, 34];

interface Outfit {
  body: RGB;
  legs: RGB;
  hat?: RGB;
  skirt?: boolean;
}
/** worker blue, farmer brown, townsman grey, woman red */
const OUTFITS: Outfit[] = [
  { body: [72, 96, 124], legs: [52, 68, 88], hat: [84, 108, 132] },
  { body: [150, 112, 70], legs: [110, 80, 50], hat: [206, 188, 148] },
  { body: [104, 106, 104], legs: [68, 70, 70], hat: [52, 56, 54] },
  { body: [152, 74, 70], legs: [112, 52, 50], skirt: true },
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
  // Waistcoat, brass button and lit shoulder read at miniature scale.
  b.set(2, 3, shade(o.body, 1.3));
  b.set(3, 5, PAL.brass);
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
// The figures of each profession
// ---------------------------------------------------------------------------

/** Poses of a walk cycle: near foot forward, passing, far foot forward, passing. */
export const WALK_FRAMES = 4;
/** Who gathers from the ground and walks home with a load. */
const CARRIERS: readonly Profession[] = ['lumberjack', 'stone_mason', 'farmer', 'pump_hand'];

export type FigureView = 'front' | 'back';
export type FigurePose = 'walk' | 'carry';

/** Wide enough for a tool or a load either side of the body; PERSON_PX tall, feet on the last row. */
const FIGURE_W = 13;
/** The column under the hips. */
const FIGURE_X = 6;
const BOOT: RGB = [62, 46, 36];
const WOOD: RGB = [118, 84, 52];
const IRON: RGB = [132, 138, 142];
const LOG: RGB = [136, 98, 60];
const STONE: RGB = [188, 169, 139];
const STRAW: RGB = [206, 176, 104];
const WATER: RGB = [71, 123, 130];

interface Dress {
  /** Hat crown, and the brim where it is another colour or wider. */
  hat: RGB;
  wide?: boolean;
  /** The clothes seen from behind; `chest` runs down the front. */
  body: RGB;
  chest: RGB;
  legs: RGB;
}

const DRESS: Record<Profession, Dress> = {
  passenger: { hat: [41, 70, 56], body: [41, 70, 56], chest: [228, 213, 181], legs: [62, 66, 66] },
  lumberjack: { hat: [84, 92, 56], body: [158, 92, 54], chest: [41, 70, 56], legs: [76, 78, 78] },
  stone_mason: {
    hat: [98, 107, 108],
    body: [150, 136, 112],
    chest: [120, 84, 52],
    legs: [86, 82, 72],
  },
  farmer: {
    hat: STRAW,
    wide: true,
    body: [120, 128, 76],
    chest: [146, 150, 96],
    legs: [96, 78, 56],
  },
  pump_hand: {
    hat: [71, 123, 130],
    body: [188, 169, 139],
    chest: [71, 123, 130],
    legs: [64, 70, 78],
  },
  railway_worker: {
    hat: [38, 52, 84],
    body: [46, 62, 98],
    chest: [62, 80, 118],
    legs: [38, 48, 74],
  },
};

/** Sets each `[x, y]` to `c`. */
function dots(b: PixelBuf, c: RGB, ...at: [number, number][]) {
  for (const [x, y] of at) b.set(x, y, c);
}

/** A two-pixel boot pointing forward, the toe at `x` + 1. */
function boot(b: PixelBuf, x: number, y: number, c: RGB) {
  dots(b, c, [x, y], [x + 1, y]);
}

/** Rows 6 to 8. A foot ahead stands lower on the page going down the screen, higher going up. */
function figureLegs(b: PixelBuf, view: FigureView, f: number, legs: RGB) {
  const near = legs,
    far = shade(legs, 0.72),
    farBoot = shade(BOOT, 0.8);
  if (f % 2 === 1) {
    // passing: one leg planted, the other swings by with its foot off the ground
    const planted = f === 1;
    dots(b, far, [5, 6], [5, 7]);
    if (planted) boot(b, 7, 7, farBoot);
    else boot(b, 5, 8, farBoot);
    dots(b, near, [6, 6], [6, 7]);
    if (planted) boot(b, 6, 8, BOOT);
    else boot(b, 7, 7, BOOT);
    return;
  }
  const ahead = view === 'front' ? 8 : 7,
    behind = view === 'front' ? 7 : 8,
    reach = (c: RGB, foot: RGB) => {
      dots(b, c, [6, 6], [7, ahead - 1]);
      boot(b, 8, ahead, foot);
    },
    trail = (c: RGB, foot: RGB) => {
      dots(b, c, [5, 6], [4, behind - 1]);
      boot(b, 3, behind, foot);
    };
  if (f === 0) {
    trail(far, farBoot);
    reach(near, BOOT);
  } else {
    reach(far, farBoot);
    trail(near, BOOT);
  }
}

/** Head and hat on rows 0 to 2, turned to the right of the picture, the back of it from behind. */
function figureHead(b: PixelBuf, view: FigureView, o: Dress) {
  if (view === 'front') dots(b, SKIN, [6, 2], [7, 2]);
  else dots(b, SKIN, [7, 2]);
  dots(b, HAIR, [5, 2]);
  if (view === 'back') dots(b, HAIR, [6, 2]);
  b.rect(5, 0, 3, 1, o.hat);
  b.rect(o.wide ? 3 : 4, 1, o.wide ? 7 : 5, 1, shade(o.hat, 0.86));
}

/** Rows 3 to 5, with the arms swinging against the legs unless `free` is false. */
function figureBody(b: PixelBuf, view: FigureView, f: number, o: Dress, free: boolean) {
  b.rect(5, 3, 3, 3, o.body);
  b.rect(7, 3, 1, 3, shade(o.body, 0.8));
  dots(b, shade(o.body, 1.15), [5, 3]);
  if (view === 'front') dots(b, o.chest, [6, 3], [6, 4], [6, 5]);
  if (!free) return;
  if (f === 0) dots(b, SKIN, [4, 5], [8, 4]);
  else if (f === 2) dots(b, SKIN, [4, 4], [8, 5]);
  else dots(b, shade(o.body, 0.8), [4, 4], [8, 4]);
}

/** What the figure carries, drawn over it; `false` keeps its arms off the swing. */
const TOOLS: Record<Profession, (b: PixelBuf, view: FigureView) => boolean> = {
  passenger(b) {
    dots(b, [163, 107, 66], [4, 5], [4, 6]);
    return true;
  },
  lumberjack(b) {
    // the axe on the shoulder, its head behind the figure
    dots(b, WOOD, [9, 4], [8, 3], [7, 3], [6, 2], [5, 2], [4, 1]);
    dots(b, SKIN, [8, 4]);
    dots(b, IRON, [3, 0], [3, 1], [2, 1], [3, 2]);
    return false;
  },
  stone_mason(b) {
    dots(b, WOOD, [9, 4], [8, 3], [7, 3], [6, 2], [5, 2], [4, 1]);
    dots(b, SKIN, [8, 4]);
    dots(b, IRON, [2, 2], [3, 1], [3, 0], [4, 0]);
    return false;
  },
  farmer(b) {
    b.rect(9, 1, 1, 7, WOOD);
    dots(b, IRON, [8, 0], [9, 0], [10, 0], [8, 1], [10, 1]);
    dots(b, SKIN, [8, 4]);
    return false;
  },
  pump_hand(b) {
    dots(b, SKIN, [4, 4], [4, 5], [8, 4], [8, 5]);
    return false;
  },
  railway_worker(b) {
    dots(b, PAL.brass, [6, 0]);
    dots(b, SKIN, [8, 5]);
    dots(b, WOOD, [9, 5]);
    dots(b, PAL.brass, [9, 6], [9, 7]);
    return false;
  },
};

/** The load of a carrier walking home. */
const LOADS: Partial<Record<Profession, (b: PixelBuf, view: FigureView) => void>> = {
  lumberjack(b) {
    b.rect(2, 3, 9, 2, LOG);
    dots(b, shade(LOG, 0.8), [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4]);
    dots(b, shade(LOG, 1.3), [10, 3], [10, 4]);
    dots(b, SKIN, [8, 5]);
  },
  stone_mason(b, view) {
    b.rect(8, 3, view === 'front' ? 3 : 2, 3, STONE);
    b.rect(8, 5, view === 'front' ? 3 : 2, 1, shade(STONE, 0.78));
    dots(b, SKIN, [7, 5]);
  },
  farmer(b) {
    b.rect(2, 2, 3, 2, STRAW);
    dots(b, shade(STRAW, 0.8), [3, 3], [4, 3]);
    dots(b, shade(STRAW, 1.15), [1, 1], [2, 1], [3, 1]);
    dots(b, [160, 128, 70], [4, 4]);
    dots(b, SKIN, [8, 4]);
  },
  pump_hand(b) {
    b.rect(2, 3, 9, 1, WOOD);
    for (const x of [2, 9]) {
      b.rect(x, 4, 2, 2, IRON);
      b.rect(x, 4, 2, 1, WATER);
    }
    dots(b, SKIN, [4, 4], [8, 4]);
  },
};

/** One frame of a profession's figure, PERSON_PX tall with its feet on the last row. */
export function professionFigure(
  profession: Profession,
  view: FigureView,
  pose: FigurePose,
  f: number,
): PixelBuf {
  const b = new PixelBuf(FIGURE_W, PERSON_PX),
    o = DRESS[profession];
  figureLegs(b, view, f, o.legs);
  const load = pose === 'carry' ? LOADS[profession] : undefined;
  figureBody(b, view, f, o, !load && profession === 'passenger');
  figureHead(b, view, o);
  if (load) load(b, view);
  else TOOLS[profession](b, view);
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

const DIRT: RGB[] = [
  [166, 138, 96],
  [150, 124, 86],
  [180, 152, 108],
  [134, 110, 76],
  [194, 168, 124],
];

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

export function generatePeopleAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  OUTFITS.forEach((o, k) => {
    for (let f = 0; f < 2; f++)
      ab.add(`people/walker_${k}_f${f}`, walker(o, f).toImageData(), PW / 2, PH - 1);
  });
  for (const profession of PROFESSIONS)
    for (const view of ['front', 'back'] as const)
      for (const pose of ['walk', 'carry'] as const) {
        if (pose === 'carry' && !CARRIERS.includes(profession)) continue;
        for (let f = 0; f < WALK_FRAMES; f++)
          ab.add(
            `people/${profession}_${view}_${pose}_f${f}`,
            professionFigure(profession, view, pose, f).toImageData(),
            FIGURE_X,
            PERSON_PX - 1,
          );
      }
  for (let v = 0; v < 3; v++) {
    ab.add(`people/path_dirt_${v}`, pathDirt(v).toImageData(), HALF_W, HALF_H);
    ab.add(`people/road_stone_${v}`, roadStone(v).toImageData(), HALF_W, HALF_H);
  }
  return ab.build(256);
}
