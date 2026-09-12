import { describe, it, expect } from 'vitest';
import { Dir, opposite } from '../engine/iso';
import {
  TrackGraph,
  TRACK_KINDS,
  TRACK_CLASSES,
  CLASS_N,
  classRadius,
  classCostMul,
  pieceLinks,
  rotationCount,
  makePiece,
  pieceCost,
  isUnitKind,
  portClass,
  classesJoin,
} from './track';

/** A line of E–W straights of one class along row `y`, from x0 to x1 inclusive. */
function line(
  g: TrackGraph,
  y: number,
  x0: number,
  x1: number,
  cls: 'regular' | 'high_speed' = 'regular',
) {
  for (let x = x0; x <= x1; x++) g.place(x, y, 'straight', 1, cls);
}

describe('track classes', () => {
  it('derives radius and cost from the class number', () => {
    for (const cls of TRACK_CLASSES) expect(classRadius(cls)).toBe(CLASS_N[cls] - 0.5);
    expect(classCostMul('regular')).toBe(1);
    expect(classCostMul('high_speed')).toBe(CLASS_N.high_speed * 1.5);
  });

  it('charges more for the faster class', () => {
    const reg = pieceCost('straight', 'regular');
    const hs = pieceCost('straight', 'high_speed');
    for (const k of Object.keys(reg)) expect(hs[k]).toBeGreaterThan(reg[k]);
    // A crossing takes the more expensive of its two axes.
    expect(pieceCost('crossing', 'regular', 'high_speed')).toEqual(
      pieceCost('crossing', 'high_speed', 'high_speed'),
    );
  });

  it('spreads only curves and switches over n x n tiles', () => {
    for (const kind of TRACK_KINDS) {
      expect(isUnitKind(kind, 'regular')).toBe(false);
      expect(isUnitKind(kind, 'high_speed')).toBe(kind === 'curve' || kind === 'switch');
    }
  });

  it('joins like with like, and anything to a transition', () => {
    expect(classesJoin('regular', 'regular')).toBe(true);
    expect(classesJoin('regular', 'high_speed')).toBe(false);
    expect(classesJoin('any', 'high_speed')).toBe(true);
    expect(classesJoin('regular', 'any')).toBe(true);
    expect(portClass(makePiece('transition', 0, 'regular'), Dir.N)).toBe('any');
  });

  it('gives a crossing its second class on the second axis', () => {
    const x = makePiece('crossing', 0, 'regular', 'high_speed');
    // Rotation 0: the N–S link is the first axis, E–W the second.
    expect(portClass(x, Dir.N)).toBe('regular');
    expect(portClass(x, Dir.S)).toBe('regular');
    expect(portClass(x, Dir.E)).toBe('high_speed');
    expect(portClass(x, Dir.W)).toBe('high_speed');
    expect(portClass(makePiece('crossing', 0, 'regular'), Dir.E)).toBe('regular');
  });
});

describe('pieceLinks', () => {
  it('wraps rotations and accepts negative ones', () => {
    for (const kind of TRACK_KINDS) {
      const n = rotationCount(kind);
      for (let r = 0; r < n; r++) {
        expect(pieceLinks(kind, r + n)).toEqual(pieceLinks(kind, r));
        expect(pieceLinks(kind, r - n)).toEqual(pieceLinks(kind, r));
      }
    }
  });

  it('turns a straight from N–S to E–W', () => {
    expect(pieceLinks('straight', 0)).toEqual([[Dir.N, Dir.S]]);
    expect(pieceLinks('straight', 1)).toEqual([[Dir.E, Dir.W]]);
  });

  it('gives a switch a through road and a branch on both hands', () => {
    for (let r = 0; r < rotationCount('switch'); r++) {
      const links = pieceLinks('switch', r);
      expect(links).toHaveLength(2);
      // Both roads leave the same edge.
      expect(links[0][0]).toBe(links[1][0]);
      expect(links[0][1]).not.toBe(links[1][1]);
    }
  });
});

describe('TrackGraph', () => {
  it('bumps its version on every change, so callers can cache', () => {
    const g = new TrackGraph(8, 8);
    const v0 = g.version;
    g.place(1, 1, 'straight', 1);
    expect(g.version).toBeGreaterThan(v0);
    const v1 = g.version;
    g.removeAt(1, 1);
    expect(g.version).toBeGreaterThan(v1);
  });

  it('keeps nothing outside its bounds', () => {
    const g = new TrackGraph(4, 4);
    expect(g.inBounds(0, 0)).toBe(true);
    expect(g.inBounds(3, 3)).toBe(true);
    expect(g.inBounds(4, 0)).toBe(false);
    expect(g.inBounds(-1, 0)).toBe(false);
    expect(g.get(-1, 0)).toBeUndefined();
    expect(g.get(4, 4)).toBeUndefined();
  });

  it('connects matching neighbours both ways round', () => {
    const g = new TrackGraph(8, 8);
    line(g, 3, 1, 4);
    for (let x = 1; x < 4; x++) {
      expect(g.connected(x, 3, Dir.E)).toBe(true);
      expect(g.connected(x + 1, 3, Dir.W)).toBe(true);
    }
    // The ends open onto nothing.
    expect(g.connected(1, 3, Dir.W)).toBe(false);
    expect(g.connected(4, 3, Dir.E)).toBe(false);
    // A straight has no N–S link at this rotation.
    expect(g.opensTo(2, 3, Dir.N)).toBe(false);
  });

  it('refuses to join two classes without a transition', () => {
    const g = new TrackGraph(8, 8);
    g.place(1, 1, 'straight', 1, 'regular');
    g.place(2, 1, 'straight', 1, 'high_speed');
    expect(g.opensTo(1, 1, Dir.E)).toBe(true);
    expect(g.opensTo(2, 1, Dir.W)).toBe(true);
    expect(g.connected(1, 1, Dir.E)).toBe(false);
    expect(g.connected(2, 1, Dir.W)).toBe(false);

    // A transition between them joins both sides.
    const t = new TrackGraph(8, 8);
    t.place(1, 1, 'straight', 1, 'regular');
    t.place(2, 1, 'transition', 1);
    t.place(3, 1, 'straight', 1, 'high_speed');
    expect(t.connected(1, 1, Dir.E)).toBe(true);
    expect(t.connected(2, 1, Dir.E)).toBe(true);
  });

  it('reads exits back through whichever edge you entered by', () => {
    const g = new TrackGraph(8, 8);
    g.place(2, 2, 'switch', 1);
    const links = pieceLinks('switch', 1);
    const entry = links[0][0];
    expect(g.exits(2, 2, entry).sort()).toEqual([links[0][1], links[1][1]].sort());
    // Entering by a branch leaves by the throat.
    expect(g.exits(2, 2, links[0][1])).toEqual([entry]);
    // An edge the piece does not open to leads nowhere.
    const closed = [Dir.N, Dir.E, Dir.S, Dir.W].find((d) => !g.opensTo(2, 2, d))!;
    expect(g.exits(2, 2, closed)).toEqual([]);
    expect(g.exits(7, 7, Dir.N)).toEqual([]);
  });
});

describe('multi-tile pieces', () => {
  it('writes every member of a high-speed curve against one anchor', () => {
    const g = new TrackGraph(16, 16);
    const tiles = g.place(6, 6, 'curve', 0, 'high_speed');
    expect(tiles.length).toBe(CLASS_N.high_speed ** 2);
    for (const t of tiles) {
      const p = g.get(t.x, t.y)!;
      expect(p.unit).toBeDefined();
      expect(p.unit!.ax).toBe(6);
      expect(p.unit!.ay).toBe(6);
      expect(g.anchorOf(t.x, t.y)).toEqual({ x: 6, y: 6 });
      expect(g.unitTiles(t.x, t.y)).toHaveLength(tiles.length);
    }
  });

  it('takes the whole unit away when any member is removed', () => {
    const g = new TrackGraph(16, 16);
    const tiles = g.place(6, 6, 'curve', 0, 'high_speed');
    const notTheAnchor = tiles.find((t) => t.x !== 6 || t.y !== 6)!;
    const cleared = g.removeAt(notTheAnchor.x, notTheAnchor.y);
    expect(cleared).toHaveLength(tiles.length);
    for (const t of tiles) expect(g.has(t.x, t.y)).toBe(false);
    expect(g.removeAt(6, 6)).toEqual([]);
  });

  it('treats a 1x1 piece as its own unit', () => {
    const g = new TrackGraph(8, 8);
    g.place(2, 2, 'curve', 0, 'regular');
    expect(g.get(2, 2)!.unit).toBeUndefined();
    expect(g.anchorOf(2, 2)).toEqual({ x: 2, y: 2 });
    expect(g.unitTiles(2, 2)).toEqual([{ x: 2, y: 2 }]);
    expect(g.memberLinks(2, 2)).toBeNull();
  });

  it('joins members of one unit to each other whatever their ports say', () => {
    const g = new TrackGraph(16, 16);
    const tiles = g.place(6, 6, 'curve', 0, 'high_speed');
    let internal = 0;
    for (const t of tiles)
      for (const d of [Dir.N, Dir.E, Dir.S, Dir.W]) {
        const n = {
          x: t.x + (d === Dir.E ? 1 : d === Dir.W ? -1 : 0),
          y: t.y + (d === Dir.S ? 1 : d === Dir.N ? -1 : 0),
        };
        const q = g.get(n.x, n.y);
        if (q?.unit && q.unit.ax === 6 && q.unit.ay === 6 && g.connected(t.x, t.y, d)) {
          internal++;
          expect(g.connected(n.x, n.y, opposite(d))).toBe(true);
        }
      }
    expect(internal).toBeGreaterThan(0);
  });
});
