import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import {
  vehicleAccess,
  consistAccess,
  consistGauge,
  gaugeOf,
  pieceClassFor,
  runsOn,
  classOf,
  classRunsOn,
  trainClassOf,
  CLASS_LINE,
} from './compat';
import { makePiece } from '../world/track';
import { Dir } from '../engine/iso';
import { STR } from '../strings';

const loco = (id: string) => content.locomotives.find((d) => d.id === id)!;
const wagon = (id: string) => content.wagons.find((d) => d.id === id)!;

describe('gauge access', () => {
  it('keeps narrow stock on narrow track and regular stock off it', () => {
    expect(gaugeOf(loco('mk48'))).toBe('narrow');
    expect(vehicleAccess(loco('mk48'), 'narrow')).toBeNull();
    expect(vehicleAccess(loco('mk48'), 'branch')).not.toBeNull();
    expect(vehicleAccess(loco('f7'), 'narrow')).not.toBeNull();
    expect(vehicleAccess(wagon('mine_tub'), 'narrow')).toBeNull();
    expect(vehicleAccess(wagon('boxcar'), 'narrow')).not.toBeNull();
    // regular stock runs on the whole standard network, and on no line of another network
    expect(vehicleAccess(loco('f7'), 'main')).toBeNull();
    expect(vehicleAccess(loco('f7'), 'trunk')).toBeNull();
    expect(vehicleAccess(loco('f7'), 'maglev')).toBe(STR.compat.wrongNetwork('Maglev Guideway'));
    expect(vehicleAccess(loco('mk48'), 'main')).toBe(STR.compat.wrongNetwork('Main Line'));
  });

  it('lets a vehicle onto the line of its class and every bigger standard line', () => {
    expect(classOf(loco('f7'))).toBe('frigate');
    expect(classOf(loco('black_five'))).toBe('destroyer');
    expect(classOf(loco('big_boy'))).toBe('cruiser');
    expect(classOf(loco('mk48'))).toBe('corvette');
    // a def without a class falls back by its gauge
    expect(classOf({})).toBe('frigate');
    expect(classOf({ gauge: 'narrow' })).toBe('corvette');
    expect(CLASS_LINE).toEqual({
      corvette: 'narrow',
      frigate: 'branch',
      destroyer: 'main',
      cruiser: 'trunk',
      carrier: 'trunk',
      hydrofoil: 'maglev',
      submarine: 'hyperloop',
    });
    // a Frigate runs on the whole standard network
    for (const cls of ['branch', 'main', 'trunk'] as const)
      expect(vehicleAccess(loco('f7'), cls), cls).toBeNull();
    // a Destroyer is refused on Branch Line, runs on Main and Trunk
    for (const id of ['black_five', 'sd40', 'crocodile', 'tgv']) {
      expect(vehicleAccess(loco(id), 'branch'), id).toBe(
        STR.compat.tooBig('Destroyer', 'Branch Line'),
      );
      expect(vehicleAccess(loco(id), 'main'), id).toBeNull();
      expect(vehicleAccess(loco(id), 'trunk'), id).toBeNull();
    }
    expect(vehicleAccess(wagon('pullman'), 'branch')).toBe(
      STR.compat.tooBig('Destroyer', 'Branch Line'),
    );
    expect(vehicleAccess(wagon('pullman'), 'main')).toBeNull();
    // a Cruiser only on Trunk Line
    expect(vehicleAccess(loco('big_boy'), 'branch')).toBe(
      STR.compat.tooBig('Cruiser', 'Branch Line'),
    );
    expect(vehicleAccess(loco('big_boy'), 'main')).toBe(STR.compat.tooBig('Cruiser', 'Main Line'));
    expect(vehicleAccess(loco('big_boy'), 'trunk')).toBeNull();
    expect(vehicleAccess(wagon('heavy_flat'), 'main')).toBe(
      STR.compat.tooBig('Cruiser', 'Main Line'),
    );
    // another network refuses whatever the size
    expect(vehicleAccess(loco('big_boy'), 'narrow')).toBe(STR.compat.wrongNetwork('Narrow Gauge'));
    expect(classRunsOn('hydrofoil', 'maglev')).toBe(true);
    expect(classRunsOn('hydrofoil', 'trunk')).toBe(false);
    expect(classRunsOn('submarine', 'hyperloop')).toBe(true);
    expect(classRunsOn('corvette', 'branch')).toBe(false);
  });

  it('gives a consist the class of its biggest vehicle', () => {
    expect(trainClassOf([])).toBeNull();
    expect(trainClassOf([loco('f7'), wagon('boxcar')])).toBe('frigate');
    expect(trainClassOf([loco('f7'), wagon('boxcar'), wagon('pullman')])).toBe('destroyer');
    expect(trainClassOf([loco('black_five'), wagon('heavy_flat')])).toBe('cruiser');
    expect(trainClassOf([loco('mk48'), wagon('mine_tub')])).toBe('corvette');
  });

  it('says which class a vehicle is and which track it runs on', () => {
    expect(runsOn(loco('big_boy'))).toBe('Cruiser · runs on Trunk Line');
    expect(runsOn(loco('black_five'))).toBe('Destroyer · runs on Main Line, Trunk Line');
    expect(runsOn(wagon('boxcar'))).toBe('Frigate · runs on Branch Line, Main Line, Trunk Line');
    expect(runsOn(loco('mk48'))).toBe('Corvette · runs on Narrow Gauge');
    expect(runsOn(wagon('mine_tub'))).toBe('Corvette · runs on Narrow Gauge');
  });

  it('names a consist of two gauges as mixed', () => {
    expect(consistGauge([loco('mk48'), wagon('mine_tub')])).toBe('narrow');
    expect(consistGauge([loco('f7'), wagon('boxcar')])).toBe('regular');
    expect(consistGauge([loco('mk48'), wagon('boxcar')])).toBe('mixed');
    expect(consistGauge([])).toBeNull();
    expect(consistAccess([loco('mk48'), wagon('boxcar')]).classes.size).toBe(0);
  });

  it('lets each gauge use its own axis of a mixed crossing', () => {
    const x = makePiece('crossing', 0, 'narrow', 'branch');
    expect(pieceClassFor(x, Dir.N)).toBe('narrow');
    expect(pieceClassFor(x, Dir.E)).toBe('branch');
    expect(consistAccess([loco('f7')]).classes.has(pieceClassFor(x, Dir.E))).toBe(true);
    expect(consistAccess([loco('f7')]).classes.has(pieceClassFor(x, Dir.N))).toBe(false);
    expect(consistAccess([loco('mk48')]).classes.has(pieceClassFor(x, Dir.N))).toBe(true);
  });

  it('gives every narrow wagon a cargo class and a length of at most one tile', () => {
    for (const id of ['mine_tub', 'narrow_tank', 'narrow_box', 'narrow_coach']) {
      const w = wagon(id);
      expect(w.gauge).toBe('narrow');
      expect(['tiny', 'small']).toContain(w.size ?? 'small');
    }
    expect(wagon('mine_tub').size).toBe('tiny');
  });
});
