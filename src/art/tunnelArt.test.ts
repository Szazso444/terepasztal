/**
 * The placeholder tunnel frames: the set of names the renderers will look up, each anchored at the
 * centre of its canvas (the tile centre, the portal plane at the rail, the middle of a swatch), at
 * the canvas sizes the repaint is briefed on. The generator runs against a 2D context that counts
 * what is painted into each frame, so the pictures are checked as geometry, not pixels.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AtlasBuilder } from '../engine/atlas';
import {
  BRICK_FRAMES,
  BRICK_COURSE,
  BRICK_H,
  BRICK_W,
  COPING_FRAME,
  COPING_H,
  COPING_W,
  PORTAL_FRAME,
  PORTAL_FRAMES,
  TILE_FRAME,
  TILE_FRAMES,
  TUNNEL_R,
  generateTunnelAtlas,
} from './tunnelArt';

/** Node has no ImageData: a stand-in that keeps the size the packer reads. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

/**
 * A 2D context that accepts every drawing call, counts the paints of the frame being drawn, and
 * starts the next frame at each `getImageData`, the call that ends one.
 */
class CountingContext {
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  lineWidth = 1;
  globalCompositeOperation = 'source-over';
  /** paints per frame, in the order the frames end */
  readonly paints: number[] = [0];
  private paint() {
    this.paints[this.paints.length - 1]++;
  }
  setTransform() {}
  scale() {}
  save() {}
  restore() {}
  clip() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  ellipse() {}
  fill() {
    this.paint();
  }
  stroke() {
    this.paint();
  }
  fillRect() {
    this.paint();
  }
  createLinearGradient() {
    return { addColorStop() {} };
  }
  putImageData() {}
  getImageData(_x: number, _y: number, w: number, h: number) {
    this.paints.push(0);
    return new FakeImageData(w, h);
  }
}

const ALL_FRAMES = [
  ...TILE_FRAMES.floor,
  ...TILE_FRAMES.wallN,
  ...TILE_FRAMES.wallW,
  TILE_FRAMES.shadeN,
  TILE_FRAMES.shadeW,
  TILE_FRAMES.rimS,
  TILE_FRAMES.rimE,
  PORTAL_FRAMES.E,
  PORTAL_FRAMES.S,
  ...BRICK_FRAMES,
  COPING_FRAME,
];

/** key -> the canvas the frame was drawn on and the anchor it was added with, before trimming */
const added = new Map<string, { w: number; h: number; ax: number; ay: number; paints: number }>();
let atlas: ReturnType<typeof generateTunnelAtlas>;

beforeAll(() => {
  const context = new CountingContext();
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  const add = vi.spyOn(AtlasBuilder.prototype, 'add');
  try {
    atlas = generateTunnelAtlas();
    add.mock.calls.forEach(([key, img, ax, ay], i) =>
      added.set(key, { w: img.width, h: img.height, ax, ay, paints: context.paints[i] }),
    );
  } finally {
    add.mockRestore();
    vi.unstubAllGlobals();
  }
});

describe('placeholder tunnel frames', () => {
  it('has exactly the frames the renderers will ask for, and no other', () => {
    expect(ALL_FRAMES).toHaveLength(4 + 3 + 3 + 2 + 2 + 2 + 4 + 1);
    expect([...added.keys()].sort()).toEqual([...ALL_FRAMES].sort());
    expect(Object.keys(atlas.frames).sort()).toEqual([...ALL_FRAMES].sort());
    expect(ALL_FRAMES.every((k) => k.startsWith('tunnel/'))).toBe(true);
  });

  it('every frame exists with its anchor at the tile centre', () => {
    for (const key of ALL_FRAMES) {
      const f = added.get(key)!;
      expect(f, key).toBeDefined();
      expect(f.ax, `${key} anchor x`).toBe(f.w / 2);
      expect(f.ay, `${key} anchor y`).toBe(f.h / 2);
    }
  });

  it('draws tile frames on a square, the portal on a bigger one, and the swatches to their size', () => {
    const size = (w: number, h: number) => ({ w: w * TUNNEL_R, h: h * TUNNEL_R });
    const tileFrames = [
      ...TILE_FRAMES.floor,
      ...TILE_FRAMES.wallN,
      ...TILE_FRAMES.wallW,
      TILE_FRAMES.shadeN,
      TILE_FRAMES.shadeW,
      TILE_FRAMES.rimS,
      TILE_FRAMES.rimE,
    ];
    for (const key of tileFrames)
      expect(added.get(key), key).toMatchObject(size(TILE_FRAME, TILE_FRAME));
    for (const key of Object.values(PORTAL_FRAMES))
      expect(added.get(key), key).toMatchObject(size(PORTAL_FRAME, PORTAL_FRAME));
    for (const key of BRICK_FRAMES)
      expect(added.get(key), key).toMatchObject(size(BRICK_W, BRICK_H));
    expect(added.get(COPING_FRAME)).toMatchObject(size(COPING_W, COPING_H));
    expect(atlas.resolution).toBe(TUNNEL_R);
  });

  it('paints something into every frame', () => {
    for (const key of ALL_FRAMES) expect(added.get(key)!.paints, key).toBeGreaterThan(0);
  });

  it('lays a brick swatch in an even number of courses, so it repeats both ways', () => {
    // the odd courses are shifted half a brick: an even count closes the pattern at the seam
    expect(BRICK_H % BRICK_COURSE).toBe(0);
    expect((BRICK_H / BRICK_COURSE) % 2).toBe(0);
  });
});
