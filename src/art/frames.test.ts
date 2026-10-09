import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import {
  bogieFrame,
  bogieStyleOf,
  locoFrame,
  wagonFrame,
  loadFrame,
  structureFrame,
} from './frames';
import { pieceFrame, makePiece, TrackGraph } from '../world/track';

const atlas = (...keys: string[]) => ({ has: (k: string) => keys.includes(k) });

describe('bogie styles', () => {
  it('take one style for every bogie, or one per part and position', () => {
    expect(bogieStyleOf('blomberg', 'body', 1)).toBe('blomberg');
    const steam = { engine: ['leading', 'pacific'], tender: 'tender_truck' };
    expect(bogieStyleOf(steam, 'engine', 0)).toBe('leading');
    expect(bogieStyleOf(steam, 'engine', 1)).toBe('pacific');
    expect(bogieStyleOf(steam, 'tender', 1)).toBe('tender_truck');
    // a part the style does not name keeps the generic truck; a short list repeats its last entry
    expect(bogieStyleOf(steam, 'cradle', 0)).toBeUndefined();
    expect(bogieStyleOf({ body: ['a', 'b'] }, 'body', 2)).toBe('b');
    expect(bogieStyleOf(undefined, 'body', 0)).toBeUndefined();
  });

  it("draw the style's own sprite when the atlas has it, else the generic truck of that kind", () => {
    const a = atlas('rolling/bogie_pacific_f3');
    expect(bogieFrame(a, 'pacific', 'bogie', 3)).toBe('rolling/bogie_pacific_f3');
    // a style is one sprite whatever the kind: the pony truck serves a 2- and a 3-axle chassis
    expect(bogieFrame(a, 'pacific', 'bogie3', 3)).toBe('rolling/bogie_pacific_f3');
    expect(bogieFrame(a, 'pacific', 'bogie4', 4)).toBe('rolling/bogie4_f4');
    expect(bogieFrame(a, undefined, 'bogie3', 3)).toBe('rolling/bogie3_f3');
  });
});

describe('prototype frames', () => {
  const loco = content.locomotives.find((l) => l.gauge !== 'narrow')!;
  const wagon = content.wagons[0];

  it("prefer the prototype's own sprite and fall back to its body", () => {
    const own = `rolling/loco_${loco.id}_body_f2`;
    const body = `rolling/loco_${loco.body}_${loco.size ?? 'small'}_${loco.paint}_body_f2`;
    expect(locoFrame(atlas(own, body), loco, 2)).toBe(own);
    expect(locoFrame(atlas(body), loco, 2)).toBe(body);
    const w = `rolling/wagon_${wagon.id}_f2`;
    expect(wagonFrame(atlas(w), wagon, 2)).toBe(w);
  });

  it('never name a prototype like a body the generators draw', () => {
    // loco_<id>_… and loco_<body>_<size>_<paint>_… share one namespace
    const bodies = new Set([
      ...content.locomotives.map((d) => `loco_${d.body}_${d.size ?? 'small'}_${d.paint}`),
      ...content.locomotives.map((d) => `loco_${d.body}_${d.size ?? 'small'}_iron`),
      ...content.wagons.map((d) => `wagon_${d.body}_${d.size ?? 'small'}_${d.paint}`),
      ...content.wagons.map((d) => `wagon_${d.body}_${d.size ?? 'small'}_iron`),
    ]);
    for (const d of content.locomotives) expect(bodies.has(`loco_${d.id}`)).toBe(false);
    for (const d of content.wagons) expect(bodies.has(`wagon_${d.id}`)).toBe(false);
  });
});

describe('track frames', () => {
  it('names the members of a parallel switch apart from a turning one', () => {
    const g = new TrackGraph(20, 20);
    g.place(4, 4, 'switch', 1, 'regular', undefined, 'parallel');
    expect(pieceFrame(g.get(4, 4)!)).toBe('track/switch_regular_1p_m0');
    g.place(10, 4, 'switch', 1, 'regular');
    expect(pieceFrame(g.get(10, 4)!)).toBe('track/switch_regular_1_m0');
    expect(pieceFrame(makePiece('curve', 2, 'narrow'))).toBe('track/curve_narrow_2');
    expect(pieceFrame(makePiece('crossing', 1, 'narrow', 'regular'))).toBe(
      'track/crossing_narrow_regular_1',
    );
  });
});

describe('narrow stock frames', () => {
  it('looks narrow stock up under its own frames', () => {
    const tub = content.wagons.find((w) => w.id === 'mine_tub')!;
    const key = 'rolling/wagon_hopper_tiny_n_iron_f2';
    expect(wagonFrame(atlas(key), tub, 2)).toBe(key);
    const rocket = content.locomotives.find((l) => l.id === 'rocket')!;
    const loco = `rolling/loco_${rocket.body}_small_n_${rocket.paint}_body_f2`;
    expect(locoFrame(atlas(loco), rocket, 2)).toBe(loco);
    expect(bogieFrame(atlas('rolling/bogie_n_f2'), undefined, 'bogie', 2, true)).toBe(
      'rolling/bogie_n_f2',
    );
    expect(bogieFrame(atlas('rolling/bogie_f2'), undefined, 'bogie', 2)).toBe('rolling/bogie_f2');
    expect(loadFrame('heap', 3, true)).toBe('rolling/load_heap_n_f3');
    expect(loadFrame('heap', 3, false)).toBe('rolling/load_heap_f3');
  });
});

describe('structure frames', () => {
  const key = 'structures/farm_2';
  const turned = atlas(`${key}_r1`, `${key}_r2`, `${key}_r3`);

  it('keep the unturned frame at rotation 0 and every full turn', () => {
    expect(structureFrame(turned, key, 0)).toBe(key);
    expect(structureFrame(turned, key, 4)).toBe(key);
    expect(structureFrame(turned, key, 8)).toBe(key);
  });

  it('take the turned frame when the atlas has it, else the unturned one', () => {
    for (const rot of [1, 2, 3]) expect(structureFrame(turned, key, rot)).toBe(`${key}_r${rot}`);
    expect(structureFrame(turned, key, 5)).toBe(`${key}_r1`);
    expect(structureFrame(atlas(`${key}_r2`), key, 1)).toBe(key);
    expect(structureFrame(atlas(), key, 3)).toBe(key);
    // a depot's frame already carries rot % 2: rot 2 asks for depot_r0's turn
    expect(structureFrame(atlas('structures/depot_r0_r2'), 'structures/depot_r0', 2)).toBe(
      'structures/depot_r0_r2',
    );
    expect(structureFrame(atlas('structures/depot_r1_r3'), 'structures/depot_r1', 1)).toBe(
      'structures/depot_r1',
    );
  });

  it('take a negative rotation mod 4', () => {
    expect(structureFrame(turned, key, -1)).toBe(`${key}_r3`);
    expect(structureFrame(turned, key, -2)).toBe(`${key}_r2`);
    expect(structureFrame(turned, key, -3)).toBe(`${key}_r1`);
    expect(structureFrame(turned, key, -4)).toBe(key);
    expect(structureFrame(atlas(), key, -1)).toBe(key);
  });
});
