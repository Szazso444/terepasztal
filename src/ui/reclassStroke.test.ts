import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { stepTiles } from '../world/reclass';
import { Builder } from '../sim/build';
import { Stockpile } from '../sim/stockpile';
import { Economy } from '../sim/economy';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { ReclassStroke } from './reclassStroke';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const at = (x: number, y: number) => ({ x, y });
const plain = () => false;

describe('a stroke of the upgrade tool', () => {
  it('converts every tile between two frames, each entered from the one before', () => {
    const s = new ReclassStroke();
    expect(s.move(at(5, 5), plain)).toEqual([{ tile: at(5, 5) }]);
    expect(s.move(at(5, 5), plain)).toEqual([]);
    expect(s.move(at(8, 5), plain)).toEqual([
      { tile: at(6, 5), from: at(5, 5) },
      { tile: at(7, 5), from: at(6, 5) },
      { tile: at(8, 5), from: at(7, 5) },
    ]);
  });

  it('steps across before along when the cursor moves diagonally', () => {
    // no direction known: as before, along y first
    expect(stepTiles(at(9, 9), at(10, 10))).toEqual([at(9, 10), at(10, 10)]);
    // a stroke running along y gets back onto its line first
    expect(stepTiles(at(9, 9), at(10, 10), 'y')).toEqual([at(10, 9), at(10, 10)]);
    expect(stepTiles(at(9, 9), at(10, 10), 'x')).toEqual([at(9, 10), at(10, 10)]);
    // off the diagonal the straight line decides, whatever the direction
    expect(stepTiles(at(0, 0), at(4, 1), 'y')).toEqual(stepTiles(at(0, 0), at(4, 1)));
  });

  it("keeps a crossing on the stroke's line through a wobble of the hand", () => {
    // down a north-south line, the cursor one tile off to the west just before the crossing
    const crossing = (t: { x: number; y: number }) => t.x === 10 && t.y === 10;
    const s = new ReclassStroke();
    const steps = [at(10, 8), at(9, 9), at(10, 10), at(10, 11)].flatMap((t) => s.move(t, crossing));
    const cross = steps.find((p) => crossing(p.tile))!;
    // entered from the north: its north-south line
    expect(cross.from).toEqual(at(10, 9));
    // and the tile west of the crossing, which the cursor never touched, is left alone
    expect(steps.some((p) => p.tile.x === 9 && p.tile.y === 10)).toBe(false);
  });

  it("takes a crossing by the stroke's direction, whichever tile it is reached from", () => {
    // along a west-east line, arriving at the crossing from the tile north-west of it
    const crossing = (t: { x: number; y: number }) => t.x === 10 && t.y === 10;
    const s = new ReclassStroke();
    const steps = [at(6, 10), at(8, 10), at(9, 9), at(10, 10)].flatMap((t) => s.move(t, crossing));
    expect(steps.find((p) => crossing(p.tile))!.from).toEqual(at(9, 10));
  });

  it('waits for the direction when the stroke starts on a crossing', () => {
    const crossing = (t: { x: number; y: number }) => t.x === 10 && t.y === 10;
    const s = new ReclassStroke();
    expect(s.move(at(10, 10), crossing)).toEqual([]);
    expect(s.move(at(10, 11), crossing)).toEqual([
      { tile: at(10, 10), from: at(10, 9) },
      { tile: at(10, 11), from: at(10, 10) },
    ]);
    // nothing is left over at the end of the stroke
    expect(s.release()).toEqual([]);
  });

  it('treats a press and release on a crossing as a click', () => {
    const crossing = () => true;
    const s = new ReclassStroke();
    expect(s.move(at(10, 10), crossing)).toEqual([]);
    expect(s.release()).toEqual([{ tile: at(10, 10) }]);
    expect(s.release()).toEqual([]);
  });

  it('starts anew after the cursor left the map or jumped', () => {
    const s = new ReclassStroke();
    s.move(at(5, 5), plain);
    // over a panel or off the map with the button held: no line is drawn to where it comes back
    s.stop();
    expect(s.move(at(12, 5), plain)).toEqual([{ tile: at(12, 5) }]);
    // a jump no hand makes in one frame (the view was zoomed under the cursor)
    expect(s.move(at(40, 5), plain)).toEqual([{ tile: at(40, 5) }]);
    // a fast stroke is still one stroke
    expect(s.move(at(46, 5), plain)).toHaveLength(6);
  });

  it('says where a tile under the cursor would be entered from', () => {
    const s = new ReclassStroke();
    expect(s.entry(at(5, 5))).toBeUndefined();
    s.move(at(5, 5), plain);
    s.move(at(5, 7), plain);
    expect(s.entry(at(5, 8))).toEqual(at(5, 7));
  });
});

describe('a stroke on real track', () => {
  function world() {
    const map = emptyMap(4242, 48, 48, Terrain.Grass),
      track = new TrackGraph(48, 48),
      stock = new Stockpile(),
      economy = new Economy();
    const regions = new RegionState(map);
    for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
    const builder = new Builder(map, regions, track, economy, stock);
    for (const k of ['wood', 'stone', 'iron']) stock.amounts.set(k, 5000);
    // a north-south line and a west-east line, crossing at (10, 10)
    for (let y = 5; y <= 15; y++) if (y !== 10) track.place(10, y, 'straight', 0, 'regular');
    for (let x = 5; x <= 15; x++) if (x !== 10) track.place(x, 10, 'straight', 1, 'regular');
    track.place(10, 10, 'crossing', 0, 'regular', 'regular');
    return { track, builder };
  }
  const lineOf = (track: TrackGraph, axis: 'ns' | 'ew') => {
    const p = track.get(10, 10)!;
    const northSouth = p.links[0].some((d) => d === 0 || d === 2) ? 0 : 1;
    const i = axis === 'ns' ? northSouth : 1 - northSouth;
    return i === 0 ? p.cls : (p.cls2 ?? p.cls);
  };

  it("upgrades only the stroke's line of a crossing when the hand wobbles beside it", () => {
    const { track, builder } = world();
    const crossing = (t: { x: number; y: number }) => track.get(t.x, t.y)?.kind === 'crossing';
    const s = new ReclassStroke();
    for (const t of [at(10, 7), at(10, 8), at(9, 9), at(10, 10), at(10, 11), at(10, 12)])
      for (const step of s.move(t, crossing))
        builder.reclassTrack([step.tile], 'high_speed', step.from);
    expect(lineOf(track, 'ns')).toBe('high_speed');
    expect(lineOf(track, 'ew')).toBe('regular');
    // the cross line beside the crossing is untouched wide track
    for (const x of [9, 11])
      expect(track.get(x, 10)).toMatchObject({ kind: 'straight', cls: 'regular' });
    expect(track.get(10, 9)).toMatchObject({ kind: 'straight', cls: 'high_speed' });
  });

  it('upgrades the line a stroke leaves a crossing along when it starts on it', () => {
    const { track, builder } = world();
    const crossing = (t: { x: number; y: number }) => track.get(t.x, t.y)?.kind === 'crossing';
    const s = new ReclassStroke();
    for (const t of [at(10, 10), at(11, 10), at(12, 10)])
      for (const step of s.move(t, crossing))
        builder.reclassTrack([step.tile], 'high_speed', step.from);
    expect(lineOf(track, 'ew')).toBe('high_speed');
    expect(lineOf(track, 'ns')).toBe('regular');
  });
});
