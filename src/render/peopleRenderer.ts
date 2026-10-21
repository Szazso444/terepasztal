import { Container, Sprite } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld } from '../engine/iso';
import type { PeopleSim } from '../sim/people';
import { PERSON_PX } from './assetScale';
import { RoadWalk, roadWalks, turn, type Heading, type Placed } from './roadWalk';
import { walkerDepth, walkerGround } from './walkerGround';

/** A jump further than this between two frames (tiles) is a walker put somewhere, not walking. */
const TELEPORT = 0.5;

/** Where a walker was drawn last frame and the way it is facing (length 1 on the move, else less). */
interface Facing extends Heading {
  x: number;
  y: number;
}

/**
 * Tiny walkers in the object layer; two frames alternate while they move. A walker stands on the
 * ground under it with no jump at a tile edge, and is drawn over the ground cover of its tile
 * (walkerGround.ts). On a road it is drawn along the road's centre line, a little to the right of
 * it (roadWalk.ts, #477): only where it is drawn, never where the simulation has it.
 */
export class PeopleRenderer {
  private sprites = new Map<number, Sprite>();
  private facing = new Map<number, Facing>();
  private placed: Placed = { x: 0, y: 0 };
  private t = 0;
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
      f = { x: p.x, y: p.y, hx: 0, hy: 0 };
      this.facing.set(p.id, f);
      return f;
    }
    const dx = p.x - f.x,
      dy = p.y - f.y,
      moved = Math.hypot(dx, dy);
    if (moved > TELEPORT) {
      f.hx = f.hy = 0;
    } else turn(f, dx, dy);
    f.x = p.x;
    f.y = p.y;
    return f;
  }

  update(sim: PeopleSim, dt: number) {
    this.t += dt;
    const walkFrame = Math.floor(this.t * 5) % 2;
    const seen = new Set<number>();
    const roads = this.roads ?? roadWalks.get(this.layer);
    for (const p of sim.persons) {
      if (p.state === 'inside') continue;
      seen.add(p.id);
      let s = this.sprites.get(p.id);
      const moving = p.state !== 'idle' && p.state !== 'waiting';
      const key = `people/walker_${p.outfit}_f${moving ? walkFrame : 0}`;
      if (!this.atlas.has(key)) continue;
      const f = this.atlas.get(key);
      if (!s) {
        s = new Sprite(f.texture);
        s.cullable = true;
        this.layer.addChild(s);
        this.sprites.set(p.id, s);
      } else s.texture = f.texture;
      s.anchor.set(f.anchorX, f.anchorY);
      s.scale.set(PERSON_PX / f.h);
      const face = this.face(p);
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
