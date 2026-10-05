import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import {
  vehicleAccess,
  consistAccess,
  consistGauge,
  gaugeOf,
  pieceClassFor,
  runsOn,
} from './compat';
import { makePiece } from '../world/track';
import { Dir } from '../engine/iso';

const loco = (id: string) => content.locomotives.find((d) => d.id === id)!;
const wagon = (id: string) => content.wagons.find((d) => d.id === id)!;

describe('gauge access', () => {
  it('keeps narrow stock on narrow track and regular stock off it', () => {
    expect(gaugeOf(loco('mk48'))).toBe('narrow');
    expect(vehicleAccess(loco('mk48'), 'narrow')).toBeNull();
    expect(vehicleAccess(loco('mk48'), 'regular')).not.toBeNull();
    expect(vehicleAccess(loco('f7'), 'narrow')).not.toBeNull();
    expect(vehicleAccess(wagon('mine_tub'), 'narrow')).toBeNull();
    expect(vehicleAccess(wagon('boxcar'), 'narrow')).not.toBeNull();
  });

  it('no longer bars large stock from regular track', () => {
    const large = content.locomotives.find((d) => d.size === 'large')!;
    expect(vehicleAccess(large, 'regular')).toBeNull();
  });

  it('says which track a vehicle runs on', () => {
    const large = content.locomotives.find((d) => d.size === 'large' && d.gauge !== 'narrow')!;
    expect(runsOn(large)).toBe('Runs on wide and high-speed track');
    expect(runsOn(wagon('boxcar'))).toBe('Runs on wide and high-speed track');
    expect(runsOn(loco('mk48'))).toBe('Runs on narrow track');
    expect(runsOn(wagon('mine_tub'))).toBe('Runs on narrow track');
  });

  it('names a consist of two gauges as mixed', () => {
    expect(consistGauge([loco('mk48'), wagon('mine_tub')])).toBe('narrow');
    expect(consistGauge([loco('f7'), wagon('boxcar')])).toBe('regular');
    expect(consistGauge([loco('mk48'), wagon('boxcar')])).toBe('mixed');
    expect(consistGauge([])).toBeNull();
    expect(consistAccess([loco('mk48'), wagon('boxcar')]).classes.size).toBe(0);
  });

  it('lets each gauge use its own axis of a mixed crossing', () => {
    const x = makePiece('crossing', 0, 'narrow', 'regular');
    expect(pieceClassFor(x, Dir.N)).toBe('narrow');
    expect(pieceClassFor(x, Dir.E)).toBe('regular');
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
