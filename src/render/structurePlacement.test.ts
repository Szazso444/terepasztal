import { describe, expect, it } from 'vitest';
import { groundOf } from '../art/buildingGround';
import { tileToWorld } from '../engine/iso';
import { BUILDING_DEFS, buildingSpan, type Building } from '../sim/buildings';
import { Station, STATION_DEFS } from '../sim/stations';
import { BUILDING_ROTATIONS } from '../sim/rotation';
import { buildingPlacement, stationPlacement } from './structurePlacement';

const ROTS = Array.from({ length: BUILDING_ROTATIONS }, (_, i) => i);
/** An atlas that has every picture of the game's families, with all turns. */
const everything = { has: () => true };

/** Where the picture's anchor lands on the ground, in world px, as `setStructure` places it. */
const anchorOf = (p: { x: number; y: number; dx: number; dy: number }) => {
  const at = tileToWorld(p.x, p.y);
  return { x: at.x + p.dx, y: at.y + p.dy };
};

/** A station def given a span, as the data will give it (F2); put back by the returned function. */
function withSpan(id: string, w: number, h: number) {
  const def = STATION_DEFS.find((d) => d.id === id)!;
  const was = def.span;
  def.span = { w, h };
  return () => {
    def.span = was;
  };
}

describe('where a station stands', () => {
  it('has a picture on the middle of its footprint in every rotation, whatever the span', () => {
    const undo = ['town', 'warehouse', 'farm'].map((id) => withSpan(id, 2, 1));
    try {
      for (const def of STATION_DEFS)
        for (const rot of ROTS) {
          const s = new Station(def.id, 12, 20);
          s.rot = rot;
          const p = stationPlacement(everything, s);
          const centre = tileToWorld(s.cx, s.cy);
          const at = anchorOf(p);
          expect(at.x, `${def.id} r${rot} x`).toBeCloseTo(centre.x, 9);
          expect(at.y, `${def.id} r${rot} y`).toBeCloseTo(centre.y, 9);
          // sorted with the footprint's tile nearest the camera
          expect({ x: p.x, y: p.y }, `${def.id} r${rot}`).toEqual({
            x: s.x + s.w - 1,
            y: s.y + s.h - 1,
          });
          expect(p.span).toEqual({ w: s.w, h: s.h });
        }
    } finally {
      undo.forEach((f) => f());
    }
  });

  it('draws a station of a two-tile span from its level picture, turned, never as a shed', () => {
    const undo = withSpan('town', 2, 1);
    try {
      for (const rot of ROTS) {
        const s = new Station('town', 5, 5);
        s.rot = rot;
        expect(stationPlacement(everything, s).frame).toBe(
          rot === 0 ? 'structures/town_1' : `structures/town_1_r${rot}`,
        );
      }
    } finally {
      undo();
    }
  });

  it('turns the pair with the picture: the same two tiles in a row, along x or along y', () => {
    const undo = withSpan('warehouse', 2, 1);
    try {
      const along = (rot: number) => {
        const s = new Station('warehouse', 8, 8);
        s.rot = rot;
        return s.footprint().map((t) => `${t.x},${t.y}`);
      };
      expect(along(0)).toEqual(['8,8', '9,8']);
      expect(along(1)).toEqual(['8,8', '8,9']);
      expect(along(2)).toEqual(along(0));
      expect(along(3)).toEqual(along(1));
    } finally {
      undo();
    }
  });

  it('keeps a depot where it stood: the shed picture of its axis, half a tile back', () => {
    const wide = new Station('depot', 3, 5);
    const a = stationPlacement(everything, wide);
    expect([a.x, a.y, a.dx, a.dy, a.layer]).toEqual([4, 6, 0, -16, 20]);
    expect(a.frame).toBe('structures/depot_r0');
    wide.rot = 1;
    expect(stationPlacement(everything, wide).frame).toBe('structures/depot_r1_r1');
    const narrow = new Station('narrow_depot', 3, 5);
    const b = stationPlacement(everything, narrow);
    expect([b.x, b.y, b.dx, b.dy]).toEqual([4, 5, -16, -8]);
    expect(b.frame).toBe('structures/depot_narrow_r0');
    narrow.rot = 1;
    const c = stationPlacement(everything, narrow);
    expect([c.x, c.y, c.dx, c.dy]).toEqual([3, 6, 16, -8]);
    expect(c.frame).toBe('structures/depot_narrow_r1_r1');
  });

  it('stands a one-tile station on its tile, borrowing the plain station when it has no family', () => {
    const lumber = new Station('lumber', 7, 9);
    const p = stationPlacement(everything, lumber);
    expect([p.x, p.y, p.dx, p.dy]).toEqual([7, 9, 0, 0]);
    const bare = { has: (k: string) => k === 'structures/station_1' };
    expect(stationPlacement(bare, lumber).frame).toBe('structures/station_1');
  });
});

const works = (id: string, rot: number) => ({ id, x: 30, y: 40, acc: 0, rot }) as Building;

describe('where a works stands', () => {
  it('has its picture on the middle of its footprint in every rotation', () => {
    for (const def of BUILDING_DEFS)
      for (const rot of ROTS) {
        const b = works(def.id, rot);
        const p = buildingPlacement(everything, b);
        const { w, h } = buildingSpan(def, rot);
        const centre = tileToWorld(b.x + (w - 1) / 2, b.y + (h - 1) / 2);
        const at = anchorOf(p);
        expect(at.x, `${def.id} r${rot} x`).toBeCloseTo(centre.x, 9);
        expect(at.y, `${def.id} r${rot} y`).toBeCloseTo(centre.y, 9);
        expect({ x: p.x, y: p.y }).toEqual({ x: b.x + w - 1, y: b.y + h - 1 });
        expect(p.span).toEqual({ w, h });
      }
  });

  it('swaps the footprint on a quarter turn and keeps it on a half turn', () => {
    const spansOf = (id: string) =>
      ROTS.map((rot) => buildingPlacement(everything, works(id, rot)).span);
    const power = spansOf('power_plant');
    expect(power[0]).toEqual({ w: 3, h: 2 });
    expect(power[1]).toEqual({ w: 2, h: 3 });
    expect(power[2]).toEqual(power[0]);
    expect(power[3]).toEqual(power[1]);
    // square after the review of 2026-10-19 (F7): the same at every turn
    for (const id of ['colliery', 'ironworks'])
      for (const span of spansOf(id)) expect(span, id).toEqual({ w: 2, h: 2 });
    for (const span of spansOf('grinder')) expect(span).toEqual({ w: 1, h: 1 });
    for (const id of ['oil_derrick']) {
      expect(buildingPlacement(everything, works(id, 0)).span).toEqual({ w: 2, h: 1 });
      expect(buildingPlacement(everything, works(id, 3)).span).toEqual({ w: 1, h: 2 });
    }
  });

  it("agrees with the footprint its picture's ground data records, turned the same way", () => {
    // the yard, the plinth and the door paths read that footprint; a mismatch would offset them
    for (const def of BUILDING_DEFS)
      for (const rot of ROTS) {
        const p = buildingPlacement(everything, works(def.id, rot));
        const ground = groundOf(p.frame);
        if (!ground) continue;
        const w = Math.max(...ground.footprint.map(([dx]) => dx)) + 1,
          h = Math.max(...ground.footprint.map(([, dy]) => dy)) + 1;
        expect({ w, h, n: ground.footprint.length }, `${p.frame}`).toEqual({
          ...p.span,
          n: p.span.w * p.span.h,
        });
      }
  });

  it('adds no offset to a works of one tile, which stands on its tile as before', () => {
    const one = BUILDING_DEFS.find((d) => !d.bridge && !d.span)!;
    const p = buildingPlacement(everything, works(one.id, 0));
    expect([p.x, p.y, p.dx, p.dy]).toEqual([30, 40, 0, 0]);
  });

  it('draws the turn the atlas has, else the unturned picture', () => {
    expect(buildingPlacement(everything, works('colliery', 1)).frame).toBe(
      'structures/colliery_r1',
    );
    expect(buildingPlacement({ has: () => false }, works('colliery', 1)).frame).toBe(
      'structures/colliery',
    );
  });
});
