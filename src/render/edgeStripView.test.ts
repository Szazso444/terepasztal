import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Container, type Graphics } from 'pixi.js';
import { stripMeshes, type StripMesh } from './edgeStripMesh';
import {
  EDGE_STRIP_TIMEOUT_MS,
  EdgeStripView,
  STRIP_FADE_SECONDS,
  STRIP_FRAME_BUDGET_MS,
  buildEdgeStrip,
} from './edgeStripView';
import { EDGE_STRIP_TILES, edgeStripRequest, type EdgeStrip } from '../world/edgeStrip';
import { DEFAULT_MAP_PARAMS } from '../world/mapgen';
import { regionOf } from '../world/tiles';
import type { EdgeStripJob } from './edgeStrip.worker';
import type { WorldSpec } from '../sim/save';

const W = EDGE_STRIP_TILES;
/** The grid of a map of 64 x 64 tiles, in chunks of 16. */
const GRID = { regionSize: 16, regionsX: 4 };

/** Flat ground round a map of `size` tiles square. */
function flatStrip(size: number): EdgeStrip {
  const n = (size + 2 * W) ** 2;
  return { w: size, h: size, terrain: new Uint8Array(n), levels: new Uint8Array(n) };
}
const meshes = (size = 64) => stripMeshes(flatStrip(size), (x, y) => regionOf(GRID, x, y));

/** Records what the page sends and lets a test answer or crash like the strip's worker. */
class StubWorker {
  static made: StubWorker[] = [];
  /** What `new Worker` throws, and what `postMessage` throws. */
  static refuse: Error | null = null;
  static refusePost: Error | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: Partial<ErrorEvent>) => void) | null = null;
  onmessageerror: ((event: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  terminated = false;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    if (StubWorker.refuse) throw StubWorker.refuse;
    StubWorker.made.push(this);
  }
  postMessage(message: unknown) {
    if (StubWorker.refusePost) throw StubWorker.refusePost;
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}

const world: WorldSpec = {
  kind: 'generated',
  seed: 4242,
  params: { ...DEFAULT_MAP_PARAMS, w: 64, h: 64, originX: 0, originY: 0 },
  chunks: {},
};
const request = () => edgeStripRequest(world)!;

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  StubWorker.made = [];
  StubWorker.refuse = StubWorker.refusePost = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('building the strip in a worker', () => {
  /** A build begun on a stub worker. */
  function begin() {
    vi.stubGlobal('Worker', StubWorker);
    const answer = buildEdgeStrip(request(), GRID);
    return { answer, worker: StubWorker.made[0] };
  }
  const logged = () => errors.mock.calls.map((call) => String(call[0])).join('\n');

  it('starts the module worker that is there, with the build and the region grid', () => {
    const { worker } = begin();
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.url.pathname.endsWith('/edgeStrip.worker.ts')).toBe(true);
    expect(existsSync(fileURLToPath(worker.url))).toBe(true);
    const job = worker.sent[0] as EdgeStripJob;
    expect(job.req).toEqual(request());
    expect(job.regions).toEqual(GRID);
    // what it sends must survive the copy to a worker
    expect(() => structuredClone(worker.sent[0])).not.toThrow();
  });

  it('sends the region grid alone, not the map it was read from', () => {
    vi.stubGlobal('Worker', StubWorker);
    void buildEdgeStrip(request(), { ...GRID, terrain: new Uint8Array(4) } as typeof GRID);
    expect((StubWorker.made[0].sent[0] as EdgeStripJob).regions).toEqual(GRID);
  });

  it('gives the answer of the worker and ends it', async () => {
    const { answer, worker } = begin();
    const shape = meshes();
    worker.onmessage!({ data: shape });
    await expect(answer).resolves.toBe(shape);
    expect(worker.terminated).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it('gives null for a null answer, and ends the worker', async () => {
    const { answer, worker } = begin();
    worker.onmessage!({ data: null });
    await expect(answer).resolves.toBeNull();
    expect(worker.terminated).toBe(true);
  });

  it('gives null when the worker fails, and logs the cause', async () => {
    const { answer, worker } = begin();
    const cause = new Error('boom');
    worker.onerror!({
      message: 'Uncaught Error: boom',
      filename: 'edgeStrip.worker.ts',
      lineno: 7,
      colno: 3,
      error: cause,
    });
    await expect(answer).resolves.toBeNull();
    expect(worker.terminated).toBe(true);
    expect(logged()).toContain('Uncaught Error: boom (edgeStrip.worker.ts:7:3)');
    expect(errors.mock.calls.flat()).toContain(cause);
  });

  it('gives null when the answer cannot be read, and logs it', async () => {
    const { answer, worker } = begin();
    worker.onmessageerror!({ data: null });
    await expect(answer).resolves.toBeNull();
    expect(worker.terminated).toBe(true);
    expect(logged()).toContain('could not be read');
  });

  it('gives null where there is no Worker', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(buildEdgeStrip(request(), GRID)).resolves.toBeNull();
    // nothing has gone wrong: this browser has none
    expect(errors).not.toHaveBeenCalled();
  });

  it('gives null when the worker cannot be made, and logs why', async () => {
    vi.stubGlobal('Worker', StubWorker);
    const refused = new Error('workers are off');
    StubWorker.refuse = refused;
    await expect(buildEdgeStrip(request(), GRID)).resolves.toBeNull();
    expect(logged()).toContain('workers are off');
    expect(errors.mock.calls.flat()).toContain(refused);
  });

  it('gives null when the job cannot be handed over, and ends the worker', async () => {
    vi.stubGlobal('Worker', StubWorker);
    StubWorker.refusePost = new DOMException('out of memory', 'DataCloneError');
    await expect(buildEdgeStrip(request(), GRID)).resolves.toBeNull();
    expect(StubWorker.made[0].terminated).toBe(true);
    expect(logged()).toContain('DataCloneError');
  });

  it(`gives up after ${EDGE_STRIP_TIMEOUT_MS / 1000} s without an answer, not before`, async () => {
    vi.useFakeTimers();
    const { answer, worker } = begin();
    const seen = vi.fn();
    void answer.then(seen);
    await vi.advanceTimersByTimeAsync(EDGE_STRIP_TIMEOUT_MS - 1);
    expect(seen).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toHaveBeenCalledWith(null);
    expect(worker.terminated).toBe(true);
    expect(logged()).toContain('no answer');
  });

  it('leaves no timer behind an answer, and takes the first thing that happens', async () => {
    vi.useFakeTimers();
    const { answer, worker } = begin();
    const shape = meshes();
    worker.onmessage!({ data: shape });
    worker.onerror!({ message: 'late' });
    await expect(answer).resolves.toBe(shape);
    expect(vi.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('the worker itself', () => {
  /** Runs edgeStrip.worker.ts in a stand-in for its global scope. */
  async function workerScope() {
    vi.resetModules();
    const posted: { data: unknown; options?: { transfer: ArrayBuffer[] } }[] = [];
    const scope = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (data: unknown, options?: { transfer: ArrayBuffer[] }) =>
        void posted.push({ data, options }),
    };
    vi.stubGlobal('self', scope);
    await import('./edgeStrip.worker');
    return { scope, posted };
  }

  it('answers a job with the blocks of the map, their buffers handed over', async () => {
    const { scope, posted } = await workerScope();
    scope.onmessage!({ data: { req: request(), regions: GRID } });
    expect(posted).toHaveLength(1);
    const answer = posted[0].data as StripMesh[];
    expect(answer.length).toBeGreaterThan(0);
    // sixteen regions, of which the four in the middle touch no edge
    expect(new Set(answer.map((m) => m.region)).size).toBe(12);
    expect(answer.some((m) => m.front)).toBe(true);
    expect(answer.some((m) => !m.front)).toBe(true);
    for (const m of answer) {
      expect(m.points.length).toBeGreaterThan(0);
      expect(Number.isFinite(m.points[0])).toBe(true);
    }
    expect(posted[0].options!.transfer).toHaveLength(answer.length * 5);
    expect(posted[0].options!.transfer).toContain(answer[0].points.buffer);
    expect(errors).not.toHaveBeenCalled();
  }, 30_000);

  it('answers null when the build throws, and logs why', async () => {
    const { scope, posted } = await workerScope();
    const req = { ...request(), chunks: null };
    scope.onmessage!({ data: { req, regions: GRID } });
    expect(posted).toEqual([{ data: null, options: undefined }]);
    expect(errors).toHaveBeenCalled();
  }, 30_000);

  it('takes what the page sends, and the page takes what it answers', async () => {
    const { scope } = await workerScope();
    /** A worker whose inside is the real one: what goes in and out is copied as a browser does. */
    class Bridged extends StubWorker {
      postMessage(message: unknown) {
        super.postMessage(message);
        scope.postMessage = (data, options) => {
          this.onmessage?.({ data: structuredClone(data, options) });
        };
        scope.onmessage!({ data: structuredClone(message) });
      }
    }
    vi.stubGlobal('Worker', Bridged);
    const answer = await buildEdgeStrip(request(), GRID);
    expect(answer).not.toBeNull();
    expect(answer![0].points).toBeInstanceOf(Float32Array);
  }, 30_000);
});

describe('the blocks on the page', () => {
  /** A view of the strip of a map of 64 x 64 whose regions `shown` holds. */
  function setup(shown = new Set<number>()) {
    const back = new Container();
    const front = new Container();
    const view = new EdgeStripView(back, front, (region) => shown.has(region));
    const list = meshes();
    const covers: [number, boolean, boolean][] = [];
    view.onCover = (region, isFront, covered) => void covers.push([region, isFront, covered]);
    view.set(list);
    const shapes = () => [...back.children, ...front.children] as Graphics[];
    const drawn = () => shapes().filter((s) => s.context.instructions.length > 0).length;
    return { back, front, view, list, shown, covers, shapes, drawn };
  }
  /** Time passing until nothing is left to fade. */
  const settle = (view: EdgeStripView) => {
    for (let i = 0; i < 300; i++) view.update(0.05);
  };

  it('keeps a block in its layer and in depth order, whatever is drawn first', () => {
    const s = setup();
    expect(s.back.children.length).toBe(s.list.filter((m) => !m.front).length);
    expect(s.front.children.length).toBe(s.list.filter((m) => m.front).length);
    const order = [...s.back.children];
    s.shown.add(15);
    s.view.refresh();
    settle(s.view);
    expect(s.back.children).toEqual(order);
    expect(s.drawn()).toBeGreaterThan(0);
  });

  it('draws nothing while no region beside it shows', () => {
    const s = setup();
    settle(s.view);
    expect(s.drawn()).toBe(0);
    expect(s.shapes().every((shape) => !shape.visible)).toBe(true);
  });

  it('draws a block with all its fills and one stroke a run, one pixel wide', () => {
    const s = setup(new Set([0]));
    settle(s.view);
    const i = s.list.findIndex((m) => m.region === 0 && !m.front);
    const shape = s.back.children[s.list.slice(0, i).filter((m) => !m.front).length] as Graphics;
    const steps = shape.context.instructions;
    const fills = steps.filter((step) => step.action === 'fill');
    const strokes = steps.filter((step) => step.action === 'stroke');
    expect(fills).toHaveLength(s.list[i].colors.length);
    expect(strokes).toHaveLength(s.list[i].runs.length / 3);
    const first = strokes[0].data as unknown as {
      style: { pixelLine: boolean; color: number; alpha: number };
    };
    expect(first.style.pixelLine).toBe(true);
    expect(first.style.color).toBe(s.list[i].runs[1]);
    expect(first.style.alpha).toBeCloseTo(s.list[i].runs[2]);
  });

  it(`spreads the drawing over frames, past ${STRIP_FRAME_BUDGET_MS} ms a frame`, () => {
    const s = setup(new Set(Array.from({ length: 16 }, (_, i) => i)));
    // a clock where each look at it costs over a third of the budget: three blocks fit in a frame
    let now = 0;
    const look = STRIP_FRAME_BUDGET_MS / 3 + 0.01;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += look));
    const frames: number[] = [];
    for (let i = 0; i < 100 && s.drawn() < s.list.length; i++) {
      const before = s.drawn();
      s.view.update(1 / 60);
      frames.push(s.drawn() - before);
    }
    expect(s.drawn()).toBe(s.list.length);
    expect(Math.max(...frames)).toBeLessThanOrEqual(3);
    expect(frames.length).toBeGreaterThan(1);
  });

  it('always draws a block in a frame, however slow the clock', () => {
    const s = setup(new Set([0]));
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 1000));
    settle(s.view);
    expect(s.drawn()).toBeGreaterThan(0);
  });

  it('fades a block in over its time, and says when it has come in whole', () => {
    const s = setup(new Set([0]));
    s.view.update(0);
    const shape = s.shapes().find((c) => c.visible)!;
    expect(shape.alpha).toBe(0);
    expect(s.covers).toEqual([]);
    s.view.update(STRIP_FADE_SECONDS / 2);
    expect(shape.alpha).toBeCloseTo(0.5);
    expect(s.covers).toEqual([]);
    settle(s.view);
    expect(shape.alpha).toBe(1);
    expect(s.covers.filter(([region]) => region === 0).length).toBeGreaterThan(0);
    expect(s.covers.every(([, , covered]) => covered)).toBe(true);
  });

  it('takes a block away with its region, and shows it again without drawing it twice', () => {
    const s = setup(new Set([0]));
    settle(s.view);
    const lit = s.shapes().filter((c) => c.visible);
    const steps = lit[0].context.instructions.length;
    s.covers.length = 0;
    s.shown.clear();
    s.view.refresh();
    expect(lit.every((c) => !c.visible)).toBe(true);
    expect(s.covers.every(([, , covered]) => !covered)).toBe(true);
    expect(s.covers.length).toBe(lit.length);
    s.shown.add(0);
    s.view.refresh();
    settle(s.view);
    expect(lit.every((c) => c.visible && c.alpha === 1)).toBe(true);
    expect(lit[0].context.instructions.length).toBe(steps);
  });

  it('tells the regions it shows', () => {
    const s = setup(new Set([0, 3, 7]));
    expect(s.view.regions()).toEqual(new Set([0, 3, 7]));
  });
});
