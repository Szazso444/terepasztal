import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notices } from './notices';
import { rules, DEFAULT_RULES } from './rules';
import { ALERT_DEFS } from './alerts';
import { simWorld, type SimWorld } from '../testing/simWorld';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** A world with `n` Branch straights in a row, a tile apart, each at zero health. */
function failed(n: number): SimWorld {
  const w = simWorld({ terrain: 'grass', size: 32 });
  for (let i = 0; i < n; i++) {
    w.track.place(4 + i * 2, 5, 'straight', 1, 'branch');
    w.track.get(4 + i * 2, 5)!.wear.health = 0;
  }
  return w;
}
const worn = (w: SimWorld) => {
  const n = new Notices();
  n.refresh({ trains: [], builder: w.builder, power: w.power, wear: w.builder.wear });
  return n.list.filter((x) => x.type === 'trackbroken');
};

describe('notices for unusable track', () => {
  it('a world with none says nothing', () => {
    expect(worn(failed(0))).toEqual([]);
  });

  it('three unusable pieces give three notices, four give one with a count', () => {
    const three = worn(failed(3));
    expect(three).toHaveLength(3);
    expect(new Set(three.map((n) => n.key)).size).toBe(3);
    expect(three.map((n) => n.target)).toEqual([
      { kind: 'tile', x: 4, y: 5 },
      { kind: 'tile', x: 6, y: 5 },
      { kind: 'tile', x: 8, y: 5 },
    ]);
    const four = worn(failed(4));
    expect(four).toHaveLength(1);
    expect(four[0].text).toContain('4');
    expect(four[0].target).toEqual({ kind: 'tile', x: 4, y: 5 });
    expect(four[0].kind).toBe('bad');
  });

  it('a multi-tile piece is one notice, at its anchor', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    const tiles = w.track.place(8, 8, 'curve', 0, 'main');
    expect(tiles.length).toBeGreaterThan(1);
    w.track.get(8, 8)!.wear.health = 0;
    const list = worn(w);
    expect(list).toHaveLength(1);
    expect(list[0].target).toEqual({ kind: 'tile', x: 8, y: 8 });
  });

  it('a repaired piece takes its notice away', () => {
    const w = failed(2);
    const n = new Notices();
    const src = { trains: [], builder: w.builder, power: w.power, wear: w.builder.wear };
    n.refresh(src);
    expect(n.list.filter((x) => x.type === 'trackbroken')).toHaveLength(2);
    w.track.get(4, 5)!.wear.health = 1;
    w.track.version++;
    n.refresh(src);
    expect(n.list.filter((x) => x.type === 'trackbroken')).toHaveLength(1);
  });

  it('both rows are marked on the alert icon and the map pin', () => {
    expect(ALERT_DEFS.trackbroken).toEqual({ severity: 'problem', start: ['icon', 'pin'] });
    expect(ALERT_DEFS.trackworn).toMatchObject({ severity: 'attention', start: ['icon', 'pin'] });
  });
});

describe('the unusable pieces', () => {
  it('are listed once each, with their anchor and every tile', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.track.place(2, 2, 'straight', 1, 'branch');
    const curve = w.track.place(8, 8, 'curve', 0, 'main');
    w.track.get(2, 2)!.wear.health = 0;
    w.track.get(curve[0].x, curve[0].y)!.wear.health = 0;
    const list = w.builder.wear.failedPieces();
    expect(list).toHaveLength(2);
    const straight = list.find((p) => p.tiles.length === 1)!;
    expect(straight).toMatchObject({ x: 2, y: 2 });
    const turn = list.find((p) => p.tiles.length > 1)!;
    expect(turn.tiles).toHaveLength(curve.length);
    expect(w.track.get(turn.x, turn.y)!.unit).toMatchObject({ ax: turn.x, ay: turn.y });
  });

  it('are none when every piece is sound', () => {
    expect(failed(0).builder.wear.failedPieces()).toEqual([]);
  });
});
