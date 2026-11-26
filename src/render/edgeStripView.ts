import { Graphics, type Container } from 'pixi.js';
import type { EdgeStripRequest } from '../world/edgeStrip';
import type { EdgeStripJob } from './edgeStrip.worker';
import type { StripMesh } from './edgeStripMesh';
import { workerErrorText } from './landscape';

/**
 * The picture of the edge strip (src/world/edgeStrip.ts): the ground past the map as a dark
 * wireframe at its true height, white lines along the tile sides, water in blue. Its shape comes
 * from a worker (edgeStripMesh.ts); here it only becomes Graphics.
 *
 * It lies in two layers: what lies behind the map (past its two upper edges) under the ground, and
 * what lies before it (past its two lower edges) over the map, so a mountain in front of the map
 * stands in front of it as it will when the map grows, solid past the map's edge and in lines alone
 * over the map's tiles, which stay in sight. A block of tiles shows while the edge region
 * beside it does (`EdgeStripView.refresh`): the strip goes on from the ground in view, never from
 * the dark of a region still hidden. A block is drawn when it first has to show, a few a frame, and
 * fades in.
 */

/** How long the worker has to answer; past it the void ring stays. */
export const EDGE_STRIP_TIMEOUT_MS = 30_000;
/** How long a block takes to fade in, in seconds. */
export const STRIP_FADE_SECONDS = 0.4;
/** The milliseconds a frame spends drawing blocks: past it the next block waits a frame. */
export const STRIP_FRAME_BUDGET_MS = 4;

/**
 * The fills of a block, then its lines, one path to each run. The lines go on one pixel wide at
 * every zoom (`pixelLine`), and in one batch after the fills, which is why what is hidden is cut out
 * of them beforehand rather than painted over.
 */
function drawMesh(g: Graphics, mesh: StripMesh) {
  const { points, sizes, colors, lines, runs } = mesh;
  for (let i = 0, from = 0; i < colors.length; i++) {
    const to = from + sizes[i] * 2;
    g.poly(Array.from(points.subarray(from, to))).fill(colors[i]);
    from = to;
  }
  let at = 0;
  for (let r = 0; r < runs.length; r += 3) {
    for (; at < runs[r]; at += 4)
      g.moveTo(lines[at], lines[at + 1]).lineTo(lines[at + 2], lines[at + 3]);
    g.stroke({ pixelLine: true, color: runs[r + 1], alpha: runs[r + 2] });
  }
}

/** A block on the page. */
interface ShownBlock {
  region: number;
  front: boolean;
  shape: Graphics;
  /** the shape to draw; gone once it is drawn */
  mesh: StripMesh | null;
  /** whether it is to show now */
  wanted: boolean;
}

/** The strip's blocks on the page, in their two layers, a Graphics a block: culled by block. */
export class EdgeStripView {
  private blocks: ShownBlock[] = [];
  /** Whether a block is still to be drawn or to fade in. */
  private busy = false;
  /**
   * Hears when a block has come in whole, so what lies under it can go, and when it went again.
   */
  onCover: ((region: number, front: boolean, covered: boolean) => void) | null = null;
  constructor(
    private readonly back: Container,
    private readonly front: Container,
    private readonly shown: (region: number) => boolean,
  ) {}

  /** Takes the strip in; the shapes are empty and hidden until they have to show. */
  set(meshes: StripMesh[]) {
    this.blocks = meshes.map((mesh) => {
      const shape = new Graphics();
      shape.cullable = true;
      shape.visible = false;
      (mesh.front ? this.front : this.back).addChild(shape);
      return { region: mesh.region, front: mesh.front, shape, mesh, wanted: false };
    });
    this.refresh();
  }

  /** The regions blocks stand past that show now. */
  regions(): Set<number> {
    return new Set(this.blocks.filter((b) => b.wanted).map((b) => b.region));
  }

  /** Reads which blocks are to show: what `shown` says now. */
  refresh() {
    for (const b of this.blocks) {
      const wanted = this.shown(b.region);
      if (wanted === b.wanted) continue;
      b.wanted = wanted;
      if (wanted) this.busy = true;
      else {
        const covered = b.shape.alpha >= 1;
        b.shape.visible = false;
        b.shape.alpha = 0;
        if (covered) this.onCover?.(b.region, b.front, false);
      }
    }
  }

  /** A frame, `dt` seconds after the last: draws the blocks that wait, and fades them in. */
  update(dt: number) {
    if (!this.busy) return;
    const start = performance.now();
    let drew = false;
    this.busy = false;
    for (const b of this.blocks) {
      if (!b.wanted) continue;
      if (b.mesh) {
        if (drew && performance.now() - start >= STRIP_FRAME_BUDGET_MS) {
          this.busy = true;
          continue;
        }
        drawMesh(b.shape, b.mesh);
        drew = true;
        b.mesh = null;
        b.shape.alpha = 0;
        b.shape.visible = true;
        this.busy = true;
      } else if (!b.shape.visible) {
        // back after it was hidden: it is drawn already
        b.shape.visible = true;
        this.busy = true;
      } else if (b.shape.alpha < 1) {
        b.shape.alpha = Math.min(1, b.shape.alpha + dt / STRIP_FADE_SECONDS);
        if (b.shape.alpha < 1) this.busy = true;
        else this.onCover?.(b.region, b.front, true);
      }
    }
  }
}

/**
 * Builds the strip's shape in a worker; null where there are no workers, or the build failed, which
 * leaves the game as it is without a strip. `regions` is the map's grid, to file the blocks by.
 */
export function buildEdgeStrip(
  req: EdgeStripRequest,
  regions: EdgeStripJob['regions'],
): Promise<StripMesh[] | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const done = (meshes: StripMesh[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker?.terminate();
      resolve(meshes);
    };
    const fail = (reason: string, ...detail: unknown[]) => {
      if (!settled) console.error(`Edge strip: ${reason}`, ...detail);
      done(null);
    };
    try {
      worker = new Worker(new URL('./edgeStrip.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<StripMesh[] | null>) => done(e.data);
      worker.onerror = (e) => fail(workerErrorText(e), e.error);
      worker.onmessageerror = () => fail('its answer could not be read');
      timer = setTimeout(() => fail('no answer from its worker'), EDGE_STRIP_TIMEOUT_MS);
      const job: EdgeStripJob = {
        req,
        regions: { regionSize: regions.regionSize, regionsX: regions.regionsX },
      };
      worker.postMessage(job);
    } catch (error) {
      fail(`the worker did not start: ${String(error)}`, error);
    }
  });
}
