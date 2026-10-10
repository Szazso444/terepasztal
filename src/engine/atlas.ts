import { Texture, ImageSource, Rectangle } from 'pixi.js';

/** One frame inside an atlas. Anchor is in pixels from the frame's top-left. */
export interface FrameDef {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}
export interface AtlasImage {
  image: HTMLCanvasElement | HTMLImageElement;
  frames: Record<string, FrameDef>;
  /** Physical texels per world pixel. Procedural and legacy atlases use 1. */
  resolution?: number;
  /** a file atlas that replaces only its own frames and keeps the generator for the rest */
  partial?: boolean;
}
export type AtlasGenerator = () => AtlasImage;

export interface FrameInfo {
  image: HTMLCanvasElement | HTMLImageElement;
  texture: Texture;
  anchorX: number;
  anchorY: number;
  w: number;
  h: number;
}

/**
 * Names with a `.json` in `public/assets` when the bundle was built (`vite.config.ts`); undefined
 * where nothing defines it, such as the Node tests.
 */
declare const __ATLAS_FILES__: readonly string[] | undefined;
/** The groups the build ships a file pair for. */
const SHIPPED_GROUPS: ReadonlySet<string> = new Set(
  typeof __ATLAS_FILES__ === 'undefined' ? [] : __ATLAS_FILES__,
);

/**
 * Asset pipeline. Each named atlas group is loaded from `/assets/<group>.json` + `.png` when
 * present (exported by any packer that writes {frames:{name:{x,y,w,h,ax,ay}}}); otherwise the
 * procedural generator supplies it. A file marked `"partial": true` is layered over the
 * generator instead, so a handful of rendered frames can replace their procedural namesakes
 * without the rest of the group going missing. Game code only ever asks for frame names.
 *
 * A group the build ships a file for and that falls back to its generator anyway is a broken file
 * or server: it is warned about once, on the console. A group with no file is procedural by design
 * and stays quiet.
 */
export class AtlasRegistry {
  private frames = new Map<string, FrameInfo>();
  private sources: ImageSource[] = [];
  readonly groupOrigin = new Map<string, 'png' | 'procedural' | 'png+procedural'>();
  /** Raw atlas images by group, kept for the debug atlas viewer. */
  readonly images = new Map<string, HTMLCanvasElement | HTMLImageElement>();
  /** shipped groups already warned about */
  private warned = new Set<string>();

  constructor(
    /** groups whose file pair ships with the game; the build's list unless a test gives one */
    private readonly shipped: ReadonlySet<string> = SHIPPED_GROUPS,
  ) {}

  async load(groups: { name: string; generate: AtlasGenerator }[]) {
    await Promise.all(groups.map((g) => this.loadGroup(g.name, g.generate)));
  }

  private async loadGroup(name: string, generate: AtlasGenerator) {
    const fromFile = await this.tryLoadFile(name);
    if (typeof fromFile !== 'string') {
      // generated first, so the file's frames win where the names collide
      if (fromFile.partial) this.register(generate());
      this.register(fromFile);
      this.images.set(name, fromFile.image);
      this.groupOrigin.set(name, fromFile.partial ? 'png+procedural' : 'png');
      return;
    }
    if (this.shipped.has(name) && !this.warned.has(name)) {
      this.warned.add(name);
      console.warn(`Atlas: ${name} falls back to procedural art: ${fromFile}`);
    }
    const gen = generate();
    this.register(gen);
    this.images.set(name, gen.image);
    this.groupOrigin.set(name, 'procedural');
  }

  /** The group's file pair, or why it cannot be used. */
  private async tryLoadFile(name: string): Promise<AtlasImage | string> {
    const json = `/assets/${name}.json`;
    const png = `/assets/${name}.png`;
    try {
      const res = await fetch(json, { cache: 'no-cache' });
      if (!res.ok) return `${json} answered ${res.status}`;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) return `${json} came as ${ct || 'no content type'}`;
      const data = (await res.json()) as Omit<AtlasImage, 'image'>;
      const resolution = data.resolution ?? 1;
      if (!Number.isFinite(resolution) || resolution < 1 || resolution > 8)
        return `${json} has resolution ${resolution}, outside 1 to 8`;
      const image = new Image();
      const loaded = await new Promise<boolean>((done) => {
        image.onload = () => done(true);
        image.onerror = () => done(false);
        image.src = png;
      });
      if (!loaded) return `${png} did not load as an image`;
      return { image, frames: data.frames, resolution, partial: data.partial === true };
    } catch (err) {
      return `${json} did not load: ${String(err)}`;
    }
  }

  private register(atlas: AtlasImage) {
    const resolution = atlas.resolution ?? 1;
    const source = new ImageSource({
      resource: atlas.image,
      scaleMode: resolution > 1 ? 'linear' : 'nearest',
      autoGenerateMipmaps: resolution > 1,
    });
    this.sources.push(source);
    for (const [key, f] of Object.entries(atlas.frames)) {
      // UVs address physical texels; orig controls the sprite's world-space dimensions.
      // This also preserves callers that mirror/rotate sprites at scale 1 (rolling stock).
      const texture = new Texture({
        source,
        frame: new Rectangle(f.x, f.y, f.w, f.h),
        orig: new Rectangle(0, 0, f.w / resolution, f.h / resolution),
      });
      this.frames.set(key, {
        image: atlas.image,
        texture,
        anchorX: f.ax / f.w,
        anchorY: f.ay / f.h,
        w: f.w / resolution,
        h: f.h / resolution,
      });
    }
  }

  has(key: string) {
    return this.frames.has(key);
  }
  get(key: string): FrameInfo {
    const f = this.frames.get(key);
    if (!f) throw new Error(`Missing atlas frame: ${key}`);
    return f;
  }
  keys(prefix: string): string[] {
    return [...this.frames.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/** Simple shelf packer producing a canvas + frame table from a list of pixel buffers. */
export class AtlasBuilder {
  private items: { key: string; img: ImageData; ax: number; ay: number }[] = [];
  add(key: string, img: ImageData, ax: number, ay: number) {
    // Pack actual ink, retaining the ground anchor. Blank sprite margins otherwise dominate
    // the 48-facing rolling atlases.
    let left = img.width;
    let top = img.height;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (img.data[(y * img.width + x) * 4 + 3]) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
    if (left === img.width) {
      left = top = 0;
      right = bottom = 1;
    }
    const trimmed = new ImageData(right - left, bottom - top);
    for (let y = top; y < bottom; y++)
      trimmed.data.set(
        img.data.subarray((y * img.width + left) * 4, (y * img.width + right) * 4),
        (y - top) * trimmed.width * 4,
      );
    this.items.push({ key, img: trimmed, ax: ax - left, ay: ay - top });
  }
  build(maxW = 1024): AtlasImage {
    const pad = 1;
    const sorted = [...this.items].sort((a, b) => b.img.height - a.img.height);
    let x = pad;
    let y = pad;
    let shelfH = 0;
    const placed: { it: (typeof sorted)[0]; x: number; y: number }[] = [];
    for (const it of sorted) {
      if (x + it.img.width + pad > maxW) {
        x = pad;
        y += shelfH + pad;
        shelfH = 0;
      }
      placed.push({ it, x, y });
      x += it.img.width + pad;
      shelfH = Math.max(shelfH, it.img.height);
    }
    const totalH = y + shelfH + pad;
    const canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = Math.max(1, nextPow2(totalH));
    const ctx = canvas.getContext('2d')!;
    const frames: Record<string, FrameDef> = {};
    for (const p of placed) {
      ctx.putImageData(p.it.img, p.x, p.y);
      frames[p.it.key] = {
        x: p.x,
        y: p.y,
        w: p.it.img.width,
        h: p.it.img.height,
        ax: p.it.ax,
        ay: p.it.ay,
      };
    }
    return { image: canvas, frames };
  }
}

function nextPow2(v: number) {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}
