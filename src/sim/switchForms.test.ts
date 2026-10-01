import { describe, it, expect, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
function world() {
  const map = emptyMap(4242, 40, 40, Terrain.Grass),
    track = new TrackGraph(40, 40);
  const builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  const changed: string[] = [];
  builder.onTrackChanged = (x, y) => changed.push(`${x},${y}`);
  return { track, builder, changed };
}

describe('switch forms while building', () => {
  it('snaps a switch when the player lays the parallel straight, and back when it is removed', () => {
    const { track, builder, changed } = world();
    expect(builder.placeTrack(10, 10, { kind: 'switch', cls: 'regular' }, 1)).toBe(true);
    const e = track.switchExit(10, 10, 1, 'regular', 'parallel');
    const rot = e.out === Dir.N || e.out === Dir.S ? 0 : 1;
    changed.length = 0;
    expect(builder.placeTrack(e.x, e.y, { kind: 'straight', cls: 'regular' }, rot)).toBe(true);
    expect(track.get(10, 10)!.form).toBe('parallel');
    // the renderer hears about every tile of the switch that changed shape
    for (const t of track.unitTiles(10, 10)) expect(changed).toContain(`${t.x},${t.y}`);
    expect(builder.removeTrack(e.x, e.y)).toBe(true);
    expect(track.get(10, 10)!.form ?? 'turn').toBe('turn');
  });

  it('snaps a switch laid beside a parallel straight that is already there', () => {
    const { track, builder } = world();
    const e = track.switchExit(20, 20, 1, 'regular', 'parallel');
    const rot = e.out === Dir.N || e.out === Dir.S ? 0 : 1;
    builder.placeTrack(e.x, e.y, { kind: 'straight', cls: 'regular' }, rot);
    builder.placeTrack(20, 20, { kind: 'switch', cls: 'regular' }, 1);
    expect(track.get(20, 20)!.form).toBe('parallel');
  });
});
