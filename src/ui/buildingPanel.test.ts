import { describe, it, expect, beforeEach, vi } from 'vitest';
import { simWorld, type SimWorld } from '../testing/simWorld';
import { STR } from '../strings';
import { LAST_AGE } from '../sim/ages';
import { rules, DEFAULT_RULES, weekSeconds } from '../sim/rules';
import {
  BUILDING_DEFS,
  buildingLevel,
  buildingUpgradeCost,
  missingInput,
  tickBuildings,
  type Building,
  type BuildingDef,
} from '../sim/buildings';
import { cargoName } from '../sim/cargo';
import { Stockpile } from '../sim/stockpile';
import { startWork, upgradeSeconds } from '../sim/upgrade';
import { TERRAIN_NAMES, type PropKind } from '../world/tiles';
import { BuildingPanel } from './buildingPanel';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
});

/** Every reason `tickBuildings` can leave on a building. */
const REASONS: NonNullable<Building['reason']>[] = ['', 'full', 'inputs', 'upgrading'];

const bridges = BUILDING_DEFS.filter((d) => d.bridge);
const works = BUILDING_DEFS.filter((d) => !d.bridge);

/** A building of `def` at level 1 left with `reason`, with an upgrade under way when `busy`. */
function building(def: BuildingDef, reason: Building['reason'], busy: boolean): Building {
  const b: Building = { id: def.id, x: 0, y: 0, acc: 0, active: false, rate: 0, reason };
  if (busy) b.work = startWork(2)!;
  return b;
}

/** `b` after one tick against an empty stockpile, as the game leaves it. */
function ticked(b: Building): Building {
  tickBuildings([b], new Stockpile(), weekSeconds() / 7, false, 0, 0);
  return b;
}

describe('the status line of a works or a bridge', () => {
  it('has a bridge and a works to look at, and a work to give them', () => {
    expect(bridges.length).toBeGreaterThan(0);
    expect(works.length).toBeGreaterThan(0);
    expect(startWork(2)).not.toBeNull();
  });

  it('never calls a bridge being strengthened closed: it reads as the same bridge without one', () => {
    const stock = new Stockpile();
    for (const def of bridges) {
      for (const reason of REASONS) {
        const busy = BuildingPanel.status(building(def, reason, true), stock);
        expect(busy.text, `${def.id} ${reason}`).not.toBe(STR.upgrade.closed);
        expect(busy, `${def.id} ${reason}`).toEqual(
          BuildingPanel.status(building(def, reason, false), stock),
        );
      }
      // what a tick leaves on it: trains still cross, so it reads as it does with no work
      const busy = ticked(building(def, '', true));
      const idle = ticked(building(def, '', false));
      expect(busy.reason).toBe('upgrading');
      expect(BuildingPanel.status(busy, stock), def.id).toEqual(BuildingPanel.status(idle, stock));
    }
  });

  it('still says every works being upgraded is closed, whatever its last reason', () => {
    const stock = new Stockpile();
    const closed = { text: STR.upgrade.closed, cls: 'amber' };
    for (const def of works) {
      for (const reason of REASONS)
        expect(
          BuildingPanel.status(building(def, reason, true), stock),
          `${def.id} ${reason}`,
        ).toEqual(closed);
      expect(BuildingPanel.status(ticked(building(def, '', true)), stock), def.id).toEqual(closed);
      // and a works with no work under way is not
      for (const reason of REASONS)
        expect(BuildingPanel.status(building(def, reason, false), stock).text).not.toBe(
          STR.upgrade.closed,
        );
    }
  });
});

describe('the status kind the works tooltip is built from', () => {
  /** The words `status` gives a kind. */
  const worded = (b: Building, stock: Stockpile) => {
    const s = BuildingPanel.statusKind(b, stock);
    switch (s.kind) {
      case 'closed':
        return STR.upgrade.closed;
      case 'full':
        return STR.building.full;
      case 'running':
        return STR.building.running;
      case 'starved':
        return STR.building.starved(s.missing ? cargoName(s.missing) : STR.building.unknownInput);
    }
  };

  it('is the status the panel words, for every reason, with and without an upgrade', () => {
    const stock = new Stockpile();
    for (const def of BUILDING_DEFS)
      for (const reason of REASONS)
        for (const busy of [false, true]) {
          const b = building(def, reason, busy);
          expect(BuildingPanel.status(b, stock).text, `${def.id} ${reason} ${busy}`).toBe(
            worded(b, stock),
          );
        }
  });

  it('names the input a starved works is short of, and none once it is stocked', () => {
    const def = works.find((d) => Object.values(d.recipe.in).some((v) => v > 0))!;
    const stock = new Stockpile();
    const b = building(def, 'inputs', false);
    const short = BuildingPanel.statusKind(b, stock);
    expect(short.kind).toBe('starved');
    expect(short.kind === 'starved' ? short.missing : null).toBe(missingInput(def, stock));
    expect(short.kind === 'starved' ? short.missing : null).not.toBeNull();
    for (const [k, v] of Object.entries(def.recipe.in)) stock.add(k, v);
    expect(BuildingPanel.statusKind(b, stock)).toEqual({ kind: 'starved', missing: null });
  });

  it('keeps a bridge being strengthened as it was, and closes a works being upgraded', () => {
    const stock = new Stockpile();
    for (const def of bridges)
      expect(BuildingPanel.statusKind(building(def, '', true), stock).kind).not.toBe('closed');
    for (const def of works)
      expect(BuildingPanel.statusKind(building(def, '', true), stock)).toEqual({ kind: 'closed' });
  });
});

/**
 * A flat world in the last age with everything an upgrade costs, and the tile at (x, y) made fit
 * for `def`: water beside it, the terrain it asks for, the deposit it stands on.
 */
function site(def: BuildingDef, x: number, y: number): SimWorld {
  const w = simWorld({ terrain: 'grass', size: 64 });
  w.economy.setAge(LAST_AGE);
  const i = y * w.map.w + x;
  if (def.needsWater) w.map.terrain[i + 1] = TERRAIN_NAMES.indexOf('water');
  if (def.terrain) w.map.terrain[i] = TERRAIN_NAMES.indexOf(def.terrain as 'grass');
  if (def.deposit)
    w.map.props.set(i, [{ kind: def.deposit as PropKind, variant: 0, ox: 0, oy: 0 }]);
  return w;
}

describe('the crew a works panel shows', () => {
  it('is the change the works makes to the crew, placed, closed for its upgrade and open again', () => {
    const crewed = works.filter((d) => d.crew > 0);
    expect(crewed.length).toBeGreaterThan(0);
    for (const def of crewed) {
      const [x, y] = [20, 20];
      const w = site(def, x, y);
      const before = w.builder.crewTotal();
      // placed the way the editor places one, so the age and the production chain do not matter
      w.builder.free = true;
      const b = w.builder.placeBuilding(x, y, def.id);
      w.builder.free = false;
      expect(b, `${def.id}: ${w.builder.checkBuilding(x, y, def.id).reason}`).not.toBeNull();
      const crew = () => w.builder.crewTotal() - before;
      expect(BuildingPanel.crew(b!), def.id).toBe(def.crew);
      expect(crew(), def.id).toBe(BuildingPanel.crew(b!));

      for (const [k, v] of Object.entries(buildingUpgradeCost(b!)!)) w.stock.add(k, v);
      expect(w.builder.upgradeBuilding(b!), def.id).toBe(true);
      expect(b!.work, def.id).toBeDefined();
      expect(BuildingPanel.crew(b!), def.id).toBe(0);
      expect(crew(), def.id).toBe(BuildingPanel.crew(b!));

      w.builder.tickWorks(upgradeSeconds(2));
      expect([b!.work, buildingLevel(b!)], def.id).toEqual([undefined, 2]);
      expect(BuildingPanel.crew(b!), def.id).toBe(def.crew);
      expect(crew(), def.id).toBe(BuildingPanel.crew(b!));
    }
  });
});
