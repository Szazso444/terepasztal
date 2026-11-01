import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../game';
import { WorldRenderer } from '../render/worldRenderer';
import { EDGE_STRIP_TILES } from '../world/edgeStrip';
import { DEFAULT_MAP_PARAMS } from '../world/mapgen';
import type { WorldSpec } from '../sim/save';

// Where the game starts the edge strip. A `Game` cannot be constructed under Node (gameSave.test.ts
// says why), so `startEdgeStrip` runs on a stand-in with the prototype and the fields it reads, on a
// stub worker that answers as src/render/edgeStrip.worker.ts does.

class StubWorker {
  static made: StubWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: Partial<ErrorEvent>) => void) | null = null;
  sent: { regions: unknown }[] = [];
  constructor() {
    StubWorker.made.push(this);
  }
  postMessage(message: { regions: unknown }) {
    this.sent.push(message);
  }
  terminate() {}
}

const GENERATED: WorldSpec = {
  kind: 'generated',
  seed: 4242,
  params: { ...DEFAULT_MAP_PARAMS, w: 64, h: 64, originX: 0, originY: 0 },
  chunks: {},
};
const LEVEL = { kind: 'level', seed: 1, level: {} } as unknown as WorldSpec;
const BORDER = WorldRenderer.BORDER;

/** A Game with the prototype's `startEdgeStrip` and the fields it reads. */
function standIn(spec: WorldSpec) {
  const fields = {
    spec,
    map: { w: 64, h: 64, regionSize: 16, regionsX: 4 },
    dayNight: { setWorld: vi.fn() },
    fog: { setWorld: vi.fn() },
    world: {
      setEdgeStrip: vi.fn(),
      onStripReach: null as ((reach: object[]) => void) | null,
    },
  };
  const game = Object.assign(Object.create(Game.prototype), fields) as typeof fields & {
    startEdgeStrip(): void;
  };
  return game;
}
/** Lets the promise of a build run its course. */
const settled = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  StubWorker.made = [];
  vi.stubGlobal('Worker', StubWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the game and the edge strip', () => {
  it('asks a generated world for its strip, and shows what comes back', async () => {
    const game = standIn(GENERATED);
    game.startEdgeStrip();
    expect(StubWorker.made).toHaveLength(1);
    expect(StubWorker.made[0].sent[0].regions).toEqual({ regionSize: 16, regionsX: 4 });
    const answer = [{ region: 0 }];
    StubWorker.made[0].onmessage!({ data: answer });
    await settled();
    expect(game.world.setEdgeStrip).toHaveBeenCalledWith(answer);
  });

  it('shows nothing on a null answer, a failure or no workers at all', async () => {
    for (const fail of [
      (w: StubWorker) => w.onmessage!({ data: null }),
      (w: StubWorker) => w.onerror!({ message: 'boom' }),
    ]) {
      StubWorker.made = [];
      const game = standIn(GENERATED);
      game.startEdgeStrip();
      fail(StubWorker.made[0]);
      await settled();
      expect(game.world.setEdgeStrip).not.toHaveBeenCalled();
    }
    vi.stubGlobal('Worker', undefined);
    const game = standIn(GENERATED);
    game.startEdgeStrip();
    await settled();
    expect(game.world.setEdgeStrip).not.toHaveBeenCalled();
  });

  it('lets the night reach over a strip that was asked for', () => {
    const game = standIn(GENERATED);
    game.startEdgeStrip();
    expect(game.dayNight.setWorld).toHaveBeenCalledWith(64, 64, EDGE_STRIP_TILES);
  });

  it('leaves a world with no strip exactly as before: no worker, the night to the ring', () => {
    const game = standIn(LEVEL);
    game.startEdgeStrip();
    expect(StubWorker.made).toHaveLength(0);
    expect(game.dayNight.setWorld).toHaveBeenCalledWith(64, 64, BORDER);
    expect(game.fog.setWorld).toHaveBeenCalledWith(64, 64, BORDER);
    expect(game.world.onStripReach).toBeNull();
  });

  it('starts the fog at the ring, and widens it as the blocks show', () => {
    const game = standIn(GENERATED);
    game.startEdgeStrip();
    expect(game.fog.setWorld).toHaveBeenCalledTimes(1);
    expect(game.fog.setWorld).toHaveBeenCalledWith(64, 64, BORDER);
    const reach = [{ x0: 0, y0: -12, x1: 16, y1: 16 }];
    game.world.onStripReach!(reach);
    expect(game.fog.setWorld).toHaveBeenLastCalledWith(64, 64, BORDER, reach);
  });

  it('is started once, with the fog and the night there for its answer', () => {
    const code = readFileSync('src/game.ts', 'utf8');
    const start = code.indexOf('    this.startEdgeStrip();');
    expect(start).toBeGreaterThan(code.indexOf('this.fog = new Fog('));
    expect(code.indexOf('    this.startEdgeStrip();', start + 1)).toBe(-1);
  });
});
