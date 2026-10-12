import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRACE_MS,
  HOLD_MS,
  RING_C,
  ROOT_DELAY_MS,
  ROOT_LEAVE_MS,
  SHOW_MS,
  TIP_MARGIN,
  TIP_OFFSET,
  UPDATE_MS,
  TooltipStack,
  holdProgress,
  placeTip,
  ringDashOffset,
  termAnchor,
  tipKey,
  type Point,
  type TipView,
} from './tooltipStack';

/** A view that logs what the stack asks of it and keeps what is on screen, level by level. */
class FakeView implements TipView<string> {
  log: string[] = [];
  shown: string[] = [];
  locked: boolean[] = [];
  at: Point[] = [];
  open(level: number, content: string, anchor: Point) {
    expect(level, 'a tooltip opens right above the top one').toBe(this.shown.length);
    this.log.push(`open ${level} ${content}`);
    this.shown[level] = content;
    this.locked[level] = false;
    this.at[level] = anchor;
  }
  move(level: number, anchor: Point) {
    this.log.push(`move ${level}`);
    this.at[level] = anchor;
  }
  refresh(level: number, content: string) {
    this.log.push(`refresh ${level} ${content}`);
    this.shown[level] = content;
  }
  lock(level: number) {
    this.log.push(`lock ${level}`);
    this.locked[level] = true;
  }
  close(level: number) {
    expect(level, 'the newest tooltip closes first').toBe(this.shown.length - 1);
    this.log.push(`close ${level}`);
    this.shown.length = level;
    this.locked.length = level;
    this.at.length = level;
  }
  /** what happened since the last call */
  take(): string[] {
    const l = this.log;
    this.log = [];
    return l;
  }
}

const FRAME = 16;
const TILE_A = tipKey({ kind: 'tile', x: 3, y: 4, tool: 'none' });
const TILE_B = tipKey({ kind: 'tile', x: 4, y: 4, tool: 'none' });

let view: FakeView;
let stack: TooltipStack<string>;
/** how many times each content was built */
let builds: Map<string, number>;

beforeEach(() => {
  vi.useFakeTimers();
  view = new FakeView();
  stack = new TooltipStack<string>(view, {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  });
  builds = new Map();
});
afterEach(() => {
  // whatever a test did, the view shows exactly what the stack holds
  expect(view.shown.length).toBe(stack.depth);
  for (let l = 0; l < stack.depth; l++) expect(view.locked[l]).toBe(stack.isLocked(l));
  vi.useRealTimers();
});

const build = (content: string) => () => {
  builds.set(content, (builds.get(content) ?? 0) + 1);
  return content;
};
const built = (content: string) => builds.get(content) ?? 0;
const wait = (ms: number) => vi.advanceTimersByTime(ms);

/** The game's frames over `ms`: the pointer on `key` at `x`, `y`, as `hover` sees it each frame. */
function rest(key: string | null, ms: number, x = 100, y = 100, content = key ?? '') {
  for (let t = 0; t < ms; t += FRAME) {
    stack.hover(key, x, y, build(content));
    wait(Math.min(FRAME, ms - t));
  }
}
/** The game's frames over `ms` with the pointer off the field. */
function away(ms: number) {
  for (let t = 0; t < ms; t += FRAME) {
    stack.leave();
    wait(Math.min(FRAME, ms - t));
  }
}
/** A root over the field, opened and locked, the pointer still where it opened it. */
function lockedRoot(key = TILE_A) {
  rest(key, ROOT_DELAY_MS + HOLD_MS);
  expect(stack.isLocked(0)).toBe(true);
  view.take();
}
/** A term in the tooltip at `parent`: rest on it until its tooltip opens, `content`. */
function openTerm(parent: number, content: string, term: object = {}) {
  stack.termEnter(parent, term, () => ({ x: 200, y: 200 }), build(content));
  wait(SHOW_MS);
  return term;
}
/** Into the tooltip at `level`: from the term below it that opened it, or (level 0) from outside. */
function enter(level: number) {
  if (level > 0) {
    stack.termLeave(level - 1);
    stack.tipLeave(level - 1, level);
  }
  stack.tipEnter(level);
}

describe('the root over the field', () => {
  it('builds nothing and opens nothing while the pointer sweeps across targets', () => {
    for (let i = 0; i < 40; i++) {
      const key = tipKey({ kind: 'tile', x: i, y: 7, tool: 'none' });
      rest(key, ROOT_DELAY_MS - FRAME * 2, 100 + i * 5, 100, key);
    }
    expect([...builds.values()]).toEqual([]);
    expect(view.take()).toEqual([]);
  });

  it('builds its content once, when the pointer has rested ROOT_DELAY_MS on one target', () => {
    rest(TILE_A, ROOT_DELAY_MS - FRAME, 100, 100, 'a');
    expect(built('a')).toBe(0);
    rest(TILE_A, 5000, 100, 100, 'a');
    expect(built('a')).toBe(1);
    expect(view.take().filter((l) => l.startsWith('open'))).toEqual(['open 0 a']);
  });

  it('never rebuilds or restarts its ring for the same target, wherever the pointer is on it', () => {
    let x = 100;
    stack.hover(TILE_A, x, 100, build('a'));
    wait(ROOT_DELAY_MS);
    for (let t = 0; t < HOLD_MS - FRAME; t += FRAME) {
      x = 100 + (t % 7);
      stack.hover(TILE_A, x, 100, build('a'));
      wait(FRAME);
    }
    expect(stack.isLocked(0)).toBe(false);
    wait(FRAME);
    expect(stack.isLocked(0)).toBe(true);
    rest(TILE_A, 3000, x, 100, 'a');
    expect(built('a')).toBe(1);
    expect(view.take().filter((l) => !l.startsWith('move'))).toEqual(['open 0 a', 'lock 0']);
  });

  it('follows the pointer until it locks, then stays put', () => {
    rest(TILE_A, ROOT_DELAY_MS);
    rest(TILE_A, FRAME, 110, 105);
    expect(view.at[0]).toEqual({ x: 110, y: 105 });
    wait(HOLD_MS);
    stack.hover(TILE_A, 130, 120, build(TILE_A));
    expect(view.at[0]).toEqual({ x: 110, y: 105 });
  });

  it('opens where the pointer is when the wait ends', () => {
    stack.hover(TILE_A, 100, 100, build('a'));
    wait(ROOT_DELAY_MS / 2);
    stack.hover(TILE_A, 107, 103, build('a'));
    wait(ROOT_DELAY_MS / 2);
    expect(view.at[0]).toEqual({ x: 107, y: 103 });
  });

  it('closes on a new target and opens a new root there, its ring empty again', () => {
    rest(TILE_A, ROOT_DELAY_MS + HOLD_MS / 2, 100, 100, 'a');
    view.take();
    stack.hover(TILE_B, 120, 100, build('b'));
    expect(view.take()).toEqual(['close 0']);
    rest(TILE_B, ROOT_DELAY_MS + HOLD_MS - FRAME, 120, 100, 'b');
    expect(stack.isLocked(0)).toBe(false);
    rest(TILE_B, FRAME, 120, 100, 'b');
    expect(view.take()).toEqual(['open 0 b', 'lock 0']);
  });

  it('closes at once when the pointer finds no target or leaves the field, while unlocked', () => {
    rest(TILE_A, ROOT_DELAY_MS + FRAME);
    stack.hover(null, 100, 100, build('x'));
    expect(stack.depth).toBe(0);
    rest(TILE_A, ROOT_DELAY_MS + FRAME, 101);
    stack.leave();
    expect(stack.depth).toBe(0);
  });

  it('drops a waiting root when the pointer leaves the field', () => {
    rest(TILE_A, ROOT_DELAY_MS - FRAME, 100, 100, 'a');
    away(2000);
    expect(built('a')).toBe(0);
    expect(stack.depth).toBe(0);
  });
});

describe('the lock and the grace', () => {
  it('stays while the pointer travels over the field to it', () => {
    lockedRoot();
    rest(TILE_B, ROOT_LEAVE_MS - FRAME * 3, 104, 104);
    expect(stack.depth).toBe(1);
    stack.tipEnter(0);
    wait(5000);
    expect(stack.depth).toBe(1);
  });

  it('closes ROOT_LEAVE_MS after the pointer first moves on, later movement not restarting it', () => {
    lockedRoot();
    for (let t = 0; t < ROOT_LEAVE_MS - FRAME; t += FRAME) {
      stack.hover(TILE_A, 101 + t, 100, build(TILE_A));
      wait(FRAME);
    }
    expect(stack.depth).toBe(1);
    stack.hover(TILE_A, 999, 100, build(TILE_A));
    wait(FRAME);
    expect(stack.depth).toBe(0);
  });

  it('stays while the pointer keeps still on the field', () => {
    lockedRoot();
    rest(TILE_A, 10_000);
    expect(stack.depth).toBe(1);
  });

  it('closes ROOT_LEAVE_MS after the pointer leaves the field, unless it goes into the stack', () => {
    lockedRoot();
    away(ROOT_LEAVE_MS - FRAME);
    expect(stack.depth).toBe(1);
    away(FRAME);
    expect(stack.depth).toBe(0);

    lockedRoot(TILE_B);
    stack.tipEnter(0);
    away(5000);
    expect(stack.depth).toBe(1);
  });

  it('closes GRACE_MS after the pointer leaves it, and stays if the pointer comes back in time', () => {
    lockedRoot();
    stack.tipEnter(0);
    stack.tipLeave(0, null);
    wait(GRACE_MS - 1);
    stack.tipEnter(0);
    wait(5000);
    expect(stack.depth).toBe(1);
    stack.tipLeave(0, null);
    wait(GRACE_MS - 1);
    expect(stack.depth).toBe(1);
    wait(1);
    expect(stack.depth).toBe(0);
  });

  it('opens a fresh root on the next movement after a close, and not before', () => {
    lockedRoot();
    stack.tipEnter(0);
    stack.tipLeave(0, null);
    wait(GRACE_MS);
    expect(stack.depth).toBe(0);
    rest(TILE_A, 2000);
    expect(stack.depth).toBe(0);
    rest(TILE_A, ROOT_DELAY_MS, 101);
    expect(stack.depth).toBe(1);
    expect(stack.isLocked(0)).toBe(false);
  });
});

describe('nested tooltips', () => {
  it('open three levels deep, each locking after HOLD_MS, and close newest first', () => {
    lockedRoot();
    for (let level = 1; level <= 3; level++) {
      enter(level - 1);
      openTerm(level - 1, `term ${level}`);
      expect(stack.depth).toBe(level + 1);
      wait(HOLD_MS - 1);
      expect(stack.isLocked(level)).toBe(false);
      wait(1);
      expect(stack.isLocked(level)).toBe(true);
    }
    enter(3);
    view.take();
    // out of the top one, off the field: it goes after the grace, the rest with the root
    stack.tipLeave(3, null);
    away(GRACE_MS);
    expect(view.take()).toEqual(['close 3']);
    away(ROOT_LEAVE_MS - GRACE_MS);
    expect(view.take()).toEqual(['close 2', 'close 1', 'close 0']);
  });

  it('come only from a locked tooltip', () => {
    rest(TILE_A, ROOT_DELAY_MS + HOLD_MS / 2);
    openTerm(0, 'biome');
    wait(HOLD_MS);
    expect(built('biome')).toBe(0);
    expect(stack.depth).toBe(1);
  });

  it('open after SHOW_MS of rest on the term, and not if the pointer leaves it sooner', () => {
    lockedRoot();
    enter(0);
    stack.termEnter(0, {}, () => ({ x: 1, y: 1 }), build('biome'));
    wait(SHOW_MS - 1);
    stack.termLeave(0);
    wait(1000);
    expect(built('biome')).toBe(0);
    openTerm(0, 'biome');
    expect(view.take().at(-1)).toBe('open 1 biome');
  });

  it('are anchored where the term is when they open', () => {
    lockedRoot();
    enter(0);
    let box = { right: 10, bottom: 10 };
    stack.termEnter(0, {}, () => termAnchor(box), build('biome'));
    box = { right: 50, bottom: 60 };
    wait(SHOW_MS);
    expect(view.at[1]).toEqual(termAnchor({ right: 50, bottom: 60 }));
  });

  it('close at once when the pointer leaves the term before they lock, and stay once locked', () => {
    lockedRoot();
    enter(0);
    openTerm(0, 'biome');
    stack.termLeave(0);
    expect(stack.depth).toBe(1);
    openTerm(0, 'biome');
    wait(HOLD_MS);
    stack.termLeave(0);
    wait(5000);
    expect(stack.depth).toBe(2);
  });

  it('give way to another term of the same parent, locked or not', () => {
    lockedRoot();
    enter(0);
    openTerm(0, 'biome');
    wait(HOLD_MS);
    view.take();
    openTerm(0, 'station');
    expect(view.take()).toEqual(['close 1', 'open 1 station']);
  });

  it('keep their ring and lock when the pointer rests on their own term again', () => {
    lockedRoot();
    enter(0);
    const term = openTerm(0, 'biome');
    wait(HOLD_MS);
    enter(1);
    // back over the parent onto the same term
    stack.tipLeave(1, 0);
    stack.tipEnter(0);
    openTerm(0, 'biome', term);
    wait(5000);
    expect(built('biome')).toBe(1);
    expect(stack.isLocked(1)).toBe(true);
  });

  it('close after GRACE_MS when the pointer goes back into the parent, which stays', () => {
    lockedRoot();
    enter(0);
    openTerm(0, 'biome');
    wait(HOLD_MS);
    enter(1);
    stack.tipLeave(1, 0);
    stack.tipEnter(0);
    wait(GRACE_MS);
    expect(stack.depth).toBe(1);
    wait(5000);
    expect(stack.depth).toBe(1);
  });

  it('start no close for their parent when the pointer moves straight into them', () => {
    lockedRoot();
    enter(0);
    openTerm(0, 'biome');
    wait(HOLD_MS);
    stack.termLeave(0);
    stack.tipLeave(0, 1);
    wait(5000);
    expect(stack.depth).toBe(2);
  });

  it('keep their parents while the pointer crosses a gap into them', () => {
    lockedRoot();
    enter(0);
    openTerm(0, 'biome');
    wait(HOLD_MS);
    stack.tipLeave(0, null);
    wait(GRACE_MS - 1);
    stack.tipEnter(1);
    wait(5000);
    expect(stack.depth).toBe(2);
  });
});

describe('a term in a panel', () => {
  it('opens a root after SHOW_MS that locks after HOLD_MS, the pointer resting on the term', () => {
    const term = {};
    stack.termEnter(-1, term, () => ({ x: 300, y: 40 }), build('panel'));
    away(SHOW_MS);
    expect(view.take()).toEqual(['open 0 panel']);
    away(HOLD_MS);
    expect(stack.isLocked(0)).toBe(true);
    away(5000);
    expect(stack.depth).toBe(1);
  });

  it('closes its unlocked root when the pointer leaves the term', () => {
    stack.termEnter(-1, {}, () => ({ x: 300, y: 40 }), build('panel'));
    away(SHOW_MS + 100);
    stack.termLeave(-1);
    expect(stack.depth).toBe(0);
  });

  it('closes its locked root ROOT_LEAVE_MS after the pointer leaves the term elsewhere', () => {
    stack.termEnter(-1, {}, () => ({ x: 300, y: 40 }), build('panel'));
    away(SHOW_MS + HOLD_MS);
    stack.termLeave(-1);
    away(ROOT_LEAVE_MS);
    expect(stack.depth).toBe(0);
  });

  it('replaces a root over the field', () => {
    lockedRoot();
    stack.termEnter(-1, {}, () => ({ x: 300, y: 40 }), build('panel'));
    wait(SHOW_MS);
    expect(view.take()).toEqual(['close 0', 'open 0 panel']);
  });
});

describe('update', () => {
  it('rebuilds the root at most 4 times a second, keeping its ring, its lock and its nested tooltips', () => {
    lockedRoot();
    enter(0);
    openTerm(0, 'biome');
    wait(HOLD_MS);
    view.take();
    let n = 0;
    for (let t = 0; t < 1000; t += FRAME) {
      stack.update(TILE_A, build(`live ${n++}`));
      wait(FRAME);
    }
    const log = view.take();
    expect(log.every((l) => l.startsWith('refresh 0'))).toBe(true);
    expect(log.length).toBeGreaterThan(0);
    expect(log.length).toBeLessThanOrEqual(1000 / UPDATE_MS);
    // a throttled call builds nothing
    expect([...builds.keys()].filter((k) => k.startsWith('live')).length).toBe(log.length);
    expect(stack.depth).toBe(2);
    expect(stack.isLocked(0) && stack.isLocked(1)).toBe(true);
  });

  it('does not delay the lock', () => {
    rest(TILE_A, ROOT_DELAY_MS);
    for (let t = 0; t < HOLD_MS; t += FRAME) {
      stack.update(TILE_A, build('live'));
      wait(FRAME);
    }
    expect(stack.isLocked(0)).toBe(true);
  });

  it('leaves another target alone', () => {
    rest(TILE_A, ROOT_DELAY_MS + 1000);
    expect(stack.update(TILE_B, build('b'))).toBe(false);
    expect(built('b')).toBe(0);
  });
});

describe('closing', () => {
  it('closes the whole stack on closeAll (a pan, a zoom, a click outside, another tool)', () => {
    lockedRoot();
    enter(0);
    openTerm(0, 'biome');
    wait(HOLD_MS);
    view.take();
    stack.closeAll();
    expect(view.take()).toEqual(['close 1', 'close 0']);
    // nothing comes back while the pointer stays where it is on the same target
    rest(TILE_A, 3000);
    expect(stack.depth).toBe(0);
    // a pan brings another tile under the still pointer: it opens after the wait
    rest(TILE_B, ROOT_DELAY_MS + FRAME);
    expect(stack.depth).toBe(1);
  });

  it('drops a waiting root on closeAll', () => {
    rest(TILE_A, ROOT_DELAY_MS - FRAME, 100, 100, 'a');
    stack.closeAll();
    rest(TILE_A, 2000, 100, 100, 'a');
    expect(built('a')).toBe(0);
  });

  it('closes everything on Escape, saying whether anything was open', () => {
    expect(stack.escape()).toBe(false);
    lockedRoot();
    enter(0);
    openTerm(0, 'biome');
    expect(stack.escape()).toBe(true);
    expect(stack.depth).toBe(0);
    expect(stack.escape()).toBe(false);
  });

  it('drops a waiting root on Escape without taking the key', () => {
    rest(TILE_A, ROOT_DELAY_MS - FRAME, 100, 100, 'a');
    expect(stack.escape()).toBe(false);
    rest(TILE_A, 2000, 100, 100, 'a');
    expect(built('a')).toBe(0);
  });
});

describe('placement and the ring', () => {
  const VIEW = { w: 1280, h: 720 };

  it('puts the corner TIP_OFFSET right of and below the anchor', () => {
    expect(placeTip({ x: 100, y: 200 }, { w: 120, h: 40 }, VIEW)).toEqual({
      x: 100 + TIP_OFFSET,
      y: 200 + TIP_OFFSET,
    });
  });

  it('keeps every tooltip TIP_MARGIN inside the window', () => {
    for (let ax = -200; ax <= VIEW.w + 200; ax += 37)
      for (let ay = -200; ay <= VIEW.h + 200; ay += 41)
        for (const size of [
          { w: 40, h: 20 },
          { w: 300, h: 160 },
          { w: VIEW.w - 2 * TIP_MARGIN, h: 30 },
        ]) {
          const p = placeTip({ x: ax, y: ay }, size, VIEW);
          expect(p.x).toBeGreaterThanOrEqual(TIP_MARGIN);
          expect(p.y).toBeGreaterThanOrEqual(TIP_MARGIN);
          expect(p.x + size.w).toBeLessThanOrEqual(VIEW.w - TIP_MARGIN);
          expect(p.y + size.h).toBeLessThanOrEqual(VIEW.h - TIP_MARGIN);
        }
  });

  it('keeps the top-left margin for a tooltip larger than the window', () => {
    expect(placeTip({ x: 500, y: 500 }, { w: 2000, h: 1000 }, VIEW)).toEqual({
      x: TIP_MARGIN,
      y: TIP_MARGIN,
    });
  });

  it("lands a term's tooltip at its box's right + 8, bottom + 4", () => {
    const p = placeTip(termAnchor({ right: 300, bottom: 200 }), { w: 50, h: 20 }, VIEW);
    expect(p).toEqual({ x: 308, y: 204 });
  });

  it('fills the ring linearly over HOLD_MS, from empty to full', () => {
    expect(holdProgress(-50)).toBe(0);
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(HOLD_MS / 4)).toBeCloseTo(0.25);
    expect(holdProgress(HOLD_MS)).toBe(1);
    expect(holdProgress(HOLD_MS * 3)).toBe(1);
    expect(ringDashOffset(0)).toBeCloseTo(RING_C);
    expect(ringDashOffset(1)).toBe(0);
  });

  it('keys a tile by its place and the tool in hand', () => {
    const tile = (x: number, y: number, tool: string) => tipKey({ kind: 'tile', x, y, tool });
    expect(tile(1, 2, 'none')).toBe(tile(1, 2, 'none'));
    expect(new Set([tile(1, 2, 'none'), tile(2, 1, 'none'), tile(1, 2, 'farm')]).size).toBe(3);
    expect(tipKey({ kind: 'station', id: 4 })).not.toBe(tipKey({ kind: 'train', id: 4 }));
  });
});
