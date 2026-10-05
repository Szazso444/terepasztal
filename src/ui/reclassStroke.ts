import { stepTiles } from '../world/reclass';

type Tile = { x: number; y: number };
/** A tile to convert, and the tile the stroke enters it from (it picks a crossing's line). */
export interface StrokeStep {
  tile: Tile;
  from?: Tile;
}

/** Further than this between two frames is not a hand moving: the view changed under the cursor. */
const JUMP = 8;
/** The stroke's direction is read over this many cursor tiles, so one tile of wobble does not turn it. */
const TRAIL = 3;

const same = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;

/**
 * A stroke of the Upgrade or Downgrade tool: the tiles the cursor is seen on, frame by frame,
 * turned into the tiles to convert.
 *
 * A fast cursor skips tiles between frames, so every tile on the way is visited. A crossing is
 * taken by the stroke's direction, not by the tile it happens to be reached from, and a diagonal
 * move steps back onto the stroke's line before it goes on along it: a hand that wobbles one tile
 * beside a crossing still converts the line it runs along and leaves the cross line alone. A
 * stroke that starts on a crossing waits for its first move to know its line; released without a
 * move it is a click.
 */
export class ReclassStroke {
  /** cursor tiles seen, the newest last */
  private trail: Tile[] = [];
  private heading: 'x' | 'y' | null = null;
  /** a crossing the stroke started on, not yet converted */
  private held: Tile | null = null;

  private get last(): Tile | null {
    return this.trail[this.trail.length - 1] ?? null;
  }

  /** The direction the stroke has when it reaches `t`, and which way it runs along it. */
  private towards(t: Tile): { axis: 'x' | 'y' | null; dx: number; dy: number } {
    const back = this.trail[Math.max(0, this.trail.length - TRAIL)];
    const dx = t.x - back.x,
      dy = t.y - back.y;
    const axis =
      Math.abs(dx) > Math.abs(dy) ? 'x' : Math.abs(dy) > Math.abs(dx) ? 'y' : this.heading;
    return { axis, dx, dy };
  }
  /** The neighbour a crossing at `t` is entered from by a stroke running along `axis`. */
  private static before(t: Tile, axis: 'x' | 'y', dx: number, dy: number): Tile {
    return axis === 'x'
      ? { x: t.x - (Math.sign(dx) || 1), y: t.y }
      : { x: t.x, y: t.y - (Math.sign(dy) || 1) };
  }

  /** The cursor is on `t` with the button down. The tiles to convert now, in order. */
  move(t: Tile, isCrossing: (t: Tile) => boolean): StrokeStep[] {
    const last = this.last;
    if (last && same(last, t)) return [];
    const out: StrokeStep[] = [];
    if (last && Math.max(Math.abs(t.x - last.x), Math.abs(t.y - last.y)) > JUMP) {
      out.push(...this.release());
    }
    if (!this.last) {
      this.trail = [t];
      if (isCrossing(t)) this.held = t;
      else out.push({ tile: t });
      return out;
    }
    const { axis, dx, dy } = this.towards(t);
    this.heading = axis;
    const path = stepTiles(this.last, t, axis ?? undefined);
    if (this.held) {
      // the crossing the stroke started on: the line it leaves along
      const first = path[0];
      const leave = axis ?? (first.x !== this.held.x ? 'x' : 'y');
      out.push({ tile: this.held, from: ReclassStroke.before(this.held, leave, dx, dy) });
      this.held = null;
    }
    let prev = this.last;
    for (const p of path) {
      const from = axis && isCrossing(p) ? ReclassStroke.before(p, axis, dx, dy) : prev;
      out.push({ tile: p, from });
      prev = p;
    }
    this.trail.push(t);
    if (this.trail.length > TRAIL + 1) this.trail.shift();
    return out;
  }

  /** The button is up. A crossing pressed and released without a move is a click. */
  release(): StrokeStep[] {
    const out = this.held ? [{ tile: this.held }] : [];
    this.stop();
    return out;
  }

  /** The cursor left the map or went over a panel: the stroke ends here and nothing is owed. */
  stop() {
    this.trail = [];
    this.heading = null;
    this.held = null;
  }

  /** The tile a conversion of `t` would be entered from, for the preview under the cursor. */
  entry(t: Tile, crossing = false): Tile | undefined {
    const last = this.last;
    if (!last || same(last, t)) return undefined;
    const { axis, dx, dy } = this.towards(t);
    if (crossing && axis) return ReclassStroke.before(t, axis, dx, dy);
    const path = [last, ...stepTiles(last, t, axis ?? undefined)];
    return path[path.length - 2];
  }
}
