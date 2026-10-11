import { describe, expect, it } from 'vitest';
import {
  bridgeQuads,
  bridgeTile,
  deckTop,
  project,
  SLAB,
  WATER_DROP,
  type BridgeDeck,
  type BridgeQuad,
  type BridgeTile,
  type GroundAt,
} from './bridgeGeometry';
import { lineSpans, railLevel, type RailBed } from '../world/railProfile';
import SWATCHES from '../art/bridgeSwatches.json';

const STEP = 9.8;
const flatGround: GroundAt = () => 0;

/** Platforms along x at row `y`, their decks at `levels`, straight track over all of them. */
function line(levels: number[], y = 5, x0 = 10, material: 'stone' | 'wood' = 'stone') {
  const { spans, levels: rail } = lineSpans(levels, [], x0),
    decks = new Map<string, BridgeDeck>();
  levels.forEach((_, i) => {
    const c = x0 + i,
      near = spans.filter((s) => s.to > c - 1.5 && s.from < c + 1.5),
      close = near.filter((s) => s.to > c - 0.9 && s.from < c + 0.9),
      bed: RailBed = {
        axis: 'x',
        spans: near,
        bridge: true,
        flat: close.every((s) => s.a === s.b && s.a === rail[i]),
      };
    decks.set(`${c},${y}`, {
      x: c,
      y,
      material,
      step: STEP,
      deck: rail[i],
      bed,
      rails: [1, 3],
      level: 1,
      water: false,
    });
  });
  return decks;
}
const tiles = (decks: Map<string, BridgeDeck>) =>
  [...decks.values()].map((d) => bridgeTile(d, (x, y) => decks.get(`${x},${y}`)));
const corners = (q: BridgeQuad) =>
  [0, 1, 2, 3].map((i) => ({ x: q.p[i * 3], y: q.p[i * 3 + 1], z: q.p[i * 3 + 2] }));
const all = (t: BridgeTile, ground = flatGround) => {
  const q = bridgeQuads(t, ground);
  return [...q.sunk, ...q.body, ...q.near];
};
/** A bare platform: no track, deck at `deck` levels. */
const bare = (x: number, y: number, deck: number, more: Partial<BridgeDeck> = {}): BridgeDeck => ({
  x,
  y,
  material: 'stone',
  step: STEP,
  deck,
  level: 1,
  water: false,
  ...more,
});

describe('bridge geometry', () => {
  it('puts the deck top at the rail height, also where the rail climbs', () => {
    for (const t of tiles(line([0, 1, 2, 3, 3, 2, 1, 0]))) {
      const tops = bridgeQuads(t, flatGround).body.filter((q) => /(stone|wood)-top$/.test(q.key));
      expect(tops.length).toBe(t.bed!.flat ? 1 : 8);
      for (const q of tops)
        for (const c of corners(q)) expect(c.z).toBe(railLevel(t.bed!, c.x) * STEP);
    }
  });

  it('shares its edge vertices with the next tile exactly', () => {
    const list = tiles(line([0, 1, 2, 2, 1, 1, 0]));
    for (let i = 0; i + 1 < list.length; i++) {
      const edge = list[i].x + 0.5,
        at = (t: BridgeTile) => {
          const found = new Map<string, number>();
          for (const q of all(t))
            for (const c of corners(q))
              if (c.x === edge && Math.abs(c.y - t.y) === 0.5 && /-(top|parapet-[lr])$/.test(q.key))
                found.set(`${q.key.replace(/^.*-/, '')}@${c.y}:${c.z}`, c.z);
          return [...found.keys()].sort();
        };
      // Deck corners and parapet ends on the joint: the same points from both sides.
      expect(at(list[i])).toEqual(at(list[i + 1]));
      expect(at(list[i]).length).toBeGreaterThan(0);
    }
  });

  it('draws every level edge at exactly two to one', () => {
    const [t] = tiles(line([2]));
    for (const q of all(t)) {
      const c = corners(q).map((p) => project(p.x, p.y, p.z));
      for (let i = 0; i < 4; i++) {
        const a = corners(q)[i],
          b = corners(q)[(i + 1) % 4],
          [ax, ay] = c[i],
          [bx, by] = c[(i + 1) % 4];
        if (a.z !== b.z || (a.x === b.x && a.y === b.y)) continue;
        // A level edge runs along one tile axis: 32 across for 16 down, either way.
        expect(Math.abs(by - ay) / Math.abs(bx - ax)).toBe(0.5);
      }
    }
  });

  it('ends every wall and leg on the ground, with nothing below it', () => {
    // A valley floor that rises toward the east, one level per tile.
    const ground = (x: number) => Math.max(0, Math.min(2, x - 11)) * STEP;
    for (const material of ['stone', 'wood'] as const) {
      let feet = 0;
      for (const t of tiles(line([3, 3, 3, 3], 5, 10, material))) {
        const q = bridgeQuads(t, ground);
        expect(q.sunk).toEqual([]);
        for (const quad of [...q.body, ...q.near]) {
          const onDeck = /-(top|parapet-[lr])$/.test(quad.key);
          for (const c of corners(quad)) {
            if (onDeck) expect(c.z).toBeGreaterThanOrEqual(deckTop(t, c.x, c.y) - 1e-9);
            else expect(c.z).toBeGreaterThanOrEqual(ground(c.x) - 1e-3);
            if (/-leg-/.test(quad.key) && Math.abs(c.z - ground(c.x)) < 1e-3) feet++;
          }
          for (const v of quad.uv) {
            expect(v).toBeGreaterThanOrEqual(-1e-9);
            expect(v).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      }
      expect(feet).toBeGreaterThan(0);
    }
  });

  it('fences a curve pad around its outside only', () => {
    // A 2x2 pad: track enters from the west on the lower row and leaves north on the right column.
    const decks = new Map<string, BridgeDeck>();
    const pad = (x: number, y: number, rails: number[]) =>
      decks.set(`${x},${y}`, bare(x, y, 2, { rails }));
    pad(4, 4, []);
    pad(5, 4, [0, 2]);
    pad(4, 5, [3, 1]);
    pad(5, 5, [3, 0]);
    const where = Object.fromEntries(
      tiles(decks).map((t) => [
        `${t.x},${t.y}`,
        t.edges.map((e, i) => (e.parapet ? 'NESW'[i] : '')).join(''),
      ]),
    );
    expect(where).toEqual({ '4,4': 'NW', '5,4': 'E', '4,5': 'S', '5,5': 'ES' });
    // Inside the pad no edge shows a slab side either.
    const inner = tiles(decks).find((t) => t.x === 4 && t.y === 4)!;
    expect(inner.edges[1].wall).toBe(false);
    expect(inner.edges[2].wall).toBe(false);
  });

  it('makes one double deck of two decks side by side at one height', () => {
    const decks = new Map([...line([2, 2], 5), ...line([2, 2], 6)]),
      list = tiles(decks),
      north = list.find((t) => t.y === 5)!,
      south = list.find((t) => t.y === 6)!;
    expect(north.edges.map((e) => e.parapet)).toEqual([true, false, false, false]);
    expect(south.edges.map((e) => e.parapet)).toEqual([false, false, true, false]);
    expect(bridgeQuads(north, flatGround).near).toEqual([]);
    // At different heights each keeps its own parapets, and the higher shows its side.
    const stepped = new Map([...line([2, 2], 5), ...line([1, 1], 6)]),
      high = tiles(stepped).find((t) => t.y === 5)!;
    expect(high.edges[2]).toMatchObject({ parapet: true, wall: true });
    expect(tiles(stepped).find((t) => t.y === 6)!.edges[0]).toMatchObject({
      parapet: true,
      wall: false,
    });
  });

  it('closes a raised end with a face down to the ground', () => {
    // The rail stops on the deck: the east end stands two levels above flat ground.
    const [, end] = tiles(line([2, 2]));
    expect(end.edges[1]).toMatchObject({ rail: true, parapet: false, wall: true });
    const onEnd = (q: BridgeQuad) =>
        !q.key.includes('parapet') && corners(q).every((c) => c.x === end.x + 0.5),
      east = all(end).filter(onEnd);
    expect(east.some((q) => q.key.endsWith('edge-r'))).toBe(true);
    const zs = east.flatMap((q) => corners(q).map((c) => c.z));
    expect(Math.max(...zs)).toBe(2 * STEP);
    expect(Math.min(...zs)).toBe(0);
    // Against a bank as high as the deck nothing of the end shows.
    const buried = all(end, (x) => (x >= end.x + 0.5 ? 2 * STEP : 0)).filter(onEnd);
    expect(buried).toEqual([]);
  });

  it('stands in water: what is below the water plane is listed apart', () => {
    for (const material of ['stone', 'wood'] as const)
      for (const deck of [0, 1, 3]) {
        const t = bridgeTile(
            bare(7, 7, deck, { water: true, material, rails: [1, 3] }),
            () => undefined,
          ),
          q = bridgeQuads(t, () => 0),
          floor = -WATER_DROP * STEP;
        expect(q.sunk.length).toBeGreaterThan(0);
        for (const quad of q.sunk)
          for (const c of corners(quad)) {
            expect(c.z).toBeLessThanOrEqual(1e-9);
            expect(c.z).toBeGreaterThanOrEqual(floor - 1e-9);
          }
        for (const quad of [...q.body, ...q.near])
          for (const c of corners(quad)) expect(c.z).toBeGreaterThanOrEqual(-1e-9);
        // The slab itself never goes under: its top is the deck.
        expect(deck * STEP - SLAB).toBeLessThan(deck * STEP);
      }
  });

  it('uses only swatches the atlas group carries', () => {
    const known = new Set(Object.keys(SWATCHES.swatches));
    for (const material of ['stone', 'wood'] as const)
      for (const water of [false, true]) {
        const decks = line([0, 1, 3, 3], 5, 10, material);
        for (const d of decks.values()) {
          d.water = water;
          d.level = 3;
        }
        for (const t of tiles(decks))
          for (const q of all(t)) expect(known.has(q.key), q.key).toBe(true);
      }
  });
});
