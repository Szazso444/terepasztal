import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { HALO_SECONDS } from './haloTimeline';
import { Halos } from './halo';

/** The three halo frames at their generated sizes and anchors, on blank textures. */
function fakeAtlas(): AtlasRegistry {
  const frames: Record<string, [number, number, number, number]> = {
    'fx/halo_ring': [64, 32, 0.5, 0.5],
    'fx/halo_beam': [40, 80, 0.5, 1],
    'fx/spark': [7, 7, 0.5, 0.5],
  };
  return {
    get(key: string): FrameInfo {
      const [w, h, anchorX, anchorY] = frames[key];
      const texture = new Texture({ source: new TextureSource({ width: w, height: h }) });
      return { image: null!, texture, anchorX, anchorY, w, h };
    },
  } as unknown as AtlasRegistry;
}
const flat = (x: number, y: number) => ({ x: (x - y) * 32, y: (x + y) * 16 });

describe('halos', () => {
  it('play for HALO_SECONDS of the time they are given and then release their sprites', () => {
    const layer = new Container();
    const halos = new Halos(fakeAtlas(), layer, flat);
    halos.spawn(3, 4, 2, 2, 'building');
    halos.spawn(5, 5, 1, 1, 'piece');
    const sprites = layer.children.map((n) => n.children[0] as Sprite);
    // in steps of an uneven frame time, like the render loop's
    const steps = [0.016, 0.033, 0.05];
    let t = 0;
    let lit = false;
    for (let i = 0; t + steps[i % 3] < HALO_SECONDS; i++) {
      halos.update(steps[i % 3]);
      t += steps[i % 3];
      expect(layer.children.length, `t ${t}`).toBe(2);
      lit ||= layer.children.every((n) => n.children.some((s) => s.visible));
    }
    expect(lit).toBe(true);
    halos.update(HALO_SECONDS - t + 1e-9);
    expect(layer.children.length).toBe(0);
    expect(sprites.every((s) => s.destroyed)).toBe(true);
  });

  it('make the piece halo smaller than a building one on the same tile', () => {
    const layer = new Container();
    const halos = new Halos(fakeAtlas(), layer, flat);
    halos.spawn(2, 2, 1, 1, 'building');
    halos.spawn(2, 2, 1, 1, 'piece');
    halos.update(HALO_SECONDS / 2);
    const [building, piece] = layer.children;
    const ring = (n: Container) => n.children[1] as Sprite;
    expect(piece.children.length).toBeLessThan(building.children.length);
    expect(ring(piece).width).toBeLessThan(ring(building).width);
    expect(-ring(piece).y).toBeLessThan(-ring(building).y);
    // both stand on the footprint's centre
    expect([building.x, building.y]).toEqual([0, 64]);
    expect([piece.x, piece.y]).toEqual([0, 64]);
  });
});
