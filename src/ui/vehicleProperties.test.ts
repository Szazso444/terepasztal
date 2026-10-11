import { describe, it, expect } from 'vitest';
import { LOCOS, WAGONS, type LocoDef, type WagonDef } from '../gacha/items';
import { vehicleSpec } from '../sim/body';
import { cargoName } from '../sim/cargo';
import { STR } from '../strings';
import { vehicleProperties } from './vehicleProperties';

/** The values a vehicle's data stores that the player should only ever read as names. */
function storedValues(d: LocoDef | WagonDef): string[] {
  const s = vehicleSpec(d);
  const out: string[] = [s.size, s.plan];
  if (d.size) out.push(d.size);
  if ('plan' in d && d.plan) out.push(d.plan);
  if ('type' in d) out.push(d.type);
  if ('carries' in d) out.push(d.carries, ...(d.accepts ?? []));
  return out;
}

/** A line, each ' · ' part of it, and each ', ' item of a part, with text in parentheses dropped. */
function pieces(line: string): string[] {
  const parts = line
    .replace(/\s*\([^)]*\)/g, '')
    .split(' · ')
    .map((p) => p.trim());
  return [line, ...parts, ...parts.flatMap((p) => p.split(', ').map((i) => i.trim()))];
}

describe('the data sheet of a vehicle', () => {
  const vehicles: (LocoDef | WagonDef)[] = [...LOCOS, ...WAGONS];

  it('covers locomotives and wagons, every body plan among them', () => {
    expect(LOCOS.length).toBeGreaterThan(0);
    expect(WAGONS.length).toBeGreaterThan(0);
    const plans = new Set(vehicles.map((d) => vehicleSpec(d).plan));
    expect([...plans].sort()).toEqual(['garratt', 'meyer', 'rigid', 'tender']);
  });

  it('shows no stored size, body plan, type, cargo class or cargo id, and no empty line', () => {
    for (const d of vehicles) {
      const stored = new Set(storedValues(d));
      const lines = vehicleProperties(d.id);
      expect(lines.length, d.id).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.trim(), `${d.id}: an empty line`).not.toBe('');
        expect(line, d.id).not.toMatch(/undefined|NaN/);
        for (const p of pieces(line))
          expect(stored.has(p), `${d.id}: "${p}" in "${line}"`).toBe(false);
      }
    }
  });

  it('leaves out the accepted-cargo line of a wagon whose class has no cargo', () => {
    // no wagon in the shipped data has an empty `accepts`, so each one is copied without it
    for (const base of [...WAGONS]) {
      const full = vehicleProperties(base.id);
      for (const accepts of [[], undefined]) {
        const id = `${base.id}__no_cargo`;
        WAGONS.push({ ...base, id, accepts });
        const tag = `${id} with accepts ${JSON.stringify(accepts)}`;
        try {
          const lines = vehicleProperties(id);
          for (const line of lines) expect(line.trim(), `${tag}: an empty line`).not.toBe('');
          // the same sheet with one line left out: the one naming the cargo the wagon takes
          const dropped = full.findIndex((l) => !lines.includes(l));
          expect(dropped, `${tag}: no line left out of ${full.join(' | ')}`).not.toBe(-1);
          expect(lines, tag).toEqual(full.filter((_, i) => i !== dropped));
          for (const c of base.accepts ?? []) expect(full[dropped], tag).toContain(cargoName(c));
        } finally {
          WAGONS.splice(
            WAGONS.findIndex((w) => w.id === id),
            1,
          );
        }
      }
    }
  });

  it('states the tile count once, on the first line', () => {
    // a length in tiles; "tiles/s" is a speed and "per tile" a rate
    const length = /\d+(?:\.\d+)? tiles?\b(?!\/)/g;
    for (const d of vehicles) {
      const lines = vehicleProperties(d.id);
      const found = lines.map((l) => l.match(length) ?? []);
      expect(found[0], `${d.id}: ${lines[0]}`).toHaveLength(1);
      expect(parseFloat(found[0][0]), d.id).toBe(vehicleSpec(d).L);
      expect(found.slice(1).flat(), `${d.id}: ${lines.join(' | ')}`).toEqual([]);
    }
  });

  it('names the size, the body plan and the type or cargo class in the crafting list', () => {
    for (const d of vehicles) {
      const s = vehicleSpec(d);
      // the crafting list shows the first three lines
      const [body, , what] = vehicleProperties(d.id);
      expect(body, d.id).toContain(STR.roster.sizes[s.size]);
      expect(body, d.id).toContain(STR.vehicle.plan[s.plan]);
      expect(what, d.id).toContain(
        'type' in d ? STR.roster.type[d.type] : STR.roster.carries[d.carries],
      );
    }
  });
});
