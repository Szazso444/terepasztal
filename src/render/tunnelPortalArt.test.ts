import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtlasRegistry } from '../engine/atlas';
import { canvasPortalArt, PICTURE_MAX, type FaceFit } from './tunnelPortalArt';
import { planePoint } from './tunnelPortalArt';

/** The canvases made, each with a 2D context that takes every call and draws nothing. */
function fakeCanvases() {
  const made: { width: number; height: number }[] = [];
  const inert: object = new Proxy(() => undefined, {
    get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : inert),
    apply: () => inert,
    set: () => true,
  });
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => inert };
      made.push(canvas);
      return canvas;
    },
  });
  vi.stubGlobal(
    'DOMMatrix',
    class {
      scale() {
        return this;
      }
    },
  );
  return made;
}

const FRAME = {
  image: undefined as never,
  texture: { frame: { x: 0, y: 0, width: 24, height: 24 } },
  anchorX: 0.5,
  anchorY: 0.9,
  w: 64,
  h: 64,
};
const ATLAS = { get: () => FRAME } as unknown as AtlasRegistry;

/** A face with `run` tiles of cutting. */
function fit(run: number): FaceFit {
  const us = [-0.6, 0, 0.6],
    ds = Array.from({ length: run * 4 + 1 }, (_, i) => -i / 4);
  return {
    mirror: false,
    bricks: 0,
    us,
    base: [0, 0, 0],
    top: [60, 60, 60],
    run,
    ds,
    wall: ds.map(() => 40),
    opening: [planePoint(-0.4, 0), planePoint(0, 34), planePoint(0.4, 0)],
  };
}

describe('the pictures of a portal', () => {
  afterEach(() => void vi.unstubAllGlobals());
  it('a short cutting has its picture at three texels a px', () => {
    const made = fakeCanvases(),
      art = canvasPortalArt(ATLAS).back(fit(2)),
      canvas = made[made.length - 1];
    expect(art.scale).toBeCloseTo(1 / 3);
    expect(Math.max(canvas.width, canvas.height)).toBeLessThan(PICTURE_MAX);
  });
  it('no cutting makes a picture past the limit: it takes a lower density', () => {
    const made = fakeCanvases(),
      art = canvasPortalArt(ATLAS).back(fit(60)),
      back = made.reduce((a, c) => (a.width * a.height > c.width * c.height ? a : c));
    expect(back.width).toBeLessThanOrEqual(PICTURE_MAX);
    expect(back.height).toBeLessThanOrEqual(PICTURE_MAX);
    expect(art.scale).toBeGreaterThan(1 / 3);
    // the picture still spans the whole run on the ground
    expect(back.width * art.scale).toBeGreaterThan(60 * 32);
  });
});
