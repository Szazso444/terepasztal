import { describe, expect, it } from 'vitest';
import { Sprite } from 'pixi.js';
import type { Rng } from '../engine/rng';
import type { Station } from '../sim/stations';
import { forAll, shrinkArray } from '../testing/property';
import { BUILDING_DEFS } from '../sim/buildings';
import { STATION_DEFS } from '../sim/stations';
import { BuildController } from './buildController';
import type { Tool } from './toolbar';

/**
 * One frame of the game: something picked up before it, whether Escape went down in it, and
 * whether the keymap's Escape closed the tooltip stack first (`PlayUi.keys.closeTooltips` calls
 * `takeEscape`, and src/game.ts runs the keys before `BuildController.update`).
 */
interface Frame {
  pick: 'tool' | 'station' | null;
  escape: boolean;
  tooltips: boolean;
}

/** A controller over fakes: the frames here never reach past its Escape, so nothing else is read. */
function controller(pressed: Set<string>) {
  const input = { wasPressed: (code: string) => pressed.has(code) };
  const builder = { map: { w: 8, h: 8 }, stationAt: () => undefined, buildingAt: () => undefined };
  const world = { makeOverlaySprite: () => new Sprite(), surfacePoint: () => ({ x: 0, y: 0 }) };
  return new BuildController(input as never, builder as never, world as never, () => ({
    x: 1,
    y: 1,
  }));
}

const STATION = { x: 2, y: 3 } as Station;

function genFrames(rng: Rng): Frame[] {
  return Array.from({ length: rng.int(1, 30) }, () => {
    const escape = rng.chance(0.5);
    return {
      pick: rng.chance(0.3) ? rng.pick(['tool', 'station'] as const) : null,
      escape,
      tooltips: escape && rng.chance(0.5),
    };
  });
}

describe('Escape between the tooltips and the build controller', () => {
  it('keeps the tool and the selection when Escape closed the tooltips, for that frame only', () => {
    forAll(
      genFrames,
      (frames) => {
        const pressed = new Set<string>();
        const b = controller(pressed);
        // the model: what is in hand and what is picked
        let tool = false;
        let picked = false;
        frames.forEach((f, i) => {
          if (f.pick === 'tool') {
            b.setTool({ kind: 'remove' });
            tool = true;
            picked = false;
          } else if (f.pick === 'station') {
            b.select(STATION);
            picked = true;
          }
          pressed.clear();
          if (f.escape) pressed.add('Escape');
          if (f.tooltips) b.takeEscape();
          // the frame's Escape: the tooltips took it, or it drops the tool, or else the selection
          if (f.escape && !f.tooltips) {
            if (tool) tool = false;
            else picked = false;
          }
          b.update(false);
          expect(b.tool.kind !== 'none', `frame ${i}: a tool in hand`).toBe(tool);
          expect(b.selected !== null, `frame ${i}: a station picked`).toBe(picked);
        });
      },
      { shrink: (frames) => shrinkArray(frames) },
    );
  });
});

describe('the placing ghost of a footprint of several tiles', () => {
  /** A controller whose world records where the sprites go; every spot is free to build on. */
  function placing(tool: Tool, tile: { x: number; y: number }) {
    const input = {
      wasPressed: () => false,
      clicks: [],
      buttons: new Set(),
      buttonPressed: new Set(),
    };
    const builder = {
      map: { w: 40, h: 40 },
      stationAt: () => undefined,
      buildingAt: () => undefined,
      checkStation: () => ({ ok: true, cost: {} }),
      checkBuilding: () => ({ ok: true, cost: {} }),
    };
    const sprites: Sprite[] = [];
    const world = {
      atlas: { has: () => true },
      makeOverlaySprite: () => {
        const s = new Sprite();
        sprites.push(s);
        return s;
      },
      setSpriteFrame: () => null,
      // the tile's own world px, which is all these tests read
      surfacePoint: (x: number, y: number) => ({ x: (x - y) * 32, y: (x + y) * 16 }),
    };
    const b = new BuildController(input as never, builder as never, world as never, () => tile);
    (b as unknown as { status: () => void }).status = () => {};
    b.setTool(tool);
    return { b, sprites };
  }
  const at = (x: number, y: number) => ({ x: (x - y) * 32, y: (x + y) * 16 });
  /** The diamonds on the tiles, among the sprites the controller made: the visible ones, by place. */
  const spots = (sprites: Sprite[]) =>
    sprites
      .filter((s) => s.visible && s.alpha === 1)
      .map((s) => `${s.x},${s.y}`)
      .sort();

  it('marks each tile of a works and stands the picture on the middle of them', () => {
    const { b, sprites } = placing({ kind: 'building', defId: 'power_plant' }, { x: 10, y: 10 });
    b.update(true);
    const tiles = [];
    for (let y = 10; y < 12; y++)
      for (let x = 10; x < 13; x++) tiles.push(`${at(x, y).x},${at(x, y).y}`);
    expect(spots(sprites)).toEqual(tiles.sort());
    // the picture, at 0.75 alpha, on the middle of the 3 x 2 footprint
    const ghost = sprites.find((s) => s.alpha === 0.75)!;
    expect({ x: ghost.x, y: ghost.y }).toEqual(at(11, 10.5));
  });

  it('turns the footprint with the rotation', () => {
    const { b, sprites } = placing({ kind: 'building', defId: 'power_plant' }, { x: 10, y: 10 });
    b.rot = 1;
    b.update(true);
    const tiles = [];
    for (let y = 10; y < 13; y++)
      for (let x = 10; x < 12; x++) tiles.push(`${at(x, y).x},${at(x, y).y}`);
    expect(spots(sprites)).toEqual(tiles.sort());
    const ghost = sprites.find((s) => s.alpha === 0.75)!;
    expect({ x: ghost.x, y: ghost.y }).toEqual(at(10.5, 11));
  });

  it('keeps the one tile diamond for a one-tile works', () => {
    const one = BUILDING_DEFS.find((d) => !d.bridge && !d.span)!;
    const { b, sprites } = placing({ kind: 'building', defId: one.id }, { x: 5, y: 6 });
    b.update(true);
    expect(spots(sprites)).toEqual([`${at(5, 6).x},${at(5, 6).y}`]);
  });

  it('marks both tiles of a station of a two-tile span, in either axis', () => {
    const town = STATION_DEFS.find((d) => d.id === 'town')!;
    const kept = town.span;
    town.span = { w: 2, h: 1 };
    try {
      const { b, sprites } = placing({ kind: 'station', defId: 'town' }, { x: 7, y: 7 });
      b.update(true);
      expect(spots(sprites)).toEqual([at(7, 7), at(8, 7)].map((p) => `${p.x},${p.y}`).sort());
      b.rot = 1;
      b.update(true);
      expect(spots(sprites)).toEqual([at(7, 7), at(7, 8)].map((p) => `${p.x},${p.y}`).sort());
    } finally {
      town.span = kept;
    }
  });
});
