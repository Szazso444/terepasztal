import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Texture } from 'pixi.js';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { buildRelief } from './terrainRelief';
import {
  Landscape,
  JOB_TIMEOUT_MS,
  workerErrorText,
  type LandscapeStatus,
  type PainterPool,
} from './landscape';

/** Records what the landscape sends and lets a test answer or crash like a paint worker. */
class StubWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: Partial<ErrorEvent>) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  terminated = false;
  postMessage(message: Record<string, unknown>) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: object) {
    this.onmessage?.({ data });
  }
  crash(event: Partial<ErrorEvent>) {
    this.onerror?.(event);
  }
}

/** A landscape on a small empty map whose pools are stub workers, two to a pool. */
function setup(spawn?: () => StubWorker) {
  const spawned: StubWorker[] = [];
  const painters: PainterPool = {
    size: 2,
    spawn: () => {
      const worker = spawn ? spawn() : new StubWorker();
      spawned.push(worker);
      return worker as unknown as Worker;
    },
    sheet: () => 'test://terrain-surfaces.png',
  };
  const map = emptyMap(155, 16, 16);
  const landscape = new Landscape(map, new Set(), new Map(), painters);
  const seen: LandscapeStatus[] = [];
  landscape.watchStatus((s) => seen.push(s));
  return { landscape, map, spawned, seen, states: () => seen.map((s) => s.state) };
}
const pool = (spawned: StubWorker[], n: number) => spawned.slice(n * 2, n * 2 + 2);
const jobsOf = (w: StubWorker) => w.sent.filter((m) => typeof m.id === 'string');

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('landscape status', () => {
  it('is loading until a worker has the surface sheet, then active from the next flush', () => {
    const { landscape, spawned, states } = setup();
    expect(landscape.status).toEqual({ state: 'loading' });
    expect(spawned).toHaveLength(2);
    for (const w of spawned) {
      expect(w.sent[0]).toEqual({ url: 'test://terrain-surfaces.png' });
      expect(w.sent.some((m) => 'map' in m)).toBe(true);
    }
    spawned[0].reply({ loaded: true });
    expect(landscape.status.state).toBe('loading');
    expect(landscape.flush()).toBe(true);
    expect(landscape.status).toEqual({ state: 'active' });
    expect(landscape.active).toBe(true);
    expect(landscape.failed).toBe(false);
    expect(states()).toEqual(['loading', 'active']);
    expect(errors).not.toHaveBeenCalled();
  });

  it('logs a worker error event with its message, file and line, and starts one fresh pool', () => {
    const { landscape, spawned, states } = setup();
    const cause = new Error('boom');
    spawned[1].crash({
      message: 'Uncaught Error: boom',
      filename: 'landscape.worker.ts',
      lineno: 42,
      colno: 7,
      error: cause,
    });
    const logged = errors.mock.calls.find((call) => String(call[0]).includes('boom'));
    expect(logged).toBeDefined();
    expect(String(logged![0])).toContain('landscape.worker.ts:42:7');
    expect(logged).toContain(cause);
    expect(pool(spawned, 0).every((w) => w.terminated)).toBe(true);
    expect(spawned).toHaveLength(4);
    for (const w of pool(spawned, 1)) {
      expect(w.terminated).toBe(false);
      expect(w.sent[0]).toEqual({ url: 'test://terrain-surfaces.png' });
      expect(w.sent.some((m) => 'map' in m)).toBe(true);
    }
    expect(landscape.status.state).toBe('loading');
    pool(spawned, 1)[0].reply({ loaded: true });
    landscape.flush();
    expect(states()).toEqual(['loading', 'active']);
  });

  it('counts every worker of one pool failing as one failure, and drops its late messages', () => {
    const { landscape, spawned } = setup();
    spawned[0].crash({});
    spawned[1].reply({ error: 'Error: Terrain surfaces: 404' });
    spawned[1].reply({ loaded: true });
    expect(spawned).toHaveLength(4);
    expect(landscape.failed).toBe(false);
    landscape.flush();
    expect(landscape.status.state).toBe('loading');
  });

  it('fails for good with the reason when the restarted pool fails too', () => {
    const { landscape, spawned, seen } = setup();
    spawned[0].crash({ message: 'first', filename: 'landscape.worker.ts', lineno: 1, colno: 1 });
    const stack = 'Error: Terrain surfaces: 404\n    at onmessage (landscape.worker.ts:27:33)';
    pool(spawned, 1)[0].reply({ error: 'Error: Terrain surfaces: 404', stack });
    expect(landscape.status.state).toBe('failed');
    const reason = (landscape.status as { reason: string }).reason;
    expect(reason).toContain('Terrain surfaces: 404');
    expect(seen.filter((s) => s.state === 'failed')).toHaveLength(1);
    expect(errors.mock.calls.some((call) => call.includes(stack))).toBe(true);
    expect(spawned).toHaveLength(4);
    expect(spawned.every((w) => w.terminated)).toBe(true);
    expect(landscape.root.visible).toBe(false);
    // The world renderer re-anchors once to the fallback ground, and nothing restarts after.
    expect(landscape.flush()).toBe(true);
    expect(landscape.flush()).toBe(false);
    pool(spawned, 1)[1].crash({ message: 'late' });
    expect(spawned).toHaveLength(4);
    expect(seen.filter((s) => s.state === 'failed')).toHaveLength(1);
  });

  it('counts a pool that cannot start as a failure', () => {
    let tries = 0;
    const { landscape } = setup(() => {
      tries++;
      throw new Error('Worker is not defined');
    });
    expect(tries).toBe(2);
    expect(landscape.status.state).toBe('failed');
    expect((landscape.status as { reason: string }).reason).toContain('Worker is not defined');
  });

  it('stays active through a restart, and the new pool paints the chunk the old one was on', () => {
    const { landscape, spawned, states } = setup();
    landscape.add(0, 0, 8, 8);
    spawned[0].reply({ loaded: true });
    landscape.flush();
    expect(jobsOf(spawned[0]).map((m) => m.id)).toEqual(['0,0']);
    spawned[0].crash({ message: 'out of memory' });
    expect(landscape.active).toBe(true);
    const fresh = pool(spawned, 1);
    fresh[1].reply({ loaded: true });
    expect(jobsOf(fresh[1]).map((m) => m.id)).toEqual(['0,0']);
    expect(states()).toEqual(['loading', 'active']);
  });

  it('ignores errors after the landscape is destroyed', () => {
    const { landscape, spawned, states } = setup();
    landscape.root.destroy();
    expect(spawned.every((w) => w.terminated)).toBe(true);
    spawned[0].crash({ message: 'late' });
    expect(spawned).toHaveLength(2);
    expect(states()).toEqual(['loading']);
  });
});

/** A landscape whose restarted pool failed too: off for the rest of the session. */
function failedSetup() {
  const s = setup();
  s.spawned[0].crash({ message: 'first' });
  pool(s.spawned, 1)[0].reply({ error: 'Error: Terrain surfaces: 404' });
  expect(s.landscape.failed).toBe(true);
  return s;
}
/** A landscape whose workers loaded: painting, and active from the first flush. */
function workingSetup() {
  const s = setup();
  s.spawned[0].reply({ loaded: true });
  s.landscape.flush();
  expect(s.landscape.active).toBe(true);
  return s;
}
/** Raises a 5 x 5 block of tiles to hills and reports each, as the editor's brush does. */
function raiseHill(landscape: Landscape, map: { w: number; terrain: Uint8Array }) {
  for (let y = 5; y < 10; y++)
    for (let x = 5; x < 10; x++) {
      map.terrain[y * map.w + x] = Terrain.Hill;
      landscape.invalidate(x, y);
    }
}
const everyTile = (map: { w: number; h: number }) =>
  Array.from({ length: map.w * map.h }, (_, k) => ({ x: k % map.w, y: Math.floor(k / map.w) }));

describe('landscape ground rules', () => {
  it('answers the same level and straight questions whether the painter works or has failed', () => {
    const working = workingSetup(),
      failed = failedSetup();
    for (const s of [working, failed]) raiseHill(s.landscape, s.map);
    let refused = 0;
    for (const { x, y } of everyTile(working.map))
      for (const need of ['straight', 'level'] as const) {
        const answer = working.landscape.groundAllows(x, y, need);
        if (!answer) refused++;
        expect(failed.landscape.groundAllows(x, y, need), `${need} at ${x},${y}`).toBe(answer);
      }
    // the hill's bank rim is refused level, the open grass and the hill's own top are not
    expect(refused).toBeGreaterThan(0);
    expect(failed.landscape.groundAllows(5, 5, 'level')).toBe(false);
    expect(failed.landscape.groundAllows(7, 7, 'level')).toBe(true);
    expect(failed.landscape.groundAllows(14, 14, 'level')).toBe(true);
  });

  it('shows a terrain change reported after the failure in the next answer', () => {
    const { landscape, map } = failedSetup();
    expect(landscape.groundAllows(5, 7, 'level')).toBe(true);
    raiseHill(landscape, map);
    expect(landscape.groundAllows(5, 7, 'level')).toBe(false);
    for (let y = 5; y < 10; y++)
      for (let x = 5; x < 10; x++) {
        map.terrain[y * map.w + x] = Terrain.Grass;
        landscape.invalidate(x, y);
      }
    expect(landscape.groundAllows(5, 7, 'level')).toBe(true);
  });

  it('stays off after the failure: one status change, no painting, nothing queued per change', () => {
    const { landscape, map, spawned } = failedSetup();
    expect(landscape.flush()).toBe(true);
    const sent = spawned.map((w) => w.sent.length);
    raiseHill(landscape, map);
    landscape.groundAllows(5, 7, 'level');
    expect(landscape.flush()).toBe(false);
    expect(landscape.flush()).toBe(false);
    expect(spawned.map((w) => w.sent.length)).toEqual(sent);
    expect(spawned).toHaveLength(4);
    expect(landscape.status.state).toBe('failed');
    const queued = landscape as unknown as { dirtyTiles: unknown[]; invalid: boolean };
    expect(queued.dirtyTiles).toHaveLength(0);
    expect(queued.invalid).toBe(false);
  });

  it('builds the relief once for a run of changes, on the question after them', () => {
    const { landscape, map } = failedSetup();
    const before = landscape.groundAllows(5, 7, 'level');
    raiseHill(landscape, map);
    const rebuilt = (landscape as unknown as { relief: unknown }).relief;
    expect(landscape.groundAllows(5, 7, 'level')).not.toBe(before);
    const after = (landscape as unknown as { relief: unknown }).relief;
    expect(after).not.toBe(rebuilt);
    landscape.groundAllows(6, 7, 'level');
    expect((landscape as unknown as { relief: unknown }).relief).toBe(after);
  });
});

describe('workerErrorText', () => {
  it('names the file, line and column when the event has them', () => {
    expect(
      workerErrorText({ message: 'Uncaught TypeError: x', filename: 'w.js', lineno: 3, colno: 9 }),
    ).toBe('Uncaught TypeError: x (w.js:3:9)');
  });
  it('still says something for the bare event of a worker script that did not load', () => {
    expect(workerErrorText({}).length).toBeGreaterThan(0);
  });
});

/** A paint job as the landscape hands it out. */
type JobMessage = { id: string; scale: number; version: number };
/** A worker's answer to a job it painted: a two-pixel image, enough for a texture stand-in. */
const painted = (job: JobMessage) => ({
  id: job.id,
  version: job.version,
  left: 0,
  top: 0,
  width: 2,
  height: 2,
  scale: job.scale,
  pixels: new Uint8ClampedArray(16),
  grass: new Float32Array(0),
  tint: 0xffffff,
  ms: 1,
});
const isJob = (m: Record<string, unknown>) => typeof m.id === 'string';

/**
 * A stub that answers as landscape.worker.ts does, one message at a time in the order they were
 * sent: the sheet loads, a map sets its version, and a job is painted, or turned away when its
 * version is not the worker's. Tests make it throw on a hand-off or lose a message.
 */
class PaintWorker extends StubWorker {
  version = -1;
  read = 0;
  /** Map hand-offs to throw on, as postMessage does with a DataCloneError once memory runs out. */
  throwOnMap = 0;
  /** Job hand-offs to throw on. */
  throwOnJob = 0;
  /** Maps to lose without a word. */
  dropMap = 0;
  /** Jobs to lose without an answer, and the ones lost. */
  loseJobs = 0;
  lost: Record<string, unknown>[] = [];
  postMessage(message: Record<string, unknown>) {
    const kind = 'map' in message ? 'throwOnMap' : isJob(message) ? 'throwOnJob' : null;
    if (kind && this[kind] > 0) {
      this[kind]--;
      throw new DOMException('Data cannot be cloned, out of memory.', 'DataCloneError');
    }
    super.postMessage(message);
  }
  /** Handles the next message waiting; false when none is. */
  step() {
    if (this.terminated || this.read >= this.sent.length) return false;
    const m = this.sent[this.read++];
    if ('url' in m) this.reply({ loaded: true });
    else if ('map' in m) {
      if (this.dropMap > 0) this.dropMap--;
      else this.version = m.version as number;
    } else if (this.loseJobs > 0) {
      this.loseJobs--;
      this.lost.push(m);
    } else {
      const job = m as JobMessage;
      this.reply(
        job.version === this.version
          ? painted(job)
          : { stale: true, id: job.id, scale: job.scale, version: job.version },
      );
    }
    return true;
  }
  /** Handles every message waiting, those its own answers bring included. */
  drain() {
    for (let i = 0; i < 1000; i++) if (!this.step()) return;
    throw new Error('a paint worker was still busy after 1000 messages');
  }
}

/** The clock the landscape reads, and its chunk textures, which need a DOM to build. */
const time = { now: 0 };
const build = { failing: 0, built: 0 };
/** What each stand-in texture shows: the chunk, and the map version and scale it was painted at. */
const shows = new WeakMap<Texture, JobMessage>();
type ChunkInside = {
  base: Texture;
  sharp: Texture | null;
  sprite: { texture: Texture };
};
type Inside = {
  slots: { worker: PaintWorker; loaded: boolean; job: JobMessage | null }[];
  version: number;
  pending: Set<string>;
  sharpPending: Set<string>;
  loaded: boolean;
  chunks: Map<string, ChunkInside>;
};
const inside = (landscape: Landscape) => landscape as unknown as Inside;

/** A landscape on stub workers that answer like real ones, with the clock in the test's hands. */
function paintWorld() {
  time.now = 0;
  build.failing = build.built = 0;
  const s = setup(() => new PaintWorker());
  const workers = s.spawned as PaintWorker[];
  /** Tiles edited since the last frame. */
  const edits: { x: number; y: number }[] = [];
  /** Per chunk, the map version of the last edit inside it: its picture may be no older. */
  const due = new Map<string, number>();
  return {
    ...s,
    workers,
    due,
    /** The pool in use: the last two workers started. */
    current: () => workers.slice(-2),
    /** Turns a tile from grass to hill or back and reports it, as the editor's brush does. */
    edit: (x: number, y: number) => {
      const i = y * s.map.w + x;
      s.map.terrain[i] = s.map.terrain[i] === Terrain.Hill ? Terrain.Grass : Terrain.Hill;
      s.landscape.invalidate(x, y);
      edits.push({ x, y });
    },
    /** One frame, `ms` after the last. */
    frame: (ms = 16) => {
      time.now += ms;
      const before = inside(s.landscape).version;
      const changed = s.landscape.flush();
      const version = inside(s.landscape).version;
      // A frame that raised the version took every edit before it; one that did not had failed.
      for (const { x, y } of edits.splice(0))
        if (version !== before) due.set(`${x - (x % 8)},${y - (y % 8)}`, version);
      return changed;
    },
  };
}
type World = ReturnType<typeof paintWorld>;
/** The four chunks of the 16 x 16 map. */
const CHUNKS = [
  [0, 0],
  [8, 0],
  [0, 8],
  [8, 8],
] as const;
/** Every chunk added and painted by a loaded pool. */
function paintedWorld() {
  const w = paintWorld();
  for (const [x, y] of CHUNKS) w.landscape.add(x, y, 8, 8);
  settle(w);
  expect(w.landscape.ready).toBe(true);
  expect(w.landscape.active).toBe(true);
  return w;
}

/**
 * Why the painter is stalled, or null when it is not. While it is loaded and not failed:
 * - every job out is one its worker will still answer (or one it lost, which the watchdog catches);
 * - with chunks pending, a worker holds a job for the current map version. The one exception is
 *   right after the map changed: a worker cannot drop a paint it has begun, so every loaded worker
 *   may still be on a job of the older version, and its answer is what hands out the next one;
 * - no loaded worker sits idle while a chunk waits that no worker is painting for the current map,
 *   or while a close-view copy waits to be handed out.
 */
function stall(landscape: Landscape) {
  const l = inside(landscape);
  if (!l.loaded || landscape.failed) return null;
  const out = l.slots.filter((slot) => slot.job);
  for (const { worker, job } of out) {
    const same = (m: Record<string, unknown>) =>
      m.id === job!.id && m.scale === job!.scale && m.version === job!.version;
    if (!worker.sent.slice(worker.read).some(same) && !worker.lost.some(same))
      return `job ${job!.id}@${job!.version} is out, but its worker will never answer it`;
  }
  const current = out.some(({ job }) => job!.version === l.version);
  const allOnOlder = l.slots.every((slot) => !slot.loaded || slot.job);
  if (l.pending.size && !current && !allOnOlder)
    return `${l.pending.size} chunks pending and no job out for map version ${l.version}`;
  if (l.slots.some((slot) => slot.loaded && !slot.job)) {
    const painting = (id: string) =>
      out.some(({ job }) => job!.id === id && job!.scale === 1 && job!.version === l.version);
    const waiting = [...l.pending].find((id) => !painting(id)) ?? [...l.sharpPending][0];
    if (waiting !== undefined)
      return `a worker is idle while chunk ${waiting} waits (map version ${l.version})`;
  }
  return null;
}
/**
 * Every chunk shows a picture painted for it at scale 1, for a map no older than the last edit
 * inside it.
 */
function expectFresh(w: World) {
  const l = inside(w.landscape);
  for (const [id, c] of l.chunks) {
    const shown = shows.get(c.base);
    expect(shown, `chunk ${id} is painted`).toBeDefined();
    expect(shown, `chunk ${id}`).toMatchObject({ id, scale: 1 });
    expect(shown!.version, `map version of chunk ${id}`).toBeGreaterThanOrEqual(w.due.get(id) ?? 0);
  }
}
/** The whole 16 x 16 map, as the camera's world rectangle. */
const VIEW = { x: -600, y: -200, w: 1200, h: 900 };
/**
 * Holds a close view over the whole map, focused every frame as the world renderer does, and lets
 * the pool in use answer everything, a frame a second, until every close-view copy is painted or
 * the landscape fails.
 */
function settleSharp(w: World) {
  for (let i = 0; i < 100; i++) {
    w.landscape.focus(VIEW, 2);
    if (w.landscape.sharpReady || w.landscape.failed) return;
    for (const worker of w.current()) worker.drain();
    expect(stall(w.landscape)).toBeNull();
    w.frame(1000);
    expect(stall(w.landscape)).toBeNull();
  }
}
/** Every chunk shows a close-view copy painted for it at the current map version. */
function expectSharp(w: World) {
  const l = inside(w.landscape);
  expect(w.landscape.sharpReady, 'sharpReady').toBe(true);
  for (const [id, c] of l.chunks) {
    const shown = c.sharp ? shows.get(c.sharp) : undefined;
    expect(shown, `close-view copy of chunk ${id}`).toEqual({ id, version: l.version, scale: 2 });
    expect(c.sprite.texture, `chunk ${id} shows its close-view copy`).toBe(c.sharp);
  }
}
/**
 * Lets the pool in use answer everything and runs a frame a second, checking for a stall after
 * each, until the landscape is ready or failed; 100 frames is more than three watchdog limits.
 */
function settle(w: World) {
  for (let i = 0; i < 100 && !w.landscape.ready && !w.landscape.failed; i++) {
    for (const worker of w.current()) worker.drain();
    expect(stall(w.landscape)).toBeNull();
    w.frame(1000);
    expect(stall(w.landscape)).toBeNull();
  }
}

describe('landscape painter', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => time.now);
    vi.spyOn(
      Landscape.prototype as unknown as { chunkTexture(data: JobMessage): Texture },
      'chunkTexture',
    ).mockImplementation((data: JobMessage) => {
      if (build.failing > 0) {
        build.failing--;
        // What the canvas path throws when getContext('2d') returns null.
        throw new TypeError("Cannot read properties of null (reading 'putImageData')");
      }
      build.built++;
      const texture = new Texture();
      shows.set(texture, { id: data.id, version: data.version, scale: data.scale });
      return texture;
    });
  });

  it('paints every chunk with stub workers that answer like real ones', () => {
    const w = paintedWorld();
    for (const [x, y] of CHUNKS) expect(w.landscape.isPainted(x, y)).toBe(true);
    expect(build.built).toBe(4);
    expect(w.workers).toHaveLength(2);
  });

  it('replaces the pool when a map hand-off throws in flush, and every chunk is painted', () => {
    const w = paintedWorld();
    const before = w.current();
    // The second worker's hand-off throws after the first worker took the new map.
    before[1].throwOnMap = 1;
    raiseHill(w.landscape, w.map);
    w.frame();
    expect(before[0].sent.filter((m) => 'map' in m)).toHaveLength(2);
    expect(before.every((worker) => worker.terminated)).toBe(true);
    expect(w.workers).toHaveLength(4);
    expect(w.landscape.status.state).toBe('active');
    expect(errors.mock.calls.some((call) => String(call[0]).includes('DataCloneError'))).toBe(true);
    // The fresh pool takes the new map and repaints the chunks around the hill.
    const version = inside(w.landscape).version;
    for (const worker of w.current())
      expect(worker.sent.find((m) => 'map' in m)?.version).toBe(version);
    expect(w.landscape.ready).toBe(false);
    settle(w);
    expect(w.landscape.ready).toBe(true);
    expect(w.workers).toHaveLength(4);
  });

  it('fails with a reason when the hand-off throws again in the fresh pool', () => {
    const w = paintedWorld();
    w.current()[0].throwOnMap = 1;
    raiseHill(w.landscape, w.map);
    w.frame();
    for (const worker of w.current()) worker.drain();
    w.current()[1].throwOnMap = 1;
    w.landscape.invalidate(2, 2);
    expect(w.frame()).toBe(true);
    expect(w.landscape.status.state).toBe('failed');
    expect((w.landscape.status as { reason: string }).reason).toContain('DataCloneError');
    expect(w.workers.every((worker) => worker.terminated)).toBe(true);
    expect(w.landscape.ready).toBe(false);
  });

  it('hands the map again to a worker that turned a job away, and paints the chunk', () => {
    const warnings = vi.mocked(console.warn);
    const w = paintedWorld();
    const [first, second] = w.current();
    // Both workers lose the next map without a word, as if its hand-off never arrived.
    first.dropMap = second.dropMap = 1;
    raiseHill(w.landscape, w.map);
    w.frame();
    const version = inside(w.landscape).version;
    first.drain();
    // Turned away, then given the map of this version again, ahead of its next job.
    const maps = first.sent.flatMap((m, i) => ('map' in m ? [i] : []));
    expect(maps.map((i) => first.sent[i].version)).toEqual([0, version, version]);
    expect(first.sent.slice(maps[2]).some(isJob)).toBe(true);
    expect(warnings.mock.calls.some((call) => String(call[0]).includes('missed map version'))).toBe(
      true,
    );
    expect(stall(w.landscape)).toBeNull();
    settle(w);
    expect(w.landscape.ready).toBe(true);
    // No restart was needed.
    expect(w.workers).toHaveLength(2);
    for (const [x, y] of CHUNKS) expect(w.landscape.isPainted(x, y)).toBe(true);
  });

  it('counts a worker that turns the same version away twice as a failure, not a loop', () => {
    const w = paintedWorld();
    w.current()[0].dropMap = 2;
    raiseHill(w.landscape, w.map);
    w.frame();
    w.current()[0].drain();
    expect(w.workers).toHaveLength(4);
    expect(w.landscape.status.state).toBe('active');
    settle(w);
    expect(w.landscape.ready).toBe(true);
  });

  it('restarts the pool once when a painted chunk cannot be shown, and paints it then', () => {
    const w = paintWorld();
    for (const [x, y] of CHUNKS) w.landscape.add(x, y, 8, 8);
    build.failing = 1;
    const first = w.current();
    for (const worker of first) worker.drain();
    // The chunk whose texture failed is still pending, and no worker is left idle with it.
    expect(first.every((worker) => worker.terminated)).toBe(true);
    expect(w.workers).toHaveLength(4);
    expect(stall(w.landscape)).toBeNull();
    settle(w);
    expect(w.landscape.ready).toBe(true);
    expect(w.landscape.status.state).toBe('active');
  });

  it('turns the landscape off when chunks still cannot be shown after the restart', () => {
    const w = paintWorld();
    for (const [x, y] of CHUNKS) w.landscape.add(x, y, 8, 8);
    build.failing = Infinity;
    settle(w);
    expect(w.landscape.status.state).toBe('failed');
    expect((w.landscape.status as { reason: string }).reason).toContain('putImageData');
    expect(w.workers).toHaveLength(4);
    expect(w.seen.filter((s) => s.state === 'failed')).toHaveLength(1);
  });

  it('replaces the pool when a job hand-off throws', () => {
    const w = paintedWorld();
    w.current()[1].throwOnJob = 1;
    raiseHill(w.landscape, w.map);
    w.frame();
    expect(w.workers).toHaveLength(4);
    settle(w);
    expect(w.landscape.ready).toBe(true);
  });

  it(`restarts the pool when a job has had no answer for ${JOB_TIMEOUT_MS / 1000} s`, () => {
    const w = paintWorld();
    w.landscape.add(0, 0, 8, 8);
    const [first] = w.current();
    first.loseJobs = 1;
    first.drain();
    expect(inside(w.landscape).slots[0].job?.id).toBe('0,0');
    // A frame a second: no restart while the job is within the limit.
    for (let t = 0; t < JOB_TIMEOUT_MS; t += 1000) w.frame(1000);
    expect(w.workers).toHaveLength(2);
    expect(stall(w.landscape)).toBeNull();
    w.frame(1000);
    expect(w.workers).toHaveLength(4);
    expect(w.landscape.status.state).toBe('active');
    expect(errors.mock.calls.some((call) => String(call[0]).includes('no answer'))).toBe(true);
    settle(w);
    expect(w.landscape.ready).toBe(true);
  });

  it('does not count a pause (a hidden tab, a sleeping machine) against a job', () => {
    const w = paintWorld();
    w.landscape.add(0, 0, 8, 8);
    const [first] = w.current();
    first.step();
    first.step();
    expect(inside(w.landscape).slots[0].job?.id).toBe('0,0');
    w.frame(10 * 60_000);
    w.frame();
    expect(w.workers).toHaveLength(2);
    first.drain();
    w.frame();
    expect(w.landscape.ready).toBe(true);
  });

  it('never stalls: whatever fails, every chunk is painted or the landscape fails', () => {
    forAll(
      generateSteps,
      (steps) => {
        const w = paintWorld();
        for (const step of steps) {
          act(w, step);
          const why = stall(w.landscape) ?? lifecycle(w);
          if (why) throw new Error(`after ${JSON.stringify(step)}: ${why}`);
        }
        settle(w);
        expect(lifecycle(w)).toBeNull();
        expect(w.landscape.ready || w.landscape.failed, 'neither painted nor failed').toBe(true);
        if (w.landscape.ready) {
          for (const id of inside(w.landscape).chunks.keys()) {
            const [x, y] = id.split(',').map(Number);
            expect(w.landscape.isPainted(x, y), `chunk ${id}`).toBe(true);
          }
          expectFresh(w);
          settleSharp(w);
          expect(lifecycle(w)).toBeNull();
          if (!w.landscape.failed) expectSharp(w);
        }
        if (w.landscape.failed) {
          expect(w.workers.every((worker) => worker.terminated)).toBe(true);
          expect(w.landscape.root.visible).toBe(false);
        }
      },
      { shrink: (steps) => shrinkArray(steps) },
    );
  });

  it('comes back from any one failure painted, and with none never restarts or logs', () => {
    const warnings = vi.mocked(console.warn);
    forAll(
      generateQuiet,
      (steps) => {
        const logged = errors.mock.calls.length + warnings.mock.calls.length;
        const w = paintWorld();
        for (const step of steps) {
          act(w, step);
          const why = stall(w.landscape) ?? lifecycle(w);
          if (why) throw new Error(`after ${JSON.stringify(step)}: ${why}`);
        }
        settle(w);
        expect(w.landscape.ready, 'painted').toBe(true);
        expectFresh(w);
        settleSharp(w);
        expectSharp(w);
        expect(lifecycle(w)).toBeNull();
        expect(w.states()).not.toContain('failed');
        const faults = steps.filter((s) => (FAULTS as readonly string[]).includes(s.do)).length;
        expect(w.workers.length, 'workers started').toBeLessThanOrEqual(faults ? 4 : 2);
        if (!faults)
          expect(errors.mock.calls.length + warnings.mock.calls.length, 'lines logged').toBe(
            logged,
          );
      },
      { shrink: (steps) => shrinkArray(steps) },
    );
  });

  it('replaces the pool when handing the map again throws, and every chunk is painted', () => {
    const w = paintedWorld();
    const [first] = w.current();
    first.dropMap = 1;
    w.edit(2, 2);
    w.frame();
    // The worker missed the map and turns its job away; handing it the map again throws.
    first.throwOnMap = 1;
    first.drain();
    expect(first.terminated).toBe(true);
    expect(w.workers).toHaveLength(4);
    expect(w.landscape.status.state).toBe('active');
    expect(errors.mock.calls.some((call) => String(call[0]).includes('could not be handed'))).toBe(
      true,
    );
    expect(stall(w.landscape)).toBeNull();
    settle(w);
    expect(w.landscape.ready).toBe(true);
    expectFresh(w);
  });

  it('never counts a chunk a worker turned away as painted: it shows the new map', () => {
    const w = paintedWorld();
    for (const worker of w.current()) worker.dropMap = 1;
    // One tile in each chunk, so every chunk must show this map version or a later one.
    for (const [x, y] of CHUNKS) w.edit(x + 2, y + 2);
    w.frame();
    settle(w);
    expect(w.landscape.ready).toBe(true);
    expect(w.workers).toHaveLength(2);
    expectFresh(w);
  });

  it('gives a worker that turned away a job of an older map its next job at once', () => {
    const w = paintedWorld();
    const [first] = w.current();
    first.dropMap = 1;
    w.edit(2, 2);
    w.frame();
    // The map changes again while both workers are on jobs of the version before.
    w.edit(12, 12);
    w.frame();
    expect(inside(w.landscape).version).toBe(2);
    first.step(); // version 1 is lost
    first.step(); // its job of version 1 is turned away
    expect(inside(w.landscape).slots[0].job).toMatchObject({ version: 2, scale: 1 });
    expect(stall(w.landscape)).toBeNull();
    settle(w);
    expect(w.landscape.ready).toBe(true);
    expectFresh(w);
  });

  it('paints a close-view copy a worker turned away once the view is focused again', () => {
    const w = paintedWorld();
    settleSharp(w);
    expectSharp(w);
    const [first] = w.current();
    first.dropMap = 1;
    w.edit(2, 2);
    w.frame();
    w.landscape.focus(VIEW, 2);
    // The chunks show close-view copies, so those are repainted first.
    expect(inside(w.landscape).slots[0].job).toMatchObject({ scale: 2, version: 1 });
    first.drain();
    settleSharp(w);
    expectSharp(w);
    expect(w.workers).toHaveLength(2);
  });

  it('asks again for the close-view copies the old pool was painting, after a restart', () => {
    const w = paintedWorld();
    w.landscape.focus(VIEW, 2);
    expect(inside(w.landscape).slots.map((slot) => slot.job?.scale)).toEqual([2, 2]);
    w.current()[0].crash({ message: 'boom' });
    expect(w.workers).toHaveLength(4);
    settleSharp(w);
    expectSharp(w);
  });

  it(`restarts at the first frame a lost job has waited over ${JOB_TIMEOUT_MS / 1000} s of running time`, () => {
    forAll(
      // Up to 80 frames after the job: about half the cases cross the limit.
      (rng) => ({
        before: Array.from({ length: rng.int(0, 40) }, () => rng.pick(GAPS)),
        after: Array.from({ length: rng.int(1, 80) }, () => rng.pick(GAPS)),
      }),
      ({ before, after }) => {
        const w = paintWorld();
        const [first] = w.current();
        first.step(); // the sheet loads; no chunk yet, so no job
        // Running time passes before the job goes out, and must not count against it.
        for (const ms of before) w.frame(ms);
        expect(w.workers).toHaveLength(2);
        first.loseJobs = 1;
        w.landscape.add(0, 0, 8, 8);
        first.drain();
        expect(first.lost).toHaveLength(1);
        let waited = 0;
        after.forEach((ms, i) => {
          w.frame(ms);
          // The oracle: each frame adds its gap, capped at a second.
          waited += Math.min(ms, FRAME_CAP_MS);
          const restarted = waited > JOB_TIMEOUT_MS;
          expect(w.workers.length, `after frame ${i}, ${waited} ms`).toBe(restarted ? 4 : 2);
          expect(w.landscape.status.state).toBe('active');
        });
      },
      {
        *shrink({ before, after }) {
          // Fewer frames, then gaps of exactly the cap, which read most easily.
          const gap = (ms: number) => (ms === FRAME_CAP_MS ? [] : [FRAME_CAP_MS]);
          for (const b of shrinkArray(before, gap)) yield { before: b, after };
          for (const a of shrinkArray(after, gap)) yield { before, after: a };
        },
      },
    );
  });
});

/** The most one frame adds to a job's waiting time: FRAME_LIMIT_MS in landscape.ts. */
const FRAME_CAP_MS = 1000;
/** Frame gaps: the same millisecond, ordinary frames, either side of the cap, and long pauses. */
const GAPS = [0, 16, 500, 999, 1000, 1001, 4000, 600_000];
const ORDER = ['loading', 'active', 'failed'];
/**
 * Why the status or the pools broke their contract, or null: the status only moves forward from
 * loading to active to failed (a restart changes nothing), at most one fresh pool is started, and
 * a failed landscape holds no worker.
 */
function lifecycle(w: World) {
  const states = w.states();
  if (
    states[0] !== 'loading' ||
    states.some((s, i) => i && ORDER.indexOf(s) <= ORDER.indexOf(states[i - 1]))
  )
    return `status went ${states.join(' -> ')}`;
  if (w.workers.length > 4) return `${w.workers.length / 2} pools started`;
  if (w.landscape.failed && inside(w.landscape).slots.length)
    return `failed with ${inside(w.landscape).slots.length} workers`;
  return null;
}

/** One thing that happens to the painter: a worker answering, the map changing, a failure. */
type Step =
  | { do: 'answer'; worker: number; count: number }
  | { do: 'add'; chunk: number }
  | { do: 'edit'; x: number; y: number }
  | { do: 'frame'; ms: number }
  | { do: 'focus'; close: boolean }
  | { do: 'textureThrows' }
  | { do: 'mapThrows' | 'jobThrows' | 'dropMap' | 'lose' | 'crash'; worker: number };
const EVENTS = ['answer', 'answer', 'answer', 'answer', 'add', 'edit', 'frame', 'focus'] as const;
const FAULTS = ['textureThrows', 'mapThrows', 'jobThrows', 'dropMap', 'lose', 'crash'] as const;
/** Mostly ordinary events, with a fault one step in sixteen, so cases end painted as well as failed. */
function generateSteps(rng: Rng): Step[] {
  return Array.from({ length: rng.int(5, 80) }, () =>
    stepOf(rng, rng.chance(1 / 16) ? rng.pick(FAULTS) : rng.pick(EVENTS)),
  );
}
/**
 * Up to thirty ordinary events, so no answered job can wait out the watchdog (thirty frames add at
 * most JOB_TIMEOUT_MS), and in three cases of four one fault among them.
 */
function generateQuiet(rng: Rng): Step[] {
  const steps = Array.from({ length: rng.int(5, 30) }, () => stepOf(rng, rng.pick(EVENTS)));
  if (rng.chance(3 / 4)) steps.splice(rng.int(0, steps.length), 0, stepOf(rng, rng.pick(FAULTS)));
  return steps;
}
function stepOf(rng: Rng, kind: (typeof EVENTS)[number] | (typeof FAULTS)[number]): Step {
  switch (kind) {
    case 'answer':
      return { do: kind, worker: rng.int(0, 1), count: rng.int(1, 4) };
    case 'add':
      return { do: kind, chunk: rng.int(0, CHUNKS.length - 1) };
    case 'edit':
      return { do: kind, x: rng.int(0, 15), y: rng.int(0, 15) };
    case 'frame':
      return { do: kind, ms: rng.pick([16, 1000, 20_000, 600_000]) };
    case 'focus':
      return { do: kind, close: rng.chance(0.5) };
    case 'textureThrows':
      return { do: kind };
    default:
      return { do: kind, worker: rng.int(0, 1) };
  }
}
function act(w: World, step: Step) {
  const { landscape } = w;
  switch (step.do) {
    case 'answer':
      for (let i = 0; i < step.count; i++) w.current()[step.worker].step();
      return;
    case 'add': {
      const [x, y] = CHUNKS[step.chunk];
      landscape.add(x, y, 8, 8);
      return;
    }
    case 'edit':
      w.edit(step.x, step.y);
      return;
    case 'frame':
      w.frame(step.ms);
      return;
    case 'focus':
      // The whole map in view, close enough for sharp copies or not.
      landscape.focus(VIEW, step.close ? 2 : 1);
      return;
    case 'textureThrows':
      build.failing++;
      return;
    case 'mapThrows':
      w.current()[step.worker].throwOnMap++;
      return;
    case 'jobThrows':
      w.current()[step.worker].throwOnJob++;
      return;
    case 'dropMap':
      w.current()[step.worker].dropMap++;
      return;
    case 'lose':
      w.current()[step.worker].loseJobs++;
      return;
    case 'crash':
      w.current()[step.worker].crash({ message: 'boom' });
      return;
  }
}

describe('landscape worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers a job for a map version it does not have instead of dropping it', async () => {
    const posted: unknown[] = [];
    const scope: {
      onmessage?: (event: { data: unknown }) => Promise<void>;
      postMessage: (message: unknown) => void;
    } = { postMessage: (message) => posted.push(message) };
    vi.stubGlobal('self', scope);
    await import('./landscape.worker');
    // Before any map arrives.
    await scope.onmessage!({ data: { id: '8,0', x: 8, y: 0, w: 8, h: 8, scale: 2, version: 0 } });
    expect(posted).toEqual([{ stale: true, id: '8,0', scale: 2, version: 0 }]);
    // After a map of another version.
    const map = emptyMap(155, 16, 16);
    await scope.onmessage!({
      data: { map, relief: buildRelief(map, new Set()), version: 3, tint: 0xffffff, city: [] },
    });
    await scope.onmessage!({ data: { id: '0,0', x: 0, y: 0, w: 8, h: 8, scale: 1, version: 4 } });
    expect(posted).toEqual([
      { stale: true, id: '8,0', scale: 2, version: 0 },
      { stale: true, id: '0,0', scale: 1, version: 4 },
    ]);
  });
});
