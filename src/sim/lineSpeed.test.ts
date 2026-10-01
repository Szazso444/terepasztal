import { describe, it, expect, beforeEach } from 'vitest';
import { lineSpeedCap, approachCap } from './lineSpeed';
import { rules, DEFAULT_RULES } from './rules';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

describe('line speed', () => {
  it('caps regular and narrow track, never high speed', () => {
    expect(lineSpeedCap('high_speed')).toBe(Infinity);
    expect(lineSpeedCap('regular')).toBeCloseTo(2.0 * rules.trainSpeedMul);
    expect(lineSpeedCap('narrow')).toBeCloseTo(1.2 * rules.trainSpeedMul);
    expect(lineSpeedCap('narrow')).toBeLessThan(lineSpeedCap('regular'));
  });

  it('brakes towards a lower cap ahead and holds it once there', () => {
    expect(approachCap(1, 0, 1.5)).toBe(1);
    expect(approachCap(1, -0.3, 1.5)).toBe(1);
    const far = approachCap(1, 5, 1.5);
    expect(far).toBeGreaterThan(1);
    expect(approachCap(1, 2, 1.5)).toBeLessThan(far);
  });

  it('follows the tuning values', () => {
    rules.lineSpeedRegular = 3;
    expect(lineSpeedCap('regular')).toBeCloseTo(3 * rules.trainSpeedMul);
  });
});
