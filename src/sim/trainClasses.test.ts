import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import { LINES, TRACK_CLASSES } from '../world/track';
import {
  CLASS_LINE,
  TRAIN_CLASSES,
  classOf,
  classRunsOn,
  consistAccess,
  gaugeOf,
  trainClassOf,
  vehicleAccess,
  verdictOf,
} from './compat';
import { STR } from '../strings';

const all = [...content.locomotives, ...content.wagons];
const loco = (id: string) => content.locomotives.find((d) => d.id === id)!;
const wagon = (id: string) => content.wagons.find((d) => d.id === id)!;

describe('train classes', () => {
  it('names a class for every engine and wagon in the data', () => {
    for (const d of all) expect(d.class, d.id).toBeDefined();
  });

  it('keeps gauge and class together: narrow gauge is exactly the Corvettes', () => {
    for (const d of all) expect(gaugeOf(d) === 'narrow', d.id).toBe(classOf(d) === 'corvette');
  });

  it("fits every vehicle on the curves of its own class's line", () => {
    for (const d of all) {
      const line = CLASS_LINE[classOf(d)];
      if (!LINES[line].curves) continue;
      const v = verdictOf(d, line);
      expect(v.ok, `${d.id} (${classOf(d)}) on ${line}: ${v.reason}`).toBe(true);
    }
  });

  it('runs a class on its own line and every bigger standard line, a separate one on its own', () => {
    const runs = (tc: (typeof TRAIN_CLASSES)[number]) =>
      TRACK_CLASSES.filter((c) => classRunsOn(tc, c));
    expect(runs('corvette')).toEqual(['narrow']);
    expect(runs('frigate')).toEqual(['branch', 'main', 'trunk']);
    expect(runs('destroyer')).toEqual(['main', 'trunk']);
    expect(runs('cruiser')).toEqual(['trunk']);
    expect(runs('carrier')).toEqual(['trunk']);
    expect(runs('hydrofoil')).toEqual(['maglev']);
    expect(runs('submarine')).toEqual(['hyperloop']);
  });

  it('says why a vehicle may not use a line', () => {
    expect(vehicleAccess(loco('sd40'), 'branch')).toBe(
      STR.compat.tooBig('Destroyer', 'Branch Line'),
    );
    expect(vehicleAccess(loco('sd40'), 'main')).toBeNull();
    expect(vehicleAccess(loco('mk48'), 'branch')).toBe(STR.compat.wrongNetwork('Branch Line'));
    expect(vehicleAccess(loco('f7'), 'narrow')).toBe(STR.compat.wrongNetwork('Narrow Gauge'));
  });

  it("gives a train its biggest vehicle's class and keeps it to that class's lines", () => {
    expect(trainClassOf([loco('f7'), wagon('boxcar')])).toBe('frigate');
    expect(trainClassOf([loco('f7'), wagon('heavy_flat')])).toBe('cruiser');
    expect(trainClassOf([loco('sd40'), wagon('boxcar'), wagon('pullman')])).toBe('destroyer');
    expect(trainClassOf([])).toBeNull();
    const access = consistAccess([loco('f7'), wagon('boxcar'), wagon('pressure_tank')]);
    expect([...access.classes].sort()).toEqual(['main', 'trunk']);
    expect(access.blockedBy.branch?.name).toBe(wagon('pressure_tank').name);
  });

  it('falls back to Corvette on narrow gauge and Frigate otherwise for a def without a class', () => {
    expect(classOf({ gauge: 'narrow' })).toBe('corvette');
    expect(classOf({})).toBe('frigate');
  });
});
