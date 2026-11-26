import { Container, ImageSource, Sprite, Texture, TilingSprite } from 'pixi.js';
import { HALF_H, HALF_W, tileToWorld } from '../engine/iso';
import { tileLevels } from '../world/elevation';
import { Terrain, type GameMap } from '../world/tiles';
import { lot } from './lifeMotion';

/** The depth mask has a texel for this many world px: mist has no edges to keep. */
const MASK_PX = 8;
/** How far water reaches into the land, in tiles, and how far a tile looks for a valley. */
const SHORE = 1.6;
const AROUND = 3;
/** Mist is gone from this level up. */
const MIST_TOP = 3.6;
/** The cloud picture's size, and how many world px its two layers span to a texel. */
const CLOUD = 160;
const LAYERS = [
  { scale: 3.4, pace: 1, alpha: 1, seed: 901 },
  { scale: 2.3, pace: 1.5, alpha: 0.55, seed: 917 },
] as const;

const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** World px a second mist drifts downwind: slowly, 3 in a calm and 12 in a storm. */
export const mistDrift = (strength: number) => 3 + 9 * strength;

/**
 * How deep mist lies on each tile, 0..1: most on the water, then on land by how near it lies to
 * water and how far below its surroundings, all thinning with the level, none on the heights.
 */
export function mistDepths(map: GameMap, levels: Uint8Array = tileLevels(map)) {
  const { w, h, terrain } = map,
    depth = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = 0.8;
      if (terrain[i] !== Terrain.Water) {
        let near = 0,
          sum = 0,
          count = 0;
        for (let dy = -AROUND; dy <= AROUND; dy++)
          for (let dx = -AROUND; dx <= AROUND; dx++) {
            const ox = x + dx,
              oy = y + dy;
            if (ox < 0 || oy < 0 || ox >= w || oy >= h) continue;
            const o = oy * w + ox;
            sum += levels[o];
            count++;
            if (terrain[o] === Terrain.Water)
              near = Math.max(near, Math.exp(-Math.hypot(dx, dy) / SHORE));
          }
        const valley = Math.max(0, Math.min(1, (sum / count - levels[i]) / 1.1));
        d = Math.max(near * 0.8, valley * 0.75);
      }
      depth[i] = d * (1 - smooth((levels[i] - 0.6) / (MIST_TOP - 0.6)));
    }
  return depth;
}

/** The mist's depth at a point in tiles, read between the tile centres; 0 off the map. */
export function depthAt(depth: Float32Array, w: number, h: number, x: number, y: number) {
  if (x <= -0.5 || y <= -0.5 || x >= w - 0.5 || y >= h - 0.5) return 0;
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))),
    y0 = Math.max(0, Math.min(h - 2, Math.floor(y))),
    fx = Math.max(0, Math.min(1, x - x0)),
    fy = Math.max(0, Math.min(1, y - y0)),
    at = (a: number, b: number) => depth[b * w + a];
  return (
    (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  );
}

/** A soft cloud picture that repeats: three octaves of value noise, pale and thin at its gaps. */
function cloudCanvas(seed: number) {
  const lattices = [4, 8, 16].map((p, o) =>
      Float32Array.from({ length: p * p }, (_, i) => lot(i, p, seed + o)),
    ),
    octave = (o: number, u: number, v: number) => {
      const p = 4 << o,
        x = u * p,
        y = v * p,
        x0 = Math.floor(x),
        y0 = Math.floor(y),
        fx = smooth(x - x0),
        fy = smooth(y - y0),
        L = lattices[o],
        a = L[(y0 % p) * p + (x0 % p)],
        b = L[(y0 % p) * p + ((x0 + 1) % p)],
        c = L[((y0 + 1) % p) * p + (x0 % p)],
        d = L[((y0 + 1) % p) * p + ((x0 + 1) % p)];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    },
    canvas = document.createElement('canvas');
  canvas.width = canvas.height = CLOUD;
  const g = canvas.getContext('2d')!,
    image = g.createImageData(CLOUD, CLOUD);
  for (let j = 0; j < CLOUD; j++)
    for (let i = 0; i < CLOUD; i++) {
      const u = i / CLOUD,
        v = j / CLOUD,
        d = 0.55 * octave(0, u, v) + 0.3 * octave(1, u, v) + 0.15 * octave(2, u, v),
        p = (j * CLOUD + i) * 4;
      image.data[p] = 218;
      image.data[p + 1] = 227;
      image.data[p + 2] = 232;
      image.data[p + 3] = Math.round(255 * (0.12 + 0.88 * smooth((d - 0.34) / 0.34)));
    }
  g.putImageData(image, 0, 0);
  return canvas;
}

/** The map's depths as white at that alpha, in a canvas over the map's whole diamond. */
function maskCanvas(map: GameMap) {
  const depth = mistDepths(map),
    { w, h } = map,
    left = -h * HALF_W,
    right = w * HALF_W,
    bottom = (w + h) * HALF_H,
    cw = Math.ceil((right - left) / MASK_PX),
    ch = Math.ceil(bottom / MASK_PX),
    canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d')!,
    image = g.createImageData(cw, ch);
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const wx = left + i * MASK_PX,
        wy = j * MASK_PX,
        tx = wx / (2 * HALF_W) + wy / (2 * HALF_H),
        ty = wy / (2 * HALF_H) - wx / (2 * HALF_W),
        p = (j * cw + i) * 4;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = 255;
      image.data[p + 3] = Math.round(255 * Math.min(1, depthAt(depth, w, h, tx, ty)));
    }
  g.putImageData(image, 0, 0);
  return { canvas, left };
}

const texture = (resource: HTMLCanvasElement, addressMode: 'repeat' | 'clamp-to-edge') =>
  new Texture({ source: new ImageSource({ resource, scaleMode: 'linear', addressMode }) });

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Mist that lies on the water and in the valleys while the weather is foggy, in two layers of cloud
 * that drift downwind, cut by a mask of how deep it lies. The mask and the clouds are made the first
 * time fog comes: nothing is built or drawn before that, or on a clear day.
 */
export class ValleyMist {
  readonly root = new Container();
  private layers: { sprite: TilingSprite; x: number; y: number }[] = [];
  private built = false;

  constructor(private readonly map: GameMap) {
    this.root.visible = false;
  }

  private build() {
    this.built = true;
    const { canvas, left } = maskCanvas(this.map),
      mask = new Sprite(texture(canvas, 'clamp-to-edge')),
      clouds = new Container();
    mask.position.set(left, tileToWorld(0, 0).y);
    mask.scale.set(MASK_PX);
    for (const layer of LAYERS) {
      const sprite = new TilingSprite({ texture: texture(cloudCanvas(layer.seed), 'repeat') });
      sprite.tileScale.set(layer.scale);
      sprite.alpha = layer.alpha;
      clouds.addChild(sprite);
      this.layers.push({ sprite, x: 0, y: 0 });
    }
    clouds.mask = mask;
    this.root.addChild(mask, clouds);
  }

  /** `dt` seconds on (0 while paused), `amount` of fog showing 0..1, `view` in world px. */
  update(
    dt: number,
    amount: number,
    view: View,
    wind: { strength: number; dir: { x: number; y: number } },
  ) {
    this.root.visible = amount > 0.02;
    if (!this.root.visible) return;
    if (!this.built) this.build();
    this.root.alpha = Math.min(1, amount * 1.3) * 0.9;
    const pace = mistDrift(wind.strength);
    this.layers.forEach((layer, i) => {
      const { pace: own } = LAYERS[i];
      layer.x += wind.dir.x * pace * own * dt;
      layer.y += wind.dir.y * pace * own * dt;
      layer.sprite.position.set(view.x, view.y);
      layer.sprite.width = view.w;
      layer.sprite.height = view.h;
      // the clouds keep their place on the ground as the view moves over them
      layer.sprite.tilePosition.set(layer.x - view.x + i * 53, layer.y - view.y + i * 31);
    });
  }
}
