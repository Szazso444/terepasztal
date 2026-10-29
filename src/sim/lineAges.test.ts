import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { LINES, TRACK_CLASSES, TrackGraph, itemAge, lineAge } from '../world/track';
import { AGE_DEFS } from './ages';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { rules, DEFAULT_RULES } from './rules';
import { STR } from '../strings';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const STEAM = 0,
  DIESEL = 1,
  ELECTRIC = 2;

function world(age: number) {
  const map = emptyMap(4242, 32, 32, Terrain.Grass),
    track = new TrackGraph(32, 32),
    stock = new Stockpile(),
    economy = Object.assign(new Economy(), { tier: age });
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  for (const k of ['wood', 'stone', 'iron']) stock.amounts.set(k, 10000);
  return { track, builder };
}
const straight = (cls: 'branch' | 'main' | 'trunk' | 'narrow') => ({
  kind: 'straight' as const,
  cls,
});

describe('lines open by age', () => {
  it('opens each line in its age', () => {
    for (const cls of TRACK_CLASSES) expect(AGE_DEFS[lineAge(cls)].id, cls).toBe(LINES[cls].age);
    expect(TRACK_CLASSES.map(lineAge)).toEqual([0, 0, 1, 2, 4, 5]);
    expect(TRACK_CLASSES).toEqual(['narrow', 'branch', 'main', 'trunk', 'maglev', 'hyperloop']);
  });

  it('asks a crossing for the later of its two lines', () => {
    expect(itemAge({ cls: 'branch', cls2: 'trunk' })).toBe(ELECTRIC);
    expect(itemAge({ cls: 'main', cls2: 'branch' })).toBe(DIESEL);
    expect(itemAge({ cls: 'narrow', cls2: 'branch' })).toBe(STEAM);
  });

  it('builds Main Line from the Diesel Age and Trunk Line from the Electric Age', () => {
    const steam = world(STEAM).builder;
    expect(steam.checkTrack(5, 5, straight('branch'), 1).ok).toBe(true);
    expect(steam.checkTrack(5, 5, straight('narrow'), 1).ok).toBe(true);
    expect(steam.checkTrack(5, 5, straight('main'), 1).reason).toBe(STR.build.tierLocked(DIESEL));
    expect(steam.checkTrack(5, 5, { kind: 'curve', cls: 'main' }, 0).reason).toBe(
      STR.build.tierLocked(DIESEL),
    );
    expect(
      steam.checkTrack(5, 5, { kind: 'crossing', cls: 'branch', cls2: 'main' }, 0).reason,
    ).toBe(STR.build.tierLocked(DIESEL));
    const diesel = world(DIESEL).builder;
    expect(diesel.checkTrack(5, 5, straight('main'), 1).ok).toBe(true);
    expect(diesel.checkTrack(5, 5, straight('trunk'), 1).reason).toBe(
      STR.build.tierLocked(ELECTRIC),
    );
    expect(world(ELECTRIC).builder.checkTrack(5, 5, straight('trunk'), 1).ok).toBe(true);
  });

  it('opens every line with the locks off, or for a free builder', () => {
    const steam = world(STEAM).builder;
    rules.lineAgeLocks = 0;
    expect(steam.checkTrack(5, 5, straight('trunk'), 1).ok).toBe(true);
    rules.lineAgeLocks = 1;
    steam.free = true;
    expect(steam.checkTrack(5, 5, straight('trunk'), 1).ok).toBe(true);
  });

  it('upgrades only to a line that is open, and downgrades at any age', () => {
    const { track, builder } = world(STEAM);
    for (let x = 5; x <= 8; x++) track.place(x, 10, 'straight', 1, 'branch');
    const run = [5, 6, 7, 8].map((x) => ({ x, y: 10 }));
    const up = builder.checkReclass(run, 'up');
    expect(up.ok).toBe(false);
    expect(up.reason).toBe(STR.build.tierLocked(DIESEL));
    expect(track.get(6, 10)!.cls).toBe('branch');
    for (let x = 5; x <= 8; x++) track.place(x, 12, 'straight', 1, 'main');
    const down = builder.checkReclass(
      run.map((t) => ({ ...t, y: 12 })),
      'down',
    );
    expect(down.ok).toBe(true);
  });
});
