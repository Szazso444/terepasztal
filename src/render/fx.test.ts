import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture, type Graphics, type Polygon } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld } from '../engine/iso';
import { Rng } from '../engine/rng';
import type { Station } from '../sim/stations';
import type { Train } from '../sim/trains';
import { DayNight, Fog, Glows, GroundLights, Smoke, surfaceVersions } from './fx';

const ATLAS = {
  get: () => ({ texture: Texture.EMPTY, anchorX: 0.5, anchorY: 0.5 }),
} as unknown as AtlasRegistry;

/** The ground lights as they were before #555: everything worked out again every frame. */
class EveryFrame {
  private pool = new Map<string, Sprite>();
  constructor(
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
    private readonly inBounds: (x: number, y: number) => boolean,
  ) {}
  private get(key: string) {
    let s = this.pool.get(key);
    if (!s) {
      s = new Sprite(Texture.EMPTY);
      this.layer.addChild(s);
      this.pool.set(key, s);
    }
    return s;
  }
  update(stations: Station[], trains: Train[], night: number) {
    const seen = new Set<string>();
    if (night > 0.02) {
      const R = 2;
      for (const st of stations)
        for (let dy = -R; dy <= R; dy++)
          for (let dx = -R; dx <= R; dx++) {
            const d = Math.abs(dx) + Math.abs(dy);
            if (d > R) continue;
            const x = st.x + dx;
            const y = st.y + dy;
            if (!this.inBounds(x, y)) continue;
            const key = `${x},${y}`;
            const s = this.get(key);
            const p = this.surface(x, y);
            s.position.set(p.x, p.y);
            const a = night * (1 - d / (R + 1)) * (0.55 + st.level * 0.08);
            s.alpha = seen.has(key) ? Math.min(1, s.alpha + a * 0.5) : a;
            s.visible = true;
            seen.add(key);
          }
      for (const t of trains) {
        const pose = t.poses[0];
        if (!pose) continue;
        const dir = pose.heading + (t.reversed ? Math.PI : 0);
        const x = Math.floor(pose.x + Math.cos(dir) * 1.1 + 0.5);
        const y = Math.floor(pose.y + Math.sin(dir) * 1.1 + 0.5);
        if (!this.inBounds(x, y)) continue;
        const key = `${x},${y}`;
        const s = this.get(key);
        const p = this.surface(x, y);
        s.position.set(p.x, p.y);
        s.alpha = seen.has(key) ? Math.min(1, s.alpha + 0.4 * night) : 0.75 * night;
        s.visible = true;
        seen.add(key);
      }
    }
    for (const [key, s] of this.pool)
      if (!seen.has(key)) {
        s.destroy();
        this.pool.delete(key);
      }
  }
}

/** What a layer shows: each light's place, brightness and visibility, in a stable order. */
function shown(layer: Container) {
  return layer.children
    .filter((s) => !s.destroyed)
    .map((s) => `${s.x},${s.y},${s.alpha},${s.visible}`)
    .sort();
}

const W = 40,
  H = 30;
const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

describe('GroundLights', () => {
  it('lights exactly what the every-frame pass lit, frame after frame', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = new Rng(seed);
      // a surface that rises in places; an edit raises a tile and moves the version on
      const raised = new Map<number, number>();
      let version = 0;
      const surface = (x: number, y: number) => ({
        x: (x - y) * 32,
        y: (x + y) * 16 - (raised.get(y * W + x) ?? 0),
      });
      const ours = new Container(),
        theirs = new Container();
      surfaceVersions.set(ours, () => version);
      const lights = new GroundLights(ATLAS, ours, surface, inBounds),
        reference = new EveryFrame(theirs, surface, inBounds);
      const stations: Station[] = [];
      const trains: Train[] = [];
      let night = 1;
      for (let frame = 0; frame < 300; frame++) {
        const op = rng.next();
        if (op < 0.06)
          stations.push({ x: rng.int(-1, W), y: rng.int(-1, H), level: rng.int(0, 3) } as Station);
        else if (op < 0.08 && stations.length) stations.splice(rng.int(0, stations.length - 1), 1);
        else if (op < 0.1 && stations.length) stations[rng.int(0, stations.length - 1)].level++;
        else if (op < 0.15)
          trains.push({
            poses: rng.chance(0.9)
              ? [{ x: rng.range(0, W), y: rng.range(0, H), heading: rng.range(-4, 4) }]
              : [],
            reversed: rng.chance(0.5),
          } as unknown as Train);
        else if (op < 0.17 && trains.length) trains.splice(rng.int(0, trains.length - 1), 1);
        else if (op < 0.2) night = rng.chance(0.3) ? rng.range(0, 0.05) : rng.range(0, 1);
        else if (op < 0.23) {
          raised.set(rng.int(0, W * H - 1), rng.int(1, 30));
          version++;
        }
        // trains run on every frame, some only a little, some on to the next tile
        for (const t of trains) {
          const p = t.poses[0];
          if (p && rng.chance(0.5)) {
            (p as { x: number }).x += rng.range(-0.6, 0.6);
            (p as { y: number }).y += rng.range(-0.6, 0.6);
          }
        }
        lights.update(stations, trains, night);
        reference.update(stations, trains, night);
        expect(shown(ours)).toEqual(shown(theirs));
      }
    }
  });

  it('does no work in a frame where nothing changed', () => {
    let calls = 0;
    const layer = new Container();
    const lights = new GroundLights(
      ATLAS,
      layer,
      (x, y) => {
        calls++;
        return { x, y };
      },
      (x, y) => {
        calls++;
        return inBounds(x, y);
      },
    );
    const stations = [{ x: 5, y: 5, level: 1 } as Station, { x: 6, y: 5, level: 0 } as Station];
    const trains = [{ poses: [{ x: 10, y: 10, heading: 0 }], reversed: false } as unknown as Train];
    lights.update(stations, trains, 1);
    expect(calls).toBeGreaterThan(0);
    const before = shown(layer);
    calls = 0;
    for (let i = 0; i < 10; i++) lights.update(stations, trains, 1);
    expect(calls).toBe(0);
    expect(shown(layer)).toEqual(before);
    // a train moving within its tile changes nothing either
    (trains[0].poses[0] as { x: number }).x += 0.2;
    lights.update(stations, trains, 1);
    expect(calls).toBe(0);
    // moving on to the next tile lights that one and only touches the tiles concerned
    (trains[0].poses[0] as { x: number }).x += 1;
    lights.update(stations, trains, 1);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(10);
  });

  it('moves the lights when the surface under them changes', () => {
    let lift = 0,
      version = 0;
    const layer = new Container();
    surfaceVersions.set(layer, () => version);
    const lights = new GroundLights(ATLAS, layer, (x, y) => ({ x, y: y - lift }), inBounds);
    const stations = [{ x: 5, y: 5, level: 0 } as Station];
    lights.update(stations, [], 1);
    const at = layer.children.map((s) => s.y);
    lift = 7;
    lights.update(stations, [], 1);
    expect(layer.children.map((s) => s.y)).toEqual(at);
    version++;
    lights.update(stations, [], 1);
    expect(layer.children.map((s) => s.y)).toEqual(at.map((y) => y - 7));
  });

  it('puts every light out by day', () => {
    const layer = new Container();
    const lights = new GroundLights(ATLAS, layer, (x, y) => ({ x, y }), inBounds);
    const stations = [{ x: 5, y: 5, level: 0 } as Station];
    lights.update(stations, [], 1);
    expect(layer.children.length).toBe(13);
    lights.update(stations, [], 0);
    expect(layer.children.length).toBe(0);
    lights.update(stations, [], 1);
    expect(layer.children.length).toBe(13);
  });

  it('lights the tile a fixed way ahead of an engine, past the nose of a rendered model', () => {
    const lit = (def: object) => {
      const layer = new Container();
      new GroundLights(ATLAS, layer, (x, y) => ({ x, y }), inBounds).update(
        [],
        [
          {
            poses: [{ x: 10, y: 10, heading: 0 }],
            reversed: false,
            locos: [{ def }],
            vehicleSpecs: [{ L: 4 }],
          } as unknown as Train,
        ],
        1,
      );
      return layer.children.map((s) => [s.x, s.y]);
    };
    expect(lit({})).toEqual([[11, 10]]);
    expect(lit({ spriteGear: true })).toEqual([[13, 10]]);
  });
});

/** An engine standing at (5, 5) heading along x; `def` says what its model says. */
function engine(def: object) {
  return {
    id: 1,
    poses: [{ x: 5, y: 5, heading: 0 }],
    reversed: false,
    hasSteam: true,
    state: 'moving',
    speed: 1000,
    locos: [{ def }],
    vehiclePoses: [{ segments: [{ part: 'body', x: 5, y: 5, angle: 0, mirror: false }] }],
  } as unknown as Train;
}
const RAIL_LIFT = (x: number, y: number) => -(x + y);

describe('Glows', () => {
  it("sets a rendered model's lamps where it says, on the rail under them", () => {
    const layer = new Container();
    new Glows(ATLAS, layer, (x, y) => ({ x, y }), RAIL_LIFT).update(
      [],
      [engine({ lamps: [{ part: 'body', along: 0.5, across: 0.1, up: 6 }] })],
      1,
    );
    const w = tileToWorld(5.5, 4.9);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0].x).toBe(Math.round(w.x));
    expect(layer.children[0].y).toBe(Math.round(w.y - 6 - 10.4));
    expect(layer.children[0].scale.x).toBe(0.6);
  });

  it("keeps any other engine's lamp ahead of its middle, level without a rail height", () => {
    const layer = new Container();
    new Glows(ATLAS, layer, (x, y) => ({ x, y })).update([], [engine({})], 1);
    const w = tileToWorld(5.36, 5);
    expect(layer.children[0].x).toBe(Math.round(w.x));
    expect(layer.children[0].y).toBe(Math.round(w.y) - 8);
    expect(layer.children[0].scale.x).toBe(1);
  });
});

describe('Smoke', () => {
  const puff = (smoke: Smoke, t: Train) => smoke.update([t], 0.001, true);

  it('leaves a rendered model at its chimney', () => {
    const layer = new Container();
    puff(
      new Smoke(ATLAS, layer, RAIL_LIFT),
      engine({ smoke: [{ part: 'body', along: 0.5, up: 20 }] }),
    );
    const w = tileToWorld(5.5, 5);
    expect(layer.children[0].x).toBeCloseTo(w.x, 0);
    expect(layer.children[0].y).toBeCloseTo(w.y - 20 - 10.5, 0);
  });

  it('leaves any other engine ahead of its middle', () => {
    const layer = new Container();
    puff(new Smoke(ATLAS, layer), engine({}));
    const w = tileToWorld(5.24, 5);
    expect(layer.children[0].x).toBeCloseTo(w.x, 0);
    expect(layer.children[0].y).toBeCloseTo(w.y - 30, 0);
  });
});

/** What a fill of a Graphics holds. */
type Painted = { path: { shapePath: { shapePrimitives: { shape: Polygon }[] } } };

describe('how far the fog and the night reach', () => {
  /** Whether a shape of `clip` covers tile (`x`, `y`). */
  const covers = (clip: Graphics, x: number, y: number) => {
    const p = tileToWorld(x, y);
    return clip.context.instructions.some((step) =>
      (step.data as unknown as Painted).path.shapePath.shapePrimitives.some(({ shape }) =>
        shape.contains(p.x, p.y),
      ),
    );
  };
  const clipOf = (fog: Fog) => (fog as unknown as { clip: Graphics }).clip;

  it('clips fog to the map and its ring, with no strip in view', () => {
    const fog = new Fog(ATLAS);
    fog.setWorld(32, 32, 8);
    const clip = clipOf(fog);
    expect(covers(clip, 16, 16)).toBe(true);
    expect(covers(clip, -8, 16)).toBe(true);
    expect(covers(clip, -9, 16)).toBe(false);
    expect(covers(clip, 39, 16)).toBe(true);
    expect(covers(clip, 40, 16)).toBe(false);
  });

  it('reaches over the strip in view and over no other, so it never lies on the bare page', () => {
    const fog = new Fog(ATLAS);
    // a strip block past the upper edge, beside regions that are hidden
    fog.setWorld(64, 64, 8, [{ x0: 16, y0: -12, x1: 32, y1: 16 }]);
    const clip = clipOf(fog);
    expect(covers(clip, 24, -11)).toBe(true);
    expect(covers(clip, 24, -12)).toBe(true);
    expect(covers(clip, 24, -13)).toBe(false);
    // at the same distance out, beside regions with no block: past the ring, so not there
    expect(covers(clip, 8, -11)).toBe(false);
    expect(covers(clip, 40, -11)).toBe(false);
    // the ring itself stays
    expect(covers(clip, 8, -8)).toBe(true);
  });

  it('forgets the reach it had when given less', () => {
    const fog = new Fog(ATLAS);
    fog.setWorld(64, 64, 8, [{ x0: 16, y0: -12, x1: 32, y1: 16 }]);
    fog.setWorld(64, 64, 8);
    expect(covers(clipOf(fog), 24, -11)).toBe(false);
  });

  it('lays the night over the tiles asked for, out to the last one', () => {
    const night = new DayNight();
    night.setWorld(32, 32, 12);
    night.update(0, true);
    const p = tileToWorld(-12, 16);
    const q = tileToWorld(-13, 16);
    const shape = (night.overlay.context.instructions[0].data as unknown as Painted).path.shapePath
      .shapePrimitives[0].shape;
    expect(shape.contains(p.x, p.y)).toBe(true);
    expect(shape.contains(q.x, q.y)).toBe(false);
  });
});
