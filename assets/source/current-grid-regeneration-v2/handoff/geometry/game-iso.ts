/** Isometric 2:1 projection. Base tile is 64 x 32 px. */
export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
/** Screen-pixel rise of one elevation step. */
export const ELEV_PX = 10;

export interface Vec2 {
  x: number;
  y: number;
}

/** Tile-space (fractional allowed) -> world pixel space. Returns the tile centre for integer input. */
export function tileToWorld(tx: number, ty: number): Vec2 {
  return { x: (tx - ty) * HALF_W, y: (tx + ty) * HALF_H };
}

/** World pixel -> fractional tile coordinates. Tile centre (tx,ty) maps to integer values. */
export function worldToTile(wx: number, wy: number): Vec2 {
  return { x: wx / TILE_W + wy / TILE_H, y: wy / TILE_H - wx / TILE_W };
}

/** Integer tile under a world pixel. */
export function worldToTileInt(wx: number, wy: number): Vec2 {
  const t = worldToTile(wx, wy);
  return { x: Math.floor(t.x + 0.5), y: Math.floor(t.y + 0.5) };
}

/** Pixel bounds of a W x H tile map in world space. */
export function mapWorldBounds(w: number, h: number) {
  return {
    minX: -(h - 1) * HALF_W - HALF_W,
    maxX: (w - 1) * HALF_W + HALF_W,
    minY: -HALF_H,
    maxY: (w + h - 2) * HALF_H + HALF_H,
  };
}

/** Continuous depth key: bigger draws later (in front). */
export function depthKey(tx: number, ty: number, layer = 0): number {
  return (tx + ty) * 100 + layer;
}

/** Cardinal directions in tile space. N = -y, E = +x, S = +y, W = -x. */
export const enum Dir {
  N = 0,
  E = 1,
  S = 2,
  W = 3,
}
export const DIRS: readonly Dir[] = [Dir.N, Dir.E, Dir.S, Dir.W];
export const DIR_DX = [0, 1, 0, -1];
export const DIR_DY = [-1, 0, 1, 0];
export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}
export function rotateDir(d: Dir, steps: number): Dir {
  return ((((d + steps) % 4) + 4) % 4) as Dir;
}

/**
 * Convert a heading angle in tile space (atan2(dy, dx)) into one of 8 facings.
 * Facing 0 = +x (screen down-right), going clockwise in tile space.
 */
export function angleToFacing8(angle: number): number {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(a / (Math.PI / 4)) % 8;
}
