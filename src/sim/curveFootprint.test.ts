import { describe, it, expect } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, memberClear, footprintOf, type TrackClass } from '../world/track';
import { RAIL_CLEARANCE, unitDef, type SwitchForm } from '../world/trackGeom';
import { Builder } from './build';
import { buildingFootprint } from './buildings';
import { Economy } from './economy';
import { Stockpile } from './stockpile';
import { STR } from '../strings';

const SIZE = 32;
function world() {
  const map = emptyMap(4242, SIZE, SIZE, Terrain.Grass);
  const track = new TrackGraph(SIZE, SIZE);
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, new Economy(), new Stockpile());
  builder.free = true;
  return { track, builder };
}

/** The member tiles of a block, as rows of L (rail runs through), t (rail touches) and . (clear). */
function pattern(kind: 'curve' | 'switch', n: number, form: SwitchForm = 'turn') {
  const d = unitDef(kind, n, 0, form);
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let r = '';
    for (let x = 0; x < n; x++) {
      const m = d.members[y * n + x];
      r += m.links.length ? 'L' : m.clear ? '.' : 't';
    }
    rows.push(r);
  }
  return rows.join(' ');
}

describe('tiles a curve or switch reserves but leaves clear', () => {
  it('leaves the tiles beside the arc clear, and the tiles the rail clips taken', () => {
    expect(pattern('curve', 2)).toBe('Lt LL');
    expect(pattern('curve', 3)).toBe('L.. LL. .LL');
    expect(pattern('curve', 4)).toBe('L... LL.. tLL. .tLL');
    expect(pattern('switch', 3)).toBe('L.. LL. LLL');
    expect(pattern('switch', 3, 'parallel')).toBe('L.. LL. LL.');
  });

  it('calls a member clear exactly when no rail comes within the clearance of its tile', () => {
    for (const kind of ['curve', 'switch'] as const)
      for (const n of [2, 3, 4, 5])
        for (let rot = 0; rot < (kind === 'switch' ? 8 : 4); rot++)
          for (const form of ['turn', 'parallel'] as const) {
            const d = unitDef(kind, n, rot, form);
            for (const m of d.members) {
              let nearest = Infinity;
              for (const r of d.routes)
                for (const p of r.pts)
                  nearest = Math.min(
                    nearest,
                    Math.hypot(
                      Math.max(Math.abs(p.x - m.dx) - 0.5, 0),
                      Math.max(Math.abs(p.y - m.dy) - 0.5, 0),
                    ),
                  );
              const at = `${kind} ${n} r${rot} ${form} (${m.dx},${m.dy})`;
              expect(m.clear, at).toBe(nearest >= RAIL_CLEARANCE);
              if (m.links.length) expect(m.clear, at).toBe(false);
            }
          }
  });

  it('counts a switch member clear only when it is clear in both forms', () => {
    // (2, 2) of a 3x3 switch: clear beside the S lane, on the turning lane's rail
    expect(memberClear('switch', 'main', 0, 8)).toBe(false);
    expect(memberClear('switch', 'main', 0, 2)).toBe(true);
    expect(memberClear('curve', 'main', 0, 2)).toBe(true);
    expect(memberClear('straight', 'main', 0, 0)).toBe(false);
  });

  it('says the rail runs on a tile only where it does', () => {
    const { track } = world();
    track.place(10, 10, 'curve', 0, 'main');
    expect(track.has(12, 10)).toBe(true);
    expect(track.railOn(12, 10)).toBe(false);
    expect(track.railOn(10, 10)).toBe(true);
    expect(track.railOn(11, 11)).toBe(true);
    expect(track.railOn(20, 20)).toBe(false);
  });
});

describe('building on a clear tile of a curve', () => {
  const clearTiles = (cls: TrackClass, x: number, y: number) =>
    footprintOf(x, y, 'curve', 0, cls).filter((_, i) => memberClear('curve', cls, 0, i));

  it('lets a building stand on a clear tile and refuses one on the rail', () => {
    const { builder } = world();
    expect(builder.placeTrack(10, 10, { kind: 'curve', cls: 'trunk' }, 0)).toBe(true);
    const clear = clearTiles('trunk', 10, 10);
    expect(clear).toHaveLength(7);
    expect(buildingFootprint('windmill', 0, 0, 0)).toHaveLength(1);
    for (const t of clear)
      expect(builder.checkBuilding(t.x, t.y, 'windmill').ok, `${t.x},${t.y}`).toBe(true);
    expect(builder.checkBuilding(10, 10, 'windmill').reason).toBe(STR.build.occupied);
    // (10, 12) is a member the rail clips: taken
    expect(builder.checkBuilding(10, 12, 'windmill').reason).toBe(STR.build.occupied);
    expect(builder.placeBuilding(13, 10, 'windmill')).not.toBeNull();
  });

  it('lays a curve over buildings that stand on its clear tiles, never over one on its rail', () => {
    const { builder } = world();
    for (const t of clearTiles('main', 10, 10))
      expect(builder.placeBuilding(t.x, t.y, 'windmill')).not.toBeNull();
    expect(builder.checkTrack(10, 10, { kind: 'curve', cls: 'main' }, 0).ok).toBe(true);
    expect(builder.placeBuilding(11, 11, 'windmill')).not.toBeNull();
    expect(builder.checkTrack(10, 10, { kind: 'curve', cls: 'main' }, 0).reason).toBe(
      STR.build.occupied,
    );
  });

  it('keeps a bridge platform off every tile of the block', () => {
    const { builder } = world();
    builder.placeTrack(10, 10, { kind: 'curve', cls: 'main' }, 0);
    expect(builder.checkBuilding(12, 10, 'bridge_wood').reason).toBe(STR.build.occupied);
  });
});
