import { Container, Sprite } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld } from '../engine/iso';
import type { PeopleSim } from '../sim/people';
import { PERSON_PX } from './assetScale';
import { walkerDepth, walkerGround } from './walkerGround';

/**
 * Tiny walkers in the object layer; two frames alternate while they move. A walker stands on the
 * ground under it with no jump at a tile edge, and is drawn over the ground cover of its tile
 * (walkerGround.ts).
 */
export class PeopleRenderer {
  private sprites = new Map<number, Sprite>();
  private t = 0;
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly elevation: (x: number, y: number) => number,
  ) {}

  update(sim: PeopleSim, dt: number) {
    this.t += dt;
    const walkFrame = Math.floor(this.t * 5) % 2;
    const seen = new Set<number>();
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
      const w = tileToWorld(p.x, p.y);
      s.position.set(Math.round(w.x), Math.round(w.y + walkerGround(this.elevation, p.x, p.y)));
      s.zIndex = walkerDepth(sim.map, p.x, p.y);
    }
    for (const [id, s] of this.sprites)
      if (!seen.has(id)) {
        s.destroy();
        this.sprites.delete(id);
      }
  }
}
