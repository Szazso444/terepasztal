import {
  BufferImageSource,
  Container,
  Graphics,
  RendererType,
  Sprite,
  Texture,
  type Renderer,
  type TextureSource,
} from 'pixi.js';
import { type LandscapeMap } from './landscapeModel';
import {
  buildRelief,
  reliefHeight,
  reliefCorners,
  reliefTileAtWorld,
  groundAllows,
  surfaceSlope,
  type TerrainRelief,
} from './terrainRelief';
import { hash2 } from '../engine/rng';
import { Terrain } from '../world/tiles';
import { BIOME_DEFS } from '../sim/biomes';
import type { RailBed } from '../world/railProfile';
import {
  chunkBox,
  countView,
  viewOutcome,
  boxInView,
  type ChunkPaint,
  type ViewPaint,
  type ViewProgress,
} from './viewPainted';

/** Raster pixels per world pixel of the close-view chunk copies. */
const SHARP_SCALE = 2;
/** Screen pixels per world pixel above which chunks in view get a close-view copy. */
const SHARP_FROM = 1.4;
/** Close-view copies kept at once, nearest the view centre first (about 2.5 MB each). */
const SHARP_LIMIT = 48;
/**
 * Paint workers. Chunks are independent and each paint is deterministic, so a pool paints the same
 * pixels in parallel; one core is left to the game. Each worker holds its own copy of the surface
 * sheet (about 13 MB).
 */
const WORKERS = Math.max(
  1,
  Math.min(6, (typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2) - 1),
);
/** Fresh worker pools started after a failure before the landscape turns off for the session. */
const RESTARTS = 1;
/**
 * Milliseconds of running time a paint job may go unanswered before it counts as lost and the pool
 * is replaced. A chunk paints in a second or two, a close-view copy in a few.
 */
export const JOB_TIMEOUT_MS = 30_000;
/**
 * The most one frame adds to a job's waiting time, so a pause (a hidden tab, a sleeping machine)
 * does not count against the job the worker was painting when it began.
 */
const FRAME_LIMIT_MS = 1_000;
/** The level where snow starts, by biome id (`snowLevel`, src/data/biomes.json). */
const SNOW_LEVELS: readonly number[] = BIOME_DEFS.map((def) => def.snowLevel);
/** How the landscape starts its paint workers. The game uses the browser's; tests pass stubs. */
export type PainterPool = {
  /** Workers in one pool. */
  size: number;
  spawn(): Worker;
  /** Address of the packed surface sheet each worker loads before it paints. */
  sheet(): string;
};
const BROWSER_PAINTERS: PainterPool = {
  size: WORKERS,
  spawn: () => new Worker(new URL('./landscape.worker.ts', import.meta.url), { type: 'module' }),
  sheet: () =>
    new URL(`${import.meta.env.BASE_URL}assets/terrain-surfaces.png`, location.href).href,
};
/**
 * What the landscape needs of the renderer that shows it. The root's `onRender` hands over Pixi's
 * renderer; tests pass stubs.
 */
export type LandscapeGpu = {
  /**
   * Pixi's `RendererType`. WebGL and WebGPU keep a texture on the GPU; the canvas renderer draws
   * from its pixels.
   */
  readonly type: number;
  /** Puts a texture on the GPU now (Pixi's `prepare` plugin uploads the same way). */
  readonly texture: { initSource(source: TextureSource): unknown };
  /** Fires `webglcontextlost` and `webglcontextrestored`. */
  readonly canvas: EventTarget;
};
/**
 * A painted chunk's pixels as a texture source that can let them go once they are on the GPU.
 * Pixi reads them only to upload: on first use, on `update()` (never called here), and after a
 * lost WebGL context, which the landscape answers by painting the chunk again instead. Its texture
 * collector leaves the source alone, as it could not upload it again.
 */
class ChunkSource extends BufferImageSource {
  constructor(pixels: Uint8ClampedArray, width: number, height: number) {
    super({
      resource: pixels,
      width,
      height,
      // The worker's pixels are in RGBA order; plain bytes would be read as BGRA.
      format: 'rgba8unorm',
      scaleMode: 'linear',
      autoGarbageCollect: false,
    });
  }
  /** Lets go of the pixels, held as the resource and in the options the source was built with. */
  release() {
    this.options.resource = undefined;
    (this as { resource: unknown }).resource = null;
  }
}
/**
 * Loading until the first pool has its surface sheet, then active: painted chunks show and the
 * per-tile fallback ground covers only the unpainted ones. A lost WebGL context takes every painted
 * chunk with it, so the status is loading again until the context is back. Failed is final for the
 * session and carries the last error; the fallback ground then covers everything.
 */
export type LandscapeStatus =
  { readonly state: 'loading' | 'active' } | { readonly state: 'failed'; readonly reason: string };
/** The fields of a worker's error event, where the browser gives them. */
type WorkerError = Partial<Pick<ErrorEvent, 'message' | 'filename' | 'lineno' | 'colno' | 'error'>>;
/**
 * A worker error event as one line: message, then file, line and column. A module worker whose
 * script cannot load fires a bare event with none of them.
 */
export function workerErrorText(event: WorkerError): string {
  const what = event.message || 'a paint worker failed without a message (did its script load?)';
  return event.filename
    ? `${what} (${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0})`
    : what;
}
/** A chunk handed to a worker; `sent` is the landscape's running time when it went out. */
type Job = { id: string; scale: number; version: number; sent: number };
/** `resent`: the map version last handed to this worker again after it turned a job away. */
type Slot = { worker: Worker; loaded: boolean; job: Job | null; resent: number };
/** What a paint worker sends back (landscape.worker.ts). */
type PaintReply = {
  error?: string;
  stack?: string;
  loaded?: boolean;
  /** The job's version is not the worker's map version; nothing was painted. */
  stale?: boolean;
  id: string;
  version: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  grass: Float32Array;
  tint: number;
  ms: number;
};
type Chunk = {
  x: number;
  y: number;
  w: number;
  h: number;
  sprite: Sprite;
  details: Graphics;
  base: Texture;
  sharp: Texture | null;
  sharpVersion: number;
};
type View = { x: number; y: number; w: number; h: number };
/** A caller of `whenViewPainted`, waiting for the answer; `timer` is null once it has gone off. */
type Waiter = {
  resolve: (outcome: ViewPaint) => void;
  timer: ReturnType<typeof setTimeout> | null;
  timedOut: boolean;
};

/**
 * Worker-painted illustrated chunks. Panning and simulation ticks never repaint the base cache;
 * close views add a limited set of double-resolution copies around the camera. A painted chunk
 * lives on the GPU only, so a lost WebGL context paints it again.
 */
export class Landscape {
  readonly root = new Container({ cullableChildren: true, sortableChildren: true });
  private slots: Slot[] = [];
  private relief: TerrainRelief;
  private version = 0;
  private loaded = false;
  private pending = new Set<string>();
  private sharpPending = new Set<string>();
  private sharpShown = false;
  /** The camera's world rectangle; chunks in it paint first. */
  private view: View | null = null;
  private focusKey = '';
  private chunks = new Map<string, Chunk>();
  private tint = 0xffffff;
  private dirtyTiles: { x: number; y: number }[] = [];
  private allDirty = false;
  private invalid = false;
  private heightsDirty = false;
  private statusChanged = false;
  private current: LandscapeStatus = { state: 'loading' };
  private watchers = new Set<(status: LandscapeStatus) => void>();
  private waiters = new Set<Waiter>();
  /** Worker pools started so far. */
  private starts = 0;
  /** Milliseconds of running time, advanced by each flush by at most FRAME_LIMIT_MS. */
  private awake = 0;
  private lastFlush = performance.now();
  /** The renderer that shows the landscape, from its first frame on. */
  private gpu: LandscapeGpu | null = null;
  /** The WebGL context is lost: no job goes out, and a paint that comes back is not kept. */
  private contextLost = false;
  private readonly onContextLost = () => this.loseContext();
  private readonly onContextRestored = () => this.restoreContext();
  paintCount = 0;
  paintMilliseconds = 0;
  sharpPaintCount = 0;
  sharpPaintMilliseconds = 0;
  visibilityVersion = 0;
  private city: ReadonlySet<number> = new Set();
  constructor(
    private readonly map: LandscapeMap,
    private readonly flat: ReadonlySet<number>,
    /** Rail profile of each straight track tile; its bed follows the line (terrainRelief.ts). */
    private readonly rails: ReadonlyMap<number, RailBed> = new Map(),
    private readonly painters: PainterPool = BROWSER_PAINTERS,
  ) {
    this.relief = buildRelief(map, flat, undefined, rails);
    // Runs on every frame the landscape is on the stage, shown or not.
    this.root.onRender = (renderer: Renderer) => this.attach(renderer);
    this.root.on('destroyed', () => {
      this.stop();
      this.detach();
      this.watchers.clear();
      // Nothing will be painted for anyone still waiting.
      this.settleWaiters();
      for (const c of this.chunks.values()) {
        if (c.base !== Texture.EMPTY) c.base.destroy(true);
        c.sharp?.destroy(true);
      }
      this.chunks.clear();
      this.pending.clear();
      this.sharpPending.clear();
    });
    this.start();
  }
  get status(): LandscapeStatus {
    return this.current;
  }
  /** Painted chunks show; the fallback ground covers only the unpainted ones. */
  get active() {
    return this.current.state === 'active';
  }
  /** Off for the rest of the session: the fallback ground covers everything. */
  get failed() {
    return this.current.state === 'failed';
  }
  /** Calls `listener` with the current status at once and again on every change; returns the stop. */
  watchStatus(listener: (status: LandscapeStatus) => void) {
    this.watchers.add(listener);
    listener(this.current);
    return () => void this.watchers.delete(listener);
  }
  private setStatus(status: LandscapeStatus) {
    this.current = status;
    for (const listener of [...this.watchers]) listener(status);
  }
  /**
   * The renderer that shows the landscape, handed over by the root's `onRender` on every frame; the
   * first one stays. From then on a painted chunk goes to the GPU at once and keeps no copy on the
   * CPU, and a lost WebGL context is answered by painting every chunk again once it is restored.
   */
  attach(gpu: LandscapeGpu) {
    if (this.gpu || this.root.destroyed) return;
    this.gpu = gpu;
    gpu.canvas.addEventListener('webglcontextlost', this.onContextLost);
    gpu.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    // Chunks painted before the first frame kept their pixels until now.
    for (const c of this.chunks.values()) {
      if (c.base !== Texture.EMPTY) this.upload(c.base);
      if (c.sharp) this.upload(c.sharp);
    }
  }
  private detach() {
    this.gpu?.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.gpu?.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.gpu = null;
  }
  /**
   * Puts a painted chunk on the GPU now and lets its pixels go. Before the first frame, or with the
   * canvas renderer, which draws from the pixels, they stay.
   */
  private upload(texture: Texture) {
    const gpu = this.gpu;
    if (!gpu || !(gpu.type & (RendererType.WEBGL | RendererType.WEBGPU))) return;
    gpu.texture.initSource(texture.source);
    if (texture.source instanceof ChunkSource) texture.source.release();
  }
  /**
   * The WebGL context is lost, and every painted chunk with it: the GPU copy is gone and there is
   * no other. The painter hands out no job until the context is back, and every chunk waits to be
   * painted again; the per-tile ground stands in.
   */
  private loseContext() {
    if (this.root.destroyed || this.failed || this.contextLost) return;
    console.warn(
      'Landscape: the WebGL context was lost; the chunks are painted again once it is back',
    );
    this.contextLost = true;
    for (const [id, c] of this.chunks) {
      if (c.base !== Texture.EMPTY) c.base.destroy(true);
      c.sharp?.destroy(true);
      c.base = Texture.EMPTY;
      c.sharp = null;
      c.sharpVersion = -1;
      c.sprite.texture = Texture.EMPTY;
      c.details.clear();
      this.pending.add(id);
    }
    // Close-view copies are asked for again on the next focus.
    this.sharpPending.clear();
    this.focusKey = '';
    this.visibilityVersion++;
    if (this.active) this.setStatus({ state: 'loading' });
    this.statusChanged = true;
  }
  /**
   * The context is back: jobs go out again, the chunks in view first (`next`), and the status is
   * active from the next flush.
   */
  private restoreContext() {
    if (this.root.destroyed || !this.contextLost) return;
    this.contextLost = false;
    this.pump();
  }
  /**
   * Starts a pool of paint workers. Each loads the surface sheet, then takes the map; chunks still
   * pending, and the ones the last pool was painting, go to it once it has loaded.
   */
  private start() {
    this.starts++;
    this.loaded = false;
    this.slots = [];
    try {
      for (let i = 0; i < this.painters.size; i++) {
        const slot: Slot = { worker: this.painters.spawn(), loaded: false, job: null, resent: -1 };
        slot.worker.onerror = (event: WorkerError) =>
          this.crash(slot, workerErrorText(event), event.error);
        slot.worker.onmessage = ({ data }) => this.receive(slot, data);
        this.slots.push(slot);
      }
      const url = this.painters.sheet();
      for (const { worker } of this.slots) worker.postMessage({ url });
      this.sync();
    } catch (error) {
      this.crash(null, `the paint workers did not start: ${String(error)}`, error);
    }
  }
  private stop() {
    for (const { worker } of this.slots) worker.terminate();
    this.slots = [];
    this.loaded = false;
  }
  /**
   * A worker of the current pool failed, or a step that needs it did: handing it the map or a job,
   * showing what it painted, or answering a job in time (`slot` null: the pool as a whole, which
   * did not start or did not take the map). The whole pool is replaced up to RESTARTS times; the
   * next failure turns the landscape off. A pool's later errors, such as every worker failing to
   * load the same sheet, are one failure.
   */
  private crash(slot: Slot | null, reason: string, detail?: unknown) {
    if (this.root.destroyed || this.failed || (slot && !this.slots.includes(slot))) return;
    console.error(`Landscape: ${reason}`, ...(detail === undefined ? [] : [detail]));
    this.stop();
    if (this.starts <= RESTARTS) {
      console.warn('Landscape: restarting the paint workers');
      // Close-view copies handed to the old pool are asked for again on the next focus.
      this.focusKey = '';
      this.start();
      return;
    }
    console.error('Landscape: the paint workers failed again; the per-tile ground stands in');
    this.fail(reason);
  }
  /**
   * A worker's reply: its surface sheet is loaded, a chunk paint is done, or a job was turned away
   * because the worker does not have that version of the map.
   */
  private receive(slot: Slot, data: PaintReply) {
    // A replaced pool's last messages are dropped.
    if (this.root.destroyed || !this.slots.includes(slot)) return;
    if (data.error) {
      this.crash(slot, `a paint worker reported: ${data.error}`, data.stack);
      return;
    }
    if (data.loaded) {
      slot.loaded = this.loaded = true;
      this.pump();
      return;
    }
    slot.job = null;
    if (data.stale) {
      this.turnedAway(slot, data.version, data.scale);
      return;
    }
    // A paint of an older map, or one that came back while the WebGL context is lost and could not
    // reach the GPU: the chunk stays pending.
    if (data.version !== this.version || this.contextLost) {
      this.pump();
      return;
    }
    const c = this.chunks.get(data.id);
    if (!c) {
      this.pump();
      return;
    }
    let texture: Texture | null = null;
    try {
      texture = this.chunkTexture(data);
      this.upload(texture);
    } catch (error) {
      // Such as a texture the GPU has no room for. The chunk stays pending for the next pool.
      texture?.destroy(true);
      this.crash(slot, `a painted chunk could not be shown: ${String(error)}`, error);
      return;
    }
    c.sprite.position.set(data.left, data.top);
    if (data.scale > 1) {
      c.sharp?.destroy(true);
      c.sharp = texture;
      c.sharpVersion = data.version;
      this.show(c);
      this.sharpPaintCount++;
      this.sharpPaintMilliseconds += data.ms;
      this.pump();
      return;
    }
    const old = c.base;
    c.base = texture;
    if (c.sharp && c.sharpVersion !== data.version) {
      c.sharp.destroy(true);
      c.sharp = null;
    }
    this.show(c);
    c.details.clear();
    c.details.position.set(data.left, data.top);
    const grass = data.grass;
    for (let group = 0; group < 2; group++) {
      for (let i = 0; i < grass.length; i += 4) {
        if (grass[i + 3] !== group) continue;
        const sx = grass[i],
          sy = grass[i + 1],
          length = grass[i + 2];
        c.details
          .moveTo(sx - 1.2, sy)
          .lineTo(sx - 1.5, sy - length * 0.65)
          .moveTo(sx - 0.35, sy)
          .lineTo(sx - 0.45, sy - length)
          .moveTo(sx + 0.45, sy)
          .lineTo(sx + 0.7, sy - length * 0.82)
          .moveTo(sx + 1.1, sy)
          .lineTo(sx + 1.65, sy - length * 0.5);
      }
      const base = group ? [131, 145, 70] : [172, 175, 84];
      let colour = 0;
      for (let j = 0; j < 3; j++)
        colour |= Math.round((base[j] * ((data.tint >> (16 - j * 8)) & 255)) / 255) << (16 - j * 8);
      c.details.stroke({ color: colour, width: 0.65, alpha: group ? 0.65 : 0.68 });
    }
    this.paintCount++;
    this.paintMilliseconds += data.ms;
    if (old !== Texture.EMPTY) old.destroy(true);
    else this.visibilityVersion++;
    this.pending.delete(data.id);
    this.settleWaiters();
    this.pump();
  }
  /**
   * A worker turned a job away because it does not have that version of the map; the chunk is
   * still pending. For an older version nothing more is needed, as the newer map went out after
   * the job. For the current version the worker missed a hand-off, so it gets the map again ahead
   * of its next job; turning the same version away twice is a failure, not a loop.
   */
  private turnedAway(slot: Slot, version: number, scale: number) {
    // A close-view copy is asked for again on the next focus.
    if (scale > 1) this.focusKey = '';
    if (version === this.version) {
      if (slot.resent === version) {
        this.crash(slot, `a paint worker turned away map version ${version} twice`);
        return;
      }
      console.warn(
        `Landscape: a paint worker missed map version ${version}; handing it over again`,
      );
      slot.resent = version;
      if (!this.handOff([slot])) return;
    }
    this.pump();
  }
  /**
   * A painted chunk's pixels as a texture, with no canvas between: `upload` puts it on the GPU and
   * lets the pixels go.
   */
  private chunkTexture(data: PaintReply): Texture {
    return new Texture({ source: new ChunkSource(data.pixels, data.width, data.height) });
  }
  private fail(reason: string) {
    this.setStatus({ state: 'failed', reason });
    this.root.visible = false;
    this.statusChanged = true;
    this.pending.clear();
    this.sharpPending.clear();
    this.settleWaiters();
  }
  private show(c: Chunk) {
    const sharp = this.sharpShown && c.sharp;
    c.sprite.texture = sharp || c.base;
    c.sprite.scale.set(sharp ? 1 / SHARP_SCALE : 1);
  }
  /**
   * Called with the camera's world rectangle and screen pixels per world pixel. Close views
   * repaint the chunks nearest the centre at SHARP_SCALE; the base cache stays for everything else.
   */
  focus(view: View, pixelScale: number) {
    if (this.failed) return;
    this.view = view;
    const shown = pixelScale > SHARP_FROM;
    if (shown !== this.sharpShown) {
      this.sharpShown = shown;
      for (const c of this.chunks.values()) this.show(c);
    }
    const key = shown ? `${view.x},${view.y},${view.w},${view.h},${this.version}` : '';
    if (key === this.focusKey) return;
    this.focusKey = key;
    this.sharpPending.clear();
    if (!shown) return;
    const near = [...this.chunks]
      .map(([id, c]) => ({ id, c, d: this.rank(c) }))
      .sort((a, b) => a.d - b.d);
    near.forEach(({ id, c, d }, i) => {
      const wanted = d < 1e9 && i < SHARP_LIMIT;
      if (wanted && c.sharpVersion !== this.version && !this.flying(id, SHARP_SCALE))
        this.sharpPending.add(id);
      // Copies ranked beyond the limit are released; out-of-view ones rank last.
      if (i >= SHARP_LIMIT && c.sharp) {
        c.sharp.destroy(true);
        c.sharp = null;
        c.sharpVersion = -1;
        this.show(c);
      }
    });
    this.pump();
  }
  /** Chunks in view rank first (below 1e9), each group nearest the view centre first. */
  private rank(c: Chunk) {
    const view = this.view;
    if (!view) return 0;
    const box = chunkBox(c);
    return (
      (boxInView(box, view) ? 0 : 1e9) +
      Math.hypot(
        box.left + box.width / 2 - view.x - view.w / 2,
        box.top + box.height / 2 - view.y - view.h / 2,
      )
    );
  }
  /** Is a worker already painting this chunk at this scale for the current version? */
  private flying(id: string, scale: number) {
    return this.slots.some(
      ({ job }) => !!job && job.id === id && job.scale === scale && job.version === this.version,
    );
  }
  private get busy() {
    return this.slots.some((slot) => slot.job);
  }
  /**
   * Hands the map to these workers. If that fails, such as a DataCloneError once memory runs out,
   * the workers would turn away every job of this version, so the pool is replaced (or the
   * landscape turned off) instead, and the answer is false.
   */
  private handOff(slots: readonly Slot[]) {
    try {
      this.sync(slots);
      return true;
    } catch (error) {
      this.crash(null, `the map could not be handed to the paint workers: ${String(error)}`, error);
      return false;
    }
  }
  private sync(slots: readonly Slot[] = this.slots) {
    for (const { worker } of slots)
      worker.postMessage({
        map: {
          w: this.map.w,
          h: this.map.h,
          seed: this.map.seed,
          originX: this.map.originX,
          originY: this.map.originY,
          terrain: this.map.terrain,
          biome: this.map.biome,
          climate: this.map.climate,
        },
        relief: this.relief,
        version: this.version,
        tint: this.tint,
        city: [...this.city],
        snowLevels: SNOW_LEVELS,
      });
  }
  add(x: number, y: number, w: number, h: number) {
    const id = `${x},${y}`;
    if (this.chunks.has(id) || this.failed) return;
    const sprite = new Sprite({ cullable: true }),
      details = new Graphics({ cullable: true });
    sprite.zIndex = x + y;
    details.zIndex = x + y + 0.01;
    this.root.addChild(sprite, details);
    this.chunks.set(id, {
      x,
      y,
      w,
      h,
      sprite,
      details,
      base: Texture.EMPTY,
      sharp: null,
      sharpVersion: -1,
    });
    this.pending.add(id);
    this.focusKey = '';
    this.pump();
  }
  setCity(tiles: ReadonlySet<number>) {
    this.city = tiles;
  }
  isPainted(x: number, y: number) {
    const chunk = this.chunks.get(`${Math.floor(x / 8) * 8},${Math.floor(y / 8) * 8}`);
    return !!chunk && chunk.base !== Texture.EMPTY;
  }
  /** Hands every idle worker its next chunk, unless the WebGL context is lost. */
  private pump() {
    if (!this.loaded || this.failed || this.contextLost) return;
    for (const slot of this.slots) {
      if (!slot.loaded || slot.job) continue;
      const next = this.next();
      if (!next) return;
      const c = this.chunks.get(next.id)!;
      try {
        slot.worker.postMessage({ ...next, x: c.x, y: c.y, w: c.w, h: c.h, version: this.version });
      } catch (error) {
        // With no job out, no answer would come back to hand the chunk out again.
        this.crash(slot, `a paint job could not be handed out: ${String(error)}`, error);
        return;
      }
      slot.job = { ...next, version: this.version, sent: this.awake };
    }
  }
  /**
   * Base paints come first, the chunks in view before the rest, except for chunks already showing
   * a close-view copy: those are repainted sharp first, so an edit never drops a close view back to
   * the blurrier cache. A chunk a worker is already painting is not handed out twice.
   */
  private next(): { id: string; scale: number } | null {
    let best: string | undefined,
      rank = Infinity;
    for (const id of this.pending) {
      const c = this.chunks.get(id)!;
      if ((this.sharpShown && c.sharp) || this.flying(id, 1)) continue;
      const r = this.rank(c);
      if (r < rank) {
        best = id;
        rank = r;
      }
    }
    if (best !== undefined) return { id: best, scale: 1 };
    for (const id of this.sharpPending) {
      this.sharpPending.delete(id);
      if (!this.flying(id, SHARP_SCALE)) return { id, scale: SHARP_SCALE };
    }
    for (const id of this.pending) if (!this.flying(id, 1)) return { id, scale: 1 };
    return null;
  }
  invalidate(x: number, y: number) {
    // Off for good, nothing paints or queues; the relief the building rules read still follows
    // the terrain, rebuilt on the next question (`updateHeights`).
    if (this.failed) {
      this.heightsDirty = true;
      return;
    }
    this.invalid = true;
    this.heightsDirty = true;
    this.dirtyTiles.push({ x, y });
  }
  private updateHeights() {
    if (this.heightsDirty) {
      this.relief = buildRelief(this.map, this.flat, undefined, this.rails);
      this.heightsDirty = false;
    }
  }
  /** Returns true when prop/structure anchors need to be refreshed. Called once a frame. */
  flush() {
    this.watch();
    let moved = false;
    if (this.invalid && !this.failed) {
      this.invalid = false;
      this.updateHeights();
      this.version++;
      for (const [id, c] of this.chunks)
        if (this.touchedByEdit(c)) {
          this.pending.add(id);
          if (this.sharpShown && c.sharp) this.sharpPending.add(id);
        }
      moved = this.dirtyTiles.length > 0;
      this.dirtyTiles = [];
      this.allDirty = false;
      if (this.handOff(this.slots)) this.pump();
    }
    let changed = this.statusChanged || moved;
    this.statusChanged = false;
    if (this.failed) return changed;
    // Painted chunks show as they arrive; the fallback ground covers only the unpainted ones.
    if (!this.active && this.loaded && !this.contextLost) {
      this.setStatus({ state: 'active' });
      changed = true;
    }
    this.settleWaiters();
    return changed;
  }
  /** Does an edit or a tint change not yet taken by a flush reach this chunk's picture? */
  private touchedByEdit(c: Chunk) {
    return (
      this.allDirty ||
      this.dirtyTiles.some(
        (p) => p.x >= c.x - 6 && p.x < c.x + c.w + 6 && p.y >= c.y - 6 && p.y < c.y + c.h + 6,
      )
    );
  }
  /**
   * The watchdog: a job unanswered for JOB_TIMEOUT_MS of running time is lost, and the pool is
   * replaced. Running time advances with each flush, by at most FRAME_LIMIT_MS.
   */
  private watch() {
    const now = performance.now();
    this.awake += Math.min(Math.max(0, now - this.lastFlush), FRAME_LIMIT_MS);
    this.lastFlush = now;
    const late = this.slots.find(({ job }) => job && this.awake - job.sent > JOB_TIMEOUT_MS);
    if (late?.job)
      this.crash(
        late,
        `a paint worker gave no answer in ${JOB_TIMEOUT_MS / 1000} s (${late.job.id})`,
      );
  }
  elevation(x: number, y: number) {
    this.updateHeights();
    return -reliefHeight(this.map, this.relief, x, y);
  }
  /** Can the ground at tile (x, y) carry a straight climbing rail, or only level structures? */
  get style() {
    return this.relief.style;
  }
  /** World pixels one level rises. */
  get step() {
    return this.relief.style.step;
  }
  groundAllows(x: number, y: number, need: 'straight' | 'level') {
    this.updateHeights();
    return groundAllows(this.map, this.relief, x, y, need);
  }
  /** Surface height and slope at (x, y), in world pixels (up is positive). */
  slope(x: number, y: number) {
    this.updateHeights();
    return surfaceSlope(this.map, this.relief, x, y);
  }
  tileAtWorld(x: number, y: number) {
    this.updateHeights();
    return reliefTileAtWorld(this.map, this.relief, x, y);
  }
  /** Original illustrated silhouettes only at sparse, unbuildable local summits. */
  summit(x: number, y: number) {
    if (this.failed || this.map.terrain[y * this.map.w + x] !== Terrain.Mountain) return false;
    this.updateHeights();
    // Painted peaks rise out of the terrain itself.
    if (this.relief.style.paintedPeaks) return false;
    if (Math.min(...reliefCorners(this.map, this.relief, x, y)) < this.relief.style.step)
      return false;
    const rank = hash2(x + this.map.originX, y + this.map.originY, this.map.seed + 601);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (
          xx < 0 ||
          yy < 0 ||
          xx >= this.map.w ||
          yy >= this.map.h ||
          this.map.terrain[yy * this.map.w + xx] !== Terrain.Mountain
        )
          continue;
        if (hash2(xx + this.map.originX, yy + this.map.originY, this.map.seed + 601) > rank)
          return false;
      }
    return true;
  }
  setTint(tint: number) {
    if (tint === this.tint || this.failed) return;
    this.tint = tint;
    this.invalid = true;
    this.allDirty = true;
  }
  /**
   * How many of the chunks in the camera's view are painted for the current map, out of all of the
   * view's chunks (every chunk until the first `focus`). A chunk counts once its base picture is
   * on the ground and no edit waits to repaint it, so an edit takes a chunk back out until it is
   * painted again; close-view copies are a refinement and do not count. A landscape that has
   * failed shows no painted chunk, and a context loss takes them all. A view with no chunk in it
   * is `0 of 0`.
   */
  viewProgress(): ViewProgress {
    return countView(this.paintStates(), this.view);
  }
  private *paintStates(): Iterable<ChunkPaint> {
    for (const [id, c] of this.chunks)
      yield {
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        painted:
          !this.failed &&
          c.base !== Texture.EMPTY &&
          !this.pending.has(id) &&
          !(this.invalid && this.touchedByEdit(c)),
      };
  }
  /**
   * Resolves when the ground in the camera's view is painted (`viewProgress` is complete), with
   * `'painted'`; with `'failed'` at once if the landscape has failed for the session, as the
   * per-tile ground covers everything then, and if it is destroyed; and with `'timeout'` once
   * `timeoutMs` of real time have passed with the view still unpainted. A view that is painted
   * already resolves `'painted'` at once, and so does a timeout of 0 or less that is not. An
   * infinite timeout waits for the paint or the failure. The camera moving to unpainted ground
   * keeps the wait going.
   */
  whenViewPainted(timeoutMs: number): Promise<ViewPaint> {
    return new Promise((resolve) => {
      const waiter: Waiter = { resolve, timer: null, timedOut: !(timeoutMs > 0) };
      if (!waiter.timedOut && Number.isFinite(timeoutMs))
        waiter.timer = setTimeout(() => {
          waiter.timer = null;
          waiter.timedOut = true;
          this.settleWaiters();
        }, timeoutMs);
      this.waiters.add(waiter);
      this.settleWaiters();
    });
  }
  /** Ends the waits whose time has come: painted, failed (or destroyed) or timed out. */
  private settleWaiters() {
    if (!this.waiters.size) return;
    const gone = this.failed || this.root.destroyed;
    const progress = this.viewProgress();
    for (const waiter of [...this.waiters]) {
      const outcome = viewOutcome(progress, gone, waiter.timedOut);
      if (!outcome) continue;
      this.waiters.delete(waiter);
      if (waiter.timer !== null) clearTimeout(waiter.timer);
      waiter.resolve(outcome);
    }
  }
  get ready() {
    return this.loaded && !this.failed && !this.contextLost && !this.pending.size && !this.invalid;
  }
  /** Base cache ready and every wanted close-view copy painted. */
  get sharpReady() {
    return this.ready && !this.sharpPending.size && !this.busy;
  }
  get chunkCount() {
    return this.chunks.size;
  }
}
