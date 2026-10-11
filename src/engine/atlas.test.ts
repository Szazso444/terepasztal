import { afterEach, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({
  Texture: class {},
  ImageSource: class {},
  Rectangle: class {},
}));

import { AtlasRegistry } from './atlas';

afterEach(() => vi.unstubAllGlobals());

it('loads later fleet pages when a sprite group grows beyond sixteen pages', async () => {
  vi.stubGlobal(
    'Image',
    class {
      onload?: () => void;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({
      pages: url === '/assets/rolling.json' ? 17 : undefined,
      frames: {
        [url]: { x: 0, y: 0, w: 8, h: 8, ax: 4, ay: 4 },
      },
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  const atlas = new AtlasRegistry();
  const generate = vi.fn(() => {
    throw new Error('Valid file atlases must not fall back to procedural frames');
  });
  await atlas.load([{ name: 'rolling', generate }]);
  expect(fetchMock).toHaveBeenCalledTimes(17);
  expect(atlas.has('/assets/rolling-17.json')).toBe(true);
  expect(generate).not.toHaveBeenCalled();
});
