import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import { bogieFrame, locoFrame, wagonFrame } from './frames';

const atlas = (...keys: string[]) => ({ has: (k: string) => keys.includes(k) });

describe('bogieFrame', () => {
  it("uses a vehicle's own style, drawn for its part where there is one", () => {
    const a = atlas('rolling/bogie_steam_engine_f3', 'rolling/bogie_steam_f3');
    expect(bogieFrame(a, 'steam', 'bogie', 'engine', 3)).toBe('rolling/bogie_steam_engine_f3');
    expect(bogieFrame(a, 'steam', 'bogie', 'tender', 3)).toBe('rolling/bogie_steam_f3');
  });

  it('falls back to the generic truck of the same kind', () => {
    // a style drawn for one kind or facing never stands in for another
    const a = atlas('rolling/bogie_emd_f3', 'rolling/bogie_emd_body_f3');
    expect(bogieFrame(a, 'emd', 'bogie3', 'body', 3)).toBe('rolling/bogie3_f3');
    expect(bogieFrame(a, 'emd', 'bogie', 'body', 4)).toBe('rolling/bogie_f4');
    expect(bogieFrame(a, undefined, 'bogie', 'body', 3)).toBe('rolling/bogie_f3');
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
