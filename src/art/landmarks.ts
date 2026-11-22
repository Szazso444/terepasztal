import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { drawPrism, fillPoly, proj } from './iso3d';
import footprints from './landmarkFootprints.json';
import { PAL, type RGB } from './palette';
import { PixelBuf, pickShade } from './pixels';

/**
 * Every landmark's footprint from the spec, section 1: `[W, D]` in tiles, W along +x, D along +y.
 * tools/landmark-sprites.mjs reads the same file.
 */
export const LANDMARK_FOOTPRINTS = footprints as Record<string, [number, number]>;

/** The picture's body at a glance: height in world px to the eaves, ridge rise, wall and roof. */
const LOOK: Record<string, { h: number; ridge: number; wall: RGB[]; roof: RGB[] }> = {
  merchants_last_stop: { h: 30, ridge: 26, wall: PAL.timber, roof: PAL.roofSlate },
  overgrown_bathhouse: { h: 40, ridge: 14, wall: PAL.stone, roof: PAL.leaf },
  bellkeepers_refuge: { h: 80, ridge: 14, wall: PAL.stone, roof: PAL.roofSlate },
  flooded_archive: { h: 46, ridge: 20, wall: PAL.stone, roof: PAL.copper },
  rootbound_workshop: { h: 36, ridge: 22, wall: PAL.timber, roof: PAL.roof },
  cliffside_cable_station: { h: 34, ridge: 26, wall: PAL.timber, roof: PAL.iron },
  stormglass_observatory: { h: 62, ridge: 20, wall: PAL.stone, roof: PAL.copper },
  ashen_conservatory: { h: 26, ridge: 18, wall: PAL.iron, roof: PAL.rock },
  inverted_manor: { h: 76, ridge: 12, wall: PAL.timber, roof: PAL.stone },
  sleeping_foundry: { h: 56, ridge: 30, wall: PAL.rust, roof: PAL.roofSlate },
  moonwell_pavilion: { h: 48, ridge: 16, wall: PAL.stone, roof: PAL.roofSlate },
  house_between_seasons: { h: 32, ridge: 22, wall: PAL.timber, roof: PAL.roof },
};

/**
 * A landmark's stand-in: its footprint on the ground and a plain body on it. (ax, ay) is the
 * footprint's centre, the anchor the painted frames have too, so the game places either the same
 * way.
 */
export function landmarkPlaceholder(id: string) {
  const footprint = LANDMARK_FOOTPRINTS[id];
  const look = LOOK[id];
  if (!footprint || !look) throw new Error(`No landmark placeholder for ${id}`);
  const [W, D] = footprint;
  const reach = (W + D) * 16;
  const depth = (W + D) * 8;
  const ax = reach + 1;
  const ay = look.h + look.ridge + depth + 1;
  const buf = new PixelBuf(ax * 2, ay + depth + 2);
  const seed = W * 17 + D * 5 + look.h;
  const ground = [
    proj(ax, ay, -W / 2, -D / 2),
    proj(ax, ay, W / 2, -D / 2),
    proj(ax, ay, W / 2, D / 2),
    proj(ax, ay, -W / 2, D / 2),
  ];
  fillPoly(buf, ground, (x, y) => pickShade(x, y, PAL.ballast, seed));
  drawPrism(buf, {
    ox: ax,
    oy: ay,
    cx: 0,
    cy: 0,
    angle: 0,
    len: W - 0.3,
    wid: D - 0.3,
    h: look.h,
    top: look.roof,
    side: look.wall,
    seed,
    ridge: look.ridge,
    roof: look.roof,
  });
  return { buf, ax, ay };
}

/** The `landmarks` group without its painted file: one frame per landmark, no turned views. */
export function generateLandmarksAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  for (const id of Object.keys(LANDMARK_FOOTPRINTS)) {
    const { buf, ax, ay } = landmarkPlaceholder(id);
    ab.add(`landmarks/${id}`, buf.toImageData(), ax, ay);
  }
  return ab.build(1024);
}
