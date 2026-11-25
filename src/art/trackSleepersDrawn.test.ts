/**
 * What `generateIllustratedTrackAtlas` really paints (#405). `trackSleepers.test.ts` checks the
 * layout rule and the helpers around it; this file runs the generator itself against a 2D context
 * that records every sleeper (the one closed four-corner shape `draw` fills), so a `draw` that
 * stops using the rule, or restarts it per path again, fails here whatever the helpers say.
 *
 * The expectation is written out here from the rule alone, not from `railSleepers`: a rail line
 * holds `round(length / step)` equal pitches, the first and last sleeper half a pitch from its
 * ends. The lines come from the world geometry (`pieceLinks` and `linkPoints`, `unitDef`,
 * `unitRailPaths`, `unitIconPaths`), not from `tilePaths`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AtlasBuilder } from '../engine/atlas';
import { DIR_DX, DIR_DY, opposite, worldToTile, type Dir, type Vec2 } from '../engine/iso';
import {
  CLASS_N,
  TRACK_ITEMS,
  isUnitKind,
  itemKey,
  pieceLinks,
  rotationCount,
  type TrackClass,
} from '../world/track';
import {
  EDGE_MID,
  linkPoints,
  unitDef,
  unitIconPaths,
  unitRailPaths,
  type SwitchForm,
} from '../world/trackGeom';
import { generateIllustratedTrackAtlas, sleeperStep } from './trackIllustrated';

/**
 * The nominal sleeper spacing per class, in tiles: the issue keeps it as it was before the fix
 * (the pitch is derived from it per run). Retuning a class on purpose is a one-line change here.
 */
const NOMINAL_STEP: Record<TrackClass, number> = {
  narrow: 0.115,
  branch: 0.14,
  // the lines with no pieces yet are drawn as Branch Line
  main: 0.14,
  trunk: 0.14,
  maglev: 0.14,
  hyperloop: 0.14,
};
/** A drawn icon of a piece shrinks the step with its scale, but never below this share of it. */
const ICON_STEP_FLOOR = 0.75;
/** Distance in tiles within which a drawn sleeper counts as the one expected there. */
const TOLERANCE = 1e-6;

/** One rail line of a frame, with the class whose spacing it takes and the scale it is drawn at. */
interface Line {
  points: Vec2[];
  cls: TrackClass;
  scale: number;
}
/** A frame the generator should emit: its key, its rail lines and, for a one-tile piece, ends. */
interface FrameSpec {
  key: string;
  lines: Line[];
  /** one-tile pieces: each rail line's two ends, where it meets the tile edge */
  ends?: { dir: Dir; cls: TrackClass }[];
}
/** A frame as drawn: where each sleeper was painted (tile coordinates) and in which colour. */
interface Drawn {
  key: string;
  sleepers: Vec2[];
  colors: string[];
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (p: Vec2) => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`;
const gaugeOf = (cls: TrackClass) => (cls === 'narrow' ? 'narrow' : 'wide');

function length(points: Vec2[]) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i]);
  return sum;
}

/** The point `d` tiles along a polyline (the last point past its end). */
function pointAlong(points: Vec2[], d: number): Vec2 {
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (walked + seg >= d && seg > 0) {
      const t = (d - walked) / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    walked += seg;
  }
  return points[points.length - 1];
}

/** The rule alone: a whole number of equal pitches, the first and last sleeper half a pitch in. */
function ruleSleepers(line: Line): Vec2[] {
  const step = NOMINAL_STEP[line.cls] * Math.max(line.scale, ICON_STEP_FLOOR);
  const total = length(line.points);
  const count = Math.max(1, Math.round(total / step));
  const pitch = total / count;
  return Array.from({ length: count }, (_, i) => pointAlong(line.points, (i + 0.5) * pitch));
}

/** Every frame the generator emits, in its order, as the world geometry says it should look. */
function frameSpecs(): FrameSpec[] {
  const specs: FrameSpec[] = [];
  for (const it of TRACK_ITEMS)
    for (let rotation = 0; rotation < rotationCount(it.kind); rotation++) {
      const key = `track/${itemKey(it)}_${rotation}`;
      if (isUnitKind(it.kind, it.cls)) {
        const kind = it.kind as 'curve' | 'switch';
        const n = CLASS_N[it.cls];
        const forms: SwitchForm[] = kind === 'switch' ? ['turn', 'parallel'] : ['turn'];
        for (const form of forms) {
          const roads = unitRailPaths(kind, n, rotation, form);
          // each member tile draws the whole piece, shifted into its own tile
          unitDef(kind, n, rotation, form).members.forEach((member, i) =>
            specs.push({
              key: `${key}${form === 'parallel' ? 'p' : ''}_m${i}`,
              lines: roads.map((pts) => ({
                points: pts.map((q) => ({ x: q.x - member.dx, y: q.y - member.dy })),
                cls: it.cls,
                scale: 1,
              })),
            }),
          );
          if (form === 'turn')
            specs.push({
              key,
              lines: unitIconPaths(kind, n, rotation).map((points) => ({
                points,
                cls: it.cls,
                scale: 1 / n,
              })),
            });
        }
        continue;
      }
      const links = pieceLinks(it.kind, rotation);
      const lines: Line[] = links.map((link, i) => ({
        points: linkPoints(link[0], link[1], 96),
        cls: it.kind === 'crossing' && i === 1 ? (it.cls2 ?? it.cls) : it.cls,
        scale: 1,
      }));
      specs.push({
        key,
        lines,
        ends: links.flatMap((link, i) => link.map((dir) => ({ dir, cls: lines[i].cls }))),
      });
    }
  return specs;
}

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

/**
 * A 2D context that reads every shape `fill()` paints with exactly four corners and starts a new
 * frame at each `getImageData`, the call that ends one `draw`. In `draw` that shape is a sleeper:
 * ballast is a polygon over the whole line or an ellipse, the clip and the rails are never filled
 * as four corners. A call the generator makes that is not listed here throws, so a new kind of
 * drawing is noticed rather than ignored.
 */
class RecordingContext {
  fillStyle = '';
  /** per frame: the canvas-space centre of each sleeper and its fill colour */
  readonly frames: { x: number; y: number; color: string }[][] = [[]];
  private path: Vec2[] = [];
  private closed = false;
  beginPath() {
    this.path = [];
    this.closed = false;
  }
  moveTo(x: number, y: number) {
    this.path.push({ x, y });
  }
  lineTo(x: number, y: number) {
    this.path.push({ x, y });
  }
  closePath() {
    this.closed = true;
  }
  fill() {
    if (!this.closed || this.path.length !== 4) return;
    const x = this.path.reduce((s, p) => s + p.x, 0) / 4;
    const y = this.path.reduce((s, p) => s + p.y, 0) / 4;
    this.frames[this.frames.length - 1].push({ x, y, color: this.fillStyle });
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    this.frames.push([]);
    return new FakeImageData(w, h);
  }
  scale() {}
  clip() {}
  stroke() {}
  ellipse() {}
  fillRect() {}
  putImageData() {}
}

const specs = frameSpecs();
let drawn: Drawn[] = [];
/** Where the generator anchors every frame, in canvas pixels, and the texels per world pixel. */
let anchors: { ax: number; ay: number }[] = [];
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
    anchors = add.mock.calls.map(([, , ax, ay]) => ({ ax, ay }));
    const keys = add.mock.calls.map(([key]) => key);
    // the tile centre is where the generator anchors every frame; world pixels are texels / R
    const { ax, ay } = anchors[0];
    // a level crossing's deck lies over a straight and lays no sleepers (levelCrossing.test.ts)
    drawn = keys
      .map((key, i) => ({
        key,
        sleepers: context.frames[i].map((s) =>
          worldToTile(s.x - ax / resolution, s.y - ay / resolution),
        ),
        colors: context.frames[i].map((s) => s.color),
      }))
      .filter((f) => !f.key.startsWith('track/level_crossing_'));
  } finally {
    add.mockRestore();
    vi.unstubAllGlobals();
  }
}, 60_000);

/**
 * Pairs each expected point with the nearest unused drawn point within TOLERANCE. `index[i]` is the
 * drawn index of expected point i or -1; `extra` are the drawn points nothing expected.
 */
function pair(expected: Vec2[], painted: Vec2[]) {
  const unused = new Set(painted.keys());
  const index = expected.map((e) => {
    let best = -1;
    let bestDist = TOLERANCE;
    for (const i of unused) {
      const d = dist(painted[i], e);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) unused.delete(best);
    return best;
  });
  return { index, extra: [...unused].map((i) => painted[i]) };
}

describe('the frames the generator paints', () => {
  it('are the ones the world geometry lists, in order, all anchored on the tile centre', () => {
    expect(drawn.map((f) => f.key)).toEqual(specs.map((s) => s.key));
    // the sleepers below are read relative to this anchor, so every frame must share it
    expect(new Set(anchors.map((a) => `${a.ax},${a.ay}`)).size).toBe(1);
  });

  it('hold exactly the sleepers the layout rule gives each rail line, nowhere else', () => {
    const problems: string[] = [];
    specs.forEach((spec, i) => {
      const frame = drawn[i];
      const expected = spec.lines.flatMap(ruleSleepers);
      const { index, extra } = pair(expected, frame.sleepers);
      const missing = expected.filter((_, k) => index[k] < 0);
      if (missing.length)
        problems.push(
          `${spec.key}: ${missing.length} sleepers not painted, first at ${fmt(missing[0])}`,
        );
      if (extra.length)
        problems.push(
          `${spec.key}: ${extra.length} sleepers painted off the rule, first at ${fmt(extra[0])}`,
        );
    });
    expect(problems).toEqual([]);
  });

  it('leave one pitch between the sleepers either side of a join, measured on the painted frames', () => {
    // The two sleepers nearest to the midpoint of an edge where exactly one rail line ends; a
    // neighbouring piece across that edge shows its own pair, and the gap across is the distance
    // between the two nearest. Measured on what was painted, with no layout rule in it.
    interface End {
      name: string;
      gauge: string;
      dir: Dir;
      first: Vec2;
      second: Vec2;
    }
    const ends: End[] = [];
    specs.forEach((spec, i) => {
      for (const end of spec.ends ?? []) {
        if ((spec.ends ?? []).filter((e) => e.dir === end.dir).length !== 1) continue;
        const mid = EDGE_MID[end.dir];
        const near = [...drawn[i].sleepers].sort((a, b) => dist(a, mid) - dist(b, mid));
        ends.push({
          name: `${spec.key} at edge ${end.dir}`,
          gauge: gaugeOf(end.cls),
          dir: end.dir,
          first: near[0],
          second: near[1],
        });
      }
    });
    expect(ends.length).toBeGreaterThan(40);
    let joins = 0;
    for (const a of ends)
      for (const b of ends) {
        // b sits in the tile across a's edge, and meets it with its opposite edge
        if (a.gauge !== b.gauge || b.dir !== opposite(a.dir)) continue;
        const across = { x: b.first.x + DIR_DX[a.dir], y: b.first.y + DIR_DY[a.dir] };
        const gap = dist(a.first, across);
        for (const [side, pitch] of [
          [a.name, dist(a.first, a.second)],
          [b.name, dist(b.first, b.second)],
        ] as const) {
          expect(
            Math.abs(gap / pitch - 1),
            `${a.name} to ${b.name}: gap ${gap}, ${side} pitch ${pitch}`,
          ).toBeLessThan(0.05);
        }
        joins++;
      }
    expect(joins).toBeGreaterThan(100);
  });
});

describe('the nominal sleeper step', () => {
  it('stays what each class had, and an icon of a piece shrinks it to three quarters at most', () => {
    for (const cls of Object.keys(NOMINAL_STEP) as TrackClass[])
      for (const scale of [1, 0.9, 0.75, 0.5, 0.25])
        expect(sleeperStep(cls, scale), `${cls} at scale ${scale}`).toBeCloseTo(
          NOMINAL_STEP[cls] * Math.max(scale, ICON_STEP_FLOOR),
          12,
        );
  });
});
