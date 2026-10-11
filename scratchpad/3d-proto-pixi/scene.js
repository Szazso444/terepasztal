// Shared scratch scene: a Pixi app set up like the game's (webgl, antialias off, roundPixels),
// an isometric ground with drawn rails, and real game sprites to order the 3D mesh against.
import { Application, Container, Graphics, ImageSource, Rectangle, Sprite, Texture } from 'pixi.js';
import { tileToWorld, HALF_W, HALF_H } from './train3d.js';

export const params = new URLSearchParams(location.search);
export const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
export const depthKey = (tx, ty, layer = 0) => (tx + ty) * 100 + layer;

export async function makeApp(extra = {}) {
  const app = new Application();
  await app.init({
    canvas: document.getElementById('game-canvas'),
    resizeTo: window,
    background: '#0a0a0c',
    antialias: false,
    roundPixels: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    preference: 'webgl',
    ...extra,
  });
  const gl = app.renderer.gl;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  app.glInfo = {
    version: gl.getParameter(gl.VERSION),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    depthBits: gl.getParameter(gl.DEPTH_BITS),
    stencilBits: gl.getParameter(gl.STENCIL_BITS),
    samples: gl.getParameter(gl.SAMPLES),
    contextAttributes: gl.getContextAttributes(),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    resolution: app.renderer.resolution,
  };
  return app;
}

/** Atlas loader as the game's (src/engine/atlas.ts): resolution > 1 is linear + mipmaps. */
export async function loadAtlas(name) {
  const json = await (await fetch(`/assets/${name}.json`)).json();
  const image = new Image();
  await new Promise((ok, fail) => {
    image.onload = ok;
    image.onerror = fail;
    image.src = `/assets/${name}.png`;
  });
  const resolution = json.resolution ?? 1;
  const source = new ImageSource({
    resource: image,
    scaleMode: resolution > 1 ? 'linear' : 'nearest',
    autoGenerateMipmaps: resolution > 1,
  });
  const frames = new Map();
  for (const [key, f] of Object.entries(json.frames)) {
    frames.set(key, {
      texture: new Texture({
        source,
        frame: new Rectangle(f.x, f.y, f.w, f.h),
        orig: new Rectangle(0, 0, f.w / resolution, f.h / resolution),
      }),
      anchorX: f.ax / f.w,
      anchorY: f.ay / f.h,
    });
  }
  return {
    frames,
    sprite(key, tx, ty, layer = 10) {
      const f = frames.get(key);
      if (!f) throw new Error('missing frame ' + key);
      const s = new Sprite({ texture: f.texture });
      s.anchor.set(f.anchorX, f.anchorY);
      const w = tileToWorld(tx, ty);
      s.position.set(w.x, w.y);
      s.zIndex = depthKey(tx, ty, layer);
      return s;
    },
  };
}

/** World container with a ground grid; returns layers and a camera helper. */
export function makeWorld(app, { size = 28 } = {}) {
  const world = new Container();
  const ground = new Graphics();
  const rails = new Graphics();
  const objects = new Container({ sortableChildren: true });
  world.addChild(ground, rails, objects);
  app.stage.addChild(world);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = tileToWorld(x, y);
      ground
        .poly([c.x, c.y - HALF_H, c.x + HALF_W, c.y, c.x, c.y + HALF_H, c.x - HALF_W, c.y])
        .fill((x + y) % 2 ? 0x5d8a48 : 0x658f4d);
    }
  const camera = {
    zoom: 1,
    look(tx, ty, zoom = 1) {
      const c = tileToWorld(tx, ty);
      this.zoom = zoom;
      world.scale.set(zoom);
      world.position.set(
        Math.round(app.screen.width / 2 - c.x * zoom),
        Math.round(app.screen.height / 2 - c.y * zoom),
      );
    },
  };
  return { world, ground, rails, objects, camera };
}

const GAUGE = 0.32; // tiles between the rails (the game's drawn gauge)

/** Two rails and sleepers along a tile-space polyline. */
export function drawTrack(g, pts) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = -(b[1] - a[1]) / d;
      const ny = (b[0] - a[0]) / d;
      const w = tileToWorld(pts[i][0] + (nx * side * GAUGE) / 2, pts[i][1] + (ny * side * GAUGE) / 2);
      if (i === 0) g.moveTo(w.x, w.y);
      else g.lineTo(w.x, w.y);
    }
    g.stroke({ width: 1, color: 0x2a2a30, pixelLine: false });
  }
}

export const straight = (x0, y0, x1, y1, n = 2) =>
  Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)]);
export const circle = (cx, cy, r, n = 96) =>
  Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
