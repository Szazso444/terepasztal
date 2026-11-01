import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Game } from '../game';
import type { GroundChange } from '../sim/build';
import { Terrain } from '../world/tiles';

// What the game does when the ground moves. A `Game` cannot be constructed under Node
// (gameSave.test.ts says why), so `onGroundChanged` runs on a stand-in with the prototype and the
// fields it reads (`minimap` is read through `ui`).

const change = (x: number, y: number, now = Terrain.Grass, was = Terrain.Grass): GroundChange => ({
  x,
  y,
  was: 0,
  now: 1,
  terrainWas: was,
  terrainNow: now,
});

function standIn() {
  const fields = {
    map: { w: 10, h: 10 },
    railsDirty: false,
    world: { retileMany: vi.fn() },
    ui: { minimap: { rebuildBase: vi.fn() } },
    overview: { rebuildTerrain: vi.fn() },
  };
  const game = Object.assign(Object.create(Game.prototype), fields) as typeof fields & {
    onGroundChanged(changes: readonly GroundChange[]): void;
  };
  return game;
}
const tilesOf = (game: ReturnType<typeof standIn>) =>
  (game.world.retileMany.mock.calls[0][0] as { x: number; y: number }[])
    .map((t) => `${t.x},${t.y}`)
    .sort();

describe('the game and a change of ground', () => {
  it('retiles the tiles and the ring round them in one call, and marks the rail beds', () => {
    const game = standIn();
    game.onGroundChanged([change(4, 4), change(5, 4)]);
    expect(game.world.retileMany).toHaveBeenCalledTimes(1);
    // 3 x 3 round (4, 4) and round (5, 4), each tile once
    expect(tilesOf(game)).toHaveLength(12);
    expect(tilesOf(game)).toContain('3,3');
    expect(tilesOf(game)).toContain('6,5');
    expect(new Set(tilesOf(game)).size).toBe(12);
    expect(game.railsDirty).toBe(true);
  });

  it('keeps the ring on the map', () => {
    const game = standIn();
    game.onGroundChanged([change(0, 0), change(9, 9)]);
    const tiles = tilesOf(game);
    expect(tiles).toHaveLength(8);
    expect(tiles.every((t) => t.split(',').every((v) => +v >= 0 && +v <= 9))).toBe(true);
  });

  it('draws the survey maps again only when stone turned to grass or back', () => {
    const game = standIn();
    game.onGroundChanged([change(4, 4), change(5, 4)]);
    expect(game.ui.minimap.rebuildBase).not.toHaveBeenCalled();
    expect(game.overview.rebuildTerrain).not.toHaveBeenCalled();
    game.onGroundChanged([change(4, 4), change(5, 4, Terrain.Grass, Terrain.Mountain)]);
    expect(game.ui.minimap.rebuildBase).toHaveBeenCalledTimes(1);
    expect(game.overview.rebuildTerrain).toHaveBeenCalledTimes(1);
  });

  it('is what the builder calls when ground changes', () => {
    const code = readFileSync('src/game.ts', 'utf8');
    const wired = code.indexOf(
      'this.builder.onGroundChanged = (changes) => this.onGroundChanged(changes);',
    );
    expect(wired).toBeGreaterThan(-1);
    expect(code.indexOf('this.builder.onGroundChanged =', wired + 1)).toBe(-1);
  });
});
