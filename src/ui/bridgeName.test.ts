import { describe, expect, it } from 'vitest';
import { STR } from '../strings';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { bridgeName, bridgeTitle, deckRise } from './bridgeName';

describe('a span is named by where it stands', () => {
  it('is a Bridge over water at height 0, and a Viaduct on land or once raised', () => {
    for (const material of ['wood', 'stone'] as const) {
      const bridge = STR.building.bridgeName(material, false),
        viaduct = STR.building.bridgeName(material, true);
      expect(bridgeName(material, true, 0)).toBe(bridge);
      expect(bridgeName(material, true, 1)).toBe(viaduct);
      expect(bridgeName(material, false, 0)).toBe(viaduct);
      expect(bridgeName(material, false, 3)).toBe(viaduct);
    }
  });

  it('keeps Wooden and Stone in the name', () => {
    expect(bridgeName('wood', true, 0)).toContain('Wooden');
    expect(bridgeName('stone', false, 0)).toContain('Stone');
  });

  it('counts the height from the water it crosses, so raised water is still a Bridge', () => {
    const map = emptyMap(5, 12, 12, Terrain.Water);
    map.waterSurface = new Uint8Array(144).fill(2);
    const at = { id: 'bridge_wood', x: 6, y: 6, acc: 0, active: false, rate: 0 };
    expect(deckRise(map, at)).toBe(0);
    expect(bridgeTitle(map, at, 'wood')).toBe(STR.building.bridgeName('wood', false));
    expect(bridgeTitle(map, { ...at, deck: 2 }, 'wood')).toBe(
      STR.building.bridgeName('wood', false),
    );
    expect(bridgeTitle(map, { ...at, deck: 3 }, 'wood')).toBe(
      STR.building.bridgeName('wood', true),
    );
  });
});
