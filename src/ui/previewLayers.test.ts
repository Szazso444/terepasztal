import { describe, it, expect } from 'vitest';
import { locoFrame, wagonFrame } from '../art/frames';
import { content } from '../data/content';
import { DRAWN_FACINGS, FACINGS, mirrorFacing, vehicleSpec } from '../sim/body';
import { previewLayers } from './previewLayers';

describe('item pictures', () => {
  it('draw narrow stock from its own narrow frames', () => {
    // the atlas holds narrow stock only under `_n` names, like the generators write it
    const atlas = {
      has: (k: string) => /^rolling\/(loco|wagon)_.*_n_/.test(k) || /_n_f\d+$/.test(k),
    };
    const narrow = [...content.locomotives, ...content.wagons].filter((d) => d.gauge === 'narrow');
    expect(narrow.length).toBeGreaterThan(0);
    for (const d of narrow) {
      const keys = previewLayers(atlas, d.id, 0).map((l) => l.key);
      const missing = keys.filter((k) => !atlas.has(k));
      expect(missing, d.id).toEqual([]);
    }
  });

  // Inspect 3D turns through these: a turn of a model shows the frames a train draws on the map
  it('turn through the body frames the train renderer picks for that heading', () => {
    const atlas = { has: () => true };
    const body = (id: string, part: string, f: number) => {
      const loco = content.locomotives.find((l) => l.id === id);
      const wagon = content.wagons.find((w) => w.id === id);
      return loco ? locoFrame(atlas, loco, f, part as 'body') : wagonFrame(atlas, wagon!, f);
    };
    for (const d of [...content.locomotives, ...content.wagons]) {
      const spec = vehicleSpec(d);
      if (spec.segments.length > 1 || spec.drawBogies) continue;
      for (let f = 0; f < FACINGS; f++) {
        const [layer] = previewLayers(atlas, d.id, f);
        const drawn = DRAWN_FACINGS.has(f);
        expect(layer.flip, d.id).toBe(!drawn);
        expect(layer.key, d.id).toBe(body(d.id, 'body', drawn ? f : mirrorFacing(f)));
      }
    }
  });

  it('draw a vehicle on bogies from the body frame the renderer picks, with its trucks', () => {
    const atlas = { has: () => true };
    const d = content.locomotives.find(
      (l) => vehicleSpec(l).segments.length === 1 && vehicleSpec(l).drawBogies,
    )!;
    const keys = previewLayers(atlas, d.id, 0).map((l) => l.key);
    expect(keys).toContain(locoFrame(atlas, d, 0, vehicleSpec(d).segments[0].part));
    expect(keys.length).toBeGreaterThan(1);
  });
});
