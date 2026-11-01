import { afterEach, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({
  Texture: class {
    destroy() {}
  },
  ImageSource: class {
    destroy() {}
  },
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

it("loads a vehicle's own pages only when it is wanted, and releases them unused", async () => {
  vi.stubGlobal(
    'Image',
    class {
      onload?: () => void;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const frame = { x: 0, y: 0, w: 8, h: 8, ax: 4, ay: 4 };
  const files: Record<string, object> = {
    '/assets/rolling.json': {
      resolution: 2,
      partial: true,
      frames: { 'rolling/loco_m62_body_f0': frame, 'rolling/bogie_x_f0': frame },
      vehicles: { loco_m62: ['rolling-loco_m62-1'], loco_tgv: ['rolling-loco_tgv-1'] },
    },
    '/assets/rolling-loco_m62-1.json': {
      resolution: 2,
      frames: { 'rolling/loco_m62_body_f0': frame, 'rolling/loco_m62_body_f1': frame },
    },
  };
  const fetchMock = vi.fn(async (url: string) => ({
    ok: url in files,
    headers: { get: () => 'application/json' },
    json: async () => files[url],
  }));
  vi.stubGlobal('fetch', fetchMock);
  const atlas = new AtlasRegistry();
  await atlas.load([
    { name: 'rolling', generate: () => ({ image: {} as HTMLImageElement, frames: {} }) },
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(atlas.has('rolling/loco_m62_body_f0')).toBe(true); // the resident preview copy
  expect(atlas.has('rolling/loco_m62_body_f1')).toBe(false);
  expect(atlas.want(null)).toBe(true);
  expect(atlas.want('rolling/wagon_procedural')).toBe(true);
  const before = atlas.framesVersion;
  expect(atlas.want('rolling/loco_m62')).toBe(false);
  await atlas.idle();
  expect(atlas.want('rolling/loco_m62')).toBe(true);
  expect(atlas.has('rolling/loco_m62_body_f1')).toBe(true);
  const loaded = atlas.framesVersion;
  expect(loaded).toBeGreaterThan(before);
  expect(atlas.loadedVehicles()).toEqual(['rolling/loco_m62']);
  // a vehicle whose pages are missing stays not ready (nothing of it is drawn)
  expect(atlas.want('rolling/loco_tgv')).toBe(false);
  await atlas.idle();
  expect(atlas.want('rolling/loco_tgv')).toBe(false);
  expect(atlas.framesVersion).toBe(loaded); // pages that failed add no frame
  atlas.sweep(performance.now() + 60000);
  expect(atlas.loadedVehicles()).toEqual([]);
  expect(atlas.framesVersion).toBeGreaterThan(loaded);
  expect(atlas.has('rolling/loco_m62_body_f1')).toBe(false);
  expect(atlas.has('rolling/loco_m62_body_f0')).toBe(true);
  expect(atlas.want('rolling/loco_m62')).toBe(false);
});

it('loads a page as WebP when its frames file says so', async () => {
  const sources: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      onload?: () => void;
      set src(value: string) {
        sources.push(value);
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const frame = { x: 0, y: 0, w: 8, h: 8, ax: 4, ay: 4 };
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ format: 'webp', frames: { 'rolling/a': frame } }),
  }));
  const atlas = new AtlasRegistry();
  await atlas.load([
    { name: 'rolling', generate: () => ({ image: {} as HTMLImageElement, frames: {} }) },
  ]);
  expect(sources).toEqual(['/assets/rolling.webp']);
  expect(atlas.has('rolling/a')).toBe(true);
});
