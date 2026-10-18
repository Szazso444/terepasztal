import { describe, it, expect } from 'vitest';
import { BUILDING_ROTATIONS, nextRotation, rotationAxis } from '../sim/rotation';
import { STATION_DEFS, type StationDef } from '../sim/stations';
import { BUILDING_DEFS } from '../sim/buildings';
import { DECOR_DEFS } from '../sim/build';
import { TRACK_ITEMS, rotationCount } from '../world/track';
import type { Tool } from './toolbar';
import {
  axisPictured,
  nextToolRotation,
  reachTiles,
  stationGhostFrame,
  toolFootprint,
  toolRotations,
} from './toolRotation';

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

/**
 * A station with a picture per axis: a shed (a depot) of more than one tile. A station of a
 * two-tile span is not one; it is its level 1 picture turned, drawn on the pair.
 */
const wide = axisPictured;

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
      { kind: 'road' },
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

/** A def of the content with a span it is not yet given in the data (F2 gives it to the town). */
const spanned = (id: string, w: number, h: number): StationDef => ({
  ...STATION_DEFS.find((d) => d.id === id)!,
  span: { w, h },
});

describe('the ghost of a station of a two-tile span', () => {
  const town = spanned('town', 2, 1);

  it('is its level 1 picture, turned, and not a shed picture of an axis', () => {
    expect(axisPictured(town)).toBe(false);
    const atlas = {
      has: (k: string) => k.startsWith('structures/town_1') || k === 'structures/station_1',
    };
    expect(stationGhostFrame(atlas, town, 0)).toBe('structures/town_1');
    for (const rot of [1, 2, 3])
      expect(stationGhostFrame(atlas, town, rot)).toBe(`structures/town_1_r${rot}`);
  });

  it('covers the whole pair in every rotation, as turned', () => {
    const tool: Tool = { kind: 'station', defId: 'town' };
    // the station tool reads the content's def, so give it the span for the case
    const was = STATION_DEFS.find((d) => d.id === 'town')!;
    const kept = was.span;
    was.span = { w: 2, h: 1 };
    try {
      const cover = (rot: number) =>
        toolFootprint(tool, 10, 20, rot)!
          .map((t) => `${t.x},${t.y}`)
          .sort();
      expect(cover(0)).toEqual(['10,20', '11,20']);
      expect(cover(1)).toEqual(['10,20', '10,21']);
      expect(cover(2)).toEqual(cover(0));
      expect(cover(3)).toEqual(cover(1));
    } finally {
      was.span = kept;
    }
  });
});

describe('the ghost of a works with a footprint', () => {
  const sizes: Record<string, [number, number]> = {
    grinder: [2, 1],
    oil_derrick: [2, 1],
    power_plant: [3, 2],
    colliery: [3, 2],
    ironworks: [3, 2],
    refinery: [2, 2],
    diesel_refinery: [2, 2],
    substation: [2, 2],
    wire_mill: [2, 2],
  };

  it('covers the footprint of its kind, swapped on the other axis', () => {
    for (const [id, [w, h]] of Object.entries(sizes)) {
      const tool: Tool = { kind: 'building', defId: id };
      for (const rot of range(BUILDING_ROTATIONS)) {
        const tiles = toolFootprint(tool, 4, 6, rot)!;
        const [tw, th] = rot % 2 === 0 ? [w, h] : [h, w];
        expect(tiles, `${id} r${rot}`).toHaveLength(tw * th);
        expect(Math.max(...tiles.map((t) => t.x)) - 4 + 1, `${id} r${rot} width`).toBe(tw);
        expect(Math.max(...tiles.map((t) => t.y)) - 6 + 1, `${id} r${rot} depth`).toBe(th);
      }
    }
  });

  it('is one tile for a bridge platform, which does not turn, and for a one-tile works', () => {
    const bridge = BUILDING_DEFS.find((d) => d.bridge)!;
    expect(toolFootprint({ kind: 'building', defId: bridge.id }, 3, 3, 1)).toEqual([
      { x: 3, y: 3 },
    ]);
  });

  it('has none for a tool that places nothing on a footprint', () => {
    expect(toolFootprint({ kind: 'remove' }, 3, 3, 0)).toBeNull();
    expect(toolFootprint({ kind: 'decor', defId: DECOR_DEFS[0].id }, 3, 3, 0)).toBeNull();
  });
});

describe('the reach round a footprint', () => {
  it('is the tiles within r of any footprint tile, the footprint itself left out', () => {
    const one = reachTiles([{ x: 5, y: 5 }], 1);
    expect(one).toHaveLength(8);
    const two = reachTiles(
      [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ],
      1,
    );
    // a 4 x 3 block less its own two tiles
    expect(two).toHaveLength(10);
    expect(two.some((t) => t.x === 5 && t.y === 5)).toBe(false);
    expect(two.some((t) => t.x === 7 && t.y === 6)).toBe(true);
    expect(two.some((t) => t.x === 8)).toBe(false);
  });

  it('has none for a reach of 0', () => {
    expect(reachTiles([{ x: 1, y: 1 }], 0)).toEqual([]);
  });

  it('reaches r from the edge of a 3 x 2 works, as the plant and the wire count it', () => {
    const plant = toolFootprint({ kind: 'building', defId: 'power_plant' }, 10, 10, 0)!;
    const reach = reachTiles(plant, 2);
    expect(reach).toHaveLength(7 * 6 - 6);
    for (const t of reach) {
      const dx = Math.max(10 - t.x, 0, t.x - 12);
      const dy = Math.max(10 - t.y, 0, t.y - 11);
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(2);
    }
  });
});
