import { Texture, ImageSource, Rectangle } from 'pixi.js';
import type { AtlasCache } from './atlasCache';

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
  /** a file atlas too large for one texture: `<group>-2` .. `<group>-<pages>` hold the rest */
  pages?: number;
  /**
   * Pages per vehicle (`{"loco_m62": ["rolling-loco_m62-1", ...]}`): loaded only while that vehicle
   * is shown (see {@link AtlasRegistry.want}). The group's own file keeps its resident frames.
   */
  vehicles?: Record<string, string[]>;
  /** further resident pages of a group with a vehicle index */
  shared?: string[];
  /** the picture file's format; `.png` unless the frames file says `webp` */
  format?: 'png' | 'webp';
}

/** The pages of one vehicle, loaded on demand and released when it has gone unused a while. */
interface VehiclePages {
  pages: string[];
  state: 'idle' | 'loading' | 'ready' | 'failed';
  loading?: Promise<void>;
  lastUse: number;
  keys: string[];
  sources: ImageSource[];
  textures: Texture[];
  images: (HTMLCanvasElement | HTMLImageElement)[];
}

/** How long a vehicle's pages stay after it was last shown (ms). */
const KEEP_MS = 20000;
export type AtlasGenerator = () => AtlasImage | Promise<AtlasImage>;

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
 * Where a group's file is served: `public/assets`, under the build's base path, the way
 * `src/render/landscape.ts` finds its sheet. `base` is Vite's `BASE_URL` (`/`, `/sub/` or `./` in
 * the forms Vite documents), so the default `/` gives `/assets/<group>.<ext>`.
 */
function atlasFileUrl(base: string, group: string, ext: 'json' | 'png' | 'webp') {
  return `${base}assets/${group}.${ext}`;
}

/**
 * Asset pipeline. Each named atlas group is loaded from `assets/<group>.json` + `.png` under the
 * build's base path when present (exported by any packer that writes
 * {frames:{name:{x,y,w,h,ax,ay}}}); otherwise the procedural generator supplies it. A file marked
 * `"partial": true` is layered over the generator instead, so a handful of rendered frames can
 * replace their procedural namesakes without the rest of the group going missing. Game code only
 * ever asks for frame names.
 *
 * A group the build ships a file for and that falls back to its generator anyway is a broken file
 * or server: it is warned about once, on the console. A group with no file is procedural by design
 * and stays quiet. A file that breaks the frame contract falls back the same way, so it costs only
 * its own group.
 *
 * With a cache (`src/engine/atlasCache.ts`), what a generator would supply comes from the cache
 * when it holds the group at the current content version, and the generator runs only on a miss;
 * the groups generated in a load are stored once the load is over (`cacheWrites`). A file still
 * comes from the server on every load and a partial one still wins over the generated frames.
 */
export class AtlasRegistry {
  private frames = new Map<string, FrameInfo>();
  /** Counts the changes to the frames: what was worked out from `has` holds until this moves. */
  framesVersion = 0;
  private sources: ImageSource[] = [];
  /** vehicle pages by stem (`rolling/loco_m62`) */
  private vehicles = new Map<string, VehiclePages>();
  private lastSweep = 0;
  readonly groupOrigin = new Map<string, 'png' | 'procedural' | 'png+procedural'>();
  /** For each group with generated frames, whether this load drew them or read them from the cache. */
  readonly generatedFrom = new Map<string, 'generator' | 'cache'>();
  /**
   * Settles once the groups the last load generated are stored in the cache, or failed to be.
   * Never rejects. The boot does not wait for it; tests and the boot probe do.
   */
  cacheWrites: Promise<void> = Promise.resolve();
  /** Raw atlas images by group, kept for the debug atlas viewer. */
  readonly images = new Map<string, HTMLCanvasElement | HTMLImageElement>();
  /** shipped groups already warned about */
  private warned = new Set<string>();

  constructor(
    /** groups whose file pair ships with the game; the build's list unless a test gives one */
    private readonly shipped: ReadonlySet<string> = SHIPPED_GROUPS,
    /** the base path the files are served under; the build's unless a test gives one */
    private readonly base: string = import.meta.env.BASE_URL,
    /** where generated groups are kept between boots; none generates every group every load */
    private readonly cache: AtlasCache | null = null,
  ) {}

  /**
   * Load every group, all at once. `onSettled` hears each group as it settles, from its file or its
   * generator: how many have, out of all of them (the boot's progress bar).
   */
  async load(
    groups: { name: string; generate: AtlasGenerator }[],
    onSettled?: (settled: number, total: number) => void,
  ) {
    let settled = 0;
    const generated: [string, AtlasImage][] = [];
    await Promise.all(
      groups.map(async (g) => {
        const drawn = await this.loadGroup(g.name, g.generate);
        if (drawn) generated.push([g.name, drawn]);
        onSettled?.(++settled, groups.length);
      }),
    );
    this.cacheWrites = this.keepGenerated(generated);
  }

  /** Loads one group; returns what its generator drew in this load, for the cache to keep. */
  private async loadGroup(name: string, generate: AtlasGenerator): Promise<AtlasImage | null> {
    // the file and the cache are asked at once; the cache answers null when it has nothing
    const cached = this.cache ? this.cache.read(name) : Promise.resolve(null);
    const fromFile = await this.tryLoadFile(name);
    if (typeof fromFile !== 'string' && !fromFile.partial) {
      await this.registerFile(name, fromFile);
      this.images.set(name, fromFile.image);
      this.groupOrigin.set(name, 'png');
      return null;
    }
    if (typeof fromFile === 'string' && this.shipped.has(name) && !this.warned.has(name)) {
      this.warned.add(name);
      console.warn(`Atlas: ${name} falls back to procedural art: ${fromFile}`);
    }
    const hit = await cached;
    const gen = hit ?? (await generate());
    this.generatedFrom.set(name, hit ? 'cache' : 'generator');
    // generated first, so a partial file's frames win where the names collide
    this.register(gen);
    if (typeof fromFile !== 'string') {
      await this.registerFile(name, fromFile);
      this.images.set(name, fromFile.image);
      this.groupOrigin.set(name, 'png+procedural');
    } else {
      this.images.set(name, gen.image);
      this.groupOrigin.set(name, 'procedural');
    }
    return hit ? null : gen;
  }

  /** A group's file with its further pages and its index of vehicle pages. */
  private async registerFile(name: string, file: AtlasImage) {
    this.register(file);
    for (const page of file.shared ?? []) {
      const p = await this.tryLoadFile(page);
      if (typeof p !== 'string') this.register(p);
    }
    for (const [stem, pages] of Object.entries(file.vehicles ?? {}))
      this.vehicles.set(`${name}/${stem}`, {
        pages,
        state: 'idle',
        lastUse: 0,
        keys: [],
        sources: [],
        textures: [],
        images: [],
      });
    for (let i = 2; i <= (file.pages ?? 1); i++) {
      const page = await this.tryLoadFile(`${name}-${i}`);
      if (typeof page !== 'string') this.register(page);
    }
  }

  /**
   * Keeps the groups a load generated for the next one. Never rejects. The writes run together:
   * the browser encodes a PNG in idle time, so each takes about a second however small it is, while
   * the main thread spends well under a tenth of that on all of them.
   */
  private async keepGenerated(generated: [string, AtlasImage][]) {
    const cache = this.cache;
    if (cache) await Promise.all(generated.map(([name, atlas]) => cache.write(name, atlas)));
  }

  /** The group's file pair, or why it cannot be used. */
  private async tryLoadFile(name: string): Promise<AtlasImage | string> {
    const json = atlasFileUrl(this.base, name, 'json');
    try {
      const res = await fetch(json, { cache: 'no-cache' });
      if (!res.ok) return `${json} answered ${res.status}`;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) return `${json} came as ${ct || 'no content type'}`;
      const body: unknown = await res.json();
      if (!isRecord(body) || !isRecord(body.frames)) return `${json} has no frames object`;
      for (const [key, f] of Object.entries(body.frames))
        if (!isFrameDef(f))
          return `${json} frame ${key} needs finite x, y, ax, ay and positive w, h`;
      const data = body as Omit<AtlasImage, 'image'>;
      const resolution = data.resolution ?? 1;
      if (!Number.isFinite(resolution) || resolution < 1 || resolution > 8)
        return `${json} has resolution ${resolution}, outside 1 to 8`;
      const list = (v: unknown) =>
        Array.isArray(v) && v.every((p) => typeof p === 'string' && /^[\w.-]+$/.test(p))
          ? (v as string[])
          : undefined;
      const vehicles = isRecord(data.vehicles)
        ? Object.fromEntries(
            Object.entries(data.vehicles)
              .map(([k, v]) => [k, list(v)] as const)
              .filter((e): e is readonly [string, string[]] => !!e[1]),
          )
        : undefined;
      const picture = atlasFileUrl(this.base, name, data.format === 'webp' ? 'webp' : 'png');
      const image = new Image();
      const loaded = await new Promise<boolean>((done) => {
        image.onload = () => done(true);
        image.onerror = () => done(false);
        image.src = picture;
      });
      if (!loaded) return `${picture} did not load as an image`;
      const pages =
        Number.isInteger(data.pages) && data.pages! > 1 && data.pages! <= 256
          ? data.pages
          : undefined;
      return {
        image,
        frames: data.frames,
        resolution,
        partial: data.partial === true,
        pages,
        vehicles,
        shared: list(data.shared),
      };
    } catch (err) {
      return `${json} did not load: ${String(err)}`;
    }
  }

  /**
   * Register an atlas' frames. For a vehicle's page (`own`), frames already present (the resident
   * preview copies) are kept, and what it adds is recorded so it can be released again.
   */
  private register(atlas: AtlasImage, own?: VehiclePages) {
    const resolution = atlas.resolution ?? 1;
    const source = new ImageSource({
      resource: atlas.image,
      scaleMode: resolution > 1 ? 'linear' : 'nearest',
      autoGenerateMipmaps: resolution > 1,
    });
    if (own) own.sources.push(source);
    else this.sources.push(source);
    for (const [key, f] of Object.entries(atlas.frames)) {
      if (own && this.frames.has(key)) continue;
      // UVs address physical texels; orig controls the sprite's world-space dimensions.
      // This also preserves callers that mirror/rotate sprites at scale 1 (rolling stock).
      const texture = new Texture({
        source,
        frame: new Rectangle(f.x, f.y, f.w, f.h),
        orig: new Rectangle(0, 0, f.w / resolution, f.h / resolution),
      });
      if (own) {
        own.keys.push(key);
        own.textures.push(texture);
      }
      this.frames.set(key, {
        image: atlas.image,
        texture,
        anchorX: f.ax / f.w,
        anchorY: f.ay / f.h,
        w: f.w / resolution,
        h: f.h / resolution,
      });
      this.framesVersion++;
    }
  }

  has(key: string) {
    return this.frames.has(key);
  }

  /**
   * Whether a vehicle's own frames (stem `rolling/loco_<id>`, `rolling/wagon_<id>`) are in. Asks
   * for them when they are not: the caller draws nothing of that vehicle until this turns true
   * (a frame or a few later). A stem without pages of its own (procedural stock, legacy atlases)
   * is always ready. Each call counts as a use; unused vehicles are released by {@link sweep}.
   */
  want(stem: string | null | undefined): boolean {
    if (!stem) return true;
    const v = this.vehicles.get(stem);
    if (!v) return true;
    v.lastUse = performance.now();
    if (v.state === 'ready') return true;
    if (v.state === 'idle') void this.ensure(stem);
    return false;
  }

  /** Load a vehicle's pages (see {@link want}); resolves when they are in (or failed). */
  ensure(stem: string): Promise<void> {
    const v = this.vehicles.get(stem);
    if (!v) return Promise.resolve();
    v.lastUse = performance.now();
    if (v.state === 'ready' || v.state === 'failed') return Promise.resolve();
    if (v.loading) return v.loading;
    v.state = 'loading';
    v.loading = Promise.all(v.pages.map((p) => this.tryLoadFile(p))).then((pages) => {
      v.loading = undefined;
      const failed = pages.find((p) => typeof p === 'string');
      if (failed !== undefined) {
        console.warn(`Atlas: pages of ${stem} missing: ${failed}`);
        v.state = 'failed';
        return;
      }
      for (const p of pages as AtlasImage[]) {
        this.register(p, v);
        v.images.push(p.image);
      }
      v.state = 'ready';
    });
    return v.loading;
  }

  /** Resolves once no vehicle pages are loading. */
  async idle(): Promise<void> {
    for (;;) {
      const busy = [...this.vehicles.values()].flatMap((v) => (v.loading ? [v.loading] : []));
      if (!busy.length) return;
      await Promise.all(busy);
    }
  }

  /** Vehicles whose pages are in, by stem. */
  loadedVehicles(): string[] {
    return [...this.vehicles].filter(([, v]) => v.state === 'ready').map(([k]) => k);
  }

  /** Release the pages of vehicles not asked for in the last `keepMs`; checked every few seconds. */
  sweep(now = performance.now(), keepMs = KEEP_MS) {
    if (now - this.lastSweep < 2000) return;
    this.lastSweep = now;
    for (const [stem, v] of this.vehicles)
      if (v.state === 'ready' && now - v.lastUse > keepMs) this.release(stem);
  }

  /** Drop a vehicle's frames and free its textures; it loads again when next wanted. */
  release(stem: string) {
    const v = this.vehicles.get(stem);
    if (!v || v.state !== 'ready') return;
    for (const k of v.keys) this.frames.delete(k);
    this.framesVersion++;
    for (const t of v.textures) t.destroy(false);
    for (const s of v.sources) s.destroy();
    for (const im of v.images)
      if (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement) im.src = '';
    v.keys = [];
    v.textures = [];
    v.sources = [];
    v.images = [];
    v.state = 'idle';
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

/** A JSON object, as opposed to an array, null or a primitive. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** One entry of a file's frame table that `register` can turn into a texture. */
export function isFrameDef(v: unknown): v is FrameDef {
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  return (
    isRecord(v) &&
    finite(v.x) &&
    finite(v.y) &&
    finite(v.ax) &&
    finite(v.ay) &&
    finite(v.w) &&
    finite(v.h) &&
    v.w > 0 &&
    v.h > 0
  );
}

function nextPow2(v: number) {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}
