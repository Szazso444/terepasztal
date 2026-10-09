import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { emptyMap } from '../world/mapgen';
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
  const landscape = new Landscape(emptyMap(155, 16, 16), new Set(), new Map(), painters);
  const seen: LandscapeStatus[] = [];
  landscape.watchStatus((s) => seen.push(s));
  return { landscape, spawned, seen, states: () => seen.map((s) => s.state) };
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
