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
}
export type AtlasGenerator = () => AtlasImage;

export interface FrameInfo {
  texture: Texture;
  anchorX: number;
  anchorY: number;
  w: number;
  h: number;
}

/**
 * Asset pipeline. Each named atlas group is loaded from `/assets/<group>.json` + `.png` when
 * present (exported by any packer that writes {frames:{name:{x,y,w,h,ax,ay}}}); otherwise the
 * procedural generator supplies it. Game code only ever asks for frame names.
 */
export class AtlasRegistry {
  private frames = new Map<string, FrameInfo>();
  private sources: ImageSource[] = [];
  readonly groupOrigin = new Map<string, 'png' | 'procedural'>();
  /** Raw atlas images by group, kept for the debug atlas viewer. */
  readonly images = new Map<string, HTMLCanvasElement | HTMLImageElement>();

  async load(groups: { name: string; generate: AtlasGenerator }[]) {
    await Promise.all(groups.map((g) => this.loadGroup(g.name, g.generate)));
  }

  private async loadGroup(name: string, generate: AtlasGenerator) {
    const fromFile = await this.tryLoadFile(name);
    if (fromFile) {
      this.register(fromFile);
      this.images.set(name, fromFile.image);
      this.groupOrigin.set(name, 'png');
      return;
    }
    const gen = generate();
    this.register(gen);
    this.images.set(name, gen.image);
    this.groupOrigin.set(name, 'procedural');
  }

  private async tryLoadFile(name: string): Promise<AtlasImage | null> {
    try {
      const res = await fetch(`/assets/${name}.json`, { cache: 'no-cache' });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) return null;
      const json = (await res.json()) as { frames: Record<string, FrameDef> };
      const image = new Image();
      await new Promise<void>((ok, fail) => {
        image.onload = () => ok();
        image.onerror = () => fail(new Error('atlas png missing'));
        image.src = `/assets/${name}.png`;
      });
      return { image, frames: json.frames };
    } catch {
      return null;
    }
  }

  private register(atlas: AtlasImage) {
    const source = new ImageSource({
      resource: atlas.image,
      scaleMode: 'nearest',
      autoGenerateMipmaps: false,
    });
    this.sources.push(source);
    for (const [key, f] of Object.entries(atlas.frames)) {
      const texture = new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) });
      this.frames.set(key, { texture, anchorX: f.ax / f.w, anchorY: f.ay / f.h, w: f.w, h: f.h });
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
