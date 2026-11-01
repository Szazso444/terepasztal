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

describe('the night over ground objects built within a frame, after its atmosphere pass', () => {
  type Scatter = Map<number, { s: Sprite }[]>;
  const scatterOf = (w: WorldRenderer) =>
    (w as unknown as { scatterSprites: Scatter }).scatterSprites;
  /** A night world over open plains, with the tile that has the most scatter on it. */
  const night = () => {
    const w = world(emptyMap(3, 64, 64, Terrain.Grass));
    w.setAtmosphereTint(NIGHT);
    let at = -1;
    for (const [i, list] of scatterOf(w))
      if (at < 0 || list.length > scatterOf(w).get(at)!.length) at = i;
    expect(at, 'the plains hold some scatter').toBeGreaterThanOrEqual(0);
    return { w, x: at % 64, y: Math.floor(at / 64), at };
  };
  const sprites = (w: WorldRenderer) =>
    [...scatterOf(w).values()].flatMap((l) => l.map((o) => o.s));

  it('shows the night the moment the scatter is built, without another pass', () => {
    const { w, x, y } = night();
    const before = new Set(sprites(w));
    expect(before.size).toBeGreaterThan(0);
    // a station put up (a frame builds it after its pass) clears and builds the nature around it
    w.setStructure('station:1', x, y, 'fx/warn');
    const built = sprites(w).filter((s) => !before.has(s));
    expect(built.length, 'the nature around the station was built again').toBeGreaterThan(0);
    for (const s of built) expect(s.tint, 'drawn at the night colour').toBe(NIGHT);
  });

  it('builds no nature again for a marker, which the game sets again every half second', () => {
    const { w, x, y } = night();
    const before = new Set(sprites(w));
    for (let k = 0; k < 4; k++) {
      w.setStructure('notice:t1:route', x, y, 'structures/warn', 46, -40);
      w.setStructure('contract:dest', x + 1, y, 'structures/note', 46, -58);
    }
    w.removeStructure('notice:t1:route');
    w.removeStructure('contract:dest');
    expect(sprites(w).length).toBe(before.size);
    for (const s of sprites(w)) expect(before.has(s), 'the same sprite as before').toBe(true);
    // a building does clear and build it again
    w.setStructure('station:1', x, y, 'fx/warn');
    expect(sprites(w).some((s) => !before.has(s))).toBe(true);
  });

  it('turns the scatter with the season, as the props are', () => {
    const { w } = night();
    w.setSeasonTint(0xffeecc, 0xccddaa);
    for (const s of sprites(w)) expect(s.tint).toBe(multiplyTint(0xccddaa, NIGHT));
    w.setAtmosphereTint(0xffffff);
    for (const s of sprites(w)) expect(s.tint).toBe(0xccddaa);
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
