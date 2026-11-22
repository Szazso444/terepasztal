import { describe, expect, it } from 'vitest';
import { placeNewLandmarks } from './landmarkWiring';
import { LandmarkRegistry, type LandmarkDeps } from '../sim/landmarks';
import { GameClock } from '../sim/time';
import { generatorOf, groundOf, type GeneratedWorld } from '../sim/ground';
import { DEFAULT_MAP_PARAMS } from '../world/mapgen';

/** A chance high enough that every region rolls a landmark: the tests look for what the rolls place. */
const SURE = 10;

/** The registry as the game builds it, with the clock the only dep a placement reads. */
function registry() {
  return new LandmarkRegistry({ clock: new GameClock() } as unknown as LandmarkDeps);
}

function worldOf(seed: number): GeneratedWorld {
  return { kind: 'generated', seed, params: { ...DEFAULT_MAP_PARAMS } } as GeneratedWorld;
}

/** The first seed whose new world places exactly one landmark, with that world's ground. */
function oneLandmarkWorld() {
  for (let seed = 1; seed < 80; seed++) {
    const spec = worldOf(seed);
    const ground = groundOf(spec, generatorOf('simple'));
    const reg = registry();
    if (placeNewLandmarks(reg, seed, ground.map, ground.added, SURE) === 1) return { spec, reg };
  }
  throw new Error('no seed in range placed a landmark');
}

describe('landmark wiring', () => {
  it('a newly generated chunk with a rolled landmark yields one saved item, a reload no second', () => {
    const { spec, reg } = oneLandmarkWorld();
    const saved = JSON.parse(JSON.stringify(reg.toJSON()));
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0].stage).toBe('hidden');
    // the load: the store holds every chunk, so none is generated and none rolled
    const again = groundOf(spec, generatorOf('simple'));
    expect(again.added).toEqual([]);
    const loaded = registry();
    loaded.load(saved);
    expect(placeNewLandmarks(loaded, spec.seed, again.map, again.added, SURE)).toBe(0);
    expect(loaded.toJSON()).toEqual(saved);
  });

  it('a placement a held landmark covers is not added twice, even when its chunk is offered again', () => {
    const { spec, reg } = oneLandmarkWorld();
    const ground = groundOf(spec, generatorOf('simple'));
    const all = Object.keys(spec.chunks as object);
    expect(placeNewLandmarks(reg, spec.seed, ground.map, all, SURE)).toBe(0);
    expect(reg.items).toHaveLength(1);
  });

  it('the first load after the v24 step rolls nothing and clears its mark', () => {
    const { spec, reg } = oneLandmarkWorld();
    const ground = groundOf(spec, generatorOf('simple'));
    const all = Object.keys(spec.chunks as object);
    const old = registry();
    old.load({ nextId: 1, items: [], skipRoll: true });
    expect(placeNewLandmarks(old, spec.seed, ground.map, all, SURE)).toBe(0);
    expect(old.toJSON()).toEqual({ nextId: 1, items: [] });
    // the next load that generates a chunk rolls again
    expect(placeNewLandmarks(old, spec.seed, ground.map, all, SURE)).toBe(reg.items.length);
  });
});
