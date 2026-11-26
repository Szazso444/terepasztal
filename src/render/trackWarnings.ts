import { Container, Graphics } from 'pixi.js';
import { PAL, hex } from '../art/palette';

/** A place on the map, in tiles; a multi-tile piece's centre may fall between two. */
export interface WarnAt {
  x: number;
  y: number;
}

/** Clearance between the surface and the mark's foot, in world pixels. */
const LIFT = 8;
/** warning yellow: the palette's amber reads orange beside the red edge */
const FILL = 0xf2cf4a;
const EDGE = hex(PAL.red);
const INK = hex(PAL.outline);

/**
 * A small warning triangle on each piece of track closed for wear (spec section 5). The marks are
 * drawn once when a piece first shows one and kept between calls: `sync` adds the ones missing,
 * removes the ones whose piece is gone or mended, and leaves the rest untouched, so it costs
 * nothing a frame. The game calls it when the track version moves.
 */
export class TrackWarnings {
  private marks = new Map<string, Graphics>();
  constructor(
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
  ) {}

  /** Show a mark at each of `places`, and none elsewhere. */
  sync(places: readonly WarnAt[]) {
    const wanted = new Map(places.map((p) => [`${p.x},${p.y}`, p]));
    for (const [key, g] of this.marks)
      if (!wanted.has(key)) {
        g.destroy();
        this.marks.delete(key);
      }
    for (const [key, p] of wanted) {
      if (this.marks.has(key)) continue;
      const g = draw(new Graphics());
      const s = this.surface(p.x, p.y);
      g.position.set(Math.round(s.x), Math.round(s.y - LIFT));
      this.layer.addChild(g);
      this.marks.set(key, g);
    }
  }
  get count() {
    return this.marks.size;
  }
}

/** A yellow triangle with a red edge and a red exclamation mark, its foot on the origin. */
function draw(g: Graphics): Graphics {
  g.cullable = true;
  g.poly([0, -12, 7, 0, -7, 0]).fill(FILL).stroke({ width: 1.5, color: EDGE });
  g.rect(-0.5, -8, 1.5, 4).fill(INK);
  g.rect(-0.5, -3, 1.5, 1.5).fill(INK);
  return g;
}
