import { describe, it, expect, beforeEach } from 'vitest';
import { Container, Point, Texture, type Matrix, type Sprite } from 'pixi.js';
import { TrainRenderer } from './trainRenderer';
import { MAX_PHASES, WHEEL_CYCLE_TILES } from './runningGear';
import type { Ground } from './slope';
import { DEFAULT_RELIEF } from './terrainRelief';
import { tileToWorld } from '../engine/iso';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import type { LocoDef } from '../data/content';
import type { Train } from '../sim/trains';
import {
  DRAWN_FACINGS,
  FACINGS,
  Polyline,
  facingAngle,
  facingOf,
  mirrorFacing,
  poseVehicle,
  vehicleSpec,
  type BodyFields,
  type VehiclePose,
  type VehicleSpec,
} from '../sim/body';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { simWorld, line, station } from '../testing/simWorld';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { setSupplyMode, DEFAULT_SUPPLY } from '../sim/supply';
import { resetTrainIds } from '../sim/trains';
import { resetStationIds } from '../sim/stations';
import { SIM_STEP } from '../sim/time';
import { loadKind } from '../art/frames';
import type { Rng } from '../engine/rng';

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

// ------------------------------------------------------------------ running gear properties

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * An atlas in which every still frame has `n` wheel phases, each frame with its own texture and
 * anchor. It records the `_w` names it is asked about and, in order, every frame it hands out.
 */
function gearAtlas(n: number) {
  const phaseOf = (key: string) => Number(/_w(\d+)$/.exec(key)?.[1] ?? 0);
  const frames = new Map<string, FrameInfo>(),
    keys = new Map<Texture, string>(),
    probes: string[] = [],
    gets: string[] = [];
  const atlas = {
    has(key: string) {
      if (/_w\d+$/.test(key)) probes.push(key);
      return phaseOf(key) < n;
    },
    get(key: string) {
      gets.push(key);
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
        keys.set(fr.texture, key);
      }
      return fr;
    },
  };
  /** The key of the frame a sprite shows, its anchor checked against that frame's. */
  const keyOf = (s: Sprite) => {
    const key = keys.get(s.texture);
    expect(key, 'the sprite shows an atlas frame').toBeDefined();
    const fr = frames.get(key!)!;
    expect([s.anchor.x, s.anchor.y], key).toEqual([fr.anchorX, fr.anchorY]);
    return key!;
  };
  return { atlas: atlas as unknown as AtlasRegistry, keyOf, probes, gets };
}

/**
 * A shown key read back without the renderer's rules: the still frame, the phase, and the
 * tile-space heading the drawn nose points along (a sprite at scale -1 shows the facing whose
 * mirror partner was drawn).
 */
function reading(key: string, s: Sprite) {
  const m = /_f(\d+)(?:_w(\d+))?$/.exec(key);
  expect(m, key).not.toBeNull();
  const drawn = Number(m![1]);
  const facing = s.scale.x < 0 ? mirrorFacing(drawn) : drawn;
  return { still: key.replace(/_w\d+$/, ''), phase: Number(m![2] ?? 0), nose: facingAngle(facing) };
}

/** One vehicle's sprites in a renderer's layer from child `at`: its parts, then its bogies. */
function spritesAt(layer: Container, at: number, spec: VehicleSpec, load = false) {
  const count = spec.segments.length,
    parts = layer.children.slice(at, at + count) as Sprite[],
    bogies = (layer.children[at + count] as Container).children as Sprite[],
    // which segment each bogie sprite hangs under
    segOf = spec.drawBogies ? spec.segments.flatMap((s, si) => Array<number>(s.nb).fill(si)) : [];
  return {
    sprites: [
      ...parts.map((s, si) => ({ name: `part ${si}`, seg: si, s, body: true })),
      ...bogies.map((s, bi) => ({ name: `bogie ${bi}`, seg: segOf[bi], s, body: false })),
    ],
    load: load ? (layer.children[at + count + 1] as Sprite) : null,
    next: at + count + 1 + (load ? 1 : 0),
  };
}

/**
 * What the gear of one train must show, from geometry alone: per sprite, the tiles it has run
 * towards its drawn nose (negative towards its tail) since the train was last a first sight.
 */
class GearOracle {
  last: number | null = null;
  travel = new Map<string, number>();
  centres: { x: number; y: number }[][] = [];
  keys: string[] | null = null;
  reset() {
    this.last = null;
    this.travel.clear();
  }
  /**
   * Checks one drawn frame of a train whose vehicles are `poses`, against what `shown` (the
   * sprites with their keys read back) display; `n` phases. Returns the rise it counted.
   */
  frame(
    where: string,
    n: number,
    distance: number | undefined,
    poses: VehiclePose[],
    shown: { vehicle: number; name: string; seg: number; key: string; s: Sprite }[],
  ) {
    const finite = typeof distance === 'number' && Number.isFinite(distance);
    const rise = finite && this.last !== null ? distance - this.last : 0;
    for (const x of shown) {
      const r = reading(x.key, x.s),
        id = `vehicle ${x.vehicle} ${x.name}`;
      if (!finite) {
        expect(r.phase, `${where}: ${id}, no distance`).toBe(0);
        continue;
      }
      const c = poses[x.vehicle].segments[x.seg],
        p = this.centres[x.vehicle]?.[x.seg];
      if (rise > 0 && p) {
        const dx = c.x - p.x,
          dy = c.y - p.y,
          along = dx * Math.cos(r.nose) + dy * Math.sin(r.nose);
        // it moved as far as the distance rose, close to its own axis
        expect(Math.abs(Math.hypot(dx, dy) - rise), `${where}: ${id} moved`).toBeLessThan(1e-9);
        expect(Math.abs(along), `${where}: ${id} along its axis`).toBeGreaterThan(0.99 * rise);
        this.travel.set(id, (this.travel.get(id) ?? 0) + Math.sign(along) * rise);
      }
      const t = this.travel.get(id) ?? 0;
      expect(r.phase, `${where}: ${id} after ${t} tiles nose first`).toBe(
        mod(Math.floor((t / WHEEL_CYCLE_TILES) * n), n),
      );
    }
    if (finite) this.last = distance;
    else this.reset();
    this.centres = poses.map((v) => v.segments.map((s) => ({ x: s.x, y: s.y })));
    return rise;
  }
}

/**
 * A one-locomotive train on a straight rail through the origin at heading `theta`, posed as
 * Train.updatePoses poses one: the rail runs the way of travel with the leading end at arc 50,
 * so a tail-first train stands on a rail laid the other way. Its own front is the +theta end.
 */
function mover(id: number, body: BodyFields, theta: number, distance: number, reversed: boolean) {
  const spec = vehicleSpec(body),
    def = { id: `gear${id}`, type: 'steam', body: 'box', paint: 'iron', ...body } as LocoDef,
    train = {
      id,
      locos: [{ def }],
      wagons: [],
      reversed,
      distance: distance as number | undefined,
      vehicleSpecs: [spec],
      vehiclePoses: [] as VehiclePose[],
      prevVehiclePoses: [] as VehiclePose[],
    },
    ux = Math.cos(theta),
    uy = Math.sin(theta);
  let front = 0;
  const place = () => {
    const dir = train.reversed ? -1 : 1,
      lead = train.reversed ? front - spec.L : front,
      at = (s: number) => ({ x: s * ux, y: s * uy }),
      pose = poseVehicle(
        new Polyline([at(lead - 50 * dir), at(lead + 50 * dir)]),
        50,
        spec,
        train.reversed,
      );
    train.vehiclePoses = [pose];
    train.prevVehiclePoses = [pose];
  };
  place();
  return {
    train,
    spec,
    /** run `tiles` the way of travel */
    run(tiles: number) {
      front += train.reversed ? -tiles : tiles;
      place();
    },
    /** stand somewhere else along the rail, facing as before */
    shift(tiles: number) {
      front += tiles;
      place();
    },
    /** turn round where it stands */
    turn() {
      train.reversed = !train.reversed;
      place();
    },
  };
}

const GEAR_BODIES: BodyFields[] = [
  { size: 'medium' },
  { size: 'small' },
  { size: 'large' },
  { size: 'medium', plan: 'tender' },
  // the rear engine unit is drawn back to front; the cradle's trucks are not drawn at all
  {
    size: 'large',
    plan: 'garratt',
    bogieStyle: { engine: ['leading', 'gmam'], cradle: 'none' },
  } as BodyFields,
  { size: 'large', plan: 'meyer' },
];

/** Distances are in 64ths of a tile, so every sum is exact. */
type GearOp =
  | { kind: 'run'; j: number }
  | { kind: 'turn' }
  | { kind: 'fall'; by: number; jump: number }
  | { kind: 'bad'; value: 'undefined' | 'NaN' | 'Infinity'; j: number }
  | { kind: 'gone'; j: number }
  | { kind: 'remove'; j: number };

interface GearCase {
  n: number;
  body: number;
  facing: number;
  /** share of a facing step the rail is turned off the facing, clear of the next one */
  off: number;
  reversed: boolean;
  start: number;
  ops: GearOp[];
}

function genGear(rng: Rng): GearCase {
  return {
    n: rng.pick([1, 2, 3, 4, 5, 8, 16]),
    body: rng.int(0, GEAR_BODIES.length - 1),
    facing: rng.int(0, FACINGS - 1),
    off: rng.range(-0.4, 0.4),
    reversed: rng.chance(0.5),
    start: rng.int(0, 6400),
    ops: Array.from({ length: rng.int(1, 40) }, (): GearOp => {
      const p = rng.next();
      if (p < 0.55) return { kind: 'run', j: rng.int(0, 12) };
      if (p < 0.7) return { kind: 'turn' };
      if (p < 0.8) return { kind: 'fall', by: rng.int(1, 640), jump: rng.int(-64, 64) };
      if (p < 0.88)
        return {
          kind: 'bad',
          value: rng.pick(['undefined', 'NaN', 'Infinity']),
          j: rng.int(0, 12),
        };
      if (p < 0.94) return { kind: 'gone', j: rng.int(0, 12) };
      return { kind: 'remove', j: rng.int(0, 12) };
    }),
  };
}

function* shrinkGear(c: GearCase): Iterable<GearCase> {
  const op = function* (o: GearOp): Iterable<GearOp> {
    if ('j' in o) for (const j of shrinkInt(o.j)) yield { ...o, j };
    if (o.kind === 'fall') {
      for (const by of shrinkInt(o.by, 1)) yield { ...o, by };
      for (const jump of shrinkInt(o.jump)) yield { ...o, jump };
    }
  };
  for (const ops of shrinkArray(c.ops, op)) yield { ...c, ops };
  for (const n of shrinkInt(c.n, 1)) yield { ...c, n };
  for (const body of shrinkInt(c.body)) yield { ...c, body };
  for (const facing of shrinkInt(c.facing)) yield { ...c, facing };
  if (c.off !== 0) yield { ...c, off: 0 };
  if (c.reversed) yield { ...c, reversed: false };
  for (const start of shrinkInt(c.start)) yield { ...c, start };
}

describe('TrainRenderer running gear properties', () => {
  it('each part turns its gear by its own run along its drawn nose; only the frame changes', () => {
    forAll(
      genGear,
      ({ n, body, facing, off, reversed, start, ops }) => {
        const phased = gearAtlas(n),
          still = gearAtlas(1),
          layers = [new Container(), new Container()],
          renderers = [
            new TrainRenderer(phased.atlas, layers[0]),
            new TrainRenderer(still.atlas, layers[1]),
          ];
        const a = mover(
          1,
          GEAR_BODIES[body],
          (facing + off) * ((2 * Math.PI) / FACINGS),
          0,
          reversed,
        );
        // a second train runs nose first all along: nothing done to the first may reach it
        const b = mover(2, { size: 'medium' }, facingAngle(7) + 0.01, 0, false);
        let dist = 1000 + start / 64;
        a.train.distance = dist;
        const oracles = new Map([
          [a, new GearOracle()],
          [b, new GearOracle()],
        ]);
        const frame = (where: string, withA = true) => {
          const here = withA ? [b, a] : [b];
          phased.gets.length = 0;
          for (const r of renderers)
            r.update(
              here.map((m) => m.train as unknown as Train),
              1,
            );
          let at = 0,
            // body parts are drawn in order: each one's shown frame, then its window light's
            cursor = 0;
          for (const m of here) {
            const shown = spritesAt(layers[0], at, m.spec),
              plain = spritesAt(layers[1], at, m.spec);
            at = shown.next;
            const read: Parameters<GearOracle['frame']>[4] = [];
            shown.sprites.forEach((x, i) => {
              // the phase hook changes which frame is shown and nothing else
              const twin = plain.sprites[i].s,
                what = `${where}: train ${m.train.id} ${x.name}`;
              expect(
                [twin.visible, twin.x, twin.y, twin.scale.x, twin.scale.y, twin.rotation],
                what,
              ).toEqual([x.s.visible, x.s.x, x.s.y, x.s.scale.x, x.s.scale.y, x.s.rotation]);
              expect([twin.zIndex, twin.tint], what).toEqual([x.s.zIndex, x.s.tint]);
              if (!x.s.visible) return;
              const key = phased.keyOf(x.s),
                r = reading(key, x.s);
              // the still renderer shows the still frame of the same facing, never a phase
              expect(still.keyOf(twin), what).toBe(r.still);
              // the window light reads the still frame, asked for right after the shown one
              if (x.body) {
                cursor = phased.gets.indexOf(key, cursor) + 2;
                expect(cursor, `${what}: shown frame asked for`).toBeGreaterThan(1);
                expect(phased.gets[cursor - 1], what).toBe(r.still);
              }
              read.push({ vehicle: 0, name: x.name, seg: x.seg, key, s: x.s });
            });
            const o = oracles.get(m)!,
              keys = read.map((x) => x.key);
            o.frame(
              `${where}, train ${m.train.id}`,
              n,
              m.train.distance,
              m.train.vehiclePoses,
              read,
            );
            o.keys = keys;
          }
          if (!withA) {
            oracles.get(a)!.reset();
            oracles.get(a)!.keys = null;
          }
        };
        frame('first sight');
        ops.forEach((op, k) => {
          const where = `op ${k} (${op.kind})`;
          b.run(3 / 64);
          b.train.distance! += 3 / 64;
          if ('j' in op) {
            a.run(op.j / 64);
            dist += op.j / 64;
          }
          a.train.distance = dist;
          switch (op.kind) {
            case 'run':
              return frame(where);
            case 'turn': {
              const before = oracles.get(a)!.keys;
              a.turn();
              frame(where);
              // a train turned round where it stands looks exactly as it did
              const after = oracles.get(a)!.keys;
              if (before) expect([...after!].sort(), where).toEqual([...before].sort());
              return;
            }
            case 'fall':
              dist -= op.by / 64;
              a.train.distance = dist;
              a.shift(op.jump / 64);
              return frame(where);
            case 'bad':
              a.train.distance = { undefined, NaN, Infinity }[op.value];
              return frame(where);
            case 'gone':
              return frame(where, false);
            case 'remove':
              for (const r of renderers) r.remove(a.train.id);
              oracles.get(a)!.reset();
              return frame(where);
          }
        });
        // each still frame's `_w` names are probed once over the whole run, at most 15 of them
        for (const { probes } of [phased, still]) {
          expect(new Set(probes).size, 'a _w name probed twice').toBe(probes.length);
          const per = new Map<string, number>();
          for (const p of probes) {
            const k = p.replace(/_w\d+$/, '');
            per.set(k, (per.get(k) ?? 0) + 1);
          }
          for (const [k, count] of per) expect(count, k).toBeLessThanOrEqual(MAX_PHASES - 1);
        }
      },
      { shrink: shrinkGear },
    );
  });
});

/**
 * Sim steps the simulated run lasts. On seed 7 the Garratt runs about 12 tiles nose first, turns
 * round standing and runs nearly 2 tiles tail first into the quarry within the first 520 steps;
 * the run asserts that it did.
 */
const TICKS = 800;

describe('TrainRenderer running gear on a simulated train', () => {
  beforeEach(() => {
    Object.assign(rules, DEFAULT_RULES);
    setSupplyMode(DEFAULT_SUPPLY);
    resetTrainIds();
    resetStationIds();
  });

  it('a Garratt run out and back turns every part with its own motion, and only when it moves', () => {
    const w = simWorld({ seed: 7, size: 64, terrain: 'grass' });
    const RUN = 14,
      x = 10,
      y = 20;
    station(w, 'depot', x, y);
    line(w, x + 2, y, x + 2 + RUN);
    const quarry = station(w, 'quarry', x + 8, y - 1);
    const warehouse = station(w, 'warehouse', x + RUN, y - 1);
    quarry.store('stone', 40);
    w.stock.add('coal', 400);
    w.stock.add('water', 400);
    const loco = w.inventory.add('gmam', 0);
    const hopper = w.inventory.items.find((i) => i.defId === 'wood_hopper');
    expect(hopper, 'a starter wood hopper').toBeDefined();
    const made = w.fleet.create([loco.uid], [hopper!.uid], [quarry.id, warehouse.id]);
    if (typeof made === 'string') throw new Error(`fleet.create: ${made}`);
    const train = made;

    const n = 8,
      { atlas, keyOf } = gearAtlas(n),
      layer = new Container(),
      renderer = new TrainRenderer(atlas, layer),
      oracle = new GearOracle(),
      seen = { noseFirst: 0, tailFirst: 0, turned: 0, mirroredRun: 0, bogieRun: 0, cargo: 0 };
    let wasReversed = train.reversed;
    for (let tick = 0; tick < TICKS; tick++) {
      if (tick > 0) {
        w.clock.time += SIM_STEP;
        w.fleet.tick(SIM_STEP, w.clock.time);
      }
      const before = oracle.centres;
      renderer.update(w.fleet.trains, 1);
      const read: Parameters<GearOracle['frame']>[4] = [];
      let at = 0;
      train.vehicleSpecs.forEach((spec, v) => {
        const isWagon = v >= train.locos.length,
          load = isWagon && loadKind(train.wagons[v - train.locos.length].def) !== 'none',
          shown = spritesAt(layer, at, spec, load);
        at = shown.next;
        for (const x of shown.sprites)
          if (x.s.visible)
            read.push({ vehicle: v, name: x.name, seg: x.seg, key: keyOf(x.s), s: x.s });
        // a cargo overlay keeps its still frame
        if (shown.load?.visible) {
          expect(keyOf(shown.load), `tick ${tick}: cargo on vehicle ${v}`).not.toMatch(/_w\d+$/);
          seen.cargo++;
        }
      });
      const rise = oracle.frame(`tick ${tick}`, n, train.distance, train.vehiclePoses, read);
      if (rise === 0 && before.length)
        // nothing moves while the distance stands still: no motion goes uncounted
        train.vehiclePoses.forEach((v, i) =>
          v.segments.forEach((s, si) => {
            const p = before[i][si];
            expect(
              Math.hypot(s.x - p.x, s.y - p.y),
              `tick ${tick}: vehicle ${i} part ${si} moved`,
            ).toBeLessThan(1e-9);
          }),
        );
      if (rise > 0) {
        seen[train.reversed ? 'tailFirst' : 'noseFirst']++;
        if (train.vehiclePoses.some((v) => v.segments.some((s) => s.mirror))) seen.mirroredRun++;
        if (read.some((x) => x.name.startsWith('bogie'))) seen.bogieRun++;
      } else if (train.reversed !== wasReversed) seen.turned++;
      wasReversed = train.reversed;
    }
    // not vacuous: it ran both ways, turned round standing, and its mirrored unit and bogies ran
    expect(
      Object.values(seen).every((k) => k > 0),
      JSON.stringify(seen),
    ).toBe(true);
  });
});
