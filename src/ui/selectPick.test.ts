import { describe, expect, it } from 'vitest';
import type { Building } from '../sim/buildings';
import type { Decor } from '../sim/build';
import type { LandmarkItem, LandmarkStage } from '../sim/landmarks';
import type { Station } from '../sim/stations';
import { pickAt, type PickBuilder } from './selectPick';

const st = { id: 's' } as unknown as Station;
const bld = { id: 'b' } as unknown as Building;
const dec = { id: 'd' } as unknown as Decor;
const lm = (stage: LandmarkStage) => ({ id: 1, def: 'x', stage }) as unknown as LandmarkItem;

/** What stands on the tile: each of the four unless left out. */
function world(has: { st?: boolean; bld?: boolean; dec?: boolean; lm?: LandmarkStage }) {
  const builder: PickBuilder = {
    stationAt: () => (has.st ? st : undefined),
    buildingAt: () => (has.bld ? bld : undefined),
    decorAt: () => (has.dec ? dec : undefined),
  };
  const landmarks = { at: () => (has.lm ? lm(has.lm) : undefined) };
  return { builder, landmarks };
}

describe('what the Select tool picks on a tile', () => {
  it('takes station, then building, then decor, then landmark', () => {
    const all = { st: true, bld: true, dec: true, lm: 'surveyed' as const };
    let w = world(all);
    expect(pickAt(w.builder, w.landmarks, 0, 0)).toMatchObject({ station: st, building: null });
    expect(pickAt(w.builder, w.landmarks, 0, 0).landmark).toBeNull();
    w = world({ ...all, st: false });
    expect(pickAt(w.builder, w.landmarks, 0, 0)).toMatchObject({ building: bld, decor: null });
    w = world({ ...all, st: false, bld: false });
    expect(pickAt(w.builder, w.landmarks, 0, 0)).toMatchObject({ decor: dec, landmark: null });
    w = world({ ...all, st: false, bld: false, dec: false });
    expect(pickAt(w.builder, w.landmarks, 0, 0).landmark?.id).toBe(1);
  });

  it('picks a landmark at any stage but hidden, and none without a registry', () => {
    for (const stage of ['spotted', 'surveyed', 'restoring', 'restored', 'salvaged'] as const) {
      const w = world({ lm: stage });
      expect(pickAt(w.builder, w.landmarks, 3, 4).landmark?.stage).toBe(stage);
    }
    const hidden = world({ lm: 'hidden' });
    expect(pickAt(hidden.builder, hidden.landmarks, 3, 4).landmark).toBeNull();
    expect(pickAt(hidden.builder, null, 3, 4).landmark).toBeNull();
  });
});
