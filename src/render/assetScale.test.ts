import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import atlas from '../../public/assets/structures.json';
import { structureFrame } from '../art/frames';
import { generateStructuresAtlas } from '../art/structures';
import {
  DOOR_FRACTION,
  HUMAN_HEIGHT_PX,
  HUMAN_HEIGHT_M,
  DOOR_HEIGHT_M,
  structureFamily,
  structureScale,
  hasScaleReference,
  scaleReference,
  unturnedFrame,
  type FrameNames,
} from './assetScale';

it('keeps a common human-relative door height across packed building levels', () => {
  let checked = 0;
  for (const [key, frame] of Object.entries(atlas.frames) as [string, { h: number }][]) {
    const family = structureFamily(key);
    if (!DOOR_FRACTION[family]) continue;
    const height = frame.h / atlas.resolution;
    const door = height * DOOR_FRACTION[family] * structureScale(key, height);
    expect(door / HUMAN_HEIGHT_PX).toBeCloseTo(DOOR_HEIGHT_M / HUMAN_HEIGHT_M, 5);
    checked++;
  }
  expect(checked).toBeGreaterThan(20);
});

it('requires an explicit calibration or declared estimate for every illustrated structure', () => {
  for (const key of Object.keys(atlas.frames)) expect(hasScaleReference(key), key).toBe(true);
});

/** Node has no ImageData or canvas: enough of both for the atlas packer to run. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    this.width = typeof a === 'number' ? a : b;
    this.height = typeof a === 'number' ? b : (c ?? a.length / 4 / b);
    this.data = typeof a === 'number' ? new Uint8ClampedArray(a * b * 4) : a;
  }
}

describe('turned structure frames', () => {
  /** Every structure frame the game can draw: the generated group with the shipped file over it. */
  let names: Set<string>;
  const frames: FrameNames = { has: (key) => names.has(key) };

  beforeAll(() => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: () => {} }),
      }),
    });
    names = new Set([
      ...Object.keys(generateStructuresAtlas().frames),
      ...Object.keys(atlas.frames),
    ]);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('are sized, patched and lit as the frame they were turned from', () => {
    let turns = 0,
      buildings = 0;
    for (const key of names)
      for (const rot of [1, 2, 3]) {
        const turned = structureFrame(frames, key, rot);
        if (turned === key) continue;
        turns++;
        const where = `${key} at rotation ${rot} (${turned})`;
        // family (window lights), reference (contact patches) and scale are the frame's own
        const own = hasScaleReference(key)
          ? { family: structureFamily(key), scale: structureScale(key) }
          : null;
        expect(scaleReference(frames, turned), where).toEqual(own);
        expect(scaleReference(frames, key), where).toEqual(own);
        // the turn leads back to its own frame, and that frame is not taken for a turn
        expect(unturnedFrame(frames, turned), where).toBe(key);
        expect(unturnedFrame(frames, key), where).toBe(key);
        if (own) buildings++;
      }
    // the walk reaches the turned pictures, buildings with a scale reference among them
    expect(turns).toBeGreaterThan(250);
    expect(buildings).toBeGreaterThan(200);
  });

  it("keep a wide station's axis frames as they were", () => {
    // `<art>_r<axis>[_lv<n>]` names an axis, not a turn: no frame is named without it
    const axes: Record<string, string> = {
      'structures/station_r1': 'station_r1',
      'structures/station_r0': 'station_r0',
      'structures/station_r1_lv2': 'station_r1',
      'structures/farm_r0': 'farm_r0',
      'structures/farm_r1_lv3': 'farm_r1',
      'structures/depot_r0': 'depot_r0',
      'structures/depot_r1': 'depot_r1',
      'structures/depot_r1_lv2': 'depot_r1',
      'structures/depot_narrow_r1': 'depot_narrow_r1',
    };
    for (const [key, family] of Object.entries(axes)) {
      expect(unturnedFrame(frames, key), key).toBe(key);
      expect(structureFamily(key), key).toBe(family);
      // none has a scale reference: drawn at scale 1, with no patches or lights
      expect(hasScaleReference(key), key).toBe(false);
      expect(scaleReference(frames, key), key).toBeNull();
    }
    // a wide frame's own turn is measured by it
    expect(unturnedFrame(frames, 'structures/depot_r0_r2')).toBe('structures/depot_r0');
    expect(unturnedFrame(frames, 'structures/depot_r1_lv2_r3')).toBe('structures/depot_r1_lv2');
    expect(unturnedFrame(frames, 'structures/depot_narrow_r1_r3')).toBe(
      'structures/depot_narrow_r1',
    );
  });

  it('read a turn only where the atlas has the frame it came from', () => {
    const only = (...keys: string[]): FrameNames => ({ has: (k) => keys.includes(k) });
    expect(unturnedFrame(only('structures/kiln'), 'structures/kiln_r2')).toBe('structures/kiln');
    expect(unturnedFrame(only(), 'structures/kiln_r2')).toBe('structures/kiln_r2');
    // `_r0` is never a turn, and a turn is only ever the last suffix
    expect(unturnedFrame(only('structures/kiln'), 'structures/kiln_r0')).toBe('structures/kiln_r0');
    expect(unturnedFrame(only('structures/kiln_lv2'), 'structures/kiln_lv2_r1')).toBe(
      'structures/kiln_lv2',
    );
    expect(unturnedFrame(only('structures/kiln'), 'structures/kiln_r1_lv2')).toBe(
      'structures/kiln_r1_lv2',
    );
  });
});
