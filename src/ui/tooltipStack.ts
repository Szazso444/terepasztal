/**
 * The tooltip stack (#337): the timing and the rules of the game's tooltips, apart from the DOM so
 * they are tested under Node with fake timers. `src/ui/tooltip.ts` draws it.
 *
 * Level 0 is the root: a tooltip over the field (a tile, a station, a works, a train), opened by
 * `hover` once the pointer has rested `ROOT_DELAY_MS` on one target, or the tooltip of a term in a
 * panel. Level n + 1 is opened by a term inside the tooltip at level n. There is one tooltip per
 * level; opening one at level L closes L and everything above first, and closing one closes
 * everything above it. There is no depth cap.
 *
 * Every tooltip shows a ring that fills over `HOLD_MS` from when it opened. Full, the tooltip
 * locks: it stays put, takes the pointer and its terms open the next level. A tooltip that is not
 * locked never takes the pointer and its terms do nothing.
 */

// ---------------------------------------------------------------- constants, all in one place
/** From a tooltip opening to its lock, at every level: the ring fills over exactly this. */
export const HOLD_MS = 2000;
/** A locked tooltip stays this long after the pointer leaves it; coming back in time keeps it. */
export const GRACE_MS = 350;
/**
 * A locked root closes this long after the pointer moves on over the field or leaves it: one
 * timer, started by the first movement and not restarted. Entering a tooltip of the stack cancels
 * it.
 */
export const ROOT_LEAVE_MS = 2 * GRACE_MS;
/** The pointer rests on a term this long before its tooltip opens (terms only). */
export const SHOW_MS = 120;
/**
 * The pointer rests on one target this long before the root opens; its content is built only
 * then, so a sweep across the field builds nothing.
 */
export const ROOT_DELAY_MS = 400;
/** `update` rebuilds the root's content at most this often: 4 times a second. */
export const UPDATE_MS = 250;
/** A tooltip's top-left corner sits this far right of and below its anchor... */
export const TIP_OFFSET = 14;
/** ...and is kept at least this far inside the window on every side. */
export const TIP_MARGIN = 8;
/**
 * A term's tooltip is anchored at its box's (right + this, bottom + `TERM_ANCHOR_DY`), so with
 * `TIP_OFFSET` it lands at (right + 8, bottom + 4) before clamping.
 */
export const TERM_ANCHOR_DX = -6;
export const TERM_ANCHOR_DY = -10;
/** The hold ring: an SVG of this size, its circle centred in it with radius `RING_R`. */
export const RING_SIZE = 14;
export const RING_R = 5;
/** The ring circle's length, the dash that the hold uncovers. */
export const RING_C = 2 * Math.PI * RING_R;

// ---------------------------------------------------------------- geometry

export interface Point {
  x: number;
  y: number;
}

/**
 * Where a tooltip of `size` goes for `anchor`: `TIP_OFFSET` right and down from it, clamped
 * `TIP_MARGIN` inside a window of `view`. A tooltip wider or taller than the window keeps its left
 * or top margin.
 */
export function placeTip(
  anchor: Point,
  size: { w: number; h: number },
  view: { w: number; h: number },
): Point {
  const clamp = (at: number, len: number, room: number) =>
    Math.max(TIP_MARGIN, Math.min(room - len - TIP_MARGIN, at + TIP_OFFSET));
  return { x: clamp(anchor.x, size.w, view.w), y: clamp(anchor.y, size.h, view.h) };
}

/** The anchor of the tooltip a term opens, from the term's box. */
export function termAnchor(box: { right: number; bottom: number }): Point {
  return { x: box.right + TERM_ANCHOR_DX, y: box.bottom + TERM_ANCHOR_DY };
}

/** How full the ring is `elapsed` ms after its tooltip opened: linear, 0 to 1. */
export function holdProgress(elapsed: number): number {
  return Math.min(1, Math.max(0, elapsed / HOLD_MS));
}

/** The arc's dash offset for progress `p`: the whole circle hidden at 0, none of it at 1. */
export function ringDashOffset(p: number): number {
  return RING_C * (1 - p);
}

/** What a root over the field stands for: the same target never rebuilds or restarts its ring. */
export type TipTarget =
  | { kind: 'tile'; x: number; y: number; tool: string }
  | { kind: 'station' | 'works' | 'train' | 'chunk'; id: number | string };

/** The key `hover` and `update` take for a target. */
export function tipKey(t: TipTarget): string {
  return t.kind === 'tile' ? `tile:${t.x},${t.y}:${t.tool}` : `${t.kind}:${t.id}`;
}

/**
 * Who the terms of a tooltip are, from their labels in order: the k-th term with a label is the
 * same term in the content `update` rebuilds as in the content before, so a refresh keeps the
 * tooltip it opened and the pointer resting on it.
 */
export function termKeys(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const k = seen.get(label) ?? 0;
    seen.set(label, k + 1);
    return `${label}#${k}`;
  });
}

// ---------------------------------------------------------------- the stack

/** What draws the stack. `C` is a tooltip's content, opaque here. */
export interface TipView<C> {
  /** draw the tooltip of `level` with `content`, its corner placed from `anchor` (`placeTip`) */
  open(level: number, content: C, anchor: Point): void;
  /** place it from a new anchor: an unlocked root follows the pointer */
  move(level: number, anchor: Point): void;
  /**
   * replace its content; its ring, its lock and the tooltips above it stay. A term still there
   * (`termKeys`) stays the same term for `termEnter`. False when the term the pointer is on went
   * with the old content.
   */
  refresh(level: number, content: C): boolean;
  /** it locked: it takes the pointer, shows its ring full and its terms are live */
  lock(level: number): void;
  /** take it down; the stack closes the newest first */
  close(level: number): void;
}

/** The time and the timers the stack runs on; a test passes fake ones. */
export interface TipClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const REAL_CLOCK: TipClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

interface Tip {
  /** what it stands for: a target key for a root over the field, else the term that opened it */
  readonly key: unknown;
  /** opened by a term (in a tooltip or in a panel) rather than over the field */
  readonly fromTerm: boolean;
  locked: boolean;
  /** when its content was last built, for `update`'s limit */
  builtAt: number;
  lockTimer: unknown;
  closeTimer: unknown;
}

/**
 * The stack. The game calls `hover` while the pointer is over the field, `leave` while it is not,
 * `update` for live content, and `closeAll` when the player picks another tool, places a station,
 * clicks the map, pans or zooms, switches to the overview, opens a menu or a screen, or loads a
 * game. Escape calls `escape`. The view reports the pointer entering and leaving tooltips and
 * terms (`tipEnter`, `tipLeave`, `termEnter`, `termLeave`).
 */
export class TooltipStack<C> {
  private readonly tips: Tip[] = [];
  /** the root over the field that waits `ROOT_DELAY_MS`; its content is built when it opens */
  private pending: { key: string; timer: unknown; build: () => C } | null = null;
  /** a term the pointer rests on, waiting `SHOW_MS` (the level it sits in; −1 a panel) */
  private termWait: { parent: number; timer: unknown } | null = null;
  /** the level of the term the pointer is on, −1 for a panel's; null when on none */
  private onTerm: number | null = null;
  /** the level of the tooltip the pointer is in; null when in none */
  private inside: number | null = null;
  /** the pointer over the field at the last `hover`; null once it left the field */
  private pointer: Point | null = null;
  private lastKey: string | null = null;
  /** after a close nothing opens over the field until the pointer moves or its target changes */
  private quiet: { key: string | null; x: number; y: number } | null = null;

  constructor(
    private readonly view: TipView<C>,
    private readonly clock: TipClock = REAL_CLOCK,
  ) {}

  /** How many tooltips are open: levels 0 to depth − 1. */
  get depth(): number {
    return this.tips.length;
  }
  /** Any tooltip is open. */
  get open(): boolean {
    return this.tips.length > 0;
  }
  isLocked(level: number): boolean {
    return this.tips[level]?.locked ?? false;
  }

  /**
   * The pointer is over the field at `x`, `y` (window pixels) on the target `key` (`tipKey`), or
   * on nothing (null). Call it every frame: the same target never rebuilds or restarts the ring,
   * and `build` runs only once the pointer has rested `ROOT_DELAY_MS` on the target. An unlocked
   * root follows the pointer; a locked one stays, and the pointer's first movement starts its
   * `ROOT_LEAVE_MS` close.
   */
  hover(key: string | null, x: number, y: number, build: () => C): void {
    const moved = !this.pointer || this.pointer.x !== x || this.pointer.y !== y;
    this.pointer = { x, y };
    this.lastKey = key;
    // on the field the pointer is in no tooltip and on no term
    this.inside = null;
    this.onTerm = null;
    this.cancelTermWait();
    const root = this.tips[0];
    if (root?.locked) {
      if (moved && root.closeTimer === null) this.closeLater(root, 0, ROOT_LEAVE_MS);
      return;
    }
    // the unlocked tooltip of a panel's term: the pointer has left the term
    if (root?.fromTerm) this.closeFrom(0);
    if (this.quiet) {
      if (!moved && key === this.quiet.key) return;
      this.quiet = null;
    }
    if (key === null) {
      this.cancelPending();
      this.closeFrom(0);
      return;
    }
    if (key === this.rootKey()) {
      if (this.tips[0]) {
        if (moved) this.view.move(0, this.pointer);
      } else if (this.pending) this.pending.build = build;
      return;
    }
    // a new target: what the old one showed goes, and nothing is built until the pointer rests
    this.cancelPending();
    this.closeFrom(0);
    this.pending = {
      key,
      build,
      timer: this.clock.setTimeout(() => this.openPending(), ROOT_DELAY_MS),
    };
  }

  /**
   * The pointer is not over the field: over the UI, in a tooltip or out of the window. Call it
   * every frame. A waiting root is dropped and an unlocked root over the field closes at once; a
   * locked root starts its `ROOT_LEAVE_MS` close unless the pointer is in the stack or resting on
   * a panel's term.
   */
  leave(): void {
    this.cancelPending();
    this.pointer = null;
    const root = this.tips[0];
    if (!root) return;
    if (!root.locked) {
      // a panel term's tooltip closes when the pointer leaves the term (`termLeave`)
      if (!root.fromTerm) this.closeFrom(0);
      return;
    }
    // in the stack, or resting on the panel term that opened it
    if (this.inside !== null || this.onTerm === -1 || root.closeTimer !== null) return;
    this.closeLater(root, 0, ROOT_LEAVE_MS);
  }

  /**
   * New content for the root of `key`, for what changes while it is up (a station's storage, a
   * works' status and rate, a train's state). Call it as often as you like: it builds and shows
   * the content at most every `UPDATE_MS`, and keeps the ring, the lock and the tooltips above.
   * A term still there stays the term the pointer rests on; one that went is as if the pointer
   * left it. Returns whether it did.
   */
  update(key: string, build: () => C): boolean {
    const root = this.tips[0];
    if (!root || root.fromTerm || root.key !== key) return false;
    const now = this.clock.now();
    if (now - root.builtAt < UPDATE_MS) return false;
    root.builtAt = now;
    if (!this.view.refresh(0, build()) && this.onTerm === 0) this.termLeave(0);
    return true;
  }

  /** Close every tooltip and drop what waits to open. Nothing opens again until the pointer moves. */
  closeAll(): void {
    this.cancelPending();
    this.cancelTermWait();
    this.closeFrom(0);
    this.onTerm = null;
    this.hush();
  }

  /** Escape: close the whole stack. True when a tooltip was open, so Escape does nothing else. */
  escape(): boolean {
    const was = this.open;
    this.closeAll();
    return was;
  }

  /**
   * The pointer came onto a term in the tooltip at `parent`, or in a panel (`parent` −1, whose
   * tooltip opens at level 0). After `SHOW_MS` of rest the term's tooltip opens one level up,
   * replacing what was there, at `anchor()` (`termAnchor` of the term's box, read then). `term`
   * is who the term is: the view gives a term the same one across `update` while it is still
   * there. A term of a tooltip that is not locked does nothing.
   */
  termEnter(parent: number, term: object, anchor: () => Point, build: () => C): void {
    if (parent >= 0 && !this.tips[parent]?.locked) return;
    this.onTerm = parent;
    this.cancelTermWait();
    const timer = this.clock.setTimeout(() => {
      this.termWait = null;
      const level = parent + 1;
      const up = this.tips[level];
      // its own tooltip is up already: it stays as it is, ring, lock and all
      if (up && up.key === term) {
        this.clearClose(up);
        return;
      }
      if (level === 0) this.cancelPending();
      this.openAt(level, term, true, anchor(), build());
    }, SHOW_MS);
    this.termWait = { parent, timer };
  }

  /** The pointer left a term of `parent`: a waiting tooltip opens nothing, an unlocked one closes. */
  termLeave(parent: number): void {
    if (this.termWait?.parent === parent) this.cancelTermWait();
    if (this.onTerm === parent) this.onTerm = null;
    const up = this.tips[parent + 1];
    if (up && up.fromTerm && !up.locked) this.closeFrom(parent + 1);
  }

  /** The pointer entered the tooltip at `level`: its close and every lower one's are cancelled. */
  tipEnter(level: number): void {
    if (!this.tips[level]) return;
    this.inside = level;
    for (let l = 0; l <= level; l++) this.clearClose(this.tips[l]);
  }

  /**
   * The pointer left the tooltip at `level` for the tooltip at `into`, or for outside the stack
   * (null). Into one of its own nested tooltips it stays; anywhere else it and everything above it
   * close after `GRACE_MS`, unless the pointer comes back first.
   */
  tipLeave(level: number, into: number | null): void {
    this.inside = into;
    const tip = this.tips[level];
    if (!tip || (into !== null && into > level)) return;
    this.closeLater(tip, level, GRACE_MS);
  }

  // ---------------------------------------------------------------- inside

  /** The target of the root over the field, open or waiting. */
  private rootKey(): unknown {
    if (this.pending) return this.pending.key;
    const root = this.tips[0];
    return root && !root.fromTerm ? root.key : null;
  }

  private openPending() {
    const p = this.pending;
    if (!p || !this.pointer) return;
    this.pending = null;
    this.openAt(0, p.key, false, this.pointer, p.build());
  }

  private openAt(level: number, key: unknown, fromTerm: boolean, anchor: Point, content: C) {
    this.closeFrom(level);
    const tip: Tip = {
      key,
      fromTerm,
      locked: false,
      builtAt: this.clock.now(),
      lockTimer: null,
      closeTimer: null,
    };
    this.tips.push(tip);
    this.view.open(level, content, anchor);
    tip.lockTimer = this.clock.setTimeout(() => {
      tip.lockTimer = null;
      tip.locked = true;
      this.view.lock(level);
    }, HOLD_MS);
  }

  /** Close the tooltips at `level` and above, the newest first. */
  private closeFrom(level: number) {
    if (this.termWait && this.termWait.parent >= level) this.cancelTermWait();
    while (this.tips.length > level) {
      const tip = this.tips.pop()!;
      if (tip.lockTimer !== null) this.clock.clearTimeout(tip.lockTimer);
      this.clearClose(tip);
      this.view.close(this.tips.length);
    }
    if (this.inside !== null && this.inside >= level) this.inside = null;
    if (this.onTerm !== null && this.onTerm >= level) this.onTerm = null;
  }

  /** Close `tip` (at `level`) and everything above it after `ms`, unless it is cancelled. */
  private closeLater(tip: Tip, level: number, ms: number) {
    this.clearClose(tip);
    tip.closeTimer = this.clock.setTimeout(() => {
      tip.closeTimer = null;
      if (this.tips[level] !== tip) return;
      this.closeFrom(level);
      // after any close the next movement opens a fresh root for the target under the pointer
      if (level === 0) this.hush();
    }, ms);
  }

  private clearClose(tip: Tip) {
    if (tip.closeTimer === null) return;
    this.clock.clearTimeout(tip.closeTimer);
    tip.closeTimer = null;
  }

  private cancelPending() {
    if (!this.pending) return;
    this.clock.clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private cancelTermWait() {
    if (!this.termWait) return;
    this.clock.clearTimeout(this.termWait.timer);
    this.termWait = null;
  }

  /** Stay closed while the pointer stays where it is, on the same target. */
  private hush() {
    this.quiet = this.pointer ? { key: this.lastKey, ...this.pointer } : null;
  }
}
