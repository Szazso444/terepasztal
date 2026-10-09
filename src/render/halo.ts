import { Container, Sprite } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { HALF_W } from '../engine/iso';
import { SPARKS, haloAt } from './haloTimeline';

/**
 * How tall a building on a `w` x `h` footprint is taken to be, in world pixels. The simulation
 * knows footprints, not sprites, so this is an estimate from the illustrated one-tile buildings
 * (about 60 to 85 px tall at their reviewed scale), growing with the footprint.
 */
export function buildingHeight(w: number, h: number) {
  return 48 + 12 * (w + h);
}

/** Width of a `w` x `h` footprint's diamond on screen, in world pixels. */
export function footprintWidth(w: number, h: number) {
  return (w + h) * HALF_W;
}

/** The full halo over a building, and the small one a converted track piece shimmers with. */
const SIZES = {
  building: { width: 1, height: (w: number, h: number) => buildingHeight(w, h), sparks: SPARKS },
  piece: { width: 0.7, height: () => 24, sparks: 3 },
} as const;
/** The beam's width in shares of the halo's. */
const BEAM_WIDTH = 0.6;

interface Halo {
  node: Container;
  ring: Sprite;
  beam: Sprite;
  sparks: Sprite[];
  /** real seconds since it started */
  t: number;
  /** the footprint's width and the building's height, in world pixels */
  width: number;
  height: number;
}

/**
 * The upgrade halo over a building or a track piece: a golden ring, a column of light and a few
 * sparks, as additive sprites played from `haloAt` over real time, so it runs the same at every
 * game speed and while the game is paused. A halo releases its sprites when it is done.
 */
export class Halos {
  private items: Halo[] = [];
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
  ) {}

  /** Start a halo over the `w` x `h` footprint whose top-left tile is (`x`, `y`). */
  spawn(x: number, y: number, w: number, h: number, size: 'building' | 'piece') {
    const kind = SIZES[size];
    const p = this.surface(x + (w - 1) / 2, y + (h - 1) / 2);
    const node = new Container();
    node.position.set(Math.round(p.x), Math.round(p.y));
    const beam = this.sprite('fx/halo_beam', node);
    const ring = this.sprite('fx/halo_ring', node);
    const sparks: Sprite[] = [];
    for (let i = 0; i < kind.sparks; i++) sparks.push(this.sprite('fx/spark', node));
    this.layer.addChild(node);
    const halo: Halo = {
      node,
      ring,
      beam,
      sparks,
      t: 0,
      width: footprintWidth(w, h) * kind.width,
      height: kind.height(w, h),
    };
    this.pose(halo);
    this.items.push(halo);
  }

  /** Advance every halo by `dt` real seconds and release the ones that are done. */
  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const h = this.items[i];
      h.t += dt;
      if (this.pose(h)) continue;
      h.node.destroy({ children: true });
      this.items.splice(i, 1);
    }
  }

  private sprite(frame: string, parent: Container) {
    const f = this.atlas.get(frame);
    const s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    s.blendMode = 'add';
    s.visible = false;
    parent.addChild(s);
    return s;
  }

  /** Show the halo's frame at its time; false once it is done. */
  private pose(h: Halo): boolean {
    const f = haloAt(h.t);
    if (f.done) return false;
    const ring = h.ring;
    const ringScale = (f.ring.scale * h.width) / ring.texture.width;
    ring.scale.set(ringScale);
    ring.y = Math.round(-f.ring.rise * h.height);
    ring.alpha = f.ring.alpha;
    ring.visible = f.ring.alpha > 0;
    const beam = h.beam;
    const sx = (BEAM_WIDTH * h.width) / beam.texture.width;
    const sy = (f.beam.height * h.height) / beam.texture.height;
    beam.scale.set(sx, sy);
    // the frame's foot is the near arc of a 2:1 base a quarter of its width deep: centre that
    // base on the footprint
    beam.y = Math.round((beam.texture.width / 4) * sy);
    beam.alpha = f.beam.alpha;
    beam.visible = f.beam.alpha > 0 && sy > 0;
    for (let i = 0; i < h.sparks.length; i++) {
      const s = h.sparks[i];
      const p = f.sparks[i];
      s.position.set(Math.round(p.x * h.width), Math.round(p.y * h.width));
      s.alpha = p.alpha;
      s.visible = p.alpha > 0;
    }
    return true;
  }
}
