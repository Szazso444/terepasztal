import { describe, expect, it } from 'vitest';
import { Sprite } from 'pixi.js';
import type { Rng } from '../engine/rng';
import type { Station } from '../sim/stations';
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
