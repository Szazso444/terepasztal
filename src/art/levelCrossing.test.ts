/**
 * The level crossing decks (#309): a road laid across straight track shows the straight's frame
 * with a deck frame over it. These check the deck's exported geometry against the track style it
 * lies on, and run the track generator against a 2D context that records its paths, so the frames
 * are checked as geometry rather than pixels: one per class a road may cross and per rotation of
 * the straight, anchored as that straight, clipped to the deck, and with the straight's own rail
 * strokes cut out of it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AtlasBuilder } from '../engine/atlas';
import { worldToTile, type Vec2 } from '../engine/iso';
import { TRACK_CLASSES, pieceLinks, rotationCount } from '../world/track';
import { EDGE_MID } from '../world/trackGeom';
import {
  BED_SHOULDER,
  LEVEL_CROSSING_ACROSS,
  LEVEL_CROSSING_ALONG,
  LEVEL_CROSSING_CLASSES,
  LEVEL_CROSSING_MARGIN,
  RAIL_OFFSET,
  generateIllustratedTrackAtlas,
  levelCrossingFrame,
  railReach,
} from './trackIllustrated';

/** The decisions, written out: item 18, the rail offsets of #309 and #329's road width. */
const RAIL = { regular: 0.16, narrow: 0.08 };
const MARGIN = 0.1;
const ROAD_WIDTH = 0.32;
const EPS = 1e-9;

describe('level crossing deck geometry', () => {
  it('crosses regular and narrow track only, never high speed', () => {
    expect([...LEVEL_CROSSING_CLASSES].sort()).toEqual(['narrow', 'regular']);
  });

  it('reaches 0.1 tile outside each rail, inside the ballast bed, and half a road along', () => {
    expect(LEVEL_CROSSING_MARGIN).toBe(MARGIN);
    expect(LEVEL_CROSSING_ALONG).toBeCloseTo(ROAD_WIDTH / 2, 12);
    for (const cls of LEVEL_CROSSING_CLASSES) {
      expect(RAIL_OFFSET[cls], cls).toBe(RAIL[cls]);
      expect(LEVEL_CROSSING_ACROSS[cls], cls).toBeCloseTo(RAIL_OFFSET[cls] + MARGIN, 12);
      expect(LEVEL_CROSSING_ACROSS[cls], cls).toBeLessThan(BED_SHOULDER[cls]);
    }
    expect(LEVEL_CROSSING_ACROSS.regular).toBeCloseTo(0.26, 12);
    expect(LEVEL_CROSSING_ACROSS.narrow).toBeCloseTo(0.18, 12);
  });

  it('keeps every class rail inside its own bed', () => {
    for (const cls of TRACK_CLASSES) expect(RAIL_OFFSET[cls], cls).toBeLessThan(BED_SHOULDER[cls]);
  });

  it('runs past the whole rail on either side, along either axis', () => {
    const axes: Vec2[] = [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ];
    for (const cls of LEVEL_CROSSING_CLASSES)
      for (const t of axes)
        for (const s of [-1, 1]) {
          const reach = railReach(cls, t, { x: -t.y * s, y: t.x * s });
          expect(reach, `${cls} along ${t.x},${t.y}`).toBeGreaterThan(0);
          expect(RAIL_OFFSET[cls] + reach, `${cls} along ${t.x},${t.y}`).toBeLessThan(
            LEVEL_CROSSING_ACROSS[cls],
          );
        }
  });
});

/** Node has no ImageData; the packer needs a width, a height and clear pixels. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

/** A stroke as drawn: its path in canvas world px, its width and how it was composited. */
interface Stroke {
  path: Vec2[];
  width: number;
  color: string;
  op: string;
}
interface Frame {
  clips: Vec2[][];
  strokes: Stroke[];
  /** every fill and stroke in order, by how it was composited */
  paints: string[];
}

/**
 * A 2D context that records every clip and stroke and starts a new frame at each `getImageData`,
 * the call that ends one frame. A call the generator makes that is not listed here throws.
 */
class RecordingContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  lineJoin = 'miter';
  readonly frames: Frame[] = [{ clips: [], strokes: [], paints: [] }];
  private path: Vec2[] = [];
  beginPath() {
    this.path = [];
  }
  moveTo(x: number, y: number) {
    this.path.push({ x, y });
  }
  lineTo(x: number, y: number) {
    this.path.push({ x, y });
  }
  closePath() {}
  clip() {
    this.frames[this.frames.length - 1].clips.push([...this.path]);
  }
  stroke() {
    this.frames[this.frames.length - 1].paints.push(this.globalCompositeOperation);
    this.frames[this.frames.length - 1].strokes.push({
      path: [...this.path],
      width: this.lineWidth,
      color: this.strokeStyle,
      op: this.globalCompositeOperation,
    });
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    this.frames.push({ clips: [], strokes: [], paints: [] });
    return new FakeImageData(w, h);
  }
  scale() {}
  fill() {
    this.frames[this.frames.length - 1].paints.push(this.globalCompositeOperation);
  }
  ellipse() {}
  fillRect() {}
  putImageData() {}
}

/** key -> what was drawn into it, the anchor it was added with and its canvas size */
const frames = new Map<string, Frame & { ax: number; ay: number; w: number; h: number }>();
let resolution = 0;

beforeAll(() => {
  const context = new RecordingContext();
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  const add = vi.spyOn(AtlasBuilder.prototype, 'add');
  try {
    resolution = generateIllustratedTrackAtlas().resolution ?? 1;
    add.mock.calls.forEach(([key, img, ax, ay], i) =>
      frames.set(key, { ...context.frames[i], ax, ay, w: img.width, h: img.height }),
    );
  } finally {
    add.mockRestore();
    vi.unstubAllGlobals();
  }
}, 60_000);

const expectedKeys = () =>
  LEVEL_CROSSING_CLASSES.flatMap((cls) =>
    Array.from({ length: rotationCount('straight') }, (_, rot) => ({ cls, rot })),
  );

/** The unit tile vector the straight at `rot` runs along, from the world geometry. */
function trackAxis(rot: number): Vec2 {
  const [[from, to]] = pieceLinks('straight', rot);
  const d = { x: EDGE_MID[to].x - EDGE_MID[from].x, y: EDGE_MID[to].y - EDGE_MID[from].y };
  const l = Math.hypot(d.x, d.y);
  return { x: d.x / l, y: d.y / l };
}

const same = (a: Vec2[], b: Vec2[]) =>
  a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) + Math.abs(p.y - b[i].y) < EPS);

describe('the level crossing frames', () => {
  it('are one per class a road crosses and per rotation of the straight, and no more', () => {
    const drawn = [...frames.keys()].filter((k) => k.startsWith('track/level_crossing_')).sort();
    const want = expectedKeys().map(({ cls, rot }) => `track/level_crossing_${cls}_${rot}`);
    expect(drawn).toEqual(want.sort());
    for (const { cls, rot } of expectedKeys())
      expect(levelCrossingFrame(cls, rot)).toBe(`track/level_crossing_${cls}_${rot}`);
  });

  it('are anchored exactly as the straight each lies on, on a canvas of the same size', () => {
    for (const { cls, rot } of expectedKeys()) {
      const deck = frames.get(levelCrossingFrame(cls, rot))!;
      const straight = frames.get(`track/straight_${cls}_${rot}`)!;
      expect(straight, `straight_${cls}_${rot}`).toBeDefined();
      expect([deck.ax, deck.ay, deck.w, deck.h]).toEqual([
        straight.ax,
        straight.ay,
        straight.w,
        straight.h,
      ]);
    }
  });

  it('are clipped to the deck: LEVEL_CROSSING_ACROSS across the track, LEVEL_CROSSING_ALONG along', () => {
    for (const { cls, rot } of expectedKeys()) {
      const key = levelCrossingFrame(cls, rot);
      const deck = frames.get(key)!;
      const t = trackAxis(rot);
      const n = { x: -t.y, y: t.x };
      // the tile diamond, then the deck inside it
      expect(deck.clips, key).toHaveLength(2);
      const corners = deck.clips[1].map((p) =>
        worldToTile(p.x - deck.ax / resolution, p.y - deck.ay / resolution),
      );
      expect(corners, key).toHaveLength(4);
      for (const p of corners) {
        expect(Math.abs(p.x * n.x + p.y * n.y), `${key} across`).toBeCloseTo(
          LEVEL_CROSSING_ACROSS[cls],
          9,
        );
        expect(Math.abs(p.x * t.x + p.y * t.y), `${key} along`).toBeCloseTo(
          LEVEL_CROSSING_ALONG,
          9,
        );
      }
      expect(new Set(corners.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)).size).toBe(4);
    }
  });

  it('cut the straight`s own rail strokes out of the deck, so its railheads show', () => {
    for (const { cls, rot } of expectedKeys()) {
      const key = levelCrossingFrame(cls, rot);
      const deck = frames.get(key)!;
      const straight = frames.get(`track/straight_${cls}_${rot}`)!;
      // the straight's rails are its strokes in the rail colours; the sleepers' are not
      const rails = straight.strokes.filter((s) =>
        ['#4c4940', '#827d70', '#d1c7ac'].includes(s.color),
      );
      const cuts = deck.strokes.filter((s) => s.op === 'destination-out');
      expect(rails, `straight_${cls}_${rot}`).toHaveLength(6);
      expect(cuts, key).toHaveLength(rails.length);
      for (const rail of rails)
        expect(
          cuts.some((cut) => cut.width === rail.width && same(cut.path, rail.path)),
          `${key}: a ${rail.width} px rail stroke is not cut out`,
        ).toBe(true);
      // and nothing is painted over the rails once they are cut
      const first = deck.paints.indexOf('destination-out');
      expect(first, key).toBeGreaterThan(0);
      expect(deck.paints.slice(first), key).toEqual(cuts.map(() => 'destination-out'));
    }
  });
});
