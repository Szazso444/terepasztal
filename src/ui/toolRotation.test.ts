import { describe, it, expect } from 'vitest';
import { BUILDING_ROTATIONS, nextRotation, rotationAxis } from '../sim/rotation';
import { STATION_DEFS, stationSpan, type StationDef } from '../sim/stations';
import { BUILDING_DEFS } from '../sim/buildings';
import { DECOR_DEFS } from '../sim/build';
import { TRACK_ITEMS, rotationCount } from '../world/track';
import type { Tool } from './toolbar';
import { nextToolRotation, stationGhostFrame, toolRotations } from './toolRotation';

/** 0 to n - 1. */
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** The rotations R steps a tool through from r0, one press at a time, until it is back at r0. */
function cycle(tool: Tool): number[] {
  const seen = [0];
  let rot = nextToolRotation(tool, 0);
  // a cycle that never comes back stops after a few laps and fails on its length
  while (rot !== 0 && seen.length < 4 * BUILDING_ROTATIONS) {
    seen.push(rot);
    rot = nextToolRotation(tool, rot);
  }
  return seen;
}

/** A station covers more than one tile. */
const wide = (def: StationDef) => {
  const span = stationSpan(def, 0);
  return span.w * span.h > 1;
};

describe('R in the build tools', () => {
  it('turns every station, of every size, through the four building rotations', () => {
    expect(STATION_DEFS.some(wide)).toBe(true);
    expect(STATION_DEFS.some((d) => !wide(d))).toBe(true);
    for (const def of STATION_DEFS) {
      const tool: Tool = { kind: 'station', defId: def.id };
      expect(toolRotations(tool), def.id).toBe(BUILDING_ROTATIONS);
      expect(cycle(tool), def.id).toEqual(range(BUILDING_ROTATIONS));
      // a quarter turn clockwise each press, as a placed station counts its turns
      for (const rot of range(BUILDING_ROTATIONS))
        expect(nextToolRotation(tool, rot), def.id).toBe(nextRotation(rot));
    }
  });

  it('turns every works through the four rotations and keeps a bridge platform at r0', () => {
    expect(BUILDING_DEFS.some((d) => d.bridge)).toBe(true);
    expect(BUILDING_DEFS.some((d) => !d.bridge)).toBe(true);
    for (const def of BUILDING_DEFS) {
      const tool: Tool = { kind: 'building', defId: def.id };
      const n = def.bridge ? 1 : BUILDING_ROTATIONS;
      expect(toolRotations(tool), def.id).toBe(n);
      expect(cycle(tool), def.id).toEqual(range(n));
      if (!def.bridge)
        for (const rot of range(BUILDING_ROTATIONS))
          expect(nextToolRotation(tool, rot), def.id).toBe(nextRotation(rot));
    }
  });

  it('turns decor through the rotations its def gives it', () => {
    for (const def of DECOR_DEFS) {
      const tool: Tool = { kind: 'decor', defId: def.id };
      expect(toolRotations(tool), def.id).toBe(def.rotations);
      expect(cycle(tool), def.id).toEqual(range(def.rotations));
    }
  });

  it('turns a track piece through as many rotations as the piece has', () => {
    for (const item of TRACK_ITEMS) {
      const tool: Tool = { kind: 'track', item };
      const n = rotationCount(item.kind);
      expect(toolRotations(tool), item.kind).toBe(n);
      expect(cycle(tool), item.kind).toEqual(range(n));
    }
  });

  it('does not turn a tool that places nothing turned', () => {
    const still: Tool[] = [
      { kind: 'none' },
      { kind: 'remove' },
      { kind: 'supply', supply: 'catenary' },
      { kind: 'reclass', target: 'high_speed' },
      { kind: 'terrain', terrain: 0 },
    ];
    for (const tool of still) expect(toolRotations(tool), tool.kind).toBe(1);
  });
});

describe('the station ghost', () => {
  /**
   * An atlas drawn the way `src/art/structures.ts` draws a family: a wide station's axis pictures
   * `_r0` and `_r1` with their half turns `_r0_r2` and `_r1_r3`, a one-tile station's `_1` with
   * all three turns. The plain station is always there.
   */
  function drawn(def: StationDef) {
    const fam = `structures/${def.art}`;
    const keys = wide(def)
      ? [`${fam}_r0`, `${fam}_r1`, `${fam}_r0_r2`, `${fam}_r1_r3`]
      : [`${fam}_1`, `${fam}_1_r1`, `${fam}_1_r2`, `${fam}_1_r3`];
    keys.push('structures/station_1');
    return { has: (k: string) => keys.includes(k) };
  }

  it('shows a picture of its own for each of the four rotations', () => {
    for (const def of STATION_DEFS) {
      const atlas = drawn(def);
      const frames = range(BUILDING_ROTATIONS).map((rot) => stationGhostFrame(atlas, def, rot));
      for (const f of frames) expect(atlas.has(f), `${def.id}: ${f}`).toBe(true);
      expect(new Set(frames).size, def.id).toBe(BUILDING_ROTATIONS);
    }
  });

  it("draws a wide station from the picture of its rotation's axis", () => {
    for (const def of STATION_DEFS.filter(wide)) {
      const atlas = drawn(def);
      for (const rot of range(BUILDING_ROTATIONS))
        expect(stationGhostFrame(atlas, def, rot), `${def.id} r${rot}`).toMatch(
          new RegExp(`^structures/${def.art}_r${rotationAxis(rot)}(_r${rot})?$`),
        );
    }
  });

  it('keeps the unturned picture where the atlas has no turn', () => {
    for (const def of STATION_DEFS) {
      const fam = `structures/${def.art}`;
      const unturned = [`${fam}_1`, `${fam}_r0`, `${fam}_r1`];
      const atlas = { has: (k: string) => unturned.includes(k) };
      for (const rot of range(BUILDING_ROTATIONS))
        expect(stationGhostFrame(atlas, def, rot), `${def.id} r${rot}`).toBe(
          wide(def) ? `${fam}_r${rotationAxis(rot)}` : `${fam}_1`,
        );
    }
  });

  it('borrows the plain station, turned, for a station without a picture of its own', () => {
    const def = { ...STATION_DEFS[0], art: 'no_such_art', size: 1, long: false };
    const atlas = { has: (k: string) => k.startsWith('structures/station_1') };
    expect(stationGhostFrame(atlas, def, 0)).toBe('structures/station_1');
    for (const rot of [1, 2, 3])
      expect(stationGhostFrame(atlas, def, rot)).toBe(`structures/station_1_r${rot}`);
  });
});
