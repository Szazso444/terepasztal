import { describe, it, expect } from 'vitest';
import { Dir, opposite, DIR_DX, DIR_DY } from '../engine/iso';
import { unitDef, unitIconPaths, unitRailPaths } from './trackGeom';
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
