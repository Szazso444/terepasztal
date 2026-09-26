import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import { bogieFrame, bogieStyleOf, locoFrame, wagonFrame } from './frames';

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
  const loco = content.locomotives[0];
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
