import { describe, it, expect } from 'vitest';
import { Dir, DIRS, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import { TrackGraph, pieceLinks, type TrackClass } from './track';
import { planReclass, stepTiles, type ReclassPlan } from './reclass';

const W = 40;
const NS = 0,
  EW = 1;
const graph = () => new TrackGraph(W, W);
const row = (g: TrackGraph, y: number, x0: number, x1: number, cls: TrackClass = 'regular') => {
  for (let x = x0; x <= x1; x++) g.place(x, y, 'straight', EW, cls);
};
const col = (g: TrackGraph, x: number, y0: number, y1: number, cls: TrackClass = 'regular') => {
  for (let y = y0; y <= y1; y++) g.place(x, y, 'straight', NS, cls);
};
/** kind and class of the piece on a tile, as one word */
const at = (g: TrackGraph, x: number, y: number) => {
  const p = g.get(x, y);
  if (!p) return 'none';
  return `${p.kind}/${p.cls}${p.kind === 'crossing' ? '+' + p.cls2 : ''}`;
};
/** every joint that carries trains: tile and edge */
const joints = (g: TrackGraph) => {
  const out: string[] = [];
  for (const t of g.tiles())
    for (const d of DIRS) if (g.connected(t.x, t.y, d)) out.push(`${t.x},${t.y},${d}`);
  return out;
};
const lay = (g: TrackGraph, plan: ReclassPlan) => {
  const before = joints(g);
  for (const c of plan.changes) g.place(c.x, c.y, c.kind, c.rot, c.cls, c.cls2, c.form ?? 'turn');
  g.refreshSwitchForms();
  // a conversion never parts track that was joined
  const after = new Set(joints(g));
  for (const j of before) expect(after.has(j), `joint ${j} parted`).toBe(true);
};
/** which way a transition's high-speed half faces */
const hsEnd = (g: TrackGraph, x: number, y: number) =>
  pieceLinks('transition', g.get(x, y)!.rot)[0][1];
/** the open ends of the piece on a tile: the tile beyond each and the edge that leads there */
const endsOf = (g: TrackGraph, x: number, y: number) => {
  const tiles = g.unitTiles(x, y);
  const mine = (tx: number, ty: number) => tiles.some((t) => t.x === tx && t.y === ty);
  const out: { x: number; y: number; d: Dir }[] = [];
  for (const t of tiles)
    for (const d of g.get(t.x, t.y)!.links.flat() as Dir[]) {
      const nx = t.x + DIR_DX[d],
        ny = t.y + DIR_DY[d];
      if (!mine(nx, ny) && !out.some((e) => e.x === nx && e.y === ny))
        out.push({ x: nx, y: ny, d });
    }
  return out;
};
/** `n` straights leading away from an open end */
const lead = (
  g: TrackGraph,
  e: { x: number; y: number; d: Dir },
  n: number,
  cls: TrackClass = 'regular',
) => {
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const x = e.x + DIR_DX[e.d] * i,
      y = e.y + DIR_DY[e.d] * i;
    g.place(x, y, 'straight', e.d === Dir.N || e.d === Dir.S ? NS : EW, cls);
    tiles.push({ x, y });
  }
  return tiles;
};
/** a curve laid so that one of its ends meets the given open end; returns its anchor */
const curveAt = (g: TrackGraph, e: { x: number; y: number; d: Dir }) => {
  for (let ay = e.y - 2; ay <= e.y + 2; ay++)
    for (let ax = e.x - 2; ax <= e.x + 2; ax++)
      for (let rot = 0; rot < 4; rot++) {
        const probe = graph();
        const tiles = probe.place(ax, ay, 'curve', rot, 'regular');
        if (tiles.some((t) => g.has(t.x, t.y))) continue;
        const p = probe.get(e.x, e.y);
        if (!p || !p.links.flat().includes(opposite(e.d))) continue;
        g.place(ax, ay, 'curve', rot, 'regular');
        return { x: ax, y: ay };
      }
  throw new Error('no curve fits there');
};

describe('upgrading straights', () => {
  it('turns a lone straight between wide track into a transition', () => {
    const g = graph();
    row(g, 10, 5, 9);
    const plan = planReclass(g, [{ x: 7, y: 10 }], 'high_speed');
    expect(plan.changes).toHaveLength(1);
    lay(g, plan);
    expect(at(g, 7, 10)).toBe('transition/regular');
    expect(at(g, 6, 10)).toBe('straight/regular');
  });

  it('turns a run into high speed with a transition at each end', () => {
    const all = graph();
    row(all, 10, 5, 9);
    lay(
      all,
      planReclass(
        all,
        [6, 7, 8].map((x) => ({ x, y: 10 })),
        'high_speed',
      ),
    );
    const one = graph();
    row(one, 10, 5, 9);
    for (const x of [6, 7, 8])
      lay(one, planReclass(one, [{ x, y: 10 }], 'high_speed', { x: x - 1, y: 10 }));
    for (const g of [all, one]) {
      expect([5, 6, 7, 8, 9].map((x) => at(g, x, 10))).toEqual([
        'straight/regular',
        'transition/regular',
        'straight/high_speed',
        'transition/regular',
        'straight/regular',
      ]);
    }
  });

  it("faces each transition's high-speed half to the high-speed side", () => {
    const g = graph();
    row(g, 10, 5, 9);
    lay(
      g,
      planReclass(
        g,
        [6, 7, 8].map((x) => ({ x, y: 10 })),
        'high_speed',
      ),
    );
    expect(hsEnd(g, 6, 10)).toBe(Dir.E);
    expect(hsEnd(g, 8, 10)).toBe(Dir.W);
    const v = graph();
    col(v, 10, 5, 9);
    lay(
      v,
      planReclass(
        v,
        [6, 7, 8].map((y) => ({ x: 10, y })),
        'high_speed',
      ),
    );
    expect(hsEnd(v, 10, 6)).toBe(Dir.S);
    expect(hsEnd(v, 10, 8)).toBe(Dir.N);
  });

  it('makes a dead-end run plain high speed', () => {
    const g = graph();
    row(g, 10, 5, 8);
    lay(
      g,
      planReclass(
        g,
        [5, 6, 7, 8].map((x) => ({ x, y: 10 })),
        'high_speed',
      ),
    );
    expect([5, 6, 7, 8].map((x) => at(g, x, 10))).toEqual(Array(4).fill('straight/high_speed'));
  });

  it('moves the transition along as the line is converted', () => {
    const g = graph();
    row(g, 10, 5, 9);
    lay(
      g,
      planReclass(
        g,
        [
          { x: 5, y: 10 },
          { x: 6, y: 10 },
        ],
        'high_speed',
      ),
    );
    expect([5, 6, 7].map((x) => at(g, x, 10))).toEqual([
      'straight/high_speed',
      'transition/regular',
      'straight/regular',
    ]);
    lay(g, planReclass(g, [{ x: 7, y: 10 }], 'high_speed', { x: 6, y: 10 }));
    // one transition, at the new frontier
    expect([5, 6, 7, 8, 9].map((x) => at(g, x, 10))).toEqual([
      'straight/high_speed',
      'straight/high_speed',
      'transition/regular',
      'straight/regular',
      'straight/regular',
    ]);
    expect(hsEnd(g, 7, 10)).toBe(Dir.W);
  });
});

describe('upgrading curves and switches', () => {
  it('turns the straight beside a converted curve into the transition', () => {
    const g = graph();
    g.place(10, 10, 'curve', 0, 'regular');
    const [a, b] = endsOf(g, 10, 10);
    const la = lead(g, a, 2),
      lb = lead(g, b, 2);
    const plan = planReclass(g, [{ x: 10, y: 10 }], 'high_speed');
    lay(g, plan);
    expect(at(g, 10, 10)).toBe('curve/high_speed');
    expect(g.unitTiles(10, 10).every((t) => g.get(t.x, t.y)!.cls === 'high_speed')).toBe(true);
    expect(at(g, la[0].x, la[0].y)).toBe('transition/regular');
    expect(at(g, lb[0].x, lb[0].y)).toBe('transition/regular');
    expect(at(g, la[1].x, la[1].y)).toBe('straight/regular');
    // the transitions' high-speed halves face the curve
    expect(hsEnd(g, la[0].x, la[0].y)).toBe(opposite(a.d));
    expect(hsEnd(g, lb[0].x, lb[0].y)).toBe(opposite(b.d));
  });

  it('is named by any of its tiles', () => {
    const g = graph();
    const tiles = g.place(10, 10, 'curve', 0, 'regular');
    const far = tiles[tiles.length - 1];
    const plan = planReclass(g, [far], 'high_speed');
    expect(plan.changes).toEqual([
      { x: 10, y: 10, kind: 'curve', rot: 0, cls: 'high_speed', cls2: undefined, form: undefined },
    ]);
  });

  it("converts a switch whole, keeping its form and its branch's partner", () => {
    const g = graph();
    g.place(10, 10, 'switch', 0, 'regular');
    // the straight that bends the branch into an S
    const s = g.switchExit(10, 10, 0, 'regular', 'parallel');
    lead(g, { x: s.x, y: s.y, d: s.out }, 2);
    g.refreshSwitchForms();
    expect(g.get(10, 10)!.form).toBe('parallel');
    const ends = endsOf(g, 10, 10);
    for (const e of ends) if (!g.has(e.x, e.y)) lead(g, e, 2);
    lay(g, planReclass(g, [{ x: 10, y: 10 }], 'high_speed'));
    expect(at(g, 10, 10)).toBe('switch/high_speed');
    expect(g.get(10, 10)!.form).toBe('parallel');
    for (const e of ends) expect(at(g, e.x, e.y), `${e.x},${e.y}`).toBe('transition/regular');
  });

  it('carries on through joined curves to the next straight', () => {
    const g = graph();
    g.place(10, 10, 'curve', 0, 'regular');
    const [a, b] = endsOf(g, 10, 10);
    const la = lead(g, a, 2);
    // a second curve straight on the first one's other end, then straights
    const second = curveAt(g, b);
    const far = endsOf(g, second.x, second.y).find((e) => !g.has(e.x, e.y))!;
    const lf = lead(g, far, 2);
    const plan = planReclass(g, [{ x: 10, y: 10 }], 'high_speed');
    lay(g, plan);
    expect(at(g, 10, 10)).toBe('curve/high_speed');
    expect(at(g, second.x, second.y)).toBe('curve/high_speed');
    expect(at(g, la[0].x, la[0].y)).toBe('transition/regular');
    expect(at(g, lf[0].x, lf[0].y)).toBe('transition/regular');
    expect(at(g, lf[1].x, lf[1].y)).toBe('straight/regular');
  });
});

describe('upgrading through crossings', () => {
  const cross = (cls: TrackClass = 'regular', cls2: TrackClass = 'regular') => {
    const g = graph();
    row(g, 10, 5, 15);
    col(g, 10, 5, 15, cls === 'narrow' ? 'narrow' : 'regular');
    g.place(10, 10, 'crossing', 0, cls, cls2);
    return g;
  };
  const stroke = (g: TrackGraph, tiles: { x: number; y: number }[]) => {
    let from: { x: number; y: number } | undefined;
    for (const t of tiles) {
      lay(g, planReclass(g, [t], 'high_speed', from));
      from = t;
    }
  };

  it('converts only the line the stroke runs along', () => {
    const g = cross();
    stroke(
      g,
      [7, 8, 9, 10, 11, 12].map((x) => ({ x, y: 10 })),
    );
    expect([6, 7, 8, 9, 10, 11, 12, 13].map((x) => at(g, x, 10))).toEqual([
      'straight/regular',
      'transition/regular',
      'straight/high_speed',
      'straight/high_speed',
      'crossing/regular+high_speed',
      'straight/high_speed',
      'transition/regular',
      'straight/regular',
    ]);
    // the other line is as it was
    expect(at(g, 10, 9)).toBe('straight/regular');
    expect(at(g, 10, 11)).toBe('straight/regular');
    // rotation 0 carries the second class east-west
    expect(g.get(10, 10)!.rot).toBe(0);
  });

  it('picks the crossing turn that carries the classes', () => {
    const g = cross();
    stroke(
      g,
      [8, 9, 10, 11, 12].map((y) => ({ x: 10, y })),
    );
    expect(at(g, 10, 10)).toBe('crossing/regular+high_speed');
    // the high-speed line runs north-south: the turn that swaps the lines
    expect(g.get(10, 10)!.rot).toBe(1);
    expect(at(g, 9, 10)).toBe('straight/regular');
    expect(at(g, 10, 9)).toBe('straight/high_speed');
  });

  it('converts both lines of a crossing clicked on its own', () => {
    const g = cross();
    lay(g, planReclass(g, [{ x: 10, y: 10 }], 'high_speed'));
    expect(at(g, 10, 10)).toBe('crossing/high_speed+high_speed');
    for (const [x, y] of [
      [9, 10],
      [11, 10],
      [10, 9],
      [10, 11],
    ])
      expect(at(g, x, y)).toBe('transition/regular');
  });

  it('finishes a line that was converted up to the crossing on both sides', () => {
    const g = cross();
    lay(
      g,
      planReclass(
        g,
        [7, 8, 9].map((x) => ({ x, y: 10 })),
        'high_speed',
      ),
    );
    lay(
      g,
      planReclass(
        g,
        [11, 12, 13].map((x) => ({ x, y: 10 })),
        'high_speed',
      ),
    );
    expect(at(g, 9, 10)).toBe('transition/regular');
    // a click on the crossing: the line that already runs up to it
    lay(g, planReclass(g, [{ x: 10, y: 10 }], 'high_speed'));
    expect(at(g, 10, 10)).toBe('crossing/regular+high_speed');
    expect(at(g, 9, 10)).toBe('straight/high_speed');
    expect(at(g, 11, 10)).toBe('straight/high_speed');
    expect(at(g, 10, 9)).toBe('straight/regular');
  });

  it('stops at a crossing with a narrow line', () => {
    // narrow north-south, wide east-west
    const g = cross('narrow', 'regular');
    stroke(
      g,
      [8, 9].map((x) => ({ x, y: 10 })),
    );
    expect(at(g, 9, 10)).toBe('transition/regular');
    const plan = planReclass(g, [{ x: 10, y: 10 }], 'high_speed', { x: 9, y: 10 });
    expect(plan).toEqual({ changes: [], reason: 'blocked' });
    expect(at(g, 10, 10)).toBe('crossing/narrow+regular');
  });

  it('blocks a curve joined straight to such a crossing', () => {
    const g = graph();
    col(g, 10, 5, 15, 'narrow');
    g.place(10, 10, 'crossing', 0, 'narrow', 'regular');
    const curve = curveAt(g, { x: 11, y: 10, d: Dir.E });
    expect(g.connected(10, 10, Dir.E)).toBe(true);
    const plan = planReclass(g, [curve], 'high_speed');
    expect(plan).toEqual({ changes: [], reason: 'blocked' });
  });
});

describe('what the tools leave alone', () => {
  it('leaves narrow track alone and says why', () => {
    const g = graph();
    row(g, 10, 5, 9, 'narrow');
    expect(planReclass(g, [{ x: 7, y: 10 }], 'high_speed')).toEqual({
      changes: [],
      reason: 'narrow',
    });
    expect(planReclass(g, [{ x: 7, y: 20 }], 'high_speed')).toEqual({
      changes: [],
      reason: 'nothing',
    });
  });

  it('has nothing to do on track already converted', () => {
    const g = graph();
    row(g, 10, 5, 9, 'high_speed');
    expect(planReclass(g, [{ x: 7, y: 10 }], 'high_speed')).toEqual({
      changes: [],
      reason: 'nothing',
    });
    row(g, 12, 5, 9);
    expect(planReclass(g, [{ x: 7, y: 12 }], 'regular')).toEqual({
      changes: [],
      reason: 'nothing',
    });
  });
});

describe('downgrading', () => {
  it('downgrades the same way round', () => {
    const g = graph();
    row(g, 10, 5, 9);
    lay(
      g,
      planReclass(
        g,
        [6, 7, 8].map((x) => ({ x, y: 10 })),
        'high_speed',
      ),
    );
    lay(
      g,
      planReclass(
        g,
        [6, 7, 8].map((x) => ({ x, y: 10 })),
        'regular',
      ),
    );
    // the transitions at the ends merge away
    expect([5, 6, 7, 8, 9].map((x) => at(g, x, 10))).toEqual(Array(5).fill('straight/regular'));
  });

  it('leaves a transition where a downgraded piece still meets high speed', () => {
    const g = graph();
    row(g, 10, 5, 9, 'high_speed');
    lay(
      g,
      planReclass(
        g,
        [
          { x: 5, y: 10 },
          { x: 6, y: 10 },
        ],
        'regular',
      ),
    );
    expect([5, 6, 7].map((x) => at(g, x, 10))).toEqual([
      'straight/regular',
      'transition/regular',
      'straight/high_speed',
    ]);
    expect(hsEnd(g, 6, 10)).toBe(Dir.E);
  });

  it('downgrades one line of a crossing', () => {
    const g = graph();
    row(g, 10, 5, 15, 'high_speed');
    col(g, 10, 5, 15, 'high_speed');
    g.place(10, 10, 'crossing', 0, 'high_speed', 'high_speed');
    lay(g, planReclass(g, [{ x: 10, y: 10 }], 'regular', { x: 9, y: 10 }));
    // the east-west line is wide now; rotation 1 puts the wide class there
    expect(at(g, 10, 10)).toBe('crossing/regular+high_speed');
    expect(g.get(10, 10)!.rot).toBe(1);
    expect(at(g, 9, 10)).toBe('transition/regular');
    expect(at(g, 10, 9)).toBe('straight/high_speed');
  });
});

describe('a stroke across tiles', () => {
  it('visits every tile on the way, one step at a time', () => {
    for (const [a, b] of [
      [
        { x: 5, y: 5 },
        { x: 9, y: 5 },
      ],
      [
        { x: 5, y: 5 },
        { x: 8, y: 7 },
      ],
      [
        { x: 5, y: 5 },
        { x: 3, y: 11 },
      ],
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
    ]) {
      const path = stepTiles(a, b);
      expect(path).toHaveLength(Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
      let at = a;
      for (const p of path) {
        expect(Math.abs(p.x - at.x) + Math.abs(p.y - at.y)).toBe(1);
        at = p;
      }
      expect(at).toEqual(b);
    }
  });
});
