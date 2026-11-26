import { Container, Sprite } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld } from '../engine/iso';
import type { PeopleSim, Person } from '../sim/people';
import { PERSON_PX } from './assetScale';
import { RoadWalk, roadWalks, turn, type Heading, type Placed } from './roadWalk';
import { walkerDepth, walkerGround } from './walkerGround';

/** A jump further than this between two frames (tiles) is a walker put somewhere, not walking. */
const TELEPORT = 0.5;
/**
 * Tiles walked per pose. A planted foot moves back about 1.1 world px a pose in the walk cycles
 * (assets/source/people-v3-guides/README.md), which is this much ground: at this pace it stays put.
 */
export const STEP_TILES = 0.031;
/** Poses of a walk cycle, as many as src/art/people.ts draws. */
export const WALK_FRAMES = 4;
/** A heading this small along a screen axis says nothing of it: the figure keeps its side. */
const SIDE = 0.05;

/** Where a walker was last frame, the way it is facing (length 1 on the move, else less). */
interface Facing extends Heading {
  x: number;
  y: number;
  /** Tiles walked since it came out of doors: the pose follows this, never the clock. */
  walked: number;
  /** Going up the screen: drawn from the back. */
  back: boolean;
  /** Going toward screen-left: the picture is mirrored. */
  mirror: boolean;
}

/**
 * Tiny walkers in the object layer. A figure's pose follows the distance it has walked, so its
 * feet match the ground at every game speed and a walker that stands keeps its pose; it shows its
 * profession, from the front going down the screen and from the back going up, mirrored going
 * left. A walker stands on the ground under it with no jump at a tile edge, and is drawn over the
 * ground cover of its tile (walkerGround.ts). On a road it is drawn along the road's centre line, a
 * little to the right of it (roadWalk.ts, #477): only where it is drawn, never where the simulation
 * has it.
 */
export class PeopleRenderer {
  private sprites = new Map<number, Sprite>();
  private facing = new Map<number, Facing>();
  private placed: Placed = { x: 0, y: 0 };
  /**
   * `roads` is the road walk of the world drawn into `layer`; with none given, the one the world
   * renderer registered for that layer (roadWalks), if any.
   */
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly elevation: (x: number, y: number) => number,
    private readonly roads?: RoadWalk,
  ) {}

  /** The way walker `p` faces, from how far it has moved since the last frame. */
  private face(p: { id: number; x: number; y: number }): Facing {
    let f = this.facing.get(p.id);
    if (!f) {
      f = { x: p.x, y: p.y, hx: 0, hy: 0, walked: 0, back: false, mirror: false };
      this.facing.set(p.id, f);
      return f;
    }
    const dx = p.x - f.x,
      dy = p.y - f.y,
      moved = Math.hypot(dx, dy);
    if (moved > TELEPORT) {
      f.hx = f.hy = 0;
    } else {
      turn(f, dx, dy);
      f.walked += moved;
      // on the screen tile x runs down and to the right, tile y down and to the left
      const right = f.hx - f.hy,
        down = f.hx + f.hy;
      if (Math.abs(right) > SIDE) f.mirror = right < 0;
      if (Math.abs(down) > SIDE) f.back = down < 0;
    }
    f.x = p.x;
    f.y = p.y;
    return f;
  }

  /**
   * The frame of walker `p`: its profession's, carrying when it carries and such frames exist, in
   * the view it faces. Until the people atlas has its profession's frames, the old walker's.
   */
  private frameKey(p: Person, f: Facing) {
    const step = Math.floor(f.walked / STEP_TILES) % WALK_FRAMES,
      stem = `people/${p.profession}_${f.back ? 'back' : 'front'}`;
    if (p.carrying) {
      const carry = `${stem}_carry_f${step}`;
      if (this.atlas.has(carry)) return carry;
    }
    const walk = `${stem}_walk_f${step}`;
    return this.atlas.has(walk) ? walk : `people/walker_${p.outfit}_f${step % 2}`;
  }

  /** The second argument is unused: nothing a walker shows follows the clock any more. */
  update(sim: PeopleSim, _dt?: number) {
    const seen = new Set<number>();
    const roads = this.roads ?? roadWalks.get(this.layer);
    for (const p of sim.persons) {
      if (p.state === 'inside') continue;
      seen.add(p.id);
      let s = this.sprites.get(p.id);
      const face = this.face(p),
        key = this.frameKey(p, face);
      if (!this.atlas.has(key)) continue;
      const f = this.atlas.get(key);
      if (!s) {
        s = new Sprite(f.texture);
        s.cullable = true;
        this.layer.addChild(s);
        this.sprites.set(p.id, s);
      } else s.texture = f.texture;
      s.anchor.set(f.anchorX, f.anchorY);
      // a profession's frames are drawn at their size; the old walker's is a 12 px picture
      const scale = key.startsWith('people/walker_') ? PERSON_PX / f.h : 1;
      s.scale.set(face.mirror ? -scale : scale, scale);
      const at = roads ? roads.place(p.x, p.y, face.hx, face.hy, this.placed) : p;
      const w = tileToWorld(at.x, at.y);
      s.position.set(Math.round(w.x), Math.round(w.y + walkerGround(this.elevation, at.x, at.y)));
      s.zIndex = walkerDepth(sim.map, at.x, at.y);
    }
    for (const [id, s] of this.sprites)
      if (!seen.has(id)) {
        s.destroy();
        this.sprites.delete(id);
      }
    // a walker gone indoors and out again is somewhere new: it faces no way yet
    for (const id of this.facing.keys()) if (!seen.has(id)) this.facing.delete(id);
  }
}
