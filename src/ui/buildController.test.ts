import { describe, expect, it } from 'vitest';
import { Sprite } from 'pixi.js';
import type { Rng } from '../engine/rng';
import type { Station } from '../sim/stations';
import { STR } from '../strings';
import { forAll, shrinkArray } from '../testing/property';
import { BuildController } from './buildController';

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

describe('the run being dragged', () => {
  /** A straight tool over an empty field, with the left button held on the tile `at` says. */
  function dragging() {
    const at = { x: 1, y: 1 };
    const buttons = new Set<number>();
    const buttonPressed = new Set<number>();
    const buttonReleased = new Set<number>();
    const input = { wasPressed: () => false, buttons, buttonPressed, buttonReleased, clicks: [] };
    const builder = {
      map: { w: 16, h: 16 },
      stationAt: () => undefined,
      buildingAt: () => undefined,
      track: { get: () => undefined },
      checkTrack: () => ({ ok: true, cost: { wood: 2 } }),
      placeTrack: () => true,
    };
    const world = {
      makeOverlaySprite: () => new Sprite(),
      surfacePoint: () => ({ x: 0, y: 0 }),
      setSpriteFrame: () => {},
    };
    const b = new BuildController(input as never, builder as never, world as never, () => at);
    b.setTool({ kind: 'track', item: { kind: 'straight', cls: 'branch' } });
    return { b, at, buttons, buttonPressed, buttonReleased };
  }

  it('is there while a drag covers more than a tile, and gone when it is let go', () => {
    const { b, at, buttons, buttonPressed, buttonReleased } = dragging();
    expect(b.run).toBeNull();
    buttons.add(0);
    buttonPressed.add(0);
    b.update(true);
    expect(b.run).toBeNull();
    buttonPressed.clear();
    at.x = 5;
    b.update(true);
    expect(b.run?.straights).toBe(5);
    expect(b.run?.cost).toEqual({ wood: 10 });
    buttons.clear();
    buttonReleased.add(0);
    b.update(true);
    expect(b.run).toBeNull();
  });

  it('stops with the pointer over a panel', () => {
    const { b, at, buttons, buttonPressed } = dragging();
    buttons.add(0);
    buttonPressed.add(0);
    b.update(true);
    buttonPressed.clear();
    at.x = 5;
    b.update(true);
    expect(b.run).not.toBeNull();
    b.update(false);
    expect(b.run).toBeNull();
  });
});

describe('the Repair tool', () => {
  /** A Repair tool over a row of worn Branch straights, with the cost of a piece fixed. */
  function mending() {
    const at = { x: 1, y: 1 };
    const buttons = new Set<number>();
    const input = {
      wasPressed: () => false,
      buttons,
      buttonPressed: new Set<number>(),
      buttonReleased: new Set<number>(),
      clicks: [],
    };
    const mended: string[] = [];
    let pay = true;
    const builder = {
      map: { w: 16, h: 16 },
      stationAt: () => undefined,
      buildingAt: () => undefined,
      track: {
        get: (x: number, y: number) => (y === 1 ? { kind: 'straight' } : undefined),
        unitTiles: (x: number, y: number) => [{ x, y }],
      },
      checkRepair: ([t]: { x: number; y: number }[]) =>
        mended.includes(`${t.x},${t.y}`) || t.y !== 1
          ? { ok: false, cost: {}, pieces: [], reason: STR.build.repairNothing }
          : pay
            ? { ok: true, cost: { wood: 3 }, pieces: [t] }
            : { ok: false, cost: { wood: 3 }, pieces: [t], reason: 'No store holds 3 wood' },
      repairTrack: ([t]: { x: number; y: number }[]) => {
        mended.push(`${t.x},${t.y}`);
        return true;
      },
    };
    const world = {
      makeOverlaySprite: () => new Sprite(),
      surfacePoint: () => ({ x: 0, y: 0 }),
      setSpriteFrame: () => {},
    };
    const b = new BuildController(input as never, builder as never, world as never, () => ({
      ...at,
    }));
    let status = '';
    b.onStatus = (t) => (status = t);
    b.setTool({ kind: 'repair' });
    return { b, at, buttons, mended, status: () => status, broke: () => (pay = false) };
  }

  it('prices the piece under the pointer, and mends nothing until the button goes down', () => {
    const { b, mended, status } = mending();
    b.update(true);
    expect(status()).toBe(STR.build.repairCost('3 wood'));
    expect(mended).toEqual([]);
  });

  it('mends the piece pressed and every piece the stroke enters, each once', () => {
    const { b, at, buttons, mended } = mending();
    buttons.add(0);
    b.update(true);
    at.x = 4;
    b.update(true);
    b.update(true);
    expect(mended).toEqual(['1,1', '2,1', '3,1', '4,1']);
  });

  it('says why, in the status line, when no store can pay', () => {
    const { b, status, broke } = mending();
    broke();
    b.update(true);
    expect(status()).toBe(`${STR.build.repairCost('3 wood')} (No store holds 3 wood)`);
  });

  it('has nothing to say off the track but that there is nothing to mend', () => {
    const { b, at, status } = mending();
    at.y = 5;
    b.update(true);
    expect(status()).toBe(STR.build.repairIdle);
  });
});
