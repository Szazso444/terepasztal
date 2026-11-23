import { describe, expect, it, vi } from 'vitest';
import { content, landmarkDef } from '../data/content';
import { LandmarkRegistry } from '../sim/landmarks';
import { simWorld } from '../testing/simWorld';
import { chunkKey } from '../world/chunks';
import {
  LANDMARK_SCENE_CHANCE,
  LANDMARK_SCENE_SEED,
  RESTORE_ID,
  completeLandmarks,
  findRing,
  layDelivery,
  layRing,
  ringStations,
} from './landmarkScene';
import { placeNewLandmarks } from './landmarkWiring';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

describe('the landmark review scene', () => {
  it('stands all twelve on its seed, each with a ring and two stations, and a delivery line', () => {
    const w = simWorld({ seed: LANDMARK_SCENE_SEED, size: 160 });
    const reg = new LandmarkRegistry({
      clock: w.clock,
      economy: w.economy,
      stores: w.stores,
      windLevel: () => 'calm',
    });
    w.builder.landmarks = reg;
    w.builder.free = true;
    w.regions.applyTier(Number.POSITIVE_INFINITY);
    const keys: string[] = [];
    for (let cy = 0; cy < 5; cy++) for (let cx = 0; cx < 5; cx++) keys.push(chunkKey(cx, cy));
    placeNewLandmarks(reg, w.seed, w.map, keys, LANDMARK_SCENE_CHANCE);
    completeLandmarks(w.map, reg, content.landmarks, (f) => findRing(w.builder, f) !== null);
    expect(reg.items.map((i) => i.def).sort()).toEqual(content.landmarks.map((l) => l.id).sort());
    for (const item of reg.items) {
      const def = landmarkDef(item.def)!;
      const ring = layRing(w.builder, { ...item, w: def.w, d: def.d });
      expect(ring, item.def).not.toBeNull();
      expect(ringStations(w.builder, ring!), item.def).toHaveLength(2);
    }
    const bell = reg.items.find((i) => i.def === RESTORE_ID)!;
    expect(layDelivery(w.builder, bell, landmarkDef(RESTORE_ID)!)).not.toBeNull();
  });
});
