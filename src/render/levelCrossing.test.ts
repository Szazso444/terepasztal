/**
 * The level-crossing deck the renderer lays over track (#329 on #309's frames): which track piece
 * takes which deck, and that the frames it names are there, anchored as the straight under them,
 * and as long along the track as the road is wide.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AtlasBuilder } from '../engine/atlas';
import {
  LEVEL_CROSSING_ALONG,
  LEVEL_CROSSING_CLASSES,
  generateIllustratedTrackAtlas,
  levelCrossingFrame as deckFrame,
} from '../art/trackIllustrated';
import {
  TRACK_ITEMS,
  isUnitKind,
  makePiece,
  pieceFrame,
  pieceLinks,
  rotationCount,
  type TrackPiece,
} from '../world/track';
import { crossingAxis, levelCrossingFrame } from './levelCrossing';
import { ROAD_WIDTH } from './roadShape';

/** Every piece the track can show on a tile: each item in each rotation, with each unit member. */
function everyPiece(): TrackPiece[] {
  const out: TrackPiece[] = [];
  for (const it of TRACK_ITEMS)
    for (let rot = 0; rot < rotationCount(it.kind); rot++) {
      const p = makePiece(it.kind, rot, it.cls, it.cls2);
      if (!isUnitKind(it.kind, it.cls)) {
        out.push(p);
        if (it.kind === 'switch') out.push({ ...p, form: 'parallel' });
        continue;
      }
      for (let member = 0; member < 4; member++) {
        out.push({ ...p, unit: { ax: 0, ay: 0, member } });
        if (it.kind === 'switch')
          out.push({ ...p, form: 'parallel', unit: { ax: 0, ay: 0, member } });
      }
    }
  return out;
}

describe('the deck a road lays over track', () => {
  it('is the class and rotation of a plain straight of Branch Line or Narrow Gauge, and none on any other piece', () => {
    let decks = 0,
      none = 0;
    for (const p of everyPiece()) {
      const frame = pieceFrame(p),
        deck = levelCrossingFrame(frame);
      if (p.kind === 'straight' && (p.cls === 'branch' || p.cls === 'narrow')) {
        expect(deck, frame).toBe(`track/level_crossing_${p.cls}_${p.rot}`);
        expect(deck).toBe(deckFrame(p.cls, p.rot));
        decks++;
      } else {
        expect(deck, frame).toBeNull();
        expect(crossingAxis(frame), frame).toBeNull();
        none++;
      }
    }
    expect(decks).toBe(4);
    expect(none).toBeGreaterThan(100);
    // the members of a multi-tile piece, lines a road may not cross on the level and a switch's
    // other form, named outright
    for (const frame of [
      'track/straight_main_0',
      'track/straight_trunk_1',
      'track/straight_maglev_0',
      'track/straight_hyperloop_1',
      'track/curve_branch_0_m2',
      'track/switch_narrow_3p',
      'track/switch_branch_1p_m0',
      'track/crossing_branch_narrow_0',
      'track/bridge_branch_0',
      'track/straight_branch_0_m0',
    ])
      expect(levelCrossingFrame(frame), frame).toBeNull();
  });

  it('carries the road square to the straight it crosses', () => {
    for (const cls of LEVEL_CROSSING_CLASSES)
      for (let rot = 0; rot < rotationCount('straight'); rot++) {
        const axis = crossingAxis(`track/straight_${cls}_${rot}`),
          [[a, b]] = pieceLinks('straight', rot),
          // the track runs along y where its link joins N (0) and S (2)
          trackAlongY = (a === 0 && b === 2) || (a === 2 && b === 0);
        expect(axis).toBe(trackAlongY ? 'x' : 'y');
      }
  });

  it('reaches half the road wide along the track either way, as #309 draws it', () => {
    expect(LEVEL_CROSSING_ALONG).toBeCloseTo(ROAD_WIDTH / 2, 12);
  });
});

/** Node has no ImageData; the packer needs a width, a height and clear pixels. */
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
/** A 2D context that accepts every drawing call and reads back blank pixels. */
const context = new Proxy(
  {},
  {
    get: (_, name) =>
      name === 'getImageData'
        ? (_x: number, _y: number, w: number, h: number) => new FakeImageData(w, h)
        : () => undefined,
    set: () => true,
  },
);

describe('the deck frames', () => {
  /** frame key -> the anchor it was added with, before trimming, and its canvas size */
  const added = new Map<string, { ax: number; ay: number; w: number; h: number }>();
  beforeAll(() => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    const add = vi.spyOn(AtlasBuilder.prototype, 'add');
    try {
      generateIllustratedTrackAtlas();
      for (const [key, img, ax, ay] of add.mock.calls)
        added.set(key, { ax, ay, w: img.width, h: img.height });
    } finally {
      add.mockRestore();
    }
  }, 60_000);
  afterAll(() => vi.unstubAllGlobals());

  it('are in the frame table, and the generator anchors each as the straight it lies on', () => {
    const table = JSON.parse(
      readFileSync(new URL('../art/atlasFrames.golden.json', import.meta.url), 'utf8'),
    ) as { track: string[] };
    for (const cls of LEVEL_CROSSING_CLASSES)
      for (let rot = 0; rot < rotationCount('straight'); rot++) {
        const straight = `track/straight_${cls}_${rot}`,
          deck = levelCrossingFrame(straight)!;
        expect(table.track, deck).toContain(deck);
        expect(table.track, straight).toContain(straight);
        expect(added.get(deck), deck).toBeDefined();
        expect(added.get(deck)).toEqual(added.get(straight));
      }
  });
});
