import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import {
  GRACE_MS,
  HOLD_MS,
  RING_C,
  RING_R,
  RING_SIZE,
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
  termKeys,
  tipKey,
  type Point,
  type TipClock,
  type TipTarget,
  type TipView,
} from './tooltipStack';

/** A view that logs what the stack asks of it and keeps what is on screen, level by level. */
class FakeView implements TipView<string> {
  log: string[] = [];
  shown: string[] = [];
  locked: boolean[] = [];
  at: Point[] = [];
  /** what `refresh` says: whether the term the pointer is on is still there */
  keepsTerm = true;
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
    return this.keepsTerm;
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

  it('keeps a locked nested tooltip when the pointer comes onto its term again after it', () => {
    lockedRoot();
    enter(0);
    const term = openTerm(0, 'biome');
    wait(HOLD_MS);
    wait(UPDATE_MS);
    view.take();
    expect(stack.update(TILE_A, build('live'))).toBe(true);
    // the refreshed term is the same term: the view says so by giving the stack the same one
    openTerm(0, 'biome', term);
    expect(view.take()).toEqual(['refresh 0 live']);
    expect(stack.isLocked(1)).toBe(true);
    expect(built('biome')).toBe(1);
  });

  it('goes on waiting on a term that is still there', () => {
    lockedRoot();
    enter(0);
    stack.termEnter(0, {}, () => ({ x: 1, y: 1 }), build('biome'));
    wait(SHOW_MS - 1);
    expect(stack.update(TILE_A, build('live'))).toBe(true);
    wait(1);
    expect(view.take()).toEqual(['refresh 0 live', 'open 1 biome']);
  });

  it('takes a term gone with the old content for the pointer leaving it', () => {
    view.keepsTerm = false;
    lockedRoot();
    enter(0);
    // waiting on it: nothing opens
    stack.termEnter(0, {}, () => ({ x: 1, y: 1 }), build('waited'));
    wait(SHOW_MS - 1);
    stack.update(TILE_A, build('live 1'));
    wait(1000);
    expect(built('waited')).toBe(0);
    // its unlocked tooltip closes
    openTerm(0, 'biome');
    wait(UPDATE_MS);
    view.take();
    stack.update(TILE_A, build('live 2'));
    expect(view.take()).toEqual(['refresh 0 live 2', 'close 1']);
    // a locked one stays, as it does when the pointer leaves its term
    openTerm(0, 'biome');
    wait(HOLD_MS);
    stack.update(TILE_A, build('live 3'));
    wait(5000);
    expect(stack.depth).toBe(2);
    expect(stack.isLocked(1)).toBe(true);
  });

  it('knows a term by its label, and equal labels by their order', () => {
    const before = termKeys(['Plains', 'farm', 'farm']);
    // new numbers around them, or another term before them, leave who they are
    expect(termKeys(['Plains', 'farm', 'farm'])).toEqual(before);
    expect(termKeys(['mine', 'Plains', 'farm', 'farm']).slice(1)).toEqual(before);
    expect(new Set(before).size).toBe(3);
    // a label that changed is another term
    expect(termKeys(['Forest', 'farm', 'farm'])[0]).not.toBe(before[0]);
    // no label and place can pass for another
    const odd = termKeys(['a#1', 'a', 'a', '#0', '']);
    expect(new Set(odd).size).toBe(odd.length);
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

describe('the numbers #337 decided', () => {
  // the tests above take the constants from the module, so they hold for any value: this pins the
  // ones the issue and the author's comment of 2026-10-12 give; changing one is their decision
  it('holds the timing, placement and ring constants the issue gives', () => {
    expect({
      HOLD_MS,
      GRACE_MS,
      ROOT_LEAVE_MS,
      SHOW_MS,
      ROOT_DELAY_MS,
      UPDATE_MS,
      TIP_OFFSET,
      TIP_MARGIN,
      RING_SIZE,
      RING_R,
    }).toEqual({
      HOLD_MS: 2000,
      GRACE_MS: 350,
      ROOT_LEAVE_MS: 2 * 350,
      SHOW_MS: 120,
      ROOT_DELAY_MS: 400,
      // at most 4 times a second
      UPDATE_MS: 1000 / 4,
      TIP_OFFSET: 14,
      TIP_MARGIN: 8,
      RING_SIZE: 14,
      RING_R: 5,
    });
    expect(RING_C).toBeCloseTo(2 * Math.PI * 5, 12);
  });
});

// ---------------------------------------------------------------- properties over pointer traces
//
// A driver plays seeded pointer traces against the stack the way the game and src/ui/tooltip.ts
// call it: every frame `hover` while the pointer is over the field and `leave` anywhere else, and
// the DOM's enter and leave events as the pointer crosses tooltips and terms. The pointer enters
// only a locked tooltip (an unlocked one lets it through). When the tooltip under a still pointer
// closes, the game goes on seeing the pointer over the UI until it moves, as `Input.overUi` does.
// Live content keeps its terms across a refresh or brings new ones; `TooltipLayer.refresh` keeps a
// term whose label stays (`termKeys`), and says when the one under the pointer went, as no event
// does. A panel can draw again under the pointer, taking the term it was on and that term's leave
// with it; the stack then learns that the pointer left the term from `hover` alone. The view checks
// each call the stack makes against the issue's rules as it happens; the timing rules that need the
// rest of the trace run at its end.

/** A term of a tooltip or of a panel; the stack knows a term by its identity. */
interface Term {
  readonly label: string;
}

/** Where the pointer is, as the DOM and the game see it. */
type Loc =
  | { at: 'field'; key: string | null; x: number; y: number }
  /** over a panel, out of the window, or where a tooltip closed under it */
  | { at: 'ui' }
  | { at: 'panelTerm'; term: Term }
  | { at: 'tip'; inst: Inst }
  | { at: 'term'; inst: Inst; term: Term };

/** A tooltip on screen, from its open to its close. */
interface Inst {
  readonly id: number;
  readonly level: number;
  readonly src: 'field' | 'term' | 'panel';
  /** the field target, or the term's label */
  readonly key: string;
  readonly term: Term | null;
  readonly openedAt: number;
  builtAt: number;
  lockedAt: number | null;
  closedAt: number | null;
  /** the terms its content shows now; a refresh keeps them or brings new ones */
  terms: Term[];
}

/** What a builder made: where it came from and the call or timer it ran in. */
interface Content {
  readonly src: 'field' | 'term' | 'panel' | 'update';
  readonly key: string;
  readonly term: Term | null;
  readonly ctx: Ctx;
  /** an update's content brings new terms rather than the ones shown */
  readonly newTerms: boolean;
}

type CallName =
  | 'hover'
  | 'leave'
  | 'update'
  | 'closeAll'
  | 'escape'
  | 'termEnter'
  | 'termLeave'
  | 'tipEnter'
  | 'tipLeave';

/** A call the driver made; `inst` is the tooltip at `level` when it was made. */
interface Call {
  readonly t: number;
  readonly name: CallName;
  readonly key?: string | null;
  readonly level?: number;
  readonly into?: number | null;
  readonly inst?: Inst;
  /** the term of a termEnter or termLeave */
  readonly term?: Term;
}

interface Op {
  readonly t: number;
  readonly op: 'open' | 'move' | 'refresh' | 'lock' | 'close';
  readonly level: number;
  readonly inst: Inst;
}

type Ctx = { kind: 'step' } | { kind: 'api'; call: Call } | { kind: 'timer'; ops: Op[] };

/**
 * The first pointer movement away from a locked root since the pointer was last in the stack:
 * over the field, or out to a panel. It starts the root's `ROOT_LEAVE_MS` close.
 */
interface Exit {
  readonly t: number;
  /** its hover or leave in `calls` */
  readonly index: number;
  readonly root: Inst;
}

/** How much of the rules the traces reached, so a generator that stops reaching them fails. */
interface Coverage {
  maxDepth: number;
  locksAt3: number;
  graceCloses: number;
  awayCloses: number;
  refreshes: number;
  /** refreshes that kept the term under the pointer, and ones that took it */
  termsKept: number;
  termsGone: number;
  /** refreshes that kept the term the pointer was still waiting on */
  waitsKept: number;
  /** refreshes that took the term under the pointer with its unlocked tooltip, or its locked one */
  childDrops: number;
  lockedKeptOnGone: number;
  /** the pointer back on a term whose locked tooltip is up, its parent refreshed since it opened */
  termReturns: number;
  escapes: number;
  /** the pointer seen on the field with a panel term's leave lost: its wait going, its tooltip up */
  lostWaits: number;
  lostOpen: number;
  /** tooltips a call other than closeAll or Escape closed at once, each held to its cause */
  callCloses: number;
  rootChecks: number;
  termChecks: number;
  panelOpens: number;
  graceLiveness: number;
  awayLiveness: number;
  rogue: number;
}

type Step =
  /**
   * `lost`: the panel drew again under the pointer, so the term it was on went, and the leave the
   * DOM would have sent went with it (`Tooltip.bindTerms` hears a panel term's own enter and leave)
   */
  | { k: 'field'; key: number; x: number; y: number; lost?: boolean }
  | { k: 'ui' }
  | { k: 'panelTerm'; term: number }
  | { k: 'tip'; level: number }
  | { k: 'term'; level: number; term: number }
  /** onto a term of the tooltip below the top one */
  | { k: 'back'; term: number }
  | { k: 'rogue'; level: number }
  | { k: 'wait'; ms: number }
  | { k: 'live'; on: boolean; newTerms: boolean }
  | { k: 'update'; key: number; newTerms: boolean }
  | { k: 'closeAll' }
  | { k: 'escape' };

/** A level above any stack: a step with it acts on the top tooltip. */
const TOP = 9;
const FIELD_KEYS: (string | null)[] = [
  tipKey({ kind: 'tile', x: 1, y: 1, tool: 'none' }),
  tipKey({ kind: 'tile', x: 2, y: 1, tool: 'none' }),
  tipKey({ kind: 'tile', x: 1, y: 1, tool: 'farm' }),
  tipKey({ kind: 'station', id: 7 }),
  null,
];
const NO_TARGET = FIELD_KEYS.length - 1;
/** An `update` step's key for the target of the root that is up, whatever it is. */
const OWN = FIELD_KEYS.length;
const XS = [100, 101, 160];
const YS = [100, 130];
const TERMS_PER_TIP = 3;
/** Waits on and either side of every constant, where an off-by-one would show. */
const WAITS = [
  1,
  FRAME,
  SHOW_MS - 1,
  SHOW_MS,
  GRACE_MS - 1,
  GRACE_MS,
  UPDATE_MS - 1,
  UPDATE_MS,
  ROOT_DELAY_MS - 1,
  ROOT_DELAY_MS,
  ROOT_LEAVE_MS - 1,
  ROOT_LEAVE_MS,
  HOLD_MS - 1,
  HOLD_MS,
];

function genSteps(rng: Rng): Step[] {
  const steps: Step[] = [];
  const n = rng.int(8, 60);
  const level = () => (rng.chance(0.6) ? TOP : rng.int(0, 4));
  const term = () => rng.int(0, TERMS_PER_TIP - 1);
  const field = (lost = false): Step => {
    const s = {
      k: 'field' as const,
      key: rng.chance(0.08) ? NO_TARGET : rng.int(0, NO_TARGET - 1),
      x: rng.pick(XS),
      y: rng.pick(YS),
    };
    return lost ? { ...s, lost } : s;
  };
  // a level down: rest on a term of the top tooltip until its own tooltip locks, then go in
  const dive = (t = term()): Step[] => [
    { k: 'term', level: TOP, term: t },
    { k: 'wait', ms: SHOW_MS },
    { k: 'wait', ms: HOLD_MS },
    { k: 'tip', level: TOP },
  ];
  // the live root refreshed, with its terms kept or new ones
  const refreshed = (): Step => ({ k: 'update', key: OWN, newTerms: rng.chance(0.5) });
  // a level down and back onto a term of the parent, its own or another, the parent refreshed
  // before or after: the finding of #337 that a refresh rebuilt a locked nested tooltip
  const back = (): Step[] => {
    const t = term();
    return [
      ...dive(t),
      ...(rng.chance(0.5) ? [refreshed()] : []),
      { k: 'back', term: rng.chance(0.6) ? t : term() },
      { k: 'wait', ms: rng.pick([1, SHOW_MS - 1, UPDATE_MS]) },
      refreshed(),
    ];
  };
  const root = (): Step[] => [field(), { k: 'wait', ms: ROOT_DELAY_MS + HOLD_MS }];
  while (steps.length < n) {
    const r = rng.next();
    if (r < 0.2) steps.push(field());
    else if (r < 0.43)
      steps.push({ k: 'wait', ms: rng.chance(0.3) ? rng.int(1, 2500) : rng.pick(WAITS) });
    else if (r < 0.5) steps.push({ k: 'tip', level: level() });
    else if (r < 0.58) steps.push({ k: 'term', level: level(), term: term() });
    else if (r < 0.64) steps.push(...dive());
    else if (r < 0.68) steps.push(...(rng.chance(0.5) ? root() : []), ...back());
    else if (r < 0.75) steps.push(...root());
    else if (r < 0.78)
      // a root, then down several levels at once
      steps.push(...root(), ...Array.from({ length: rng.int(2, 5) }, () => dive()).flat());
    else if (r < 0.82) steps.push({ k: 'ui' });
    else if (r < 0.86) {
      steps.push({ k: 'panelTerm', term: rng.int(0, 1) });
      // the panel draws again under the pointer, which then comes onto the field with no leave
      if (rng.chance(0.3)) steps.push({ k: 'wait', ms: rng.pick(WAITS) }, field(true));
    } else if (r < 0.88) steps.push({ k: 'live', on: rng.chance(0.5), newTerms: rng.chance(0.5) });
    else if (r < 0.9)
      steps.push({ k: 'update', key: rng.int(0, NO_TARGET), newTerms: rng.chance(0.5) });
    else if (r < 0.93) steps.push({ k: 'closeAll' });
    else if (r < 0.96) steps.push({ k: 'escape' });
    else steps.push({ k: 'rogue', level: level() });
  }
  return steps;
}

function check(ok: boolean, what: () => string): asserts ok {
  if (!ok) throw new Error(what());
}

/** Timers on a clock that moves only when told: fired in time order, and in the order set at one time. */
class StepClock implements TipClock {
  t = 0;
  private next = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  constructor(private readonly fire: (fn: () => void) => void) {}
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: unknown) {
    this.timers.delete(id as number);
  }
  runTo(to: number) {
    for (;;) {
      let id = 0;
      let due = Infinity;
      for (const [i, tm] of this.timers)
        if (tm.at <= to && tm.at < due) {
          id = i;
          due = tm.at;
        }
      if (!id) break;
      const tm = this.timers.get(id)!;
      this.timers.delete(id);
      this.t = tm.at;
      this.fire(tm.fn);
    }
    this.t = to;
  }
}

/** The driver and the view in one: it moves the pointer, and records and checks what the stack does. */
class Trace implements TipView<Content> {
  readonly clock = new StepClock((fn) => this.fire(fn));
  readonly stack = new TooltipStack<Content>(this, this.clock);
  readonly ops: Op[] = [];
  private readonly up: Inst[] = [];
  private readonly insts: Inst[] = [];
  private readonly calls: Call[] = [];
  private readonly exits: Exit[] = [];
  /** the locked root whose first exit is recorded; the pointer entering the stack clears it */
  private exited: Inst | null = null;
  private loc: Loc = { at: 'ui' };
  private locSince = 0;
  /** bumped whenever the pointer moves or the stack is closed: an expectation lapses */
  private serial = 0;
  private ctx: Ctx = { kind: 'step' };
  private live = false;
  /** the live content brings new terms with each refresh */
  private liveNewTerms = false;
  private lastFieldKey: string | null = null;
  /** the pointer at the last `hover`; null after a `leave` */
  private hoverAt: Point | null = null;
  /** the target `hover` has been given since `restSince`; undefined while off the field */
  private restKey: string | null | undefined = undefined;
  private restSince = 0;
  /** closeAll or Escape ran and the pointer has not moved since */
  private hushed = false;
  /** a root closed on a timer and the pointer has not moved since */
  private rootClosed = false;
  private readonly expects: { at: number; serial: number; what: string; ok: () => boolean }[] = [];
  /** content built and not shown yet */
  private readonly built: Content[] = [];
  private nextTerms = 0;
  private readonly panelTerms: Term[] = [{ label: 'panel term 0' }, { label: 'panel term 1' }];

  constructor(
    /** whether `rogue` steps run: a term of an unlocked tooltip reports the pointer anyway */
    private readonly rogue: boolean,
    private readonly cover: Coverage,
  ) {}

  run(steps: readonly Step[]) {
    for (const s of steps) this.step(s);
    this.finish();
  }

  // ---------------------------------------------------------------- the pointer

  private step(s: Step) {
    const t = this.clock.t;
    if (s.k === 'wait') {
      this.wait(s.ms);
      return;
    }
    if (s.k === 'back') {
      this.step({ k: 'term', level: Math.max(0, this.up.length - 2), term: s.term });
      return;
    }
    let after: (() => void) | null = null;
    switch (s.k) {
      case 'field': {
        const key = FIELD_KEYS[s.key];
        const l = this.loc;
        if (l.at === 'field' && l.key === key && l.x === s.x && l.y === s.y) break;
        this.moveTo({ at: 'field', key, x: s.x, y: s.y }, s.lost === true);
        // with no locked root, a root for the target is up once the pointer has rested on it
        after = () => {
          const root = this.up[0];
          if (key === null || (root && root.lockedAt !== null)) return;
          this.expectAt(
            t + ROOT_DELAY_MS,
            `the root of ${key} is up ROOT_DELAY_MS after the pointer came to it at ${t}`,
            () => {
              this.cover.rootChecks++;
              return this.up[0]?.src === 'field' && this.up[0].key === key;
            },
          );
        };
        break;
      }
      case 'ui':
        if (this.loc.at !== 'ui') this.moveTo({ at: 'ui' });
        break;
      case 'panelTerm': {
        const term = this.panelTerms[s.term];
        const l = this.loc;
        if (l.at === 'panelTerm' && l.term === term) break;
        this.moveTo({ at: 'panelTerm', term });
        after = () =>
          this.expectAt(
            t + SHOW_MS,
            `the tooltip of ${term.label} is up SHOW_MS after the pointer came to it at ${t}`,
            () => {
              this.cover.termChecks++;
              return this.up[0]?.src === 'panel' && this.up[0].term === term;
            },
          );
        break;
      }
      case 'tip': {
        const inst = this.up[Math.min(s.level, this.up.length - 1)];
        if (!inst || inst.lockedAt === null) break;
        const l = this.loc;
        if (l.at === 'tip' && l.inst === inst) break;
        this.moveTo({ at: 'tip', inst });
        break;
      }
      case 'term': {
        const inst = this.up[Math.min(s.level, this.up.length - 1)];
        if (!inst || inst.lockedAt === null) break;
        const term = inst.terms[s.term];
        const l = this.loc;
        if (l.at === 'term' && l.term === term) break;
        this.moveTo({ at: 'term', inst, term });
        after = () =>
          this.expectAt(
            t + SHOW_MS,
            `the tooltip of ${term.label} is up SHOW_MS after the pointer came to it at ${t}`,
            () => {
              this.cover.termChecks++;
              return this.up[inst.level + 1]?.term === term;
            },
          );
        break;
      }
      case 'rogue': {
        if (!this.rogue) break;
        const level = Math.min(s.level, this.up.length - 1);
        if (level >= 0 && this.up[level].lockedAt !== null) break;
        this.cover.rogue++;
        const term = { label: 'rogue term' };
        const build = this.builder('term', term.label, term);
        this.stack.termEnter(Math.max(0, level), term, () => ({ x: 0, y: 0 }), build);
        break;
      }
      case 'live':
        this.live = s.on;
        this.liveNewTerms = s.newTerms;
        break;
      case 'update': {
        const root = this.up[0];
        const own = root?.src === 'field' ? root.key : this.lastFieldKey;
        const key = s.key === OWN ? own : FIELD_KEYS[s.key];
        if (key !== null) this.update(key, s.newTerms);
        break;
      }
      case 'closeAll':
      case 'escape':
        this.closeStack(s.k);
        break;
    }
    this.frame();
    after?.();
  }

  /**
   * The DOM's events for the pointer going from where it is to `to`: the leaves, then the enters.
   * With `lost`, a panel term's leave never comes: its element went from under the pointer.
   */
  private moveTo(to: Loc, lost = false) {
    const t = this.clock.t;
    const from = this.loc;
    const fromInst = from.at === 'tip' || from.at === 'term' ? from.inst : null;
    const toInst = to.at === 'tip' || to.at === 'term' ? to.inst : null;
    if (from.at === 'term') {
      const level = from.inst.level;
      const call: Call = { t, name: 'termLeave', level, term: from.term };
      this.api(call, () => this.stack.termLeave(level));
    }
    if (from.at === 'panelTerm' && lost) {
      const own = this.up[0];
      if (t - this.locSince < SHOW_MS) this.cover.lostWaits++;
      else if (own?.term === from.term && own.lockedAt === null) this.cover.lostOpen++;
    } else if (from.at === 'panelTerm') {
      const call: Call = { t, name: 'termLeave', level: -1, term: from.term };
      this.api(call, () => this.stack.termLeave(-1));
    }
    if (fromInst && fromInst !== toInst) {
      const into = toInst ? toInst.level : null;
      const call: Call = { t, name: 'tipLeave', level: fromInst.level, into, inst: fromInst };
      this.api(call, () => this.stack.tipLeave(fromInst.level, into));
    }
    this.loc = to;
    this.locSince = t;
    this.serial++;
    this.hushed = false;
    this.rootClosed = false;
    if (toInst && toInst !== fromInst) {
      this.exited = null;
      const call: Call = { t, name: 'tipEnter', level: toInst.level, inst: toInst };
      this.api(call, () => this.stack.tipEnter(toInst.level));
    }
    if (to.at === 'term') {
      const level = to.inst.level;
      const own = this.up[level + 1];
      if (own?.term === to.term && own.lockedAt !== null && to.inst.builtAt > own.openedAt)
        this.cover.termReturns++;
      const build = this.builder('term', to.term.label, to.term);
      this.api({ t, name: 'termEnter', level, term: to.term }, () =>
        this.stack.termEnter(level, to.term, () => ({ x: 300, y: 200 }), build),
      );
    }
    if (to.at === 'panelTerm') {
      // back on the term that opened the root: the next movement away is a first one again
      if (this.exited?.term === to.term) this.exited = null;
      const build = this.builder('panel', to.term.label, to.term);
      this.api({ t, name: 'termEnter', level: -1, term: to.term }, () =>
        this.stack.termEnter(-1, to.term, () => ({ x: 300, y: 40 }), build),
      );
    }
    if (to.at === 'field' && to.key !== null) this.lastFieldKey = to.key;
  }

  /** What the game does each frame: hover or leave, then the live content's update. */
  private frame() {
    const l = this.loc;
    if (l.at === 'field') this.hover(l.key, l.x, l.y);
    else this.leave();
    if (this.live && this.lastFieldKey !== null) this.update(this.lastFieldKey, this.liveNewTerms);
    this.checkTerms();
  }

  /** Frames over `ms`, stopping at each expectation as it falls due. */
  private wait(ms: number) {
    const end = this.clock.t + ms;
    while (this.clock.t < end) {
      const next = Math.min(end, this.clock.t + FRAME);
      for (;;) {
        const due = this.expects.filter((e) => e.at <= next).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        this.expects.splice(this.expects.indexOf(due), 1);
        this.clock.runTo(due.at);
        if (due.serial === this.serial) check(due.ok(), () => due.what);
      }
      this.clock.runTo(next);
      this.frame();
    }
  }

  private expectAt(at: number, what: string, ok: () => boolean) {
    this.expects.push({ at, serial: this.serial, what, ok });
  }

  // ---------------------------------------------------------------- the calls

  private api<T>(call: Call, fn: () => T): T {
    this.calls.push(call);
    const outer = this.ctx;
    this.ctx = { kind: 'api', call };
    try {
      return fn();
    } finally {
      this.ctx = outer;
      this.checkMirror();
    }
  }

  private hover(key: string | null, x: number, y: number) {
    const t = this.clock.t;
    const moved = !this.hoverAt || this.hoverAt.x !== x || this.hoverAt.y !== y;
    const root = this.up[0];
    if (moved) this.exit(root);
    if (this.restKey !== key) {
      this.restKey = key;
      this.restSince = t;
    }
    const n = this.ops.length;
    const build = this.builder('field', String(key));
    this.api({ t, name: 'hover', key }, () => this.stack.hover(key, x, y, build));
    this.hoverAt = { x, y };
    const unlocked = root && root.src === 'field' && root.lockedAt === null ? root : null;
    if (unlocked && unlocked.key !== key)
      check(
        this.up.length === 0,
        () => `the unlocked root of ${unlocked.key} stayed at ${t} when the pointer went to ${key}`,
      );
    const moves = this.ops.slice(n).filter((o) => o.op === 'move').length;
    const follows = unlocked && unlocked.key === key && moved ? 1 : 0;
    check(moves === follows, () => `the root moved ${moves} times at ${t}, expected ${follows}`);
  }

  private leave() {
    const t = this.clock.t;
    const root = this.up[0];
    if (this.loc.at === 'ui') this.exit(root);
    this.restKey = undefined;
    this.api({ t, name: 'leave' }, () => this.stack.leave());
    this.hoverAt = null;
    if (root && root.src === 'field' && root.lockedAt === null)
      check(
        this.up.length === 0,
        () => `the unlocked root of ${root.key} stayed at ${t} when the pointer left the field`,
      );
  }

  private exit(root: Inst | undefined) {
    if (!root || root.lockedAt === null || this.exited === root) return;
    this.exited = root;
    this.exits.push({ t: this.clock.t, index: this.calls.length, root });
  }

  /**
   * `update` against its oracle: it rebuilds exactly when the root is its target's and UPDATE_MS
   * old, and keeps every level and lock, but for the unlocked tooltip of a term it took away.
   */
  private update(key: string, newTerms: boolean) {
    const t = this.clock.t;
    const root = this.up[0];
    const due = !!root && root.src === 'field' && root.key === key && t - root.builtAt >= UPDATE_MS;
    const l = this.loc;
    const top = this.up[1];
    const gone = due && newTerms && l.at === 'term' && l.inst === root;
    const drops = gone && !!top && top.lockedAt === null;
    if (drops) this.cover.childDrops++;
    else if (gone && top) this.cover.lockedKeptOnGone++;
    const n = this.ops.length;
    const locks = this.up
      .slice(0, drops ? 1 : undefined)
      .map((i) => i.lockedAt)
      .join();
    const build = this.builder('update', key, null, newTerms);
    const did = this.api({ t, name: 'update', key }, () => this.stack.update(key, build));
    const ops = this.ops.slice(n).map((o) => `${o.op} ${o.level}`);
    check(did === due, () => `update(${key}) at ${t} returned ${did}; due: ${due}`);
    check(
      ops.join() === (due ? (drops ? 'refresh 0,close 1' : 'refresh 0') : ''),
      () => `update(${key}) at ${t} did [${ops.join()}]`,
    );
    check(
      this.up.map((i) => i.lockedAt).join() === locks,
      () => `update(${key}) at ${t} changed the levels or a lock`,
    );
  }

  private closeStack(name: 'closeAll' | 'escape') {
    const t = this.clock.t;
    const was = this.up.length > 0;
    const r = this.api({ t, name }, () =>
      name === 'escape' ? this.stack.escape() : this.stack.closeAll(),
    );
    check(this.up.length === 0, () => `${name} at ${t} left ${this.up.length} open`);
    if (name === 'escape') {
      check(
        r === was,
        () => `escape() at ${t} returned ${String(r)} with ${was ? 'a' : 'no'} tooltip open`,
      );
      if (was) this.cover.escapes++;
    }
    this.restKey = undefined;
    this.hushed = true;
    this.serial++;
  }

  private builder(
    src: Content['src'],
    key: string,
    term: Term | null = null,
    newTerms = false,
  ): () => Content {
    return () => {
      const c: Content = { src, key, term, ctx: this.ctx, newTerms };
      this.built.push(c);
      return c;
    };
  }

  /** A timer's callback, recorded as one: one that only closes needs a cause. */
  private fire(fn: () => void) {
    const ctx: Ctx = { kind: 'timer', ops: [] };
    const outer = this.ctx;
    this.ctx = ctx;
    try {
      fn();
    } finally {
      this.ctx = outer;
    }
    this.explain(ctx.ops);
    this.checkMirror();
  }

  // ---------------------------------------------------------------- the view

  open(level: number, content: Content, anchor: Point) {
    const t = this.clock.t;
    check(level === this.up.length, () => `level ${level} opened over ${this.up.length} at ${t}`);
    check(
      this.built.at(-1) === content && content.ctx === this.ctx,
      () => `the content of level ${level} at ${t} was not built for it, then`,
    );
    this.built.pop();
    check(this.ctx.kind === 'timer', () => `level ${level} opened at ${t} with no wait`);
    check(
      !this.hushed,
      () => `level ${level} opened at ${t}: after closeAll or Escape the pointer has not moved`,
    );
    check(content.src !== 'update', () => `an update opened level ${level} at ${t}`);
    if (content.src === 'field') {
      check(level === 0, () => `a target on the field opened level ${level} at ${t}`);
      check(
        !this.rootClosed,
        () => `a root opened at ${t}: a root closed after its wait and the pointer has not moved`,
      );
      check(
        this.restKey === content.key && t - this.restSince >= ROOT_DELAY_MS,
        () =>
          `the root of ${content.key} opened at ${t}; the pointer was on ${String(this.restKey)} since ${this.restSince}`,
      );
      check(
        !!this.hoverAt && anchor.x === this.hoverAt.x && anchor.y === this.hoverAt.y,
        () => `the root opened away from the pointer at ${t}`,
      );
    } else {
      const l = this.loc;
      const on =
        content.src === 'panel'
          ? level === 0 && l.at === 'panelTerm' && l.term === content.term
          : l.at === 'term' && l.term === content.term && l.inst.level === level - 1;
      check(
        on && this.locSince === t - SHOW_MS,
        () =>
          `the tooltip of ${content.key} opened at ${t}; the pointer ${on ? `on it since ${this.locSince}` : 'not on it'}`,
      );
      if (content.src === 'panel') this.cover.panelOpens++;
    }
    const id = this.insts.length;
    const inst: Inst = {
      id,
      level,
      src: content.src,
      key: content.key,
      term: content.term,
      openedAt: t,
      builtAt: t,
      lockedAt: null,
      closedAt: null,
      terms: this.makeTerms(id),
    };
    this.up.push(inst);
    this.insts.push(inst);
    this.cover.maxDepth = Math.max(this.cover.maxDepth, this.up.length);
    this.record('open', level, inst);
  }

  move(level: number, anchor: Point) {
    const t = this.clock.t;
    const inst = this.up[level];
    const l = this.loc;
    check(
      level === 0 && !!inst && inst.src === 'field' && inst.lockedAt === null,
      () =>
        `level ${level} moved at ${t}: only an unlocked root over the field follows the pointer`,
    );
    check(
      this.ctx.kind === 'api' &&
        this.ctx.call.name === 'hover' &&
        l.at === 'field' &&
        anchor.x === l.x &&
        anchor.y === l.y,
      () => `the root moved at ${t} other than to the pointer`,
    );
    this.record('move', level, inst);
  }

  refresh(level: number, content: Content) {
    const t = this.clock.t;
    const root = this.up[level];
    check(
      level === 0 && !!root && this.ctx.kind === 'api' && this.ctx.call.name === 'update',
      () => `level ${level} refreshed at ${t} outside update`,
    );
    check(
      this.built.at(-1) === content && content.ctx === this.ctx,
      () => `the refresh at ${t} was not built for it, then`,
    );
    this.built.pop();
    root.builtAt = t;
    this.cover.refreshes++;
    this.record('refresh', level, root);
    const l = this.loc;
    const under = l.at === 'term' && l.inst === root;
    if (!content.newTerms) {
      if (under) this.cover.termsKept++;
      // the pointer still waits on it: the wait goes on (the 'term' step's expectation)
      if (under && t - this.locSince < SHOW_MS) this.cover.waitsKept++;
      return true;
    }
    root.terms = this.makeTerms(root.id);
    if (!under) return true;
    // the term under the pointer went with the old content: the pointer is in the tooltip
    this.cover.termsGone++;
    this.loc = { at: 'tip', inst: root };
    this.locSince = t;
    this.serial++;
    return false;
  }

  lock(level: number) {
    const t = this.clock.t;
    const inst = this.up[level];
    check(
      !!inst && inst.lockedAt === null && this.ctx.kind === 'timer',
      () => `level ${level} locked again or outside a timer at ${t}`,
    );
    check(
      t === inst.openedAt + HOLD_MS,
      () => `level ${level} locked at ${t}, opened at ${inst.openedAt}`,
    );
    inst.lockedAt = t;
    if (level >= 3) this.cover.locksAt3++;
    this.record('lock', level, inst);
  }

  close(level: number) {
    const t = this.clock.t;
    check(
      level === this.up.length - 1,
      () => `level ${level} closed under ${this.up.length - 1} at ${t}`,
    );
    const inst = this.up.pop()!;
    inst.closedAt = t;
    const ctx = this.ctx;
    if (level === 0 && inst.src === 'field' && inst.lockedAt === null) {
      const c = ctx.kind === 'api' ? ctx.call : null;
      check(
        !!c &&
          (c.name === 'leave' ||
            c.name === 'closeAll' ||
            c.name === 'escape' ||
            (c.name === 'hover' && c.key !== inst.key)),
        () =>
          `the unlocked root of ${inst.key} closed at ${t} with the pointer on it (${c?.name ?? ctx.kind})`,
      );
    }
    if (ctx.kind === 'api') {
      // at once, in a call, only closeAll and Escape close a locked tooltip; a term's unlocked
      // tooltip goes when the pointer is off its term: the DOM says so, an update took the term,
      // or (a panel's) the pointer is seen on the field
      const c = ctx.call;
      const all = c.name === 'closeAll' || c.name === 'escape';
      if (!all) this.cover.callCloses++;
      check(
        all || inst.lockedAt === null,
        () => `the locked level ${level} (${inst.key}) closed at ${t} in ${c.name}`,
      );
      const left = c.name === 'termLeave' && c.level === level - 1 && c.term === inst.term;
      const cause =
        inst.src === 'term'
          ? left || (c.name === 'update' && level === 1)
          : inst.src === 'panel'
            ? left || c.name === 'hover'
            : true;
      check(
        all || cause,
        () => `the unlocked tooltip of ${inst.key} closed at ${t} in ${c.name}, its term not left`,
      );
    }
    if (ctx.kind === 'timer')
      check(
        level > this.pointerLevel(),
        () =>
          `a timer closed level ${level} at ${t} with the pointer in level ${this.pointerLevel()}`,
      );
    this.record('close', level, inst);
    // a still pointer: the game sees it over the UI until it moves
    const l = this.loc;
    if ((l.at === 'tip' || l.at === 'term') && l.inst === inst) {
      this.loc = { at: 'ui' };
      this.locSince = t;
      this.serial++;
    }
  }

  // ---------------------------------------------------------------- checks

  private record(op: Op['op'], level: number, inst: Inst) {
    const o: Op = { t: this.clock.t, op, level, inst };
    this.ops.push(o);
    if (this.ctx.kind === 'timer') this.ctx.ops.push(o);
  }

  private makeTerms(id: number): Term[] {
    const gen = this.nextTerms++;
    return Array.from({ length: TERMS_PER_TIP }, (_, i) => ({
      label: `term ${i} of tooltip ${id} (${gen})`,
    }));
  }

  private pointerLevel(): number {
    const l = this.loc;
    return l.at === 'tip' || l.at === 'term' ? l.inst.level : -1;
  }

  /** The stack's own account matches what it showed. */
  private checkMirror() {
    const t = this.clock.t;
    check(
      this.stack.depth === this.up.length,
      () => `depth ${this.stack.depth} with ${this.up.length} shown at ${t}`,
    );
    check(this.stack.open === this.up.length > 0, () => `open is ${this.stack.open} at ${t}`);
    for (let l = 0; l < this.up.length; l++)
      check(
        this.stack.isLocked(l) === (this.up[l].lockedAt !== null),
        () => `the lock of level ${l} differs from what was shown at ${t}`,
      );
  }

  /** A term's tooltip that is not locked is up only while the pointer is on its term. */
  private checkTerms() {
    const l = this.loc;
    for (const inst of this.up) {
      if (inst.lockedAt !== null || inst.src === 'field') continue;
      const on = (l.at === 'term' || l.at === 'panelTerm') && l.term === inst.term;
      check(
        on,
        () =>
          `the unlocked tooltip of ${inst.key} is up at ${this.clock.t}, the pointer off its term`,
      );
    }
  }

  /** A timer callback that closes without opening needs a cause: a grace, or a root's close. */
  private explain(ops: Op[]) {
    const t = this.clock.t;
    const closes = ops.filter((o) => o.op === 'close');
    if (!closes.length) return;
    const opened = ops.find((o) => o.op === 'open');
    if (opened) {
      check(
        opened.inst.src !== 'field',
        () => `a root over the field opened over an open stack at ${t}`,
      );
      check(
        closes.every((c) => c.level >= opened.level),
        () => `opening level ${opened.level} at ${t} closed a level below it`,
      );
      // resting on a term whose own tooltip is up keeps that one, its ring and its lock
      const own = closes.find((c) => c.level === opened.level && c.inst.term === opened.inst.term);
      check(
        !own,
        () =>
          `the tooltip of ${opened.inst.key} was closed and opened again at ${t}, its own term rested on (opened at ${own?.inst.openedAt})`,
      );
      return;
    }
    const low = Math.min(...closes.map((c) => c.level));
    const inst = closes.find((c) => c.level === low)!.inst;
    const enteredAfter = (i: number, min: number) =>
      this.calls.slice(i + 1).some((c) => c.name === 'tipEnter' && c.level! >= min);
    const grace = this.calls.some(
      (c, i) =>
        c.name === 'tipLeave' &&
        c.t === t - GRACE_MS &&
        c.inst === inst &&
        (c.into === null || c.into! < low) &&
        !enteredAfter(i, low),
    );
    const away =
      low === 0 &&
      this.exits.some(
        (e) => e.t === t - ROOT_LEAVE_MS && e.root === inst && !enteredAfter(e.index, 0),
      );
    check(
      grace || away,
      () =>
        `a timer closed level ${low} at ${t}, neither GRACE_MS after the pointer left it nor ROOT_LEAVE_MS after the pointer first moved on from the locked root`,
    );
    if (grace) this.cover.graceCloses++;
    else this.cover.awayCloses++;
    // the demo opens a root on a mousemove: after a close, the next movement opens one
    if (low === 0) this.rootClosed = true;
  }

  /** The timing rules that need the trace to have run on past them. */
  private finish() {
    const end = this.clock.t;
    check(this.built.length === 0, () => 'content was built that never showed');
    for (const i of this.insts) {
      const lived = (i.closedAt ?? end + 1) - i.openedAt;
      check(
        lived <= HOLD_MS || i.lockedAt !== null,
        () =>
          `level ${i.level} (${i.key}), opened at ${i.openedAt}, was up ${lived} ms and never locked`,
      );
    }
    const enteredBefore = (i: number, by: number, min: number) =>
      this.calls.slice(i + 1).some((c) => c.name === 'tipEnter' && c.t < by && c.level! >= min);
    // the pointer back on the term that opened a tooltip keeps it, as resting on its term did
    // before it locked; a locked tooltip stays when the pointer leaves its term (#337, Closing)
    const onItsTermBefore = (i: number, by: number, inst: Inst) =>
      inst.term !== null &&
      this.calls
        .slice(i + 1)
        .some((c) => c.name === 'termEnter' && c.t < by && c.term === inst.term);
    this.calls.forEach((c, i) => {
      if (c.name !== 'tipLeave' || !c.inst || (c.into != null && c.into > c.level!)) return;
      const by = c.t + GRACE_MS;
      if (end < by || enteredBefore(i, by, c.level!) || onItsTermBefore(i, by, c.inst)) return;
      this.cover.graceLiveness++;
      const closed = c.inst.closedAt;
      check(
        closed !== null && closed <= by,
        () => `level ${c.level}, left at ${c.t} for ${String(c.into)}, was still up at ${by}`,
      );
    });
    for (const e of this.exits) {
      const by = e.t + ROOT_LEAVE_MS;
      if (end < by || enteredBefore(e.index, by, 0) || onItsTermBefore(e.index, by, e.root))
        continue;
      this.cover.awayLiveness++;
      const closed = e.root.closedAt;
      check(
        closed !== null && closed <= by,
        () => `the locked root the pointer moved on from at ${e.t} was still up at ${by}`,
      );
    }
  }
}

describe('the stack over seeded pointer traces', () => {
  const fresh = (): Coverage => ({
    maxDepth: 0,
    locksAt3: 0,
    graceCloses: 0,
    awayCloses: 0,
    refreshes: 0,
    termsKept: 0,
    termsGone: 0,
    waitsKept: 0,
    childDrops: 0,
    lockedKeptOnGone: 0,
    termReturns: 0,
    escapes: 0,
    lostWaits: 0,
    lostOpen: 0,
    callCloses: 0,
    rootChecks: 0,
    termChecks: 0,
    panelOpens: 0,
    graceLiveness: 0,
    awayLiveness: 0,
    rogue: 0,
  });
  const play = (steps: readonly Step[], cover: Coverage, rogue = true) => {
    const trace = new Trace(rogue, cover);
    trace.run(steps);
    return trace;
  };
  // a trace is cheap, and the deep and the rare cases need many of them
  const options = {
    seeds: Array.from({ length: 400 }, (_, i) => i + 1),
    shrink: (steps: Step[]) => shrinkArray(steps),
  };

  // 400 traces of up to a few hundred frames each: about 0.3 s alone
  it(
    'keeps the rules of #337 on every trace: timing, levels, targets, update, closing',
    { timeout: 10_000 },
    () => {
      const cover = fresh();
      forAll(genSteps, (steps) => void play(steps, cover), options);
      // the traces reach every rule above, three nested levels deep and more
      expect(cover.maxDepth).toBeGreaterThanOrEqual(4);
      expect(cover.locksAt3).toBeGreaterThan(0);
      for (const k of [
        'graceCloses',
        'awayCloses',
        'refreshes',
        'termsKept',
        'termsGone',
        'waitsKept',
        'childDrops',
        'lockedKeptOnGone',
        'termReturns',
        'escapes',
        'lostWaits',
        'lostOpen',
        'callCloses',
        'rootChecks',
        'termChecks',
        'panelOpens',
        'graceLiveness',
        'awayLiveness',
      ] as const)
        expect(cover[k], k).toBeGreaterThan(0);
    },
  );

  // each of the 400 traces is played twice: about 0.5 s alone
  it('does nothing for a term of a tooltip that is not locked', { timeout: 15_000 }, () => {
    const cover = fresh();
    const shown = (t: Trace) =>
      t.ops.map((o) => `${o.t} ${o.op} ${o.level} ${o.inst.id} ${o.inst.key}`).join('\n');
    forAll(
      genSteps,
      (steps) => expect(shown(play(steps, cover, true))).toBe(shown(play(steps, cover, false))),
      options,
    );
    expect(cover.rogue).toBeGreaterThan(0);
  });
});

describe('update, over seeded call times', () => {
  /** A view that draws nothing: the builders are what is counted. */
  const blank: TipView<string> = {
    open() {},
    move() {},
    refresh: () => true,
    lock() {},
    close() {},
  };
  /** Gaps between update calls: on and either side of the limit, a frame, and anything. */
  const GAPS = [1, FRAME, UPDATE_MS - 1, UPDATE_MS, UPDATE_MS + 1, 333, 500];

  it("builds a root's content at most 4 times in any second, its opening included", () => {
    forAll(
      (rng) =>
        Array.from({ length: rng.int(1, 80) }, () =>
          rng.chance(0.5) ? rng.pick(GAPS) : rng.int(1, 600),
        ),
      (gaps) => {
        const clock = new StepClock((fn) => fn());
        const stack = new TooltipStack<string>(blank, clock);
        const builtAt: number[] = [];
        const builder = (content: string) => () => {
          builtAt.push(clock.t);
          return content;
        };
        stack.hover(TILE_A, 100, 100, builder('a'));
        clock.runTo(ROOT_DELAY_MS);
        check(stack.depth === 1 && builtAt.length === 1, () => 'the root did not open once');
        for (const gap of gaps) {
          clock.runTo(clock.t + gap);
          stack.update(TILE_A, builder('live'));
        }
        // four builds a second at most: of any five, the last is a second or more after the first
        for (let i = 0; i + 4 < builtAt.length; i++)
          check(
            builtAt[i + 4] - builtAt[i] >= 1000,
            () => `five builds within a second: ${builtAt.slice(i, i + 5).join(', ')}`,
          );
      },
      {
        seeds: Array.from({ length: 300 }, (_, i) => i + 1),
        shrink: (gaps) => shrinkArray(gaps, (g) => shrinkInt(g, 1)),
      },
    );
  });
});

describe('placement and target keys, over seeded cases', () => {
  /** The slow way: of every whole-pixel corner TIP_MARGIN inside, the one nearest anchor + TIP_OFFSET. */
  function nearestInside(at: number, len: number, room: number): number {
    const want = at + TIP_OFFSET;
    let best: number | null = null;
    for (let p = TIP_MARGIN; p + len <= room - TIP_MARGIN; p++)
      if (best === null || Math.abs(p - want) < Math.abs(best - want)) best = p;
    // none fits: the tooltip keeps its top-left margin
    return best ?? TIP_MARGIN;
  }

  interface Placing {
    anchor: Point;
    size: { w: number; h: number };
    view: { w: number; h: number };
  }
  const NUMS = ['anchor.x', 'anchor.y', 'size.w', 'size.h', 'view.w', 'view.h'] as const;
  const get = (c: Placing, k: (typeof NUMS)[number]) =>
    k === 'anchor.x'
      ? c.anchor.x
      : k === 'anchor.y'
        ? c.anchor.y
        : k === 'size.w'
          ? c.size.w
          : k === 'size.h'
            ? c.size.h
            : k === 'view.w'
              ? c.view.w
              : c.view.h;
  const set = (c: Placing, k: (typeof NUMS)[number], v: number): Placing => ({
    anchor: { x: k === 'anchor.x' ? v : c.anchor.x, y: k === 'anchor.y' ? v : c.anchor.y },
    size: { w: k === 'size.w' ? v : c.size.w, h: k === 'size.h' ? v : c.size.h },
    view: { w: k === 'view.w' ? v : c.view.w, h: k === 'view.h' ? v : c.view.h },
  });

  it('puts a tooltip where an exhaustive search over the window puts it', () => {
    forAll(
      (rng): Placing => {
        const view = { w: rng.int(20, 400), h: rng.int(20, 300) };
        return {
          anchor: { x: rng.int(-60, view.w + 60), y: rng.int(-60, view.h + 60) },
          size: { w: rng.int(1, view.w + 40), h: rng.int(1, view.h + 40) },
          view,
        };
      },
      (c) =>
        expect(placeTip(c.anchor, c.size, c.view)).toEqual({
          x: nearestInside(c.anchor.x, c.size.w, c.view.w),
          y: nearestInside(c.anchor.y, c.size.h, c.view.h),
        }),
      {
        seeds: Array.from({ length: 500 }, (_, i) => i + 1),
        // each number toward a small one, the window kept at least 1 px
        shrink: function* (c) {
          for (const k of NUMS)
            for (const v of shrinkInt(get(c, k), k.startsWith('view') ? 1 : 0)) yield set(c, k, v);
        },
      },
    );
  });

  it("anchors a term's tooltip at its box's right + 8, bottom + 4 before clamping", () => {
    forAll(
      (rng) => ({ right: rng.int(-50, 1300), bottom: rng.int(-50, 800) }),
      (box) => {
        const at = termAnchor(box);
        expect({ x: at.x + TIP_OFFSET, y: at.y + TIP_OFFSET }).toEqual({
          x: box.right + 8,
          y: box.bottom + 4,
        });
      },
    );
  });

  it('keys two targets alike exactly when they are the same target', () => {
    const TOOLS = ['none', 'farm', 'track:regular', 'a:b', '1,2', ''];
    const target = (rng: Rng): TipTarget =>
      rng.chance(0.5)
        ? { kind: 'tile', x: rng.int(-2, 2), y: rng.int(-2, 2), tool: rng.pick(TOOLS) }
        : rng.chance(0.75)
          ? { kind: rng.pick(['station', 'works', 'train'] as const), id: rng.int(0, 3) }
          : { kind: 'chunk', id: rng.pick(['0,0', '1,0', 'tile:1,1:none', '']) };
    forAll(
      (rng) => [target(rng), target(rng)] as const,
      ([a, b]) => expect(tipKey(a) === tipKey(b)).toBe(JSON.stringify(a) === JSON.stringify(b)),
      { seeds: Array.from({ length: 2000 }, (_, i) => i + 1) },
    );
  });

  it('keys a term before and after a refresh alike exactly when its label and its place among equal labels match', () => {
    // labels that are one another with a digit or the separator added, so a key that runs a label
    // into its place among equal labels (`a` the 11th of its kind, `a1` the 1st) shows
    const LABELS = ['a', 'a1', 'a#', 'a#1', '#', '#0', '1', '10', ''];
    const terms = (rng: Rng): string[] => {
      const out: string[] = [];
      // runs of one label, so a label is the 11th of its kind and more
      for (let runs = rng.int(0, 4); runs > 0; runs--) {
        const label = rng.pick(LABELS);
        for (let n = rng.int(1, 12); n > 0; n--) out.push(label);
      }
      return rng.shuffle(out);
    };
    /** The slow way: how many terms before the i-th have its label. */
    const place = (labels: readonly string[], i: number) =>
      labels.slice(0, i).filter((l) => l === labels[i]).length;
    forAll(
      (rng) => [terms(rng), terms(rng)] as const,
      ([before, after]) => {
        const kb = termKeys(before);
        const ka = termKeys(after);
        expect(kb.length).toBe(before.length);
        expect(ka.length).toBe(after.length);
        // across the refresh, and within the content after it
        for (const [x, kx, when] of [
          [before, kb, 'before'],
          [after, ka, 'after'],
        ] as const)
          for (let i = 0; i < x.length; i++)
            for (let j = 0; j < after.length; j++) {
              const same = x[i] === after[j] && place(x, i) === place(after, j);
              check(
                (kx[i] === ka[j]) === same,
                () =>
                  `term ${i} "${x[i]}" ${when} (key ${kx[i]}) and term ${j} "${after[j]}" after (key ${ka[j]}): ${same ? 'the same term' : 'two terms'}`,
              );
            }
      },
      {
        seeds: Array.from({ length: 500 }, (_, i) => i + 1),
        shrink: function* ([before, after]) {
          for (const b of shrinkArray(before)) yield [b, after] as const;
          for (const a of shrinkArray(after)) yield [before, a] as const;
        },
      },
    );
  });
});

describe('the root over the field', () => {
  it('is known by its target while it is open, and is not a term tooltip opened from a panel', () => {
    expect(stack.fieldRoot).toBeNull();
    rest(TILE_A, ROOT_DELAY_MS - FRAME);
    expect(stack.fieldRoot, 'still waiting to open').toBeNull();
    rest(TILE_A, 2 * FRAME);
    expect(stack.fieldRoot).toBe(TILE_A);
    lockedRoot(TILE_A);
    rest(TILE_B, FRAME);
    expect(stack.fieldRoot, 'a locked root stays for its own target').toBe(TILE_A);
    stack.closeAll();
    expect(stack.fieldRoot).toBeNull();
    openTerm(-1, 'panel term');
    expect(stack.depth).toBe(1);
    expect(stack.fieldRoot).toBeNull();
    stack.closeAll();
  });
});
