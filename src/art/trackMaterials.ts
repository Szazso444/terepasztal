/**
 * Painted track materials (specs/codex-track-lines.txt, packed by tools/track-materials.mjs into
 * public/assets/track-materials): per line a ballast bed and a shoulder edge that repeat along the
 * track every tile, one sleeper, and for some lines grass tufts or a kilometre post. The track
 * generator lays them along each rail line (`drawStrip`, `drawSprite`) where they are loaded; it
 * draws its own procedural look where they are not (tests, or a missing file).
 */
import type { Vec2 } from '../engine/iso';
import type { TrackClass } from '../world/track';

export type MaterialImage = CanvasImageSource & { width: number; height: number };
export interface LineMaterials {
  /** the ballast bed, `pxPerTile` long, its height the bed's width */
  bed?: MaterialImage;
  /** the shoulder along the bed's top edge (the bottom row touches the bed); mirrored below */
  edge?: MaterialImage;
  /** one sleeper lying across the track: its width the sleeper's length */
  sleeper?: MaterialImage;
  /** grass tufts in square cells side by side */
  tufts?: MaterialImage;
  /** a kilometre post */
  post?: MaterialImage;
  /** the first and last row of the bed and of the edge painted solid, inside their soft fades */
  solid?: Partial<Record<'bed' | 'edge', [number, number]>>;
}
export interface TrackMaterials {
  pxPerTile: number;
  lines: Partial<Record<TrackClass, LineMaterials>>;
}
export const NO_MATERIALS: TrackMaterials = { pxPerTile: 256, lines: {} };

const NAMES = ['bed', 'edge', 'sleeper', 'tufts', 'post'] as const;

/** Load the packed materials; anything missing is left out, and nothing at all is no materials. */
export async function loadTrackMaterials(base: string): Promise<TrackMaterials> {
  try {
    const res = await fetch(`${base}assets/track-materials/materials.json`, { cache: 'no-cache' });
    if (!res.ok) return NO_MATERIALS;
    const index = (await res.json()) as {
      pxPerTile: number;
      lines: Record<string, Record<string, unknown> & { solid?: LineMaterials['solid'] }>;
    };
    const lines: TrackMaterials['lines'] = {};
    await Promise.all(
      Object.entries(index.lines).map(async ([line, files]) => {
        const got: LineMaterials = { solid: files.solid };
        await Promise.all(
          NAMES.filter((n) => n in files).map(async (n) => {
            const image = new Image();
            const ok = await new Promise<boolean>((done) => {
              image.onload = () => done(true);
              image.onerror = () => done(false);
              image.src = `${base}assets/track-materials/${line}/${n}.png`;
            });
            if (ok) got[n] = image;
          }),
        );
        lines[line as TrackClass] = got;
      }),
    );
    return { pxPerTile: index.pxPerTile, lines };
  } catch {
    return NO_MATERIALS;
  }
}

/** The tile-to-frame projection, world px: x' = ox + 32 (x - y), y' = oy + 16 (x + y). */
export interface Projection {
  ox: number;
  oy: number;
}

/**
 * Set `c`'s transform (on top of `base`) so that image px (sx, sy) lands at tile point
 * `origin + along * sx * perPxAlong + across * sy * perPxAcross`, projected.
 */
function frameTransform(
  c: CanvasRenderingContext2D,
  base: DOMMatrix,
  pr: Projection,
  origin: Vec2,
  along: Vec2,
  across: Vec2,
  perPxAlong: number,
  perPxAcross: number,
) {
  const ax = along.x * perPxAlong,
    ay = along.y * perPxAlong,
    nx = across.x * perPxAcross,
    ny = across.y * perPxAcross;
  c.setTransform(base);
  c.transform(
    32 * (ax - ay),
    16 * (ax + ay),
    32 * (nx - ny),
    16 * (nx + ny),
    pr.ox + 32 * (origin.x - origin.y),
    pr.oy + 16 * (origin.x + origin.y),
  );
}

/**
 * Lay a strip image along a line: `points` with unit `normals` (left of the direction of travel),
 * the strip's row 0 at `from` tiles across the line and its last row at `to`. The strip repeats
 * every `pxPerTile * stretch` px along: `stretch` fits a whole number of repeats into the line.
 * Slices far from the frame's own tile (more than `reach` tiles from the origin) are skipped.
 */
export function drawStrip(
  c: CanvasRenderingContext2D,
  pr: Projection,
  img: MaterialImage,
  points: Vec2[],
  normals: Vec2[],
  from: number,
  to: number,
  pxPerTile: number,
  stretch: number,
  reach = 1.6,
  /** px along the image at the start of `points` */
  shift = 0,
) {
  const base = c.getTransform();
  const period = img.width;
  const perTile = pxPerTile * stretch;
  let dist = shift / perTile;
  // slices: merge samples while the direction stays within a few degrees
  let i = 0;
  while (i < points.length - 1) {
    const a = points[i];
    let j = i + 1;
    const dir0 = Math.atan2(points[j].y - a.y, points[j].x - a.x);
    while (
      j + 1 < points.length &&
      Math.abs(Math.atan2(points[j + 1].y - points[j].y, points[j + 1].x - points[j].x) - dir0) <
        0.035 &&
      Math.hypot(points[j + 1].x - a.x, points[j + 1].y - a.y) < 0.35
    )
      j++;
    const b = points[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (len > 1e-9 && Math.max(Math.abs(mid.x), Math.abs(mid.y)) < reach) {
      const along = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const n = normals[i];
      const across = { x: n.x, y: n.y };
      const origin = { x: a.x + across.x * from, y: a.y + across.y * from };
      frameTransform(c, base, pr, origin, along, across, 1 / perTile, (to - from) / img.height);
      // the slice's px along the image, wrapped; a slice over the wrap is drawn in two
      let u = (dist * perTile) % period;
      let left = len * perTile;
      let at = 0;
      while (left > 1e-6) {
        const w = Math.min(left, period - u);
        // a hair of overlap closes the seams between slices
        c.drawImage(img, u, 0, Math.max(w, 0.01), img.height, at, 0, w + 0.6, img.height);
        at += w;
        left -= w;
        u = 0;
      }
    }
    dist += len;
    i = j;
  }
  c.setTransform(base);
}

/**
 * Draw one image centred at tile point `at`, its width along `across` (`width` tiles) and its
 * height along `along` (`height` tiles): a sleeper lying across the track, a tuft, a post.
 */
export function drawSprite(
  c: CanvasRenderingContext2D,
  pr: Projection,
  img: MaterialImage,
  at: Vec2,
  along: Vec2,
  across: Vec2,
  width: number,
  height: number,
  sx = 0,
  sw = img.width,
) {
  const base = c.getTransform();
  const origin = {
    x: at.x - (across.x * width) / 2 - (along.x * height) / 2,
    y: at.y - (across.y * width) / 2 - (along.y * height) / 2,
  };
  frameTransform(c, base, pr, origin, across, along, width / sw, height / img.height);
  c.drawImage(img, sx, 0, sw, img.height, 0, 0, sw, img.height);
  c.setTransform(base);
}
