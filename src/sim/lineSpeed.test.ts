import { describe, it, expect, beforeEach } from 'vitest';
import { Dir } from '../engine/iso';
import { content } from '../data/content';
import { simWorld } from '../testing/simWorld';
import { Station } from './stations';
import { Train, type TickCtx } from './trains';
import { lineSpeedCap, approachCap } from './lineSpeed';
import { rules, DEFAULT_RULES } from './rules';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

describe('line speed', () => {
  it('caps Branch Line and Narrow Gauge, never the bigger lines', () => {
    for (const cls of ['main', 'trunk', 'maglev', 'hyperloop'] as const)
      expect(lineSpeedCap(cls), cls).toBe(Infinity);
    expect(lineSpeedCap('branch')).toBeCloseTo(2.0 * rules.trainSpeedMul);
    expect(lineSpeedCap('narrow')).toBeCloseTo(1.2 * rules.trainSpeedMul);
    expect(lineSpeedCap('narrow')).toBeLessThan(lineSpeedCap('branch'));
  });

  it('brakes towards a lower cap ahead and holds it once there', () => {
    expect(approachCap(1, 0, 1.5)).toBe(1);
    expect(approachCap(1, -0.3, 1.5)).toBe(1);
    const far = approachCap(1, 5, 1.5);
    expect(far).toBeGreaterThan(1);
    expect(approachCap(1, 2, 1.5)).toBeLessThan(far);
  });

  it('follows the tuning values', () => {
    rules.lineSpeedBranch = 3;
    expect(lineSpeedCap('branch')).toBeCloseTo(3 * rules.trainSpeedMul);
  });
});
describe('line speed on degraded track', () => {
  /** A lone f7 running west along a Branch line, tiles 30 to 55 of it worn to this health share. */
  function run(health: number) {
    const w = simWorld({ terrain: 'grass', size: 96 });
    for (let x = 2; x < 94; x++) w.track.place(x, 20, 'straight', 1, 'branch');
    for (let x = 30; x <= 55; x++) w.track.get(x, 20)!.wear.health = health;
    const t = new Train([
      { uid: 1, level: 0, def: content.locomotives.find((d) => d.id === 'f7')! },
    ]);
    t.spawnAt(w.track, 90, 20, Dir.W);
    const st = new Station('quarry', 4, 19);
    w.builder.stations.push(st);
    t.route = [st.id];
    t.oil = t.oilCap;
    w.fleet.trains.push(t);
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    const ctx = (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
    t.onPathReady(ctx);
    const at: [number, number][] = [];
    for (let i = 0; i < 20 * 120 && t.headTile!.x > 20; i++) {
      t.tick(0.05, ctx);
      at.push([t.headTile!.x, t.speed]);
    }
    return { t, at, w };
  }
  const fastest = (at: [number, number][], from: number, to: number) =>
    Math.max(...at.filter(([x]) => x >= from && x <= to).map(([, v]) => v));

  it('brakes for a degraded piece ahead and runs it at 0.6 of its top speed', () => {
    const sound = run(1);
    const worn = run(0.2);
    const limit = worn.t.maxSpeed * rules.trackDegradedSpeed;
    // sound track: the train runs faster than the degraded limit
    expect(fastest(sound.at, 60, 85)).toBeGreaterThan(limit * 1.05);
    expect(fastest(sound.at, 35, 50)).toBeGreaterThan(limit * 1.05);
    // worn track: it is at the limit by the second worn piece, and holds it to the last
    expect(fastest(worn.at, 54, 54)).toBeLessThanOrEqual(limit * 1.02);
    expect(fastest(worn.at, 35, 53)).toBeCloseTo(limit, 3);
    // and it picks the pace up again past the worn stretch
    expect(fastest(worn.at, 21, 28)).toBeGreaterThan(limit * 1.05);
  });

  it('follows the degraded speed tuning value', () => {
    rules.trackDegradedSpeed = 0.3;
    const worn = run(0.2);
    expect(fastest(worn.at, 35, 54)).toBeCloseTo(worn.t.maxSpeed * 0.3, 3);
  });
});
