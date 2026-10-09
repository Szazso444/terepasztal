import { describe, it, expect } from 'vitest';
import { Dir, DIRS, opposite, DIR_DX, DIR_DY } from '../engine/iso';
import { Rng } from '../engine/rng';
import { SEEDS, forAll, shrinkArray, shrinkInt } from '../testing/property';
import { isCurveLink, unitDef, unitIconPaths, unitRailPaths } from './trackGeom';
import { findPath, walkBack, type PathSegment } from './pathfinding';
import {
  TrackGraph,
  TRACK_KINDS,
  TRACK_CLASSES,
  CLASS_N,
  classRadius,
  classCostMul,
  pieceLinks,
  rotationCount,
  transitionRot,
  makePiece,
  pieceCost,
  isUnitKind,
  portClass,
  classesJoin,
  TRACK_ITEMS,
  itemKey,
  type TrackClass,
  type TrackPiece,
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
    for (const kind of TRACK_KINDS)
      for (const cls of TRACK_CLASSES)
        expect(isUnitKind(kind, cls)).toBe(
          CLASS_N[cls] > 1 && (kind === 'curve' || kind === 'switch'),
        );
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
    g.place(2, 2, 'switch', 1, 'narrow');
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
    g.place(2, 2, 'curve', 0, 'narrow');
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

describe('narrow gauge and 2x2 regular track', () => {
  it('lays regular and high-speed curves and switches over 2x2, narrow ones on one tile', () => {
    expect(CLASS_N).toEqual({ regular: 2, high_speed: 2, narrow: 1 });
    for (const kind of ['curve', 'switch'] as const) {
      expect(isUnitKind(kind, 'regular')).toBe(true);
      expect(isUnitKind(kind, 'high_speed')).toBe(true);
      expect(isUnitKind(kind, 'narrow')).toBe(false);
    }
    const g = new TrackGraph(16, 16);
    expect(g.place(4, 4, 'curve', 0, 'regular')).toHaveLength(4);
    expect(g.place(10, 4, 'curve', 0, 'narrow')).toEqual([{ x: 10, y: 4 }]);
  });

  it('joins narrow only to narrow, never through a transition', () => {
    expect(classesJoin('narrow', 'narrow')).toBe(true);
    expect(classesJoin('narrow', 'regular')).toBe(false);
    expect(classesJoin('any', 'narrow')).toBe(false);
    expect(classesJoin('narrow', 'any')).toBe(false);
    expect(classesJoin('any', 'regular')).toBe(true);
  });

  it('prices narrow track below regular and keeps a crossing at its dearer axis', () => {
    const reg = pieceCost('straight', 'regular');
    const nar = pieceCost('straight', 'narrow');
    for (const k of Object.keys(reg)) expect(nar[k]).toBeLessThanOrEqual(reg[k]);
    expect(pieceCost('crossing', 'regular', 'high_speed')).toEqual(
      pieceCost('crossing', 'high_speed', 'high_speed'),
    );
    expect(pieceCost('crossing', 'narrow', 'regular')).toEqual(
      pieceCost('crossing', 'regular', 'regular'),
    );
  });

  it('turns a mixed crossing so either line can run either way', () => {
    expect(rotationCount('crossing')).toBe(2);
    const a = makePiece('crossing', 0, 'narrow', 'regular');
    expect(portClass(a, Dir.N)).toBe('narrow');
    expect(portClass(a, Dir.E)).toBe('regular');
    const b = makePiece('crossing', 1, 'narrow', 'regular');
    expect(portClass(b, Dir.E)).toBe('narrow');
    expect(portClass(b, Dir.N)).toBe('regular');
  });

  it('offers the narrow pieces and both mixed crossings in the build list', () => {
    const keys = TRACK_ITEMS.map(itemKey);
    for (const k of [
      'straight_narrow',
      'curve_narrow',
      'switch_narrow',
      'crossing_narrow_narrow',
      'crossing_narrow_regular',
    ])
      expect(keys).toContain(k);
  });
});

describe('S-shaped switch', () => {
  /** A regular switch at (4,4) rotation 1: the main line runs E–W, the points face east. */
  function yard() {
    const g = new TrackGraph(20, 20);
    g.place(4, 4, 'switch', 1, 'regular');
    return g;
  }
  /** The tile just past the block where a lane of the given form leaves, and the edge it leaves by. */
  function exitOf(form: 'turn' | 'parallel', rot = 1) {
    const def = unitDef('switch', 2, rot, form);
    const last = def.members[def.routes[1].members[def.routes[1].members.length - 1]];
    const out = last.links.find((l) => l.route === 1)!.out;
    return { x: 4 + last.dx + DIR_DX[out], y: 4 + last.dy + DIR_DY[out], out };
  }
  const axisRot = (d: Dir) => (d === Dir.N || d === Dir.S ? 0 : 1);

  it('draws the parallel lane as an S that leaves the far end of the block one track over', () => {
    const turn = unitDef('switch', 2, 0, 'turn');
    const par = unitDef('switch', 2, 0, 'parallel');
    // rotation 0: the main line runs N to S down column 0; the S lane ends going south in column 1
    const lastTurn = turn.members[turn.routes[1].members[turn.routes[1].members.length - 1]];
    const lastPar = par.members[par.routes[1].members[par.routes[1].members.length - 1]];
    expect(lastTurn.links.find((l) => l.route === 1)!.out).toBe(Dir.E);
    expect(lastPar.dx).toBe(1);
    expect(lastPar.dy).toBe(1);
    expect(lastPar.links.find((l) => l.route === 1)!.out).toBe(Dir.S);
    expect(par.routes[1].diverging).toBe(true);
    expect(par.routes[0].members).toEqual(turn.routes[0].members);
    // two reverse arcs of radius 1.25 through asin(0.8) each
    expect(par.routes[1].length).toBeCloseTo(2 * 1.25 * Math.asin(0.8), 2);
  });

  it('snaps to the S shape when a parallel straight lies past the block, and back when it goes', () => {
    const g = yard();
    const e = exitOf('parallel');
    expect(g.get(4, 4)!.form ?? 'turn').toBe('turn');
    g.place(e.x, e.y, 'straight', axisRot(e.out), 'regular');
    const changed = g.refreshSwitchForms([e]);
    expect(changed.length).toBe(4);
    for (const t of g.unitTiles(4, 4)) expect(g.get(t.x, t.y)!.form).toBe('parallel');
    expect(g.connected(e.x, e.y, opposite(e.out))).toBe(true);
    g.removeAt(e.x, e.y);
    g.refreshSwitchForms([e]);
    for (const t of g.unitTiles(4, 4)) expect(g.get(t.x, t.y)!.form ?? 'turn').toBe('turn');
  });

  it('snaps when the switch is laid next to an existing parallel straight', () => {
    const g = new TrackGraph(20, 20);
    const e = exitOf('parallel');
    g.place(e.x, e.y, 'straight', axisRot(e.out), 'regular');
    g.place(4, 4, 'switch', 1, 'regular');
    g.refreshSwitchForms(g.unitTiles(4, 4));
    expect(g.get(4, 4)!.form).toBe('parallel');
  });

  it('ignores track of another class past the block', () => {
    const g = yard();
    const e = exitOf('parallel');
    g.place(e.x, e.y, 'straight', axisRot(e.out), 'narrow');
    g.refreshSwitchForms([e]);
    expect(g.get(4, 4)!.form ?? 'turn').toBe('turn');
  });

  it('stays a turn while its side exit is connected', () => {
    const g = yard();
    const side = exitOf('turn');
    g.place(side.x, side.y, 'straight', axisRot(side.out), 'regular');
    const e = exitOf('parallel');
    g.place(e.x, e.y, 'straight', axisRot(e.out), 'regular');
    g.refreshSwitchForms([side, e]);
    expect(g.get(4, 4)!.form ?? 'turn').toBe('turn');
  });

  it('flips form under a path without breaking the graph', () => {
    const g = yard();
    const e = exitOf('parallel');
    g.place(e.x, e.y, 'straight', axisRot(e.out), 'regular');
    const before = g.version;
    g.refreshSwitchForms([e]);
    expect(g.version).toBeGreaterThan(before);
    for (const t of g.unitTiles(4, 4))
      for (const [a, b] of g.get(t.x, t.y)!.links) expect(a).not.toBe(b);
    expect(g.unitTiles(4, 4)).toHaveLength(4);
    // the S lane is a real way through: from the points to the parallel straight
    const entry = pieceLinks('switch', 1)[0][0];
    const anchorEntry = { x: 4 + (entry === Dir.E ? 1 : 0), y: 4 };
    expect(g.opensTo(anchorEntry.x, anchorEntry.y, entry)).toBe(true);
  });
});

describe('reach', () => {
  const W = 30;
  const key = (x: number, y: number) => y * W + x;
  const along = (d: Dir, cls: 'narrow' | 'regular') =>
    [0, 1].find((r) => makePiece('straight', r, cls).links[0].includes(d))!;

  it('follows the rails through a crossing without joining its two lines', () => {
    const g = new TrackGraph(W, W);
    // rotation 0: narrow runs north-south, regular east-west
    g.place(10, 10, 'crossing', 0, 'narrow', 'regular');
    for (const y of [8, 9, 11, 12]) g.place(10, y, 'straight', along(Dir.N, 'narrow'), 'narrow');
    for (const x of [8, 9, 11, 12]) g.place(x, 10, 'straight', along(Dir.E, 'regular'), 'regular');
    expect(g.connected(10, 10, Dir.N)).toBe(true);
    expect(g.connected(10, 10, Dir.E)).toBe(true);
    const narrow = g.reach([key(10, 8)]);
    expect(narrow.has(key(10, 10))).toBe(true);
    expect(narrow.has(key(10, 12))).toBe(true);
    expect(narrow.has(key(9, 10))).toBe(false);
    expect(narrow.has(key(12, 10))).toBe(false);
    const regular = g.reach([key(8, 10)]);
    expect(regular.has(key(12, 10))).toBe(true);
    expect(regular.has(key(10, 9))).toBe(false);
  });

  it('reaches every branch of a switch from any of them', () => {
    const g = new TrackGraph(W, W);
    g.place(10, 10, 'switch', 0, 'narrow');
    const edges = [...new Set(g.get(10, 10)!.links.flat())] as Dir[];
    expect(edges).toHaveLength(3);
    const ends = edges.map((d) => {
      const x = 10 + DIR_DX[d],
        y = 10 + DIR_DY[d];
      g.place(x, y, 'straight', along(d, 'narrow'), 'narrow');
      return key(x, y);
    });
    for (const from of ends) for (const to of ends) expect(g.reach([from]).has(to)).toBe(true);
  });
});

describe('toolbar icon of a multi-tile piece', () => {
  it('fits the whole piece into one tile', () => {
    for (const kind of ['curve', 'switch'] as const)
      for (let rot = 0; rot < rotationCount(kind); rot++) {
        const def = unitDef(kind, 2, rot);
        const paths = unitIconPaths(kind, 2, rot);
        expect(paths).toHaveLength(def.routes.length);
        const pts = paths.flat();
        for (const p of pts) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(0.5 + 1e-9);
        }
        // the piece reaches the tile's edges: the icon shows all of it, not a corner
        const span = (v: number[]) => Math.max(...v) - Math.min(...v);
        expect(span(pts.map((p) => p.x))).toBeGreaterThan(0.7);
        expect(span(pts.map((p) => p.y))).toBeGreaterThan(0.7);
      }
  });
});

describe('rails of a multi-tile piece', () => {
  it('run as one unbroken line per road, with no stub where tiles meet', () => {
    for (const [kind, form] of [
      ['curve', 'turn'],
      ['switch', 'turn'],
      ['switch', 'parallel'],
    ] as const)
      for (let rot = 0; rot < rotationCount(kind); rot++) {
        const def = unitDef(kind, 2, rot, form);
        const paths = unitRailPaths(kind, 2, rot, form);
        expect(paths).toHaveLength(def.routes.length);
        paths.forEach((pts, k) => {
          let len = 0;
          for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i - 1].x,
              dy = pts[i].y - pts[i - 1].y;
            const seg = Math.hypot(dx, dy);
            // a zero-length step has no direction: the drawing would turn its sleepers anywhere
            expect(seg).toBeGreaterThan(1e-3);
            len += seg;
            if (i > 1) {
              const ex = pts[i - 1].x - pts[i - 2].x,
                ey = pts[i - 1].y - pts[i - 2].y;
              const turn = Math.abs(Math.atan2(ex * dy - ey * dx, ex * dx + ey * dy));
              expect(turn).toBeLessThan(0.05);
            }
          }
          expect(len).toBeCloseTo(def.routes[k].length, 3);
        });
      }
  });
});

describe('transition', () => {
  it('turns four ways, so its high-speed half can face any side', () => {
    expect(rotationCount('transition')).toBe(4);
    // the first two turns are what they always were
    expect(pieceLinks('transition', 0)).toEqual([[Dir.N, Dir.S]]);
    expect(pieceLinks('transition', 1)).toEqual([[Dir.E, Dir.W]]);
    expect(pieceLinks('transition', 2)).toEqual([[Dir.S, Dir.N]]);
    expect(pieceLinks('transition', 3)).toEqual([[Dir.W, Dir.E]]);
  });

  it('names the turn that puts the high-speed half towards a side', () => {
    // the piece is drawn wide from its first link end and high speed towards its second
    for (const d of [Dir.N, Dir.E, Dir.S, Dir.W])
      expect(pieceLinks('transition', transitionRot(d))[0][1]).toBe(d);
  });
});

describe('pathfinding at class joints', () => {
  /** A column of N–S straights (rotation 0) of one class along x, from y0 to y1 inclusive. */
  function column(g: TrackGraph, x: number, y0: number, y1: number, cls: TrackClass) {
    for (let y = y0; y <= y1; y++) g.place(x, y, 'straight', 0, cls);
  }
  /** Regular straights at (2,1..4), then `beyond` at (2,5..9); a transition at (2,5) if asked. */
  function joint(beyond: 'narrow' | 'high_speed', transition = false) {
    const g = new TrackGraph(6, 12);
    column(g, 2, 1, 4, 'regular');
    column(g, 2, 5, 9, beyond);
    if (transition) g.place(2, 5, 'transition', transitionRot(Dir.S));
    return g;
  }
  // entering (2,1) through its north edge heads south, towards +y
  const start = { x: 2, y: 1, in: Dir.N };
  const at = (tx: number, ty: number) => (x: number, y: number) => x === tx && y === ty;
  const admitAll = () => true;
  /** Every step of the path leaves its tile where connected() joins it to the next one. */
  function joinedThroughout(g: TrackGraph, path: PathSegment[]) {
    for (let i = 0; i + 1 < path.length; i++) {
      const s = path[i];
      expect(g.connected(s.x, s.y, s.out), `step ${i} at ${s.x},${s.y}`).toBe(true);
      expect(path[i + 1]).toMatchObject({ x: s.x + DIR_DX[s.out], y: s.y + DIR_DY[s.out] });
    }
  }

  it('finds no route across a regular-to-narrow joint', () => {
    const g = joint('narrow');
    expect(g.connected(2, 4, Dir.S)).toBe(false);
    expect(findPath(g, start, at(2, 9))).toBeNull();
    expect(findPath(g, start, at(2, 9), undefined, undefined, admitAll)).toBeNull();
    // the regular side alone still routes: the null comes from the joint
    expect(findPath(g, start, at(2, 4))).toHaveLength(4);
  });

  it('finds no route across a regular-to-high-speed joint without a transition', () => {
    const g = joint('high_speed');
    expect(g.connected(2, 4, Dir.S)).toBe(false);
    expect(findPath(g, start, at(2, 9))).toBeNull();
    expect(findPath(g, start, at(2, 9), undefined, undefined, admitAll)).toBeNull();
    expect(findPath(g, start, at(2, 4))).toHaveLength(4);
  });

  it('routes from regular to high speed through a transition', () => {
    const g = joint('high_speed', true);
    for (const access of [undefined, admitAll]) {
      const path = findPath(g, start, at(2, 9), undefined, undefined, access);
      expect(path).not.toBeNull();
      expect(path!.map((s) => s.y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      joinedThroughout(g, path!);
    }
  });

  it('still runs both lines of a mixed crossing, each on its own class', () => {
    const g = new TrackGraph(12, 12);
    // rotation 0: narrow runs north-south, regular east-west
    g.place(5, 5, 'crossing', 0, 'narrow', 'regular');
    column(g, 5, 2, 4, 'narrow');
    column(g, 5, 6, 8, 'narrow');
    for (const x of [2, 3, 4, 6, 7, 8]) g.place(x, 5, 'straight', 1, 'regular');
    const ns = findPath(g, { x: 5, y: 2, in: Dir.N }, at(5, 8));
    expect(ns?.map((s) => s.y)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    joinedThroughout(g, ns!);
    const ew = findPath(g, { x: 2, y: 5, in: Dir.W }, at(8, 5));
    expect(ew?.map((s) => s.x)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    joinedThroughout(g, ew!);
  });

  it('walks back no further than a regular-to-narrow joint', () => {
    const g = joint('narrow');
    // standing at (2,7) having entered from the north: behind lie (2,6), (2,5), then the joint
    const back = walkBack(g, 2, 7, Dir.N, 10);
    expect(back.map((s) => [s.x, s.y])).toEqual([
      [2, 5],
      [2, 6],
    ]);
    for (const s of back) expect(s.y).toBeGreaterThanOrEqual(5);
  });

  it('walks back through a transition to the end of the regular track', () => {
    const g = joint('high_speed', true);
    const back = walkBack(g, 2, 7, Dir.N, 10);
    expect(back.map((s) => s.y)).toEqual([1, 2, 3, 4, 5, 6]);
    joinedThroughout(g, [...back, { x: 2, y: 7, in: Dir.N, out: Dir.S }]);
  });
});

// findPath and walkBack at class joints on seeded layouts: lines and loops of 1×1 pieces whose
// class changes along the way, with transitions and mixed crossings. Pieces go down with set()
// whatever their class, regular and high-speed curves included: the joints are what is under test,
// and connected() reads only a piece's links, the class on each edge and its unit.

interface Tile {
  x: number;
  y: number;
}

/** Inside tile (x, y), having entered through edge `in`: what findPath searches over. */
interface State extends Tile {
  in: Dir;
}

/** One 1×1 piece. */
interface Lay extends Tile {
  kind: 'straight' | 'curve' | 'switch' | 'crossing' | 'transition';
  rot: number;
  cls: TrackClass;
  /** crossings: the class of the second link */
  cls2?: TrackClass;
}

interface JointCase {
  w: number;
  h: number;
  lays: Lay[];
  /** where findPath starts, and where walkBack walks back from through the entry edge */
  start: State;
  targets: Tile[];
  avoid: Tile[];
  /** access admits these classes on the entry edge, and transitions; absent: no predicate */
  admits?: TrackClass[];
  /** tollOf makes a high-speed piece cost three times as much to cross */
  toll: boolean;
  /** how many tiles walkBack is asked for */
  back: number;
}

const EDGE = 'NESW';
const tileText = (t: Tile) => `${t.x},${t.y}`;
const stateKey = (s: State) => `${s.x},${s.y},${s.in}`;
const pairKey = (a: Dir, b: Dir) => (a < b ? `${a}${b}` : `${b}${a}`);
const toward = (a: Tile, b: Tile) =>
  DIRS.find((d) => a.x + DIR_DX[d] === b.x && a.y + DIR_DY[d] === b.y)!;

/** Every 1×1 shape by the links it has, as sorted edge pairs. */
const SHAPES = (['straight', 'curve', 'switch', 'crossing'] as const).flatMap((kind) =>
  Array.from({ length: rotationCount(kind) }, (_, rot) => ({
    kind,
    rot,
    pairs: pieceLinks(kind, rot)
      .map(([a, b]) => pairKey(a, b))
      .sort()
      .join(' '),
  })),
);

/**
 * A piece that opens to exactly the edges `e`, of class `cls`; a crossing keeps `cls` on the line
 * through `from`, the edge the tile was reached by, and three times in four another on the other.
 */
function pieceOn(rng: Rng, x: number, y: number, e: Dir[], cls: TrackClass, from?: Dir): Lay {
  if (e.length === 4) {
    const rot = rng.int(0, 1);
    const other = rng.chance(0.75) ? rng.pick(TRACK_CLASSES.filter((k) => k !== cls)) : cls;
    if (from !== undefined && pieceLinks('crossing', rot)[1].includes(from))
      return { kind: 'crossing', rot, cls: other, cls2: cls, x, y };
    return { kind: 'crossing', rot, cls, cls2: other, x, y };
  }
  let pairs: [Dir, Dir][] = [[e[0], e[1] ?? opposite(e[0])]];
  if (e.length === 3) {
    // a straight through two of them, the third leaving either end of it
    const a = e.find((d) => e.includes(opposite(d)))!;
    const b = e.find((d) => d !== a && d !== opposite(a))!;
    pairs = [
      [a, opposite(a)],
      [rng.pick([a, opposite(a)]), b],
    ];
  }
  const want = pairs
    .map(([a, b]) => pairKey(a, b))
    .sort()
    .join(' ');
  const { kind, rot } = SHAPES.find((s) => s.pairs === want)!;
  if (kind === 'straight' && rng.chance(0.25))
    return { kind: 'transition', rot: rot + 2 * rng.int(0, 1), cls: 'regular', x, y };
  return { kind, rot, cls, x, y };
}

/**
 * A row and a column, then up to two more lines or loops round rectangles, joined where they meet:
 * a switch where three edges meet, a crossing where four do. Classes go out breadth first: a tile
 * takes the class its neighbour presents on the edge it was reached through, and one time in six a
 * random one, so some joints are breaks; past a transition the class is drawn afresh. A quarter of
 * the straights are transitions; three crossings in four carry another class on their second line.
 */
function jointLayout(rng: Rng, w: number, h: number): Lay[] {
  const edges = new Map<number, Set<Dir>>();
  const open = (t: Tile, d: Dir) => {
    const k = t.y * w + t.x;
    if (!edges.has(k)) edges.set(k, new Set());
    edges.get(k)!.add(d);
  };
  // a row and a column that cross away from the border, then up to two more of anything
  const shapes = [1, 2, ...Array.from({ length: rng.int(0, 2) }, () => rng.int(0, 2))];
  for (const [i, shape] of shapes.entries()) {
    const run: Tile[] = [];
    if (shape === 0) {
      const x0 = rng.int(0, w - 2);
      const y0 = rng.int(0, h - 2);
      const x1 = rng.int(x0 + 1, w - 1);
      const y1 = rng.int(y0 + 1, h - 1);
      for (let x = x0; x < x1; x++) run.push({ x, y: y0 });
      for (let y = y0; y < y1; y++) run.push({ x: x1, y });
      for (let x = x1; x > x0; x--) run.push({ x, y: y1 });
      for (let y = y1; y > y0; y--) run.push({ x: x0, y });
      run.push(run[0]);
    } else {
      const across = shape === 1;
      const span = across ? w : h;
      const line = i < 2 ? rng.int(1, (across ? h : w) - 2) : rng.int(0, (across ? h : w) - 1);
      const whole = i < 2 || rng.chance(0.5);
      const from = whole ? 0 : rng.int(0, span - 2);
      const to = whole ? span - 1 : rng.int(from + 1, span - 1);
      for (let i = from; i <= to; i++) run.push(across ? { x: i, y: line } : { x: line, y: i });
    }
    for (let i = 0; i + 1 < run.length; i++) {
      open(run[i], toward(run[i], run[i + 1]));
      open(run[i + 1], toward(run[i + 1], run[i]));
    }
  }
  const lays: Lay[] = [];
  const classOf = new Map<number, TrackClass>();
  const reachedBy = new Map<number, Dir>();
  for (const first of rng.shuffle([...edges.keys()])) {
    if (classOf.has(first)) continue;
    classOf.set(first, rng.pick(TRACK_CLASSES));
    const queue = [first];
    while (queue.length) {
      const k = queue.shift()!;
      const e = [...edges.get(k)!];
      const lay = pieceOn(rng, k % w, Math.floor(k / w), e, classOf.get(k)!, reachedBy.get(k));
      lays.push(lay);
      const piece = makePiece(lay.kind, lay.rot, lay.cls, lay.cls2);
      for (const d of e) {
        const n = k + DIR_DY[d] * w + DIR_DX[d];
        if (classOf.has(n)) continue;
        const along = portClass(piece, d);
        const fresh = along === 'any' || rng.chance(1 / 6);
        classOf.set(n, fresh ? rng.pick(TRACK_CLASSES) : (along as TrackClass));
        reachedBy.set(n, opposite(d));
        queue.push(n);
      }
    }
  }
  return lays;
}

function layOut(w: number, h: number, lays: Lay[]): TrackGraph {
  const g = new TrackGraph(w, h);
  for (const l of lays) g.set(l.x, l.y, makePiece(l.kind, l.rot, l.cls, l.cls2));
  return g;
}

/** May a train leave tile (x, y) through edge `out` into the tile beyond? */
type Joins = (g: TrackGraph, x: number, y: number, out: Dir) => boolean;
/** The rule a route keeps to: connected() joins the two tiles. */
const joined: Joins = (g, x, y, out) => g.connected(x, y, out);
/** The rule before it: the tile beyond only has to open back, whatever its class. */
const opensBack: Joins = (g, x, y, out) =>
  g.opensTo(x + DIR_DX[out], y + DIR_DY[out], opposite(out));
/** A mistaken rule: like joins only like, so no route runs through a transition. */
const likeOnly: Joins = (g, x, y, out) =>
  g.connected(x, y, out) &&
  portClass(g.get(x, y)!, out) ===
    portClass(g.get(x + DIR_DX[out], y + DIR_DY[out])!, opposite(out));
/** A mistaken rule: a crossing's class is its first line's on both lines. */
const byPieceClass: Joins = (g, x, y, out) => {
  if (!g.opensTo(x, y, out) || !opensBack(g, x, y, out)) return false;
  const cls = (p: TrackPiece) => (p.kind === 'transition' ? 'any' : p.cls);
  return classesJoin(cls(g.get(x, y)!), cls(g.get(x + DIR_DX[out], y + DIR_DY[out])!));
};

/** Tiles a train in `start` reaches when its steps follow `joins`. */
function tilesReached(g: TrackGraph, start: State, joins: Joins): Set<string> {
  const seen = new Set([stateKey(start)]);
  const tiles = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const s = stack.pop()!;
    for (const out of g.exits(s.x, s.y, s.in)) {
      if (!joins(g, s.x, s.y, out)) continue;
      const n = { x: s.x + DIR_DX[out], y: s.y + DIR_DY[out], in: opposite(out) };
      tiles.add(tileText(n));
      if (seen.has(stateKey(n))) continue;
      seen.add(stateKey(n));
      stack.push(n);
    }
  }
  return tiles;
}

function jointCase(rng: Rng): JointCase {
  const w = rng.int(3, 7);
  const h = rng.int(3, 7);
  const lays = jointLayout(rng, w, h);
  const g = layOut(w, h, lays);
  const somewhere = (): Tile => {
    const l = rng.pick(lays);
    return { x: l.x, y: l.y };
  };
  // mostly a start that heads onto track rather than off the end of a line, often on a crossing
  const states = lays.flatMap((l) =>
    pieceLinks(l.kind, l.rot).flatMap((k) => k.map((d) => ({ x: l.x, y: l.y, in: d }))),
  );
  const heading = states.filter((s) =>
    g.exits(s.x, s.y, s.in).some((o) => opensBack(g, s.x, s.y, o)),
  );
  const crossing = heading.filter((s) => g.get(s.x, s.y)!.kind === 'crossing');
  const from = [crossing, crossing, heading, heading, states].filter((f) => f.length);
  const start = rng.pick(rng.pick(from));
  const targets = Array.from({ length: rng.int(1, 2) }, somewhere);
  // Most of the time the first target is a tile one of the rules above reaches and connected()
  // does not, or the other way round: past a break, past a transition, along a mixed crossing.
  const reached = tilesReached(g, start, joined);
  const differ = (joins: Joins) => {
    const theirs = tilesReached(g, start, joins);
    const xor = (a: Set<string>, b: Set<string>) => [...a].filter((t) => !b.has(t));
    return [...xor(theirs, reached), ...xor(reached, theirs)];
  };
  const aims = [differ(opensBack), differ(likeOnly), differ(byPieceClass)].filter((a) => a.length);
  const aim = aims.length && rng.chance(0.75) ? rng.pick(aims) : rng.pick([[...reached], []]);
  if (aim.length) {
    const [x, y] = rng.pick(aim).split(',').map(Number);
    targets[0] = { x, y };
  }
  const avoid = rng.chance(0.3) ? [somewhere()] : [];
  const access = rng.int(0, 2);
  const admits =
    access === 0
      ? undefined
      : access === 1
        ? [...TRACK_CLASSES]
        : TRACK_CLASSES.filter(() => rng.chance(0.5));
  return { w, h, lays, start, targets, avoid, admits, toll: rng.chance(0.5), back: rng.int(0, 12) };
}

function* simplerLay(l: Lay): Iterable<Lay> {
  if (l.kind === 'transition') yield { ...l, kind: 'straight', rot: l.rot % 2 };
  else if (l.cls !== 'regular') yield { ...l, cls: 'regular' };
  if (l.cls2 !== undefined && l.cls2 !== l.cls) yield { ...l, cls2: l.cls };
}

/** Simpler cases that still start on track: fewer pieces, plainer pieces, fewer options. */
function* shrinkJointCase(c: JointCase): Iterable<JointCase> {
  if (c.admits) yield { ...c, admits: undefined };
  if (c.toll) yield { ...c, toll: false };
  if (c.avoid.length) yield { ...c, avoid: [] };
  for (const targets of shrinkArray(c.targets)) if (targets.length) yield { ...c, targets };
  for (const lays of shrinkArray(c.lays, simplerLay))
    if (lays.some((l) => l.x === c.start.x && l.y === c.start.y)) yield { ...c, lays };
  for (const back of shrinkInt(c.back)) yield { ...c, back };
}

function formatJointCase(c: JointCase): string {
  const pieces = c.lays.map((l) => {
    const cls = l.kind === 'transition' ? '' : ` ${l.cls}${l.cls2 ? `/${l.cls2}` : ''}`;
    return `${l.kind} ${l.rot}${cls} at ${tileText(l)}`;
  });
  return [
    `${c.w}x${c.h} grid, start ${tileText(c.start)} in ${EDGE[c.start.in]}`,
    `targets ${c.targets.map(tileText).join(' ')}`,
    `avoid ${c.avoid.map(tileText).join(' ') || 'none'}`,
    `access ${c.admits ? `[${c.admits.join(' ')}]` : 'none'}`,
    `toll ${c.toll}, walk back ${c.back}`,
    `pieces: ${pieces.join('; ')}`,
  ].join(', ');
}

function jointCallbacks(c: JointCase) {
  const among = (ts: Tile[]) => (x: number, y: number) => ts.some((t) => t.x === x && t.y === y);
  const admits = c.admits;
  return {
    isTarget: among(c.targets),
    avoid: c.avoid.length ? among(c.avoid) : undefined,
    access: admits
      ? (p: TrackPiece, entry: Dir) => {
          const k = portClass(p, entry);
          return k === 'any' || admits.includes(k);
        }
      : undefined,
    tollOf: c.toll ? (p: TrackPiece) => (p.cls === 'high_speed' ? 3 : 1) : undefined,
  };
}

/** findPath's cost of crossing a tile: its length, times the toll, plus 0.2 on a switch's curve. */
function stepCost(g: TrackGraph, s: State, out: Dir, tollOf?: (p: TrackPiece) => number) {
  const p = g.get(s.x, s.y)!;
  let cost = g.segLength(s.x, s.y, s.in, out);
  if (tollOf) cost *= tollOf(p);
  if (p.kind === 'switch' && isCurveLink(s.in, out)) cost += 0.2;
  return cost;
}

/** The least cost from the start to a target when steps follow `joins`; Infinity if none. */
function cheapestUnder(g: TrackGraph, c: JointCase, joins: Joins): number {
  const { isTarget, avoid, access, tollOf } = jointCallbacks(c);
  const best = new Map([[stateKey(c.start), { s: c.start, d: 0 }]]);
  for (let changed = true; changed;) {
    changed = false;
    for (const { s, d } of [...best.values()])
      for (const out of g.exits(s.x, s.y, s.in)) {
        if (!joins(g, s.x, s.y, out)) continue;
        const n = { x: s.x + DIR_DX[out], y: s.y + DIR_DY[out], in: opposite(out) };
        if (avoid?.(n.x, n.y) || (access && !access(g.get(n.x, n.y)!, n.in))) continue;
        const there = d + stepCost(g, s, out, tollOf);
        if (there < (best.get(stateKey(n))?.d ?? Infinity)) {
          best.set(stateKey(n), { s: n, d: there });
          changed = true;
        }
      }
  }
  let least = Infinity;
  for (const { s, d } of best.values())
    if (stateKey(s) !== stateKey(c.start) && isTarget(s.x, s.y)) least = Math.min(least, d);
  return least;
}

/** Would walking back from the start, the way walkBack picks its tiles, cross a break? */
function walkBackCrossesBreak(g: TrackGraph, c: JointCase): boolean {
  let s: State = c.start;
  for (let i = 0; i < c.back && opensBack(g, s.x, s.y, s.in); i++) {
    if (!g.connected(s.x, s.y, s.in)) return true;
    const out = opposite(s.in);
    const x = s.x + DIR_DX[s.in];
    const y = s.y + DIR_DY[s.in];
    const exits = g.exits(x, y, out);
    s = { x, y, in: exits.includes(opposite(out)) ? opposite(out) : exits[0] };
  }
  return false;
}

describe('class joints on seeded layouts', () => {
  const options = { shrink: shrinkJointCase, format: formatJointCase };

  it('lays cases whose answer turns on a break, a transition or a mixed crossing', () => {
    // The properties below hold on code that crosses every break, refuses every transition or
    // reads a crossing's class off its first line, unless enough seeds lay a case where each of
    // those changes the answer. Counted with the search alone, so a broken findPath cannot lower it.
    const seeds = { breaks: 0, rerouted: 0, transitions: 0, crossings: 0, walks: 0 };
    for (const seed of SEEDS) {
      const c = jointCase(new Rng(seed));
      const g = layOut(c.w, c.h, c.lays);
      const least = cheapestUnder(g, c, joined);
      const refused = [...g.tiles()].some(({ x, y }) =>
        DIRS.some((d) => g.opensTo(x, y, d) && opensBack(g, x, y, d) && !g.connected(x, y, d)),
      );
      if (refused) seeds.breaks++;
      if (cheapestUnder(g, c, opensBack) < least) seeds.rerouted++;
      if (cheapestUnder(g, c, likeOnly) > least) seeds.transitions++;
      if (cheapestUnder(g, c, byPieceClass) !== least) seeds.crossings++;
      if (walkBackCrossesBreak(g, c)) seeds.walks++;
    }
    // measured on SEEDS: 84, 21, 15, 17 and 42 of 100
    expect(seeds.breaks, 'layouts with a break').toBeGreaterThanOrEqual(60);
    expect(seeds.rerouted, 'cases a route past a break would answer').toBeGreaterThanOrEqual(10);
    expect(seeds.transitions, 'cases answered through a transition').toBeGreaterThanOrEqual(8);
    expect(seeds.crossings, 'cases answered along a mixed crossing').toBeGreaterThanOrEqual(8);
    expect(seeds.walks, 'walks back that would cross a break').toBeGreaterThanOrEqual(20);
  });

  it('routes only across joints connected() accepts, as cheaply as an exhaustive search does', () => {
    // A route that crossed a joint whose far side only opens back reaches targets past a gauge or
    // class break, or comes out cheaper than any route the search allows.
    forAll(
      jointCase,
      (c) => {
        const g = layOut(c.w, c.h, c.lays);
        const { isTarget, avoid, access, tollOf } = jointCallbacks(c);
        const path = findPath(g, c.start, isTarget, undefined, avoid, access, tollOf);
        const least = cheapestUnder(g, c, joined);
        if (!path) {
          expect(least, 'findPath found no route where the search found one').toBe(Infinity);
          return;
        }
        expect(path.length).toBeGreaterThan(1);
        expect(path[0]).toMatchObject(c.start);
        let cost = 0;
        for (let i = 0; i + 1 < path.length; i++) {
          const s = path[i];
          const n = path[i + 1];
          const where = `step ${i} leaves ${tileText(s)} by ${EDGE[s.out]}`;
          expect(g.exits(s.x, s.y, s.in), where).toContain(s.out);
          expect(g.connected(s.x, s.y, s.out), `${where}, a joint connected() refuses`).toBe(true);
          const next = { x: s.x + DIR_DX[s.out], y: s.y + DIR_DY[s.out], in: opposite(s.out) };
          expect(n, where).toMatchObject(next);
          expect(avoid?.(n.x, n.y) ?? false, `${where} into an avoided tile`).toBe(false);
          expect(access?.(g.get(n.x, n.y)!, n.in) ?? true, `${where}, refused access`).toBe(true);
          cost += stepCost(g, s, s.out, tollOf);
        }
        const end = path[path.length - 1];
        expect(isTarget(end.x, end.y), `the route ends at ${tileText(end)}`).toBe(true);
        expect(cost).toBeCloseTo(least, 9);
      },
      options,
    );
  });

  it('walks back only across joints connected() accepts, and stops only at one it refuses', () => {
    forAll(
      jointCase,
      (c) => {
        const g = layOut(c.w, c.h, c.lays);
        const back = walkBack(g, c.start.x, c.start.y, c.start.in, c.back);
        expect(back.length).toBeLessThanOrEqual(c.back);
        for (let i = 0; i < back.length; i++) {
          const s = back[i];
          const n = back[i + 1] ?? c.start;
          const where = `tile ${i} of the walk, ${tileText(s)}, out by ${EDGE[s.out]}`;
          expect(g.exits(s.x, s.y, s.out), where).toContain(s.in);
          expect(g.connected(s.x, s.y, s.out), `${where}, a joint connected() refuses`).toBe(true);
          const next = { x: s.x + DIR_DX[s.out], y: s.y + DIR_DY[s.out], in: opposite(s.out) };
          expect({ x: n.x, y: n.y, in: n.in }, where).toEqual(next);
        }
        if (back.length < c.back) {
          const head = back[0] ?? c.start;
          const where = `the walk stopped at ${tileText(head)} where the track joins on`;
          expect(g.connected(head.x, head.y, head.in), where).toBe(false);
        }
      },
      options,
    );
  });
});
