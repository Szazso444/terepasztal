import { describe, expect, it } from 'vitest';
import { content, type LocoDef } from './content';

/** The engines drawn from a rendered model that a player can still have. */
const engines = content.locomotives.filter((l) => l.spriteGear && l.retired !== true);

/**
 * Tiles ahead of the vehicle's middle of a point `along` tiles ahead of its part's centre. The
 * part is the one fx.ts finds: the first pose segment of that name, and segments run front first.
 */
function placeOn(l: LocoDef, part: string, along: number) {
  const L = l.lengthTiles!;
  const parts = [...l.gear!.parts].sort((a, b) => b.to - a.to);
  const p = parts.find((g) => g.part === part);
  if (!p) return null;
  return ((p.from + p.to) / 2 - 0.5) * L + along;
}

describe('where a rendered engine smokes and shines', () => {
  it('finds rendered engines of every traction', () => {
    expect(new Set(engines.map((l) => l.type))).toEqual(new Set(['steam', 'diesel', 'electric']));
  });

  it.each(engines.filter((l) => l.type !== 'electric').map((l) => [l.id, l] as const))(
    '%s has a smoke outlet',
    (_, l) => {
      expect(l.smoke?.length).toBeGreaterThan(0);
    },
  );

  it.each(engines.filter((l) => l.type === 'electric').map((l) => [l.id, l] as const))(
    '%s, on the wire, has none',
    (_, l) => {
      expect(l.smoke ?? []).toEqual([]);
    },
  );

  it.each(engines.map((l) => [l.id, l] as const))('%s has one to three lamps', (_, l) => {
    expect(l.lamps?.length).toBeGreaterThan(0);
    expect(l.lamps?.length).toBeLessThanOrEqual(3);
  });

  it.each(engines.map((l) => [l.id, l] as const))(
    "%s has each point on a part of its gear, within the vehicle's length and above the rail",
    (_, l) => {
      for (const p of [...(l.smoke ?? []), ...(l.lamps ?? [])]) {
        const at = placeOn(l, p.part, p.along);
        expect(at, `${p.part} is a part of its gear`).not.toBeNull();
        expect(Math.abs(at!)).toBeLessThanOrEqual(l.lengthTiles! / 2);
        expect(p.up).toBeGreaterThan(0);
      }
    },
  );

  it.each(engines.map((l) => [l.id, l] as const))('%s carries its lamps on its nose', (_, l) => {
    for (const p of l.lamps ?? []) {
      expect(p.part).not.toBe('tender');
      expect(p.part).not.toBe('rear');
      expect(placeOn(l, p.part, p.along)).toBeGreaterThan(0.3 * l.lengthTiles!);
    }
  });
});
