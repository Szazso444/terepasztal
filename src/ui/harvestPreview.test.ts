import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sprite } from 'pixi.js';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { LEVELS, STATION_DEFS, resetStationIds, weeklyOutput, type Station } from '../sim/stations';
import { cargoDef } from '../sim/cargo';
import { line, simWorld, station as placeStation, type SimWorld } from '../testing/simWorld';
import { forAll } from '../testing/property';
import { STR } from '../strings';
import { BuildController } from './buildController';
import { harvestPreviewPerWeek } from './harvestPreview';

const HARVESTERS = STATION_DEFS.filter((d) => d.terrain);
/** Stations that harvest nothing (town, warehouse, depots, passenger station): no preview. */
const OTHERS = STATION_DEFS.filter((d) => !d.terrain);
/** The tuning multipliers the preview is held to: the default and one that is not. */
const MULS = [1, 2];
/** Tiles of a fixture world a harvester is tried on, per kind and multiplier. */
const SITES = 4;

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
});

/** The controller over a real world, with the renderer faked down to what a ghost asks of it. */
function controllerOn(w: SimWorld, at: { x: number; y: number }) {
  const input = {
    wasPressed: () => false,
    clicks: [],
    buttons: new Set(),
    buttonPressed: new Set(),
  };
  const world = {
    atlas: { has: () => false },
    makeOverlaySprite: () => new Sprite(),
    setSpriteFrame: () => {},
    surfacePoint: () => ({ x: 0, y: 0 }),
  };
  const b = new BuildController(input as never, w.builder, world as never, () => at);
  const status: string[] = [];
  b.onStatus = (text) => status.push(text);
  return { b, status };
}

/** Spread-out tiles to try: track goes in beside each, so a station can stand on it. */
function* tiles() {
  for (let y = 3; y < 45; y += 6) for (let x = 3; x < 45; x += 7) yield { x, y };
}

describe("a harvest station's build preview", () => {
  it('is a level 1 station weekly output on that ground, with no scaling of its own', () => {
    forAll(
      (rng) => ({
        factor: rng.pick([1, 0.15, 1.6, rng.range(0.15, 1.6), rng.range(0.15, 1.6)]),
        productionMul: rng.pick([1, 0, 0.1, 2.5, rng.range(0, 5), rng.range(0, 5)]),
      }),
      (c) => {
        rules.productionMul = c.productionMul;
        const shown = harvestPreviewPerWeek(c.factor);
        expect(shown, 'the live rules').toBe(weeklyOutput(1, c.factor));
        expect(shown, 'base x rules x ground').toBe(
          LEVELS.production[0] * c.productionMul * c.factor,
        );
        // the tuning given is the one read, not the live rules
        rules.productionMul = 3;
        expect(harvestPreviewPerWeek(c.factor, { productionMul: c.productionMul })).toBe(shown);
      },
    );
  });

  it('is the level 1 base on ground of factor 1', () => {
    expect(harvestPreviewPerWeek(1)).toBe(LEVELS.production[0]);
    expect(harvestPreviewPerWeek(1, { productionMul: 2 })).toBe(LEVELS.production[0] * 2);
  });

  it('is put into the status line for any ground the builder reports, under any tuning', () => {
    const w = simWorld({ seed: 4242, size: 48 });
    // the factor is the builder's to report, so the whole range from the floor to the ceiling is
    // reachable without hunting a fixture map for a tile that has it
    let factor = 1;
    vi.spyOn(w.builder, 'harvestFactor').mockImplementation(() => factor);
    forAll(
      (rng) => ({
        def: rng.pick(HARVESTERS),
        factor: rng.pick([0.15, 1.6, 1, 0.5, rng.range(0.15, 1.6), rng.range(0.15, 1.6)]),
        productionMul: rng.pick([1, 0.1, 2, 2.5, rng.range(0.1, 5), rng.range(0.1, 5)]),
      }),
      (c) => {
        rules.productionMul = c.productionMul;
        factor = c.factor;
        const { b, status } = controllerOn(w, { x: 3, y: 3 });
        b.setTool({ kind: 'station', defId: c.def.id });
        b.update(true);
        expect(status).toHaveLength(1);
        const cargo = c.def.produces[0]?.cargo;
        const expected = STR.build.harvest(
          Math.round(LEVELS.production[0] * c.productionMul * c.factor),
          cargo ? cargoDef(cargo).name : '',
          c.factor,
        );
        expect(status[0]).toContain(expected);
      },
      { format: (c) => JSON.stringify({ ...c, def: c.def.id }) },
    );
  });

  it('is not given for a station that harvests nothing, whatever the ground or the tuning', () => {
    const w = simWorld({ seed: 4242, size: 48 });
    let factor = 1;
    vi.spyOn(w.builder, 'harvestFactor').mockImplementation(() => factor);
    const statusOf = (defId: string, mul: number, f: number) => {
      rules.productionMul = mul;
      factor = f;
      const { b, status } = controllerOn(w, { x: 3, y: 3 });
      b.setTool({ kind: 'station', defId });
      b.update(true);
      expect(status, `${defId}: a status line`).toHaveLength(1);
      return status[0];
    };
    expect(OTHERS.length, 'stations that harvest nothing').toBeGreaterThan(0);
    forAll(
      (rng) => ({
        def: rng.pick(OTHERS),
        factor: rng.pick([0.15, 1.6, rng.range(0.15, 1.6)]),
        productionMul: rng.pick([0.1, 2.5, rng.range(0.1, 5)]),
      }),
      (c) => {
        // what the line says for this station on plain ground under the default tuning: a harvest
        // preview would carry the ground and the tuning into it, and this line does not
        const plain = statusOf(c.def.id, 1, 1);
        expect(statusOf(c.def.id, c.productionMul, c.factor)).toBe(plain);
      },
      { format: (c) => JSON.stringify({ ...c, def: c.def.id }) },
    );
  });

  // slow because it builds 14 worlds and places up to 56 stations through the builder: 0.2 to
  // 0.55 s alone
  it('shows what a level 1 station placed on that tile makes a week, for every harvester', () => {
    const factors = new Set<number>();
    for (const productionMul of MULS)
      for (const def of HARVESTERS) {
        rules.productionMul = productionMul;
        const w = simWorld({ seed: 4242, size: 48 });
        let placed = 0;
        for (const at of tiles()) {
          if (placed === SITES) break;
          const label = `${def.id} at ${at.x},${at.y}, productionMul ${productionMul}`;
          try {
            line(w, at.x, at.y + 1, at.x);
          } catch {
            continue;
          }
          // the preview first, on the tile with track beside it and nothing standing on it
          const { b, status } = controllerOn(w, at);
          b.setTool({ kind: 'station', defId: def.id });
          b.update(true);
          expect(status, `${label}: a status line`).toHaveLength(1);
          let s: Station;
          try {
            s = placeStation(w, def.id, at.x, at.y);
          } catch {
            continue; // outside the charted region, or on ground it cannot stand on
          }
          placed++;
          const f = w.builder.harvestFactor(at.x, at.y, def.id);
          factors.add(f);
          expect(s.level, `${label}: a new station is level 1`).toBe(1);
          expect(s.terrainFactor, `${label}: ground`).toBe(f);
          expect(harvestPreviewPerWeek(f), `${label}: the helper`).toBe(s.productionPerWeek);
          expect(weeklyOutput(1, f), `${label}: weeklyOutput`).toBe(s.productionPerWeek);

          // the controller puts that number, rounded, into the line it gives
          const cargo = def.produces[0]?.cargo;
          const expected = STR.build.harvest(
            Math.round(s.productionPerWeek),
            cargo ? cargoDef(cargo).name : '',
            f,
          );
          expect(status[0], `${label}: the status line`).toContain(expected);
        }
        expect(placed, `${def.id} was placed`).toBeGreaterThan(0);
      }
    // the fixture has ground that is not plain, so a stray factor in the preview would show
    expect(factors.size, 'distinct ground factors tried').toBeGreaterThan(1);
  }, 12_000);
});
