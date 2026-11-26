import { describe, it, expect } from 'vitest';
import { Container, Graphics, Sprite, Texture, type Matrix } from 'pixi.js';
import { TrainRenderer } from './trainRenderer';
import { layerPortals, type TunnelPortals } from './tunnelPortals';
import { SwingSprite } from './swingSprite';
import { spriteFacing } from './spriteFacing';
import { AtmosphereTint, multiplyTint } from './atmosphere';
import { pitchTilt, type Ground } from './slope';
import { tileToWorld } from '../engine/iso';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import type { LocoDef, WagonDef } from '../data/content';
import type { Train } from '../sim/trains';
import { Polyline, poseVehicle, vehicleSpec, type BodyFields, type VehiclePose } from '../sim/body';

/** A diesel on two trucks of its own, whose frames turn its wheels. */
const DIESEL = {
  id: 'dsl',
  type: 'diesel',
  body: 'box',
  paint: 'iron',
  size: 'medium',
  gear: {
    parts: [
      {
        part: 'body',
        from: 0,
        to: 1,
        trucks: [
          [0.2, 0.3],
          [0.7, 0.8],
        ],
      },
    ],
  },
  lengthTiles: 2,
  spriteGear: true,
  truckSprites: { body: [0, 1] },
  truckOffsets: { 'body-t0': 0.25, 'body-t1': 0 },
  wheels: {
    'body-t0': { phases: 4, cycle: 0.1, integrated: true },
    'body-t1': { phases: 4, cycle: 0.1, integrated: true },
  },
  spriteFacings: 192,
} as unknown as LocoDef;

/** A steam engine and tender on fixed axles, the engine's coupled wheels a layer of their own. */
const STEAM = {
  id: 'stm',
  type: 'steam',
  body: 'box',
  paint: 'iron',
  size: 'medium',
  gear: {
    parts: [
      { part: 'tender', from: 0, to: 0.35, rigid: [0.1, 0.25] },
      { part: 'engine', from: 0.4, to: 1, rigid: [0.5, 0.8] },
    ],
  },
  lengthTiles: 2,
  spriteGear: true,
  wheels: { engine: { phases: 4, cycle: 0.1, layer: 'engine-w' } },
  spriteFacings: 192,
} as unknown as LocoDef;

const PLAIN_WAGON = {
  id: 'wgn',
  body: 'flat',
  paint: 'iron',
  size: 'medium',
  carries: 'bulk',
} as unknown as WagonDef;

/** An atlas whose every frame has a texture of its own; it answers `want` as the test says. */
function modelAtlas(has: (key: string) => boolean = (k) => !k.includes('_lit_')) {
  const frames = new Map<string, FrameInfo>(),
    keys = new Map<Texture, string>(),
    state = { ready: true, wanted: [] as string[], sweeps: 0 };
  const atlas = {
    has,
    get(key: string) {
      let fr = frames.get(key);
      if (!fr) {
        fr = { texture: new Texture(), anchorX: 0.5, anchorY: 0.75, w: 64, h: 48 } as FrameInfo;
        frames.set(key, fr);
        keys.set(fr.texture, key);
      }
      return fr;
    },
    want(stem: string) {
      state.wanted.push(stem);
      return state.ready;
    },
    sweep() {
      state.sweeps++;
    },
  };
  return {
    atlas: atlas as unknown as AtlasRegistry,
    keyOf: (s: Container) => keyOf(keys, s),
    state,
  };
}
function keyOf(keys: Map<Texture, string>, s: Container) {
  return keys.get((s as SwingSprite).texture) ?? '';
}

/** A train of `defs` nose to tail on a straight rail heading `theta`, the first `locos` engines. */
function trainOf(defs: (BodyFields & { id: string })[], locos: number, theta = 0.3) {
  const cos = Math.cos(theta),
    sin = Math.sin(theta),
    rail = new Polyline([
      { x: -20 * cos, y: -20 * sin },
      { x: 20 * cos, y: 20 * sin },
    ]),
    specs = defs.map((d) => vehicleSpec(d));
  let at = 20;
  const poses: VehiclePose[] = specs.map((spec) => {
    const pose = poseVehicle(rail, at + spec.L / 2, spec);
    at -= spec.L + 0.2;
    return pose;
  });
  return {
    id: 1,
    locos: defs.slice(0, locos).map((def) => ({ def })),
    wagons: defs.slice(locos).map((def) => ({ def, cargo: null, amount: 0 })),
    reversed: false,
    distance: 100,
    vehicleSpecs: specs,
    vehiclePoses: poses,
    prevVehiclePoses: poses,
  } as unknown as Train & { distance: number };
}

/** The undercarriage of the first vehicle: its bogies are the sprites in it. */
const trucksOf = (layer: Container) => layer.children.find((c) => c.sortableChildren)!;

describe('TrainRenderer with a rendered model', () => {
  it('shows its own frames at its own number of headings, trucks and wheels included', () => {
    const train = trainOf([DIESEL], 1),
      { atlas, keyOf } = modelAtlas(),
      layer = new Container();
    new TrainRenderer(atlas, layer).update([train], 1);
    const body = layer.children[0],
      heading = spriteFacing(train.vehiclePoses[0].segments[0].angle, 192);
    expect(body).toBeInstanceOf(SwingSprite);
    expect(keyOf(body)).toBe(`rolling/loco_dsl_body_f${heading}`);
    const trucks = trucksOf(layer).children;
    expect(trucks).toHaveLength(2);
    expect(trucks.every((t) => t instanceof SwingSprite)).toBe(true);
    expect(keyOf(trucks[0])).toMatch(/^rolling\/loco_dsl_body-t\d_w0_f\d+$/);
  });

  it('sets a truck back from its pivot by the measured offset', () => {
    const train = trainOf([DIESEL], 1),
      { atlas } = modelAtlas(),
      layer = new Container();
    new TrainRenderer(atlas, layer).update([train], 1);
    const seg = train.vehiclePoses[0].segments[0],
      b = seg.bogies.find((p) => p.truck === 0)!,
      w = tileToWorld(b.drawX - Math.cos(b.angle) * 0.25, b.drawY - Math.sin(b.angle) * 0.25),
      k = seg.bogies.indexOf(b);
    expect(trucksOf(layer).children[k].x).toBeCloseTo(w.x, 0);
    expect(trucksOf(layer).children[k].y).toBeCloseTo(w.y, 0);
  });

  it('turns frames that hold their wheels with the track run, the other way tail first', () => {
    const train = trainOf([DIESEL], 1),
      { atlas, keyOf } = modelAtlas(),
      layer = new Container(),
      renderer = new TrainRenderer(atlas, layer),
      phase = () => Number(/_w(\d)_/.exec(keyOf(trucksOf(layer).children[0]))![1]);
    renderer.update([train], 1);
    expect(phase()).toBe(0);
    train.distance += 0.03;
    renderer.update([train], 1);
    expect(phase()).toBe(1);
    train.reversed = true;
    train.distance += 0.03;
    renderer.update([train], 1);
    expect(phase()).toBe(0);
  });

  it('draws a wheel layer of its own right over the body, hidden where it has no frame', () => {
    const train = trainOf([STEAM], 1),
      seen = { blank: false },
      { atlas, keyOf } = modelAtlas(
        (k) => !k.includes('_lit_') && !(seen.blank && k.includes('-w')),
      ),
      layer = new Container(),
      renderer = new TrainRenderer(atlas, layer);
    renderer.update([train], 1);
    const sprites = layer.children.filter((c) => c instanceof SwingSprite),
      wheels = sprites.find((c) => keyOf(c).includes('_engine-w_w0_f'))!,
      engine = sprites.find((c) => keyOf(c).includes('_engine_f'))!;
    expect(wheels.visible).toBe(true);
    expect(wheels.zIndex).toBeCloseTo(engine.zIndex + 0.005, 9);
    seen.blank = true;
    renderer.update([train], 1);
    expect(wheels.visible).toBe(false);
  });

  it('tilts as a whole on a grade', () => {
    const train = trainOf([DIESEL], 1, 0),
      ground = (x: number): Ground => ({ dz: -8 * x, sgx: -8, sgy: 0 }),
      { atlas } = modelAtlas(),
      layer = new Container();
    new TrainRenderer(atlas, layer, ground).update([train], 1);
    const body = layer.children[0];
    body.updateLocalTransform();
    const m: Matrix = body.localTransform,
      want = pitchTilt(-8, 1, 0);
    expect(m.a).toBeCloseTo(want.a, 6);
    expect(m.b).toBeCloseTo(want.b, 6);
    expect(m.c).toBeCloseTo(want.c, 6);
    expect(m.d).toBeCloseTo(want.d, 6);
  });

  it('is drawn once its pages are in, and only its pages are asked for', () => {
    const train = trainOf([STEAM, PLAIN_WAGON], 1),
      { atlas, state } = modelAtlas(),
      layer = new Container(),
      renderer = new TrainRenderer(atlas, layer);
    state.ready = false;
    renderer.update([train], 1);
    expect(layer.children).toHaveLength(0);
    expect(state.wanted).toEqual(['rolling/loco_stm']);
    expect(state.sweeps).toBe(1);
    state.ready = true;
    renderer.update([train], 1);
    expect(layer.children.length).toBeGreaterThan(0);
    // once the train is gone the sweep still runs: that is what gives the pages back
    renderer.update([], 1);
    expect(state.sweeps).toBe(3);
  });

  it('couples two models, and neither a model to a plain wagon nor two plain wagons', () => {
    const links = (defs: (BodyFields & { id: string })[]) => {
      const { atlas } = modelAtlas(),
        layer = new Container();
      new TrainRenderer(atlas, layer).update([trainOf(defs, 1)], 1);
      return layer.children.filter((c) => c instanceof Graphics).length;
    };
    const model = { ...DIESEL, id: 'two' };
    expect(links([DIESEL, model])).toBe(1);
    // an engine and its tender are coupled too
    expect(links([STEAM])).toBe(1);
    expect(links([DIESEL, PLAIN_WAGON])).toBe(0);
    expect(links([DIESEL, PLAIN_WAGON, PLAIN_WAGON])).toBe(0);
  });

  it('leaves the plain wagon behind it drawn as a plain sprite', () => {
    const train = trainOf([DIESEL, PLAIN_WAGON], 1),
      { atlas, keyOf } = modelAtlas(),
      layer = new Container();
    new TrainRenderer(atlas, layer).update([train], 1);
    // its body comes first, then the sprite of its load
    const plain = layer.children.filter((c) => c instanceof Sprite);
    expect(plain).toHaveLength(2);
    // this atlas has every frame, so the wagon's own model name wins over its single sprite
    expect(keyOf(plain[0])).toMatch(/^rolling\/wagon_wgn_(body_)?f\d+$/);
  });

  it('shows its body and wheels under the night colour, once, and its windows at their own', () => {
    const night = 0x5b6bad,
      train = trainOf([STEAM], 1),
      lit = modelAtlas(() => true),
      layer = new Container(),
      atmosphere = new AtmosphereTint(layer),
      renderer = new TrainRenderer(lit.atlas, layer);
    atmosphere.apply(night);
    renderer.setWindowNight(1);
    renderer.update([train], 1);
    atmosphere.apply(night);
    renderer.update([train], 1);
    // the sweep has looked at every object and found nothing to multiply again
    for (let k = 0; k < 3; k++) atmosphere.apply(night);
    const sprites = layer.children.filter((c) => c instanceof SwingSprite),
      lights = sprites.filter((c) => c.label === 'emissive'),
      solid = sprites.filter((c) => c.label !== 'emissive');
    expect(solid.length).toBeGreaterThanOrEqual(3);
    for (const s of solid) expect(s.tint).toBe(multiplyTint(0xffffff, night));
    expect(lights).toHaveLength(2);
    for (const l of lights) {
      expect(lit.keyOf(l)).toContain('_lit_f');
      expect(l.tint).toBe(0xffffff);
      expect(l.alpha).toBeCloseTo(0.9, 6);
      expect(l.blendMode).toBe('add');
    }
  });

  it('near a portal its window lights take the mask of the body they light', () => {
    const mask = new Graphics(),
      train = trainOf([STEAM], 1),
      lit = modelAtlas(() => true),
      layer = new Container();
    layerPortals.set(layer, {
      dress: (s: Container) => {
        s.mask = mask;
      },
    } as unknown as TunnelPortals);
    const renderer = new TrainRenderer(lit.atlas, layer);
    renderer.update([train], 1);
    const lights = layer.children.filter((c) => c.label === 'emissive');
    expect(lights.length).toBeGreaterThan(0);
    for (const l of lights) expect(l.mask).toBe(mask);
  });

  it('a coupling takes its depth from a portal last, as a body and a truck do', () => {
    const { atlas } = modelAtlas(),
      layer = new Container();
    layerPortals.set(layer, {
      dress: (s: Container) => {
        s.zIndex = 7777;
      },
    } as unknown as TunnelPortals);
    new TrainRenderer(atlas, layer).update([trainOf([DIESEL, { ...DIESEL, id: 'two' }], 1)], 1);
    const links = layer.children.filter((c) => c instanceof Graphics);
    expect(links).toHaveLength(1);
    expect(links[0].zIndex).toBe(7777);
  });

  it('gives back everything it made when the train goes', () => {
    const train = trainOf([STEAM], 1),
      { atlas } = modelAtlas(() => true),
      layer = new Container(),
      renderer = new TrainRenderer(atlas, layer);
    renderer.update([train], 1);
    expect(layer.children.length).toBeGreaterThan(0);
    renderer.remove(train.id);
    expect(layer.children).toHaveLength(0);
  });

  it('rebuilds when a model takes over the place of a plain vehicle of the same shape', () => {
    const def = { ...DIESEL, spriteGear: false },
      train = trainOf([def], 1),
      { atlas } = modelAtlas(),
      layer = new Container(),
      renderer = new TrainRenderer(atlas, layer);
    renderer.update([train], 1);
    expect(layer.children[0]).toBeInstanceOf(Sprite);
    train.locos[0] = { ...train.locos[0], def: DIESEL };
    Object.assign(train, { vehicleSpecs: [vehicleSpec(DIESEL)] });
    renderer.update([train], 1);
    expect(layer.children[0]).toBeInstanceOf(SwingSprite);
  });
});
