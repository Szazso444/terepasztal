import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
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
});
