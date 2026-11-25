import { describe, expect, it } from 'vitest';
import { Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { Camera } from '../engine/camera';
import { hash2, Rng } from '../engine/rng';
import { tileToWorld } from '../engine/iso';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain, type GameMap } from '../world/tiles';
import { multiplyTint } from './atmosphere';
import { viewTileRows, WorldRenderer } from './worldRenderer';

const SOURCE = new TextureSource({ width: 256, height: 256 });
const ANY: FrameInfo = {
  image: undefined as never,
  texture: new Texture({ source: SOURCE, frame: new Rectangle(0, 0, 64, 32) }),
  anchorX: 0.5,
  anchorY: 0.9,
  w: 64,
  h: 32,
};
const ATLAS = { has: () => true, get: () => ANY } as unknown as AtlasRegistry;

/** A whole world renderer over `map`; under Node its landscape is off and the tiles stand in. */
const world = (map: GameMap) => new WorldRenderer(ATLAS, map, new RegionState(map));

const NIGHT = 0x5c6bad;

describe('the atmosphere over the objects (#555)', () => {
  it('reaches what is built after the night fell, and leaves when the day comes', () => {
    const map = emptyMap(3, 24, 24, Terrain.Grass);
    map.props.set(5 * 24 + 5, [{ kind: 'oak', variant: 0, ox: 0, oy: 0 }]);
    const w = world(map);
    const tree = (w as unknown as { propSprites: Map<number, Sprite[]> }).propSprites.get(
      5 * 24 + 5,
    )![0];
    w.setAtmosphereTint(NIGHT);
    expect(tree.tint).toBe(NIGHT);
    // a structure put up at night
    const built = w.setStructure('warn:1', 8, 8, 'fx/warn');
    w.setAtmosphereTint(NIGHT);
    expect(built.tint).toBe(NIGHT);
    // a season that turns at night: its tint shows under the night's
    w.setSeasonTint(0xffeecc, 0xccddaa);
    expect(tree.tint).toBe(multiplyTint(0xccddaa, NIGHT));
    w.setAtmosphereTint(NIGHT);
    expect(tree.tint).toBe(multiplyTint(0xccddaa, NIGHT));
    // day: each object is back at its own tint
    w.setAtmosphereTint(0xffffff);
    expect(tree.tint).toBe(0xccddaa);
    expect(built.tint).toBe(0xffffff);
  });
});

describe('viewTileRows', () => {
  it('holds every tile whose centre lies in the view, row by row, as a scan of the map did', () => {
    const rng = new Rng(11);
    for (let n = 0; n < 300; n++) {
      const w = rng.int(1, 90),
        h = rng.int(1, 90),
        margin = rng.chance(0.5) ? 20 : rng.range(0, 40);
      const view = {
        x: rng.range(-90 * 32, 90 * 32),
        y: rng.range(-400, 180 * 16),
        w: rng.range(0, 2000),
        h: rng.range(0, 1200),
      };
      const inView = (x: number, y: number) => {
        const p = tileToWorld(x, y);
        return !(
          p.x < view.x - margin ||
          p.x > view.x + view.w + margin ||
          p.y < view.y - margin ||
          p.y > view.y + view.h + margin
        );
      };
      const scan: number[] = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) if (inView(x, y)) scan.push(y * w + x);
      const rows = viewTileRows(view, margin, w, h),
        walked: number[] = [];
      for (let y = rows.y0; y <= rows.y1; y++)
        for (let x = rows.x0(y), x1 = rows.x1(y); x <= x1; x++) {
          expect(x >= 0 && x < w && y >= 0 && y < h).toBe(true);
          if (inView(x, y)) walked.push(y * w + x);
        }
      expect(walked).toEqual(scan);
    }
  });
});

describe('water ripples (#555)', () => {
  it('draws the ripples of the water in view, as the scan of the whole map did', () => {
    const map = emptyMap(5, 64, 64, Terrain.Water);
    const w = world(map),
      camera = new Camera();
    // the still water's glints alone; moving water draws more over them
    w.movingWater = false;
    camera.setMapSize(64, 64);
    camera.viewW = 800;
    camera.viewH = 500;
    for (const [x, y, zoomIndex] of [
      [0, 1000, 2],
      [-600, 600, 4],
      [900, 1500, 0],
      [0, -100, 3],
    ]) {
      camera.zoomIndex = zoomIndex;
      camera.zoom = camera.targetZoom;
      camera.x = x;
      camera.y = y;
      // applyCamera reads the device pixel ratio
      (globalThis as { window?: unknown }).window ??= { devicePixelRatio: 1 };
      w.applyCamera(camera);
      w.animate(0.2);
      const view = camera.viewRect();
      let want = 0;
      for (let ty = 0; ty < map.h; ty++)
        for (let tx = 0; tx < map.w; tx++) {
          if (hash2(tx + map.originX, ty + map.originY, map.seed + 95) > 0.28) continue;
          const p = tileToWorld(tx, ty);
          if (
            p.x < view.x - 20 ||
            p.x > view.x + view.w + 20 ||
            p.y < view.y - 20 ||
            p.y > view.y + view.h + 20
          )
            continue;
          want++;
        }
      const drawn = (w as unknown as { waterDetails: { context: { instructions: unknown[] } } })
        .waterDetails.context.instructions.length;
      expect(drawn).toBe(want);
    }
  });
});
