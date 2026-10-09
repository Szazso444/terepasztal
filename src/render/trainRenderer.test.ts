import { describe, it, expect } from 'vitest';
import { Container, Point, Texture, type Matrix, type Sprite } from 'pixi.js';
import { TrainRenderer } from './trainRenderer';
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
