import type { AtlasImage, AtlasRegistry, FrameDef } from '../engine/atlas';
import {
  bridgeQuads,
  bridgeTile,
  project,
  type BridgeDeck,
  type BridgeMaterial,
  type BridgeQuad,
} from './bridgeGeometry';

/** Texels per world pixel the pictures are drawn at. */
const DENSITY = 4;
/** Deck height of the pictured span in levels: its supports show, piers and all. */
const PICTURED_DECK = 2.6;

/**
 * The affine map that takes three texture points to three canvas points, as the six numbers of
 * `CanvasRenderingContext2D.setTransform`; null when the texture points lie on one line.
 */
export function triangleTransform(
  uv: readonly number[],
  xy: readonly number[],
): [number, number, number, number, number, number] | null {
  const [u0, v0, u1, v1, u2, v2] = uv,
    [x0, y0, x1, y1, x2, y2] = xy,
    det = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (p0: number, p1: number, p2: number) => [
    (p0 * (v1 - v2) + p1 * (v2 - v0) + p2 * (v0 - v1)) / det,
    (p0 * (u2 - u1) + p1 * (u0 - u2) + p2 * (u1 - u0)) / det,
    (p0 * (u1 * v2 - u2 * v1) + p1 * (u2 * v0 - u0 * v2) + p2 * (u0 * v1 - u1 * v0)) / det,
  ];
  const [a, c, e] = solve(x0, x1, x2),
    [b, d, f] = solve(y0, y1, y2);
  return [a, b, c, d, e, f];
}

/** One textured quad onto a 2D canvas, as two triangles; `at` maps world pixels to canvas. */
function drawQuad(
  ctx: CanvasRenderingContext2D,
  atlas: AtlasRegistry,
  q: BridgeQuad,
  at: (sx: number, sy: number) => [number, number],
) {
  if (!atlas.has(q.key)) return;
  const f = atlas.get(q.key),
    r = f.texture.frame,
    xy: number[] = [],
    uv: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = project(q.p[i * 3], q.p[i * 3 + 1], q.p[i * 3 + 2]);
    xy.push(...at(sx, sy));
    uv.push(r.x + q.uv[i * 2] * r.width, r.y + q.uv[i * 2 + 1] * r.height);
  }
  for (const [i, j, k] of [
    [0, 1, 2],
    [0, 2, 3],
  ]) {
    const pts = [i, j, k].flatMap((n) => [xy[n * 2], xy[n * 2 + 1]]),
      m = triangleTransform(
        [i, j, k].flatMap((n) => [uv[n * 2], uv[n * 2 + 1]]),
        pts,
      );
    if (!m) continue;
    // Clip a hair wider than the triangle, so the two halves of a quad leave no seam.
    const cx = (pts[0] + pts[2] + pts[4]) / 3,
      cy = (pts[1] + pts[3] + pts[5]) / 3,
      out = (x: number, y: number): [number, number] => {
        const d = Math.hypot(x - cx, y - cy) || 1;
        return [x + ((x - cx) / d) * 0.6, y + ((y - cy) / d) * 0.6];
      };
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...out(pts[0], pts[1]));
    ctx.lineTo(...out(pts[2], pts[3]));
    ctx.lineTo(...out(pts[4], pts[5]));
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(...m);
    ctx.drawImage(f.image, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
    ctx.restore();
  }
}

/**
 * Pictures of a short bridge per material, as the atlas frames `structures/bridge_wood` and
 * `structures/bridge_stone` (toolbar and build card): two platforms as the world draws them
 * (bridgeGeometry.ts), standing on flat ground as if track ran along them. Composed once the
 * atlas groups are loaded, from whichever swatches they hold. `step` is the world pixels one
 * level rises.
 */
export function bridgePictures(atlas: AtlasRegistry, step: number): AtlasImage {
  const materials: BridgeMaterial[] = ['wood', 'stone'],
    SPANS = 2,
    rise = PICTURED_DECK * step + 14,
    w = 32 * (SPANS + 1) + 8,
    h = Math.ceil(16 * (SPANS + 1) + rise + 8),
    image = document.createElement('canvas'),
    frames: Record<string, FrameDef> = {};
  image.width = w * DENSITY * materials.length;
  image.height = h * DENSITY;
  const ctx = image.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  materials.forEach((material, n) => {
    const decks: BridgeDeck[] = Array.from({ length: SPANS }, (_, x) => ({
        x,
        y: 0,
        material,
        step,
        deck: PICTURED_DECK,
        rails: [1, 3],
        level: 1,
        water: false,
      })),
      beside = (x: number, y: number) => (y === 0 ? decks[x] : undefined),
      // Tile (0, 0) stands 32 px in from the left edge and its far corner `rise` below the top.
      ox = n * w + 36,
      oy = 4 + rise + 16,
      at = (sx: number, sy: number): [number, number] => [(ox + sx) * DENSITY, (oy + sy) * DENSITY];
    ctx.save();
    ctx.beginPath();
    ctx.rect(n * w * DENSITY, 0, w * DENSITY, h * DENSITY);
    ctx.clip();
    // Far span first: the near one stands in front of it.
    for (const deck of decks) {
      const quads = bridgeQuads(bridgeTile(deck, beside), () => 0);
      for (const q of [...quads.body, ...quads.near]) drawQuad(ctx, atlas, q, at);
    }
    ctx.restore();
    frames[`structures/bridge_${material}`] = {
      x: n * w * DENSITY,
      y: 0,
      w: w * DENSITY,
      h: h * DENSITY,
      ax: (w / 2) * DENSITY,
      ay: (h - 8) * DENSITY,
    };
  });
  return { image, frames, resolution: DENSITY };
}
