import { describe, expect, it } from 'vitest';
import GROUND from './buildingGround.json';
import { groundFrames, groundOf } from './buildingGround';

/**
 * The reader of the building ground data (tools/building-ground.mjs writes the file). It casts the
 * JSON to its own types, so nothing but these tests says the file still has the shape the types
 * promise. The measurement itself is tested in tools/building-ground.test.mjs.
 */

const FILE = (GROUND as unknown as { frames: Record<string, Record<string, unknown>> }).frames;
const KEYS = Object.keys(FILE).sort();

const isNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isPoint = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNumber);
const keysOf = (v: unknown) => Object.keys(v as object).sort();

describe('the ground data reader', () => {
  it('lists every frame of the file, once, and gives each its own entry', () => {
    expect(KEYS.length).toBeGreaterThan(300);
    expect([...groundFrames()].sort()).toEqual(KEYS);
    expect(new Set(groundFrames()).size).toBe(KEYS.length);
    for (const key of KEYS) expect(groundOf(key), key).toBe(FILE[key]);
  });

  it('gives nothing for a frame that is not a building', () => {
    for (const key of [
      'structures/bridge_wood',
      'structures/signal',
      'props/tree_0',
      'rolling/loco_steam_std_small_iron_body_f0',
      'structures/farm_1_r4',
      'structures/',
      '',
    ])
      expect(groundOf(key), key).toBeUndefined();
  });

  it('gives nothing for a name every object has, as a frame key never is one', () => {
    // the file is a plain object: a lookup by key finds the names it inherits
    for (const key of Object.getOwnPropertyNames(Object.prototype).concat(['__proto__']))
      expect(groundOf(key), key).toBeUndefined();
  });

  it('keeps the shape the types promise, in every entry', () => {
    for (const key of KEYS) {
      const e = FILE[key];
      expect(keysOf(e), key).toEqual(
        ['baked', 'doors', 'fit', 'foot', 'footprint', 'front', 'rot', 'source'].sort(),
      );
      expect(['generated', 'illustrated'], key).toContain(e.source);
      expect([0, 1, 2, 3], key).toContain(e.rot);
      expect(['walls', 'outline'], key).toContain(e.fit);
      expect(isNumber(e.baked) && (e.baked as number) >= 0, `${key} baked`).toBe(true);

      const footprint = e.footprint as unknown[];
      expect(footprint.length, key).toBeGreaterThan(0);
      expect(footprint.every(isPoint), `${key} footprint`).toBe(true);

      const foot = e.foot as unknown[];
      expect(foot, key).toHaveLength(4);
      expect(foot.every(isPoint), `${key} foot`).toBe(true);

      const front = e.front as { side: unknown; edge: unknown; visible: unknown };
      expect(keysOf(front), key).toEqual(['edge', 'side', 'visible']);
      expect(['N', 'E', 'S', 'W'], key).toContain(front.side);
      expect(typeof front.visible, key).toBe('boolean');
      expect(front.edge as unknown[], key).toHaveLength(2);
      expect((front.edge as unknown[]).every(isPoint), `${key} front edge`).toBe(true);

      for (const door of e.doors as Record<string, unknown>[]) {
        expect(keysOf(door), key).toEqual(
          ['kind', 'offset', 'point', 'reach', 'side', 'tile', 'width'].sort(),
        );
        expect(['street', 'platform'], key).toContain(door.kind);
        expect(['N', 'E', 'S', 'W'], key).toContain(door.side);
        expect(isPoint(door.tile) && isPoint(door.reach) && isPoint(door.point), key).toBe(true);
        expect(isNumber(door.width) && isNumber(door.offset), key).toBe(true);
      }
    }
  });
});
