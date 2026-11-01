import { describe, expect, it, vi } from 'vitest';
import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
  type InstructionSet,
  type Renderer,
} from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { depthKey, tileToWorld } from '../engine/iso';
import { Underground, type Face } from '../sim/underground';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain, type GameMap } from '../world/tiles';
import type { PortalArt } from './tunnelPortalArt';
import { fitFace, hillLine, openingOutline, TunnelPortals, type PortalHost } from './tunnelPortals';
import { ChunkCull } from './chunkCull';
import { layerPortals } from './tunnelPortals';
import { WorldRenderer } from './worldRenderer';

const TEXELS = new Texture({
  source: new TextureSource({ width: 64, height: 64 }),
  frame: new Rectangle(0, 0, 64, 64),
});
const BACK = new Texture(),
  DARK = new Texture(),
  art: PortalArt = {
    back: () => ({ texture: BACK, x: 0, y: 0, scale: 1 }),
    dark: () => ({ texture: DARK, x: 0, y: 0, scale: 1 }),
  };

/** A map of 40 x 40 tiles with dug tiles and portals, level ground, and rails where it says. */
function stage(lift: (x: number, y: number) => number = () => 0, size = 40) {
  const under = new Underground(size, size),
    layer = new Container(),
    rails = new Map<string, Sprite>(),
    view = { glass: false },
    host: PortalHost = {
      layer,
      under: () => under,
      glass: () => view.glass,
      levelPx: () => 10,
      lift,
      rail: (x, y) => rails.get(`${x},${y}`),
      railMesh: () => undefined,
    },
    portals = new TunnelPortals(host);
  portals.art = art;
  const dig = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) under.dig(x, y, 0);
    },
    portal = (x: number, y: number, face: Face) => under.addPortal({ x, y, face, floor: 0 }),
    rail = (x: number, y: number) => {
      const s = new Sprite(new Texture());
      s.position.copyFrom(tileToWorld(x, y));
      rails.set(`${x},${y}`, s);
      return s;
    },
    sprites = () => layer.children.filter((c) => c instanceof Sprite) as Sprite[],
    picture = (t: Texture) => sprites().find((s) => s.texture === t),
    /** A car's sprite posed at (x, y): where it stands, what shows, where it sorts. */
    car = (x: number, y: number) => {
      const s = new Sprite();
      s.zIndex = depthKey(x, y, 15);
      portals.dress(s, x, y);
      return s;
    };
  return { under, layer, rails, view, host, portals, dig, portal, rail, sprites, picture, car };
}
/** A line along y = 10: dug from x = 3 to 10, a portal on E at the end. */
function east() {
  const t = stage();
  t.dig(3, 10, 10, 10);
  t.portal(10, 10, 'E');
  t.under.cut(11, 10);
  t.portals.refresh();
  return t;
}

describe('the opening of a portal', () => {
  /** Do segments a-b and c-d cross, each passing strictly through the other? */
  const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return side(a, b, c) * side(a, b, d) < -1e-9 && side(c, d, a) * side(c, d, b) < -1e-9;
  };
  type Pt = { x: number; y: number };
  it('the opening`s outline never crosses itself', () => {
    const grounds = [
      () => 0,
      () => -5,
      () => 12,
      () => 200,
      (u: number) => 80 * u,
      (u: number) => -60 * u,
      (u: number) => 40 + 40 * Math.sin(u * 17),
    ];
    for (const ground of grounds) {
      const line = openingOutline(ground);
      for (let i = 0; i < line.length; i++)
        for (let j = i + 2; j < line.length; j++) {
          if ((j + 1) % line.length === i) continue;
          expect(cross(line[i], line[i + 1], line[j], line[(j + 1) % line.length])).toBe(false);
        }
    }
  });
  it('stands on the ground, and never below the rail', () => {
    const flat = openingOutline(() => 0),
      raised = openingOutline(() => 6);
    expect(Math.max(...raised.map((p) => p.y))).toBeLessThan(Math.max(...flat.map((p) => p.y)));
    const buried = openingOutline(() => -20);
    expect(Math.max(...buried.map((p) => p.y))).toBeCloseTo(Math.max(...flat.map((p) => p.y)));
  });
});

describe('a face that looks at the camera', () => {
  it('the portal back sorts on the depthKey scale', () => {
    const t = east();
    expect(t.picture(BACK)!.zIndex).toBe(depthKey(11, 10, -1));
    // a tree on the tile in front of it stands in front, one on the tile behind stands behind
    expect(t.picture(BACK)!.zIndex).toBeLessThan(depthKey(11, 10, 10));
    expect(t.picture(BACK)!.zIndex).toBeGreaterThan(depthKey(10, 10, 10));
  });
  it('a car within reach of a portal never sorts below its back', () => {
    const t = east(),
      back = t.picture(BACK)!.zIndex;
    for (let x = 6.1; x < 15; x += 0.25)
      expect(t.car(x, 10).zIndex).toBeGreaterThanOrEqual(back + 2);
  });
  it('a car going in sorts under the dark, and over the rail in the throat', () => {
    const t = east(),
      dark = t.picture(DARK)!.zIndex,
      rail = t.layer.children.find((c) => c.mask)!.zIndex;
    for (let x = 6.1; x < 11.4; x += 0.25) {
      const z = t.car(x, 10).zIndex;
      expect(z).toBeLessThan(dark);
      expect(z).toBeGreaterThan(rail);
    }
  });
  it('the throat holds a copy of each track sprite on the three tiles behind the portal', () => {
    const t = stage();
    t.dig(3, 10, 10, 10);
    t.portal(10, 10, 'E');
    const near = t.rail(10, 10),
      mid = t.rail(9, 10),
      far = t.rail(8, 10);
    t.rail(7, 10);
    t.portals.refresh();
    const throat = t.layer.children.find((c) => c.mask)!,
      copies = throat.children as Sprite[];
    expect(copies.map((c) => c.texture)).toEqual([far.texture, mid.texture, near.texture]);
    for (const c of copies) expect(c.parent).toBe(throat);
    expect(copies[2].position.x).toBe(near.position.x);
    // each deeper tile darker than the last
    expect(copies[0].tint).toBeLessThan(copies[1].tint);
    expect(copies[1].tint).toBeLessThan(copies[2].tint);
  });
  it('an S face stands on the tile in front, mirrored', () => {
    const t = stage();
    t.dig(10, 3, 10, 10);
    t.portal(10, 10, 'S');
    t.portals.refresh();
    expect(t.picture(BACK)!.zIndex).toBe(depthKey(10, 11, -1));
    expect(fitFace(t.host, t.under.portals()[0]).mirror).toBe(true);
  });
  it('the face stands on the ground: from the bank in front to the ground behind', () => {
    // a bank rising to the north beside the rail, and a hill behind the plane
    const t = stage((x, y) => (x < 10.5 ? 60 : Math.max(0, (10 - y) * 30)));
    t.dig(3, 10, 10, 10);
    t.portal(10, 10, 'E');
    const fit = fitFace(t.host, t.under.portals()[0]),
      at = (u: number) => fit.us.findIndex((v) => Math.abs(v - u) < 0.021);
    expect(fit.base[at(0)]).toBeCloseTo(0);
    expect(fit.base[at(-0.52)]).toBeCloseTo(15.6);
    expect(fit.top[at(0.52)]).toBeCloseTo(61);
    fit.base.forEach((b, i) => expect(fit.top[i]).toBeGreaterThanOrEqual(b));
  });
  it('walls only the cuts with rail on them', () => {
    const t = stage();
    t.dig(3, 10, 10, 10);
    t.portal(10, 10, 'E');
    t.under.cut(11, 10);
    t.under.cut(12, 10);
    t.under.cut(13, 10);
    t.rail(11, 10);
    t.rail(12, 10);
    expect(fitFace(t.host, t.under.portals()[0]).run).toBe(2);
  });
});

describe('what a car shows', () => {
  it('only cars within 4.5 tiles of a portal carry a mask', () => {
    const t = east();
    // the plane stands at x = 10.5
    expect(t.car(14.9, 10).mask).toBeInstanceOf(Graphics);
    expect(t.car(15.1, 10).mask).toBeFalsy();
    expect(t.car(6.1, 10).mask).toBeInstanceOf(Graphics);
    expect(t.car(5.9, 10).mask).toBeFalsy();
  });
  it('a mask goes when the car has left', () => {
    const t = east(),
      s = t.car(12, 10);
    expect(s.mask).toBeTruthy();
    t.portals.dress(s, 20, 10);
    expect(s.mask).toBeFalsy();
  });
  it('a car on a dug tile with no portal near is hidden', () => {
    const t = east(),
      s = t.car(5, 10);
    expect(s.visible).toBe(false);
    expect(t.car(8, 10).visible).toBe(true);
  });
  it('leaves hidden what is hidden already, as a depot hides a train', () => {
    const t = east(),
      s = new Sprite();
    s.visible = false;
    t.portals.dress(s, 12, 10);
    expect(s.visible).toBe(false);
  });
  it('a car past its own length inside shows through the opening alone', () => {
    const t = east(),
      out = t.car(10, 10).mask,
      deep = t.car(7.5, 10).mask;
    expect(deep).toBeTruthy();
    expect(deep).not.toBe(out);
  });
  it('a car takes no mask in the glass', () => {
    const t = east(),
      s = t.car(11, 10);
    expect(s.mask).toBeTruthy();
    t.view.glass = true;
    t.portals.dress(s, 11, 10);
    expect(s.mask).toBeFalsy();
    const inside = t.car(5, 10);
    expect(inside.mask).toBeFalsy();
    expect(inside.visible).toBe(true);
    expect(inside.zIndex).toBe(depthKey(5, 10, 15));
  });
  it('a train on another line beside a portal takes no part in it', () => {
    const t = east(),
      s = t.car(12, 13);
    expect(s.mask).toBeFalsy();
    expect(s.visible).toBe(true);
    expect(s.zIndex).toBe(depthKey(12, 13, 15));
  });
  it('a car in another tunnel near a portal is hidden, and not shown through its mask', () => {
    const t = east();
    t.dig(8, 7, 10, 7);
    const s = t.car(9, 7);
    expect(s.visible).toBe(false);
    expect(s.mask).toBeFalsy();
  });
  it('of two portals side by side each car reads its own', () => {
    const t = east();
    t.dig(3, 11, 10, 11);
    t.portal(10, 11, 'E');
    t.portals.refresh();
    const here = t.car(12, 10).mask,
      there = t.car(12, 11).mask;
    expect(here).toBeTruthy();
    expect(there).toBeTruthy();
    expect(here).not.toBe(there);
  });
  /** Does the sprite of a car at (x, y) show `up` px over the rail? */
  const shows = (t: ReturnType<typeof stage>, x: number, y: number, up: number) => {
    const s = t.car(x, y),
      w = tileToWorld(x, y),
      mask = s.mask as Graphics | null;
    if (!s.visible) return false;
    if (!mask) return true;
    return mask.containsPoint({ x: w.x - mask.x, y: w.y - up - mask.y });
  };
  /** A line on a tile axis into the portal on (10, 10), turning away on the tile behind it. */
  const curve = {
    E: {
      dig: [3, 10, 10, 10],
      turn: [10, 5, 10, 9],
      at: [
        [10, 9.4],
        [10, 9],
        [10, 8.6],
        [9.5, 9],
      ],
      lane: [10.4, 10],
    },
    S: {
      dig: [10, 3, 10, 10],
      turn: [5, 10, 9, 10],
      at: [
        [9.4, 10],
        [9, 10],
        [8.6, 10],
        [9, 9.5],
      ],
      lane: [10, 10.4],
    },
  } as const;
  for (const face of ['E', 'S'] as const) {
    const c = curve[face];
    const dug = () => {
      const t = stage();
      const [a0, a1, a2, a3] = c.dig,
        [b0, b1, b2, b3] = c.turn;
      t.dig(a0, a1, a2, a3);
      t.portal(10, 10, face);
      t.dig(b0, b1, b2, b3);
      t.portals.refresh();
      return t;
    };
    it(`a rail turning behind a ${face} portal keeps the car off the brick`, () => {
      const t = dug();
      for (const [x, y] of c.at)
        for (const up of [20, 30, 40]) expect(shows(t, x, y, up), `${x},${y} up ${up}`).toBe(false);
      // and at the low end of the opening it is still there, going round the bend
      expect(shows(t, c.at[0][0], c.at[0][1], 4)).toBe(true);
      expect(t.car(c.at[0][0], c.at[0][1]).zIndex).toBeLessThan(t.picture(DARK)!.zIndex);
    });
    it(`a car going round the bend behind a ${face} portal never pops: it has gone already`, () => {
      const t = dug();
      const [a, b] = c.at[1][0] === 10 ? [0, -1] : [-1, 0];
      for (let k = 0; k <= 3; k += 0.1) {
        const x = c.at[0][0] + a * k,
          y = c.at[0][1] + b * k;
        for (const up of [20, 40]) expect(shows(t, x, y, up)).toBe(false);
      }
    });
    it(`a car on the axis of a ${face} portal keeps the part it still has outside`, () => {
      const t = dug(),
        [x, y] = c.lane;
      expect(shows(t, x, y, 40)).toBe(true);
    });
  }
  it('a long car on the bend keeps its tail while that is outside, and goes to the opening after', () => {
    const t = stage();
    t.dig(3, 10, 10, 10);
    t.portal(10, 10, 'E');
    t.dig(9, 7, 10, 9);
    t.portals.refresh();
    const at = (x: number, y: number, half: number, angle: number) => {
        const s = new Sprite();
        t.portals.dress(s, x, y, half, angle);
        return s;
      },
      // on the bend, heading across the plane: the tail is still a tile out
      long = at(9.6, 9.2, 1.5, Math.PI / 4),
      // the same place for a short car, and the long one further on
      short = at(9.6, 9.2, 0.4, Math.PI / 4),
      gone = at(9, 8.6, 1.5, Math.PI / 2);
    expect(long.mask).not.toBe(short.mask);
    expect(short.mask).toBe(gone.mask);
    const w = tileToWorld(10.5, 10),
      mask = long.mask as Graphics;
    // out in the open beside the plane the long car shows, whatever its height
    expect(mask.containsPoint({ x: w.x + 20 - mask.x, y: w.y - 40 - mask.y })).toBe(true);
  });
  it('a car in a tunnel on the row beside a portal shows only through the opening', () => {
    const t = east();
    t.dig(3, 9, 10, 9);
    t.portals.refresh();
    for (const [x, y] of [
      [10, 9],
      [9.5, 9],
      [9, 9],
      [8.6, 9],
    ])
      for (const up of [20, 40]) expect(shows(t, x, y, up)).toBe(false);
  });
  it('a train stopped outside sorts as its own depth, past a building beside the mouth', () => {
    const t = east(),
      building = depthKey(12, 9, 20),
      semaphore = depthKey(12, 10, 12);
    for (const x of [11.5, 12, 12.4]) {
      expect(t.car(x, 10).zIndex).toBe(depthKey(x, 10, 15));
      expect(t.car(x, 10).zIndex).toBeGreaterThan(building);
    }
    expect(t.car(12.4, 10).zIndex).toBeGreaterThan(semaphore);
  });
  it('inside is true on a dug tile, and never in the glass', () => {
    const t = east();
    expect(t.portals.inside(8, 10)).toBe(true);
    expect(t.portals.inside(12, 10)).toBe(false);
    t.view.glass = true;
    expect(t.portals.inside(8, 10)).toBe(false);
  });
});

/** A tunnel of ten tiles into a portal on (20, 20), and the point `along` tiles out of its plane. */
function line(face: Face) {
  const t = stage(),
    dx = face === 'E' ? 1 : face === 'W' ? -1 : 0,
    dy = face === 'S' ? 1 : face === 'N' ? -1 : 0;
  for (let i = 0; i < 10; i++) t.under.dig(20 - dx * i, 20 - dy * i, 0);
  t.portal(20, 20, face);
  t.under.cut(20 + dx, 20 + dy);
  t.portals.refresh();
  const at = (along: number) => [20 + dx * (0.5 + along), 20 + dy * (0.5 + along)] as const;
  return { ...t, at };
}

describe.each(['E', 'S'] as const)('the depth of a car at a %s face', (face) => {
  it('never below the back, whatever its own depth says', () => {
    const t = line(face),
      back = t.picture(BACK)!.zIndex;
    for (let a = -4.4; a < 4.4; a += 0.25)
      expect(t.car(...t.at(a)).zIndex).toBeGreaterThanOrEqual(back + 2);
  });
  it('under the dark and over the rail, up to 0.9 out of the plane', () => {
    const t = line(face),
      dark = t.picture(DARK)!.zIndex,
      rail = t.layer.children.find((c) => c.mask)!.zIndex;
    for (let a = -4.4; a < 0.9; a += 0.25) {
      const z = t.car(...t.at(a)).zIndex;
      expect(z).toBeLessThan(dark);
      expect(z).toBeGreaterThan(rail);
    }
  });
  it('its own depth from there on', () => {
    const t = line(face);
    for (const a of [0.91, 1.5, 3]) {
      const [x, y] = t.at(a);
      expect(t.car(x, y).zIndex).toBe(depthKey(x, y, 15));
    }
  });
  it('of two cars in the throat the nearer one on top', () => {
    const t = line(face);
    expect(t.car(...t.at(0)).zIndex).toBeGreaterThan(t.car(...t.at(-1)).zIndex);
  });
  it('a long car stays under the dark till its end has left the plane', () => {
    const t = line(face),
      dark = t.picture(DARK)!.zIndex,
      long = (a: number) => {
        const s = new Sprite(),
          [x, y] = t.at(a);
        s.zIndex = depthKey(x, y, 15);
        t.portals.dress(s, x, y, 1.5, face === 'E' ? 0 : Math.PI / 2);
        return s.zIndex;
      };
    expect(long(1.4)).toBeLessThan(dark);
    expect(long(1.6)).toBeGreaterThan(dark);
  });
  it('a mask within reach, and none past it', () => {
    const t = line(face);
    expect(t.car(...t.at(4.4)).mask).toBeInstanceOf(Graphics);
    expect(t.car(...t.at(4.6)).mask).toBeFalsy();
    expect(t.car(...t.at(-4.4)).mask).toBeInstanceOf(Graphics);
  });
});

describe.each(['W', 'N'] as const)('the depth of a car at a %s face', (face) => {
  it('its own, all along the lane: nothing of the portal draws to sort against', () => {
    const t = line(face);
    for (let a = -1.9; a < 4.4; a += 0.25) {
      const [x, y] = t.at(a);
      expect(t.car(x, y).zIndex).toBe(depthKey(x, y, 15));
    }
  });
  it('the line of the hill up to two tiles in, and gone past that', () => {
    const t = line(face);
    expect(t.car(...t.at(-1.9)).mask).toBeInstanceOf(Graphics);
    const deep = t.car(...t.at(-2.1));
    expect(deep.visible).toBe(false);
    expect(deep.mask).toBeFalsy();
  });
});

describe('a face that looks away', () => {
  /** A W face on (10, 10): the hill stands east of it, 40 px high, the open ground to the west. */
  const west = () => {
    const t = stage((x) => (x > 10 ? 40 : 0));
    t.dig(10, 10, 20, 10);
    t.portal(10, 10, 'W');
    return t;
  };
  /** Is `q` inside the polygon `poly`? */
  const within = (poly: { x: number; y: number }[], q: { x: number; y: number }) => {
    let odd = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if (
        poly[i].y > q.y !== poly[j].y > q.y &&
        q.x < ((poly[j].x - poly[i].x) * (q.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x
      )
        odd = !odd;
    return odd;
  };
  it('a rear face has no back picture', () => {
    const t = west(),
      back = vi.spyOn(t.portals.art, 'back');
    t.portals.refresh();
    expect(back).not.toHaveBeenCalled();
    expect(t.sprites()).toHaveLength(0);
    expect(t.car(8, 10).mask).toBeInstanceOf(Graphics);
  });
  it('the hill`s line hides the rail behind it, and not the rail out in the open', () => {
    const t = west(),
      line = hillLine(t.host, t.under.portals()[0]),
      plane = tileToWorld(9.5, 10),
      rail = (x: number) => {
        const q = tileToWorld(x, 10);
        return { x: q.x - plane.x, y: q.y - plane.y };
      };
    expect(within(line, rail(5))).toBe(true);
    expect(within(line, rail(9.4))).toBe(false);
    // and the top of a car out in the open stands clear
    expect(within(line, { ...rail(8), y: rail(8).y - 30 })).toBe(true);
    // while a car inside is gone to its roof, though the ground over it is lower than the car
    expect(within(line, { ...rail(11), y: rail(11).y - 50 })).toBe(false);
  });
  it('a column that starts on the bank at the foot of the hill still hides the rail', () => {
    // the ground leans up across the last half tile before the plane, over the rail
    const t = stage((x) => Math.max(0, Math.min(40, (x - 9) * 80)));
    t.dig(10, 10, 20, 10);
    t.portal(10, 10, 'W');
    const line = hillLine(t.host, t.under.portals()[0]),
      plane = tileToWorld(9.5, 10);
    for (let x = 9.3; x <= 11; x += 0.1) {
      const q = tileToWorld(x, 10);
      expect(within(line, { x: q.x - plane.x, y: q.y - plane.y })).toBe(false);
    }
  });
  it('an N face runs its line the other way', () => {
    const t = stage((_, y) => (y > 10 ? 40 : 0));
    t.dig(10, 10, 10, 20);
    t.portal(10, 10, 'N');
    const line = hillLine(t.host, t.under.portals()[0]),
      plane = tileToWorld(10, 9.5),
      rail = (y: number) => {
        const q = tileToWorld(10, y);
        return { x: q.x - plane.x, y: q.y - plane.y };
      };
    expect(within(line, rail(5))).toBe(true);
    expect(within(line, rail(9.4))).toBe(false);
  });
  it('a car turning away behind the plane is hidden', () => {
    const t = west();
    t.dig(10, 6, 10, 9);
    t.portals.refresh();
    for (const [x, y] of [
      [10, 9.4],
      [10, 9],
      [10, 8.6],
    ]) {
      const s = t.car(x, y);
      expect(s.visible).toBe(false);
      expect(s.mask).toBeFalsy();
    }
  });
  it('a car past the hill`s line is hidden', () => {
    const t = west();
    t.portals.refresh();
    const s = t.car(13, 10);
    expect(s.visible).toBe(false);
    expect(s.mask).toBeFalsy();
  });
  it('the line cuts the rails of the cutting and no others, and lets them go in the glass', () => {
    const t = west();
    t.under.cut(9, 10);
    const rail = t.rail(9, 10),
      front = t.rail(8, 10);
    t.portals.refresh();
    expect(rail.mask).toBeInstanceOf(Graphics);
    expect(front.mask).toBeFalsy();
    t.view.glass = true;
    t.portals.showAll();
    expect(rail.mask).toBeFalsy();
    t.view.glass = false;
    t.portals.showAll();
    expect(rail.mask).toBeInstanceOf(Graphics);
  });
  it('reaches past the sleepers of the last tile it cuts', () => {
    const t = stage((x) => (x > 12 ? 40 : 0));
    t.dig(12, 10, 20, 10);
    t.portal(12, 10, 'W');
    for (let x = 4; x <= 11; x++) {
      t.under.cut(x, 10);
      t.rail(x, 10);
    }
    t.portals.refresh();
    const line = hillLine(t.host, t.under.portals()[0]),
      plane = tileToWorld(11.5, 10),
      end = tileToWorld(11.5 - 7.3, 10);
    expect(t.rails.get('5,10')!.mask).toBeInstanceOf(Graphics);
    expect(t.rails.get('4,10')!.mask).toBeFalsy();
    expect(within(line, { x: end.x - plane.x, y: end.y - plane.y - 2 })).toBe(true);
  });
  it('lets a rail go when its portal goes', () => {
    const t = west();
    t.under.cut(9, 10);
    const rail = t.rail(9, 10);
    t.portals.refresh();
    expect(rail.mask).toBeTruthy();
    t.under.fill(10, 10);
    t.portals.refresh();
    expect(rail.mask).toBeFalsy();
  });
});

describe('keeping the portals up', () => {
  it('in the glass a portal draws nothing of its own', () => {
    const t = east(),
      throat = t.layer.children.find((c) => c.mask)!;
    t.view.glass = true;
    t.portals.showAll();
    expect(t.picture(BACK)!.visible).toBe(false);
    expect(t.picture(DARK)!.visible).toBe(false);
    expect(throat.visible).toBe(false);
    t.view.glass = false;
    t.portals.showAll();
    expect(t.picture(BACK)!.visible).toBe(true);
  });
  it('a mask draws nothing of itself, used or not', () => {
    const t = east(),
      s = t.car(12, 10),
      mask = s.mask as Graphics,
      holder = mask.parent!,
      built = vi.spyOn(mask, 'collectRenderables');
    expect(mask.includeInBuild).toBe(false);
    // Pixi turns a Graphics back on when its last user lets it go: the holder is what keeps it out
    t.portals.dress(s, 20, 10);
    expect(s.mask).toBeFalsy();
    expect(mask.includeInBuild).toBe(true);
    holder.updateTransform?.({});
    holder.collectRenderables({} as InstructionSet, {} as Renderer, null as never);
    expect(built).not.toHaveBeenCalled();
    expect(holder.measurable).toBe(false);
  });
  it('looks again only at the portals an edit reaches', () => {
    const asked: number[] = [];
    const t = stage((x) => (asked.push(x), 0));
    for (const y of [8, 30]) {
      t.dig(3, y, 8, y);
      t.portal(8, y, 'E');
    }
    t.portals.refresh();
    const made = t.portals.built;
    asked.length = 0;
    t.portals.touch(35, 20);
    t.portals.update();
    expect(asked).toHaveLength(0);
    t.portals.touch(9, 30);
    t.portals.update();
    const first = asked.length;
    expect(first).toBeGreaterThan(0);
    asked.length = 0;
    t.portals.touch(9, 30);
    t.portals.touch(9, 8);
    t.portals.update();
    expect(asked).toHaveLength(2 * first);
    expect(t.portals.built).toBe(made);
  });
  it('a ground edit that changes a portal cuts that one again, and no other', () => {
    let high = 0;
    const t = stage((x, y) => (y > 20 && x > 8.5 && Math.abs(y - 30) > 0.3 ? high : 0));
    for (const y of [8, 30]) {
      t.dig(3, y, 8, y);
      t.portal(8, y, 'E');
    }
    t.portals.refresh();
    high = 20;
    t.portals.touch(9, 30);
    t.portals.update();
    expect(t.portals.built).toBe(3);
  });
  it('a cut rail that came near a rear face takes the line as soon as it is laid', () => {
    const t = stage();
    t.dig(10, 10, 15, 10);
    t.portal(10, 10, 'W');
    t.under.cut(9, 10);
    t.portals.refresh();
    const rail = t.rail(9, 10);
    expect(rail.mask).toBeFalsy();
    t.portals.touch(9, 10);
    t.portals.update();
    expect(rail.mask).toBeInstanceOf(Graphics);
  });
  it('stands out of the chunk cull only while it is in view', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      t = stage(),
      picture = () => ({ texture: TEXELS, x: 0, y: 0, scale: 1 }),
      root = new Container(),
      w = tileToWorld(10.5, 10);
    t.portals.art = { back: picture, dark: picture };
    t.dig(3, 10, 10, 10);
    t.portal(10, 10, 'E');
    t.rail(10, 10).texture = TEXELS;
    t.portals.refresh();
    const [back, dark] = t.sprites(),
      throat = t.layer.children.find((c) => c.mask)!,
      car = new Sprite(TEXELS);
    car.position.copyFrom(tileToWorld(10.8, 10));
    t.portals.dress(car, 10.8, 10);
    expect(car.mask).toBeTruthy();
    root.addChild(t.layer);
    t.layer.addChild(car);
    car.cullable = true;
    const cull = new ChunkCull(t.layer),
      parts = [back, dark, throat, car];
    for (const part of parts) expect(part.cullable).toBe(true);
    expect(throat.cullArea).toBeDefined();
    root.position.set(640 - w.x, 360 - w.y);
    cull.update(1280, 720);
    for (const part of parts) expect(part.culled).toBe(false);
    root.position.set(640 - w.x - 5000, 360 - w.y);
    cull.update(1280, 720);
    for (const part of parts) expect(part.culled).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it('is cut again when the ground around it changes, and not otherwise', () => {
    let high = 0;
    const t = stage((x, y) => (x > 10.5 && Math.abs(y - 10) > 0.3 ? high : 0));
    t.dig(3, 10, 10, 10);
    t.portal(10, 10, 'E');
    t.portals.refresh();
    expect(t.portals.built).toBe(1);
    t.portals.refresh();
    expect(t.portals.built).toBe(1);
    high = 20;
    t.portals.refresh();
    expect(t.portals.built).toBe(2);
    expect(t.sprites()).toHaveLength(2);
  });
  it('is cut again when the rail behind it changes', () => {
    const t = east();
    t.rail(10, 10);
    t.portals.touch(10, 10);
    t.portals.update();
    expect(t.portals.built).toBe(2);
  });
  it('a rail far from every portal costs no look', () => {
    const t = east(),
      refresh = vi.spyOn(t.portals, 'refresh');
    t.portals.touch(30, 30);
    t.portals.update();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('a mask a car still holds when its portal goes is never freed under it', () => {
    const t = east(),
      s = t.car(12, 10),
      mask = s.mask as Graphics;
    t.under.fill(10, 10);
    t.portals.refresh();
    expect(mask.destroyed).toBe(false);
    expect(mask.context.instructions).toHaveLength(0);
    t.portals.dress(s, 12, 10);
    expect(s.mask).toBeFalsy();
  });
  it('a portal that went is taken down, with its pictures', () => {
    const t = east(),
      gone = vi.fn();
    t.picture(BACK)!.on('destroyed', gone);
    t.under.fill(10, 10);
    t.portals.refresh();
    expect(gone).toHaveBeenCalledOnce();
    expect(t.sprites()).toHaveLength(0);
    expect(t.car(12, 10).mask).toBeFalsy();
  });
});

const SOURCE = new TextureSource({ width: 256, height: 256 });
const ANY: FrameInfo = {
  image: undefined as never,
  texture: new Texture({ source: SOURCE, frame: new Rectangle(0, 0, 64, 32) }),
  anchorX: 0.5,
  anchorY: 0.9,
  w: 64,
  h: 32,
};
const ATLAS = { has: () => true, get: () => ANY } as unknown as AtlasRegistry;
const world = (map: GameMap) => new WorldRenderer(ATLAS, map, new RegionState(map));
function mountainMap() {
  const map = emptyMap(3, 24, 24, Terrain.Grass);
  for (let y = 2; y <= 8; y++)
    for (let x = 2; x <= 8; x++) map.terrain[y * 24 + x] = Terrain.Mountain;
  return map;
}
type Inside = {
  trackSprites: Map<number, Sprite>;
  summitSprites: Map<number, Sprite>;
};

describe('the world over a dug tile', () => {
  it('a rail on a dug tile draws only with the glass on', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h);
    u.dig(4, 4, 0);
    w.underground = u;
    w.setTrack(4, 4, 'track/straight');
    w.setTrack(12, 12, 'track/straight');
    const rails = (w as unknown as Inside).trackSprites,
      inside = rails.get(4 * 24 + 4)!,
      open = rails.get(12 * 24 + 12)!;
    expect(inside.renderable).toBe(false);
    expect(open.renderable).toBe(true);
    w.setGlass(true);
    expect(inside.renderable).toBe(true);
    w.setGlass(false);
    expect(inside.renderable).toBe(false);
    expect(open.renderable).toBe(true);
  });
  it('a dig hides the rail on its tile, and a fill shows it again', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h);
    w.underground = u;
    w.setTrack(4, 4, 'track/straight');
    const rail = (w as unknown as Inside).trackSprites.get(4 * 24 + 4)!;
    w.animate(0.016);
    expect(rail.renderable).toBe(true);
    u.dig(4, 4, 0);
    w.animate(0.016);
    expect(rail.renderable).toBe(false);
    u.fill(4, 4);
    w.animate(0.016);
    expect(rail.renderable).toBe(true);
  });
  it('a signal and a wire follow a dig and a fill, down to the bed and back up', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h);
    w.underground = u;
    const signal = w.setStructure('decor:4,4', 4, 4, 'structures/semaphore', 12, -3, 2),
      wire = w.setStructure('supply:4,4', 4, 4, 'structures/supply_catenary_ns', 13),
      note = w.setStructure('notice:1', 4, 4, 'structures/note', 46, -58),
      p = tileToWorld(4, 4),
      surface = signal.position.y;
    w.animate(0.016);
    u.dig(4, 4, 0);
    w.animate(0.016);
    expect(signal.position.y).toBe(p.y - 3);
    expect(signal.renderable).toBe(false);
    expect(wire.renderable).toBe(false);
    expect(note.renderable).toBe(true);
    u.fill(4, 4);
    w.animate(0.016);
    expect(signal.position.y).toBe(surface);
    expect(signal.renderable).toBe(true);
  });
  it('a store handed in later is followed too, at the same version', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h),
      signal = w.setStructure('decor:4,4', 4, 4, 'structures/semaphore', 12);
    u.dig(4, 4, 0);
    u.version = 0;
    w.underground = u;
    w.animate(0.016);
    expect(signal.renderable).toBe(false);
  });
  it('no peak stands in a cutting or right beside a portal', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h),
      peaks = (w as unknown as Inside).summitSprites,
      add = (x: number, y: number) => {
        const s = new Sprite();
        peaks.set(y * 24 + x, s);
        return s;
      },
      byCut = add(5, 5),
      byPortal = add(12, 13),
      far = add(9, 9);
    w.underground = u;
    u.cut(4, 4);
    u.dig(12, 12, 0);
    u.addPortal({ x: 12, y: 11, face: 'N', floor: 0 });
    w.animate(0.016);
    expect(byCut.visible).toBe(false);
    expect(byPortal.visible).toBe(false);
    expect(far.visible).toBe(true);
  });
  it('the portals stand in the object layer, found by the cars', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h),
      before = new Set(w.objects.children);
    w.underground = u;
    u.dig(6, 5, 0);
    u.addPortal({ x: 6, y: 5, face: 'E', floor: 0 });
    w.animate(0.016);
    const added = w.objects.children.filter((c) => !before.has(c));
    expect(added.filter((c) => c instanceof Sprite)).toHaveLength(2);
    expect(added.some((c) => c.mask)).toBe(true);
    expect(layerPortals.get(w.objects)).toBe(w.portals);
  });
  it('a reshape reaches the portal with the landscape failed, when no flush says so', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h);
    w.underground = u;
    u.dig(6, 5, 0);
    u.addPortal({ x: 6, y: 5, face: 'E', floor: 0 });
    w.animate(0.016);
    const built = w.portals.built;
    Object.defineProperty(w.landscape, 'failed', { get: () => true });
    vi.spyOn(w.landscape, 'flush').mockReturnValue(false);
    w.animate(0.016);
    map.terrain[5 * 24 + 7] = Terrain.Mountain;
    map.terrain[4 * 24 + 7] = Terrain.Grass;
    map.terrain[4 * 24 + 6] = Terrain.Grass;
    map.terrain[6 * 24 + 7] = Terrain.Grass;
    const look = vi.spyOn(w.portals, 'update');
    w.retileMany([
      { x: 7, y: 4 },
      { x: 6, y: 4 },
      { x: 7, y: 6 },
    ]);
    w.animate(0.016);
    expect(look).toHaveBeenCalled();
    expect(w.portals.built).toBeGreaterThan(built);
  });
  it('a paving far from every portal looks at none of them', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h),
      refresh = vi.spyOn(w.portals, 'refresh');
    w.underground = u;
    u.dig(4, 4, 0);
    u.addPortal({ x: 4, y: 4, face: 'E', floor: 0 });
    w.animate(0.016);
    refresh.mockClear();
    const touched = vi.spyOn(w.portals, 'touch');
    w.refreshGround(22, 22);
    w.animate(0.016);
    expect(touched).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('the glass follows flattening and a carved cut, not paving or an ordinary rail', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h),
      inner = w as unknown as {
        makeGlass(): { host: { ground(): number } };
      },
      { ground } = inner.makeGlass().host,
      bed = { axis: 'x', spans: [{ from: -1, to: 40, a: 0, b: 0 }], flat: true } as never;
    w.underground = u;
    u.cut(5, 5);
    let was = ground();
    const moved = () => {
      const now = ground(),
        changed = now !== was;
      was = now;
      return changed;
    };
    w.refreshGround(12, 12);
    expect(moved()).toBe(false);
    w.setRailBeds(new Map([[14 * 24 + 14, bed]]));
    expect(moved()).toBe(false);
    w.setFlattened(5, 7, true);
    expect(moved()).toBe(true);
    w.setRailBeds(new Map([[5 * 24 + 5, bed]]));
    expect(moved()).toBe(true);
    const failed = w.landscape.failed;
    Object.defineProperty(w.landscape, 'failed', { get: () => !failed });
    expect(moved()).toBe(true);
  });
});
