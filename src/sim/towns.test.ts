import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { rules, DEFAULT_RULES } from './rules';
import { startWork } from './upgrade';
import type { Building } from './buildings';
import type { Station } from './stations';
import type { TownMembers } from './towns';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** Runs `act` with `builder.free` set (the editor's way: no price, no lock), then plays on. */
function freely<T>(w: SimWorld, act: () => T): T {
  w.builder.free = true;
  try {
    return act();
  } finally {
    w.builder.free = false;
  }
}

/**
 * A town hall on a line, with two farms, a windmill, a kiln and a finished house in its reach:
 * something made, something used and someone fed.
 */
function town() {
  const w = simWorld({ terrain: 'grass', size: 64 });
  line(w, 2, 30, 40);
  const hall = station(w, 'town', 20, 29);
  const farms = [station(w, 'farm', 16, 29), station(w, 'farm', 24, 31)];
  const works = freely(w, () => [
    w.builder.placeBuilding(18, 26, 'windmill')!,
    w.builder.placeBuilding(22, 26, 'kiln')!,
  ]);
  expect(freely(w, () => w.builder.spawnDecor(20, 25, 'townhouse', 0))).not.toBeNull();
  w.houses.finishAll();
  const home = w.houses.at(20, 25)!;
  w.towns.refresh();
  const t = w.towns.byStation(hall.id)!;
  return { w, t, farms, works, home };
}

/** Close a station or works for an upgrade to level 2, or open it again. */
function setClosed(x: Station | Building, closed: boolean) {
  const work = closed ? startWork(2)! : null;
  if ('def' in x) x.work = work;
  else if (work) x.work = work;
  else delete x.work;
}

describe("a town's weekly figures", () => {
  it('count a station or works closed for its upgrade as nothing, and the rest in full', () => {
    const { w, t, farms, works } = town();
    const m = w.towns.members(t);
    const members: (Station | Building)[] = [...farms, ...works];
    for (const s of farms) expect(m.stations).toContain(s);
    for (const b of works) expect(m.buildings).toContain(b);
    const makes = w.towns.production(t),
      uses = w.towns.consumption(t);
    // the figures are worth comparing: every member adds to them while it is open
    for (const k of ['wheat', 'food', 'coal']) expect(makes[k], k).toBeGreaterThan(0);
    for (const k of ['wheat', 'wood', 'food']) expect(uses[k], k).toBeGreaterThan(0);
    /** The town's members with the given ones left out. */
    const without = (gone: (Station | Building)[]): TownMembers => ({
      ...m,
      stations: m.stations.filter((s) => !gone.includes(s)),
      buildings: m.buildings.filter((b) => !gone.includes(b)),
    });
    // every set of closed members, from none to all four
    for (let mask = 0; mask < 1 << members.length; mask++) {
      const closed = members.filter((_, i) => mask & (1 << i));
      for (const x of members) setClosed(x, closed.includes(x));
      const label = `closed ${mask.toString(2).padStart(members.length, '0')}`;
      expect(w.towns.production(t), label).toEqual(w.towns.production(t, without(closed)));
      expect(w.towns.consumption(t), label).toEqual(w.towns.consumption(t, without(closed)));
      if (closed.length) expect(w.towns.production(t), label).not.toEqual(makes);
    }
    for (const x of members) setClosed(x, false);
    expect(w.towns.production(t)).toEqual(makes);
    expect(w.towns.consumption(t)).toEqual(uses);
  });

  it('still feed the residents of a house being upgraded', () => {
    const { w, t, home } = town();
    expect(home.residents).toBeGreaterThan(0);
    const food = w.towns.consumption(t).food;
    home.work = startWork(2)!;
    // the residents stay while it is closed, and eat
    expect(w.towns.consumption(t).food).toBe(food);
  });
});
