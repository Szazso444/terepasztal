import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { Landscape, workerErrorText, type LandscapeStatus, type PainterPool } from './landscape';

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
