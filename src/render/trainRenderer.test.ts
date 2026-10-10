import { describe, it, expect } from 'vitest';
import { Container, Point, Texture, type Matrix, type Sprite } from 'pixi.js';
import { TrainRenderer } from './trainRenderer';
import { WHEEL_CYCLE_TILES } from './runningGear';
import type { Ground } from './slope';
import { DEFAULT_RELIEF } from './terrainRelief';
import { tileToWorld } from '../engine/iso';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import type { LocoDef } from '../data/content';
import type { Train } from '../sim/trains';
import {
  DRAWN_FACINGS,
  Polyline,
  facingOf,
  mirrorFacing,
  poseVehicle,
  vehicleSpec,
  type BodyFields,
} from '../sim/body';

/** Screen pixels one terrace level rises: the landscape's level step. */
const LEVEL = DEFAULT_RELIEF.step;

/**
 * Every frame is the same blank one; the atlas records which frames were asked for. Its texture
 * is not one texel per pixel, so no window light is drawn over it.
 */
function fakeAtlas() {
  const asked: string[] = [];
  const frame = { texture: Texture.EMPTY, anchorX: 0.5, anchorY: 0.75, w: 64, h: 48 };
  const atlas = {
    has: () => true,
    get: (key: string) => {
      asked.push(key);
      return frame as unknown as FrameInfo;
    },
  };
  return { atlas: atlas as unknown as AtlasRegistry, asked };
}

/**
 * Draws a medium locomotive (a rigid body on two drawn bogies) centred on tile (0, 0) of a
 * straight rail heading `heading` (a tile axis), which climbs `rise` screen pixels per tile
 * that way (negative descends).
 */
function draw(heading: number, rise: number) {
  const hx = Math.round(Math.cos(heading)),
    hy = Math.round(Math.sin(heading)),
    ground = (x: number, y: number): Ground => ({
      dz: -rise * (x * hx + y * hy),
      sgx: -rise * hx,
      sgy: -rise * hy,
    }),
    spec = vehicleSpec({ size: 'medium' }),
    rail = new Polyline([
      { x: -4 * hx, y: -4 * hy },
      { x: 4 * hx, y: 4 * hy },
    ]),
    pose = poseVehicle(rail, 4 + spec.L / 2, spec),
    def = { id: 'test', type: 'diesel', body: 'box', paint: 'iron', size: 'medium' } as LocoDef,
    train = {
      id: 1,
      locos: [{ def }],
      wagons: [],
      reversed: false,
      vehicleSpecs: [spec],
      vehiclePoses: [pose],
      prevVehiclePoses: [pose],
    } as unknown as Train,
    { atlas, asked } = fakeAtlas(),
    layer = new Container();
  new TrainRenderer(atlas, layer, ground).update([train], 1);
  // the body's sprite is made first, then the undercarriage holding the bogies
  const body = layer.children[0] as Sprite,
    bogies = (layer.children[1] as Container).children as Sprite[];
  return { body, bogies, seg: pose.segments[0], ground, bodyFrame: asked[0] };
}

function transform(s: Sprite): Matrix {
  s.updateLocalTransform();
  return s.localTransform;
}
/** Screen length of one pixel of the sprite's own vertical. */
function heightScale(s: Sprite) {
  const m = transform(s);
  return Math.hypot(m.c, m.d);
}

// Rails climb only on straights along the tile axes (src/world/railProfile.ts, climbAxes).
const HEADINGS = [0, 1, 2, 3].map((k) => (k * Math.PI) / 2);

describe('TrainRenderer on a grade', () => {
  it('covers every drawn facing that a climbing rail uses, plain and mirrored', () => {
    const shown = HEADINGS.map((h) => {
      const f = facingOf(h);
      return DRAWN_FACINGS.has(f) ? `${f}` : `${mirrorFacing(f)} mirrored`;
    });
    expect(shown.sort()).toEqual(['0', '0 mirrored', '24', '24 mirrored']);
  });

  for (const heading of HEADINGS)
    for (const rise of [LEVEL, -LEVEL]) {
      const f = facingOf(heading),
        name = `facing ${f}, ${rise > 0 ? 'climbing' : 'descending'} a level per tile`;

      it(`${name}: body and bogies keep their drawn height`, () => {
        const flat = draw(heading, 0),
          slope = draw(heading, rise);
        // the case draws the facing it names, mirrored when that facing is not drawn
        const drawn = DRAWN_FACINGS.has(f) ? f : mirrorFacing(f);
        expect(slope.bodyFrame.endsWith(`_f${drawn}`)).toBe(true);
        const m = transform(slope.body);
        expect(Math.sign(m.a * m.d - m.b * m.c)).toBe(DRAWN_FACINGS.has(f) ? 1 : -1);
        const sprites = [slope.body, ...slope.bogies],
          level = [flat.body, ...flat.bogies];
        expect(slope.bogies.length).toBe(2);
        sprites.forEach((s, i) => {
          const ratio = heightScale(s) / heightScale(level[i]);
          expect(Math.abs(ratio - 1), `sprite ${i}: height ×${ratio.toFixed(3)}`).toBeLessThan(
            0.02,
          );
        });
      });

      it(`${name}: the body spans the rail between its ends`, () => {
        const flat = draw(heading, 0),
          slope = draw(heading, rise),
          { seg, ground } = slope,
          F = transform(flat.body),
          M = transform(slope.body),
          ends = [-1, 1].map((k) => {
            const x = seg.x + (Math.cos(seg.angle) * k * seg.L) / 2,
              y = seg.y + (Math.sin(seg.angle) * k * seg.L) / 2,
              w = tileToWorld(x, y),
              // the end as the level sprite draws it, in the sprite's own pixels
              local = F.applyInverse(new Point(w.x, w.y));
            return { drawn: M.apply(local), rail: new Point(w.x, w.y + ground(x, y).dz) };
          });
        for (const e of ends) {
          expect(e.drawn.x).toBeCloseTo(e.rail.x, 6);
          expect(e.drawn.y).toBeCloseTo(e.rail.y, 6);
        }
        const [a, b] = ends;
        expect(Math.hypot(b.drawn.x - a.drawn.x, b.drawn.y - a.drawn.y)).toBeCloseTo(
          Math.hypot(b.rail.x - a.rail.x, b.rail.y - a.rail.y),
          6,
        );
      });
    }
});

/**
 * An atlas in which every still frame has `n` wheel phases (`_w1` to `_w<n-1>`). Each frame has
 * its own texture and anchor, so a sprite tells which frame it shows.
 */
function phasedAtlas(n: number) {
  const frames = new Map<string, FrameInfo>();
  const phaseOf = (key: string) => Number(/_w(\d+)$/.exec(key)?.[1] ?? 0);
  const atlas = {
    has: (key: string) => phaseOf(key) < n,
    get: (key: string) => {
      let fr = frames.get(key);
      if (!fr) {
        const k = phaseOf(key);
        fr = {
          texture: new Texture(),
          anchorX: 0.5 - k / 100,
          anchorY: 0.75 + k / 100,
          w: 64,
          h: 48,
        } as unknown as FrameInfo;
        frames.set(key, fr);
      }
      return fr;
    },
  };
  /** The key of the frame a sprite shows, checked against that frame's anchor. */
  const keyOf = (s: Sprite) => {
    const [key, fr] = [...frames].find(([, f]) => f.texture === s.texture) ?? [];
    expect(key, 'the sprite shows an atlas frame').toBeDefined();
    expect([s.anchor.x, s.anchor.y]).toEqual([fr!.anchorX, fr!.anchorY]);
    return key!;
  };
  return { atlas: atlas as unknown as AtlasRegistry, keyOf, phaseOf };
}

/**
 * One locomotive with `body` on a straight rail heading `heading` (a tile axis), drawn by its own
 * renderer over an atlas of `n` phases. `draw` returns the phase each body part and bogie shows.
 */
function phasedScene(n: number, body: BodyFields = { size: 'medium' }, heading = 0) {
  const hx = Math.round(Math.cos(heading)),
    hy = Math.round(Math.sin(heading)),
    spec = vehicleSpec(body),
    rail = new Polyline([
      { x: -6 * hx, y: -6 * hy },
      { x: 6 * hx, y: 6 * hy },
    ]),
    pose = poseVehicle(rail, 6 + spec.L / 2, spec),
    def = { id: 'test', type: 'steam', body: 'box', paint: 'iron', ...body } as LocoDef,
    train = {
      id: 7,
      locos: [{ def }],
      wagons: [],
      reversed: false,
      distance: 100 as number | undefined,
      vehicleSpecs: [spec],
      vehiclePoses: [pose],
      prevVehiclePoses: [pose],
    },
    { atlas, keyOf, phaseOf } = phasedAtlas(n),
    layer = new Container(),
    renderer = new TrainRenderer(atlas, layer),
    count = spec.segments.length;
  /** Draws the train, or an empty fleet when `present` is false. */
  const draw = (present = true) => {
    renderer.update(present ? [train as unknown as Train] : [], 1);
    if (!present) return { parts: [], bogies: [], keys: [], bodies: [] };
    // the body parts' sprites are made first, then the undercarriage holding the bogies
    const bodies = layer.children.slice(0, count) as Sprite[],
      bogies = (layer.children[count] as Container).children as Sprite[],
      keys = bodies.map(keyOf);
    return { parts: keys.map(phaseOf), bogies: bogies.map((b) => phaseOf(keyOf(b))), keys, bodies };
  };
  return { train, renderer, draw, step: WHEEL_CYCLE_TILES / n };
}

describe('TrainRenderer running gear', () => {
  const N = 4;
  /** the phase k + 1 steps backwards from phase 0 */
  const back = (k: number) => (((-k - 1) % N) + N) % N;

  it('turns body and bogies through their phases as the train runs nose first', () => {
    const { train, draw, step } = phasedScene(N);
    expect(draw().parts).toEqual([0]);
    for (let k = 0; k < 3 * N; k++) {
      train.distance = 100 + (k + 0.5) * step;
      const shown = draw();
      expect(shown.parts, `step ${k}`).toEqual([k % N]);
      expect(shown.bogies).toEqual([k % N, k % N]);
    }
  });

  it('shows the partner phase of a mirrored facing at scale -1', () => {
    const f = facingOf(Math.PI / 2);
    expect(DRAWN_FACINGS.has(f)).toBe(false);
    const { train, draw, step } = phasedScene(N, { size: 'medium' }, Math.PI / 2);
    draw();
    train.distance = 100 + 2.5 * step;
    const shown = draw();
    expect(shown.keys[0].endsWith(`_f${mirrorFacing(f)}_w2`)).toBe(true);
    expect(shown.bodies[0].scale.x).toBe(-1);
  });

  it('runs the gear backwards while the train runs tail first', () => {
    const { train, draw, step } = phasedScene(N);
    train.reversed = true;
    draw();
    for (let k = 0; k < 2 * N; k++) {
      train.distance = 100 + (k + 0.5) * step;
      const shown = draw();
      expect(shown.parts, `step ${k}`).toEqual([back(k)]);
      expect(shown.bogies).toEqual([back(k), back(k)]);
    }
  });

  it('keeps the phase at rest and when a standing train turns round', () => {
    const { train, draw, step } = phasedScene(N);
    draw();
    train.distance = 100 + 2.5 * step;
    const before = draw();
    expect(before.parts).toEqual([2]);
    expect(draw().keys).toEqual(before.keys);
    train.reversed = true;
    const turned = draw();
    expect(turned.parts).toEqual([2]);
    expect(turned.keys).not.toEqual(before.keys);
    // and from there it runs the other way
    train.distance += step;
    expect(draw().parts).toEqual([1]);
  });

  it('turns a mirrored segment the other way, and the other way again tail first', () => {
    const { train, draw, step } = phasedScene(N, { size: 'large', plan: 'garratt' });
    draw();
    train.distance = 100 + 0.5 * step;
    // the Garratt's rear engine unit, its last segment, is drawn back to front
    let shown = draw();
    expect(shown.parts).toEqual([0, 0, back(0)]);
    expect(shown.bogies).toEqual([0, 0, 0, 0, back(0), back(0)]);
    train.reversed = true;
    train.distance += 2 * step;
    shown = draw();
    expect(shown.parts).toEqual([back(1), back(1), 1]);
    expect(shown.bogies).toEqual([back(1), back(1), back(1), back(1), 1, 1]);
  });

  it('does not turn on a first sight or when the distance goes down', () => {
    const { train, draw, step } = phasedScene(N);
    train.distance = 100 + 1.5 * step;
    expect(draw().parts).toEqual([0]);
    train.distance += step;
    expect(draw().parts).toEqual([1]);
    train.distance = 3;
    expect(draw().parts).toEqual([1]);
    train.distance = 3 + step;
    expect(draw().parts).toEqual([2]);
  });

  it('shows phase 0 for a missing or non-finite distance', () => {
    const { train, draw, step } = phasedScene(N);
    draw();
    train.distance = 100 + 1.5 * step;
    expect(draw().parts).toEqual([1]);
    for (const d of [undefined, NaN, Infinity]) {
      train.distance = d;
      const shown = draw();
      expect(shown.parts).toEqual([0]);
      expect(shown.bogies).toEqual([0, 0]);
    }
  });

  it('forgets a train it drops: one that comes back is a first sight', () => {
    const { train, renderer, draw, step } = phasedScene(N);
    draw();
    train.distance = 100 + 1.5 * step;
    expect(draw().parts).toEqual([1]);
    draw(false);
    train.distance += step;
    expect(draw().parts).toEqual([0]);
    train.distance += step;
    expect(draw().parts).toEqual([1]);
    renderer.remove(train.id);
    train.distance += step;
    expect(draw().parts).toEqual([0]);
  });
});
