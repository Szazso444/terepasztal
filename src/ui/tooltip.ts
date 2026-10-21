import type { AtlasRegistry } from '../engine/atlas';
import { el } from './dom';
import { spriteImg } from './spritePreview';
import { NO_CHANGE, signedPercent } from './tooltipFormat';
import {
  RING_C,
  RING_R,
  RING_SIZE,
  TooltipStack,
  holdProgress,
  placeTip,
  ringDashOffset,
  termAnchor,
  termKeys,
  type Point,
  type TipView,
} from './tooltipStack';

/** What a tooltip of the stack shows: nodes made with the helpers below, and plain text. */
export type TipContent = (Node | string)[];
/** Builds a tooltip's content when it opens (or when `update` refreshes it). */
export type TipBuild = () => TipContent;

export class Tooltip {
  /** Today's single tooltip, which follows the pointer; #361 moves its callers to `stack`. */
  readonly root = el('div', { id: 'tooltip', class: 'panel' });
  private readonly layer = new TooltipLayer();
  /** The tooltip stack (#337): src/game.ts calls `hover`, `leave`, `update`, `closeAll`. */
  readonly stack = new TooltipStack<TipContent>(this.layer);

  constructor() {
    this.layer.attach(this.stack);
  }
  /** Where the stack draws; it goes in `#ui-root`, next to `root`. */
  get stackRoot(): HTMLElement {
    return this.layer.root;
  }
  /**
   * Wire the terms (`ttTerm`) under `scope`, in a panel: resting on one opens its tooltip at
   * level 0. A term already wired is left alone, so a panel can call this after every render.
   */
  bindTerms(scope: ParentNode) {
    this.layer.wireTerms(scope);
  }

  show(x: number, y: number, title: string, lines: string[] = []) {
    this.root.innerHTML = '';
    this.root.append(el('div', { class: 'tt-title', text: title }));
    for (const l of lines) this.root.append(el('div', { text: l }));
    this.root.classList.add('show');
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const px = Math.min(window.innerWidth - w - 8, x + 14);
    const py = Math.min(window.innerHeight - h - 8, y + 14);
    this.root.style.left = `${px}px`;
    this.root.style.top = `${py}px`;
  }
  hide() {
    this.root.classList.remove('show');
  }
}

// ---------------------------------------------------------------- content helpers

/** The builder of each term's tooltip, by its element. */
const TERMS = new WeakMap<Element, TipBuild>();

/** The tooltip's title. */
export function ttTitle(...parts: (Node | string)[]): HTMLElement {
  return el('div', { class: 'tt-title' }, ...parts);
}

/** A number token in bold: the whole token, its sign, % and × included (`tooltipFormat.ts`). */
export function ttNum(token: string | number): HTMLElement {
  return el('b', { class: 'tt-num', text: String(token) });
}

/** A multiplier as a signed percent in bold; exactly 1 is a dash, not bold. */
export function ttPercent(m: number): Node {
  return m === 1 ? document.createTextNode(NO_CHANGE) : ttNum(signedPercent(m));
}

/**
 * A resource: its atlas icon `icons/<cargo>` at 16 px (twice the 8 px icon, pixelated), then its
 * name in lower case, underlined, never wrapped.
 */
export function ttRes(atlas: AtlasRegistry, cargo: string, name: string): HTMLElement {
  return el(
    'span',
    { class: 'tt-res' },
    spriteImg(atlas, `icons/${cargo}`, 2, 'tt-icon'),
    el('u', { text: name.toLowerCase() }),
  );
}

/**
 * A term: a word that opens a nested tooltip with `build`'s content once its tooltip is locked
 * and the pointer rests on it. In a panel, `Tooltip.bindTerms` makes it open a level-0 tooltip.
 * Its label says who it is: after an `update`, the term with the same label (the same one of
 * several equal labels) is the same term, and the tooltip it opened stays.
 */
export function ttTerm(label: string | Node, build: TipBuild): HTMLElement {
  const t = el('span', { class: 'tt-term' }, label);
  TERMS.set(t, build);
  return t;
}

/** A line of plain text. */
export function ttText(...parts: (Node | string)[]): HTMLElement {
  return el('div', {}, ...parts);
}

/** A dim description. */
export function ttDim(...parts: (Node | string)[]): HTMLElement {
  return el('div', { class: 'tt-dim' }, ...parts);
}

/** A few dim words inside a line or a row, whatever the row's tone. */
export function ttQuiet(words: string): HTMLElement {
  return el('span', { class: 'tt-dim', text: words });
}

/** A dim, italic hint. */
export function ttHint(...parts: (Node | string)[]): HTMLElement {
  return el('div', { class: 'tt-hint' }, ...parts);
}

export interface RowLook {
  /** the whole row green (good) or red (bad) */
  tone?: 'good' | 'bad';
  /** a total: a rule above it */
  total?: boolean;
}

/** A row: the label on the left, the value on the right. */
export function ttRow(
  label: Node | string | (Node | string)[],
  value: Node | string | (Node | string)[],
  look: RowLook = {},
): HTMLElement {
  const cls = ['tt-row'];
  if (look.tone) cls.push(`tt-${look.tone}`);
  if (look.total) cls.push('tt-total');
  const part = (p: Node | string | (Node | string)[]) =>
    el('span', {}, ...(Array.isArray(p) ? p : [p]));
  return el('div', { class: cls.join(' ') }, part(label), part(value));
}

// ---------------------------------------------------------------- drawing the stack

const SVG = 'http://www.w3.org/2000/svg';

/** One tooltip of the stack on screen. */
interface Drawn {
  readonly box: HTMLElement;
  readonly body: HTMLElement;
  readonly arc: SVGCircleElement;
  anchor: Point;
  readonly openedAt: number;
  /** reduced motion: the ring does not fill, it shows full on the lock */
  readonly still: boolean;
  locked: boolean;
  /** its terms by `termKeys` */
  terms: Map<string, TermSlot>;
}

/**
 * A term of a tooltip as the stack knows it: the same one across `refresh` while its key is still
 * there, its element and its builder the newest.
 */
interface TermSlot {
  readonly level: number;
  readonly drawn: Drawn;
  el: Element;
  build: TipBuild;
}

/** The mouse events that say where the pointer is, listened for while a tooltip is open. */
const MOVES = ['mouseover', 'mouseout', 'mousemove'] as const;

function circle(cls: string): SVGCircleElement {
  const c = document.createElementNS(SVG, 'circle');
  const mid = String(RING_SIZE / 2);
  c.setAttribute('class', cls);
  c.setAttribute('cx', mid);
  c.setAttribute('cy', mid);
  c.setAttribute('r', String(RING_R));
  return c;
}

/** Draws the stack's tooltips in one layer and reports the pointer to the stack. */
class TooltipLayer implements TipView<TipContent> {
  readonly root = el('div', { id: 'tooltip-stack' });
  private stack: TooltipStack<TipContent> | null = null;
  private readonly drawn: Drawn[] = [];
  private readonly wired = new WeakSet<Element>();
  /** the term a term element of a tooltip stands for */
  private readonly slotOf = new WeakMap<Element, TermSlot>();
  /** the term of a tooltip the pointer is on */
  private over: TermSlot | null = null;
  private raf = 0;
  private listening = false;

  attach(stack: TooltipStack<TipContent>) {
    this.stack = stack;
  }

  open(level: number, content: TipContent, anchor: Point) {
    const body = el('div', { class: 'tt-body' }, ...content);
    const track = circle('tt-ring-track');
    const arc = circle('tt-ring-arc');
    // the arc starts at 12 o'clock and grows clockwise
    arc.setAttribute('transform', `rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`);
    arc.setAttribute('stroke-dasharray', String(RING_C));
    arc.setAttribute('stroke-dashoffset', String(RING_C));
    const ring = document.createElementNS(SVG, 'svg');
    ring.setAttribute('class', 'tt-ring');
    ring.setAttribute('viewBox', `0 0 ${RING_SIZE} ${RING_SIZE}`);
    ring.setAttribute('aria-hidden', 'true');
    ring.append(track, arc);
    const box = el('div', { class: 'tt panel', role: 'tooltip' }, body, ring);
    const d: Drawn = {
      box,
      body,
      arc,
      anchor,
      openedAt: performance.now(),
      still: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      locked: false,
      terms: new Map(),
    };
    // a tooltip takes the pointer only once locked (style.css), so these come only then
    box.addEventListener('mouseenter', () => {
      if (this.drawn[level] === d) this.stack?.tipEnter(level);
    });
    box.addEventListener('mouseleave', (e) => {
      if (this.drawn[level] === d) this.stack?.tipLeave(level, this.levelOf(e.relatedTarget));
    });
    this.drawn[level] = d;
    this.root.append(box);
    this.slotTerms(d, level);
    this.place(d);
    this.listen(true);
    if (!d.still) this.animate();
  }

  move(level: number, anchor: Point) {
    const d = this.drawn[level];
    if (!d) return;
    d.anchor = anchor;
    this.place(d);
  }

  refresh(level: number, content: TipContent): boolean {
    const d = this.drawn[level];
    if (!d) return true;
    d.body.replaceChildren(...content);
    this.slotTerms(d, level);
    this.place(d);
    // the term the pointer is on is still there: its slot holds the new element
    const o = this.over;
    if (!o || o.drawn !== d || d.body.contains(o.el)) return true;
    this.over = null;
    return false;
  }

  lock(level: number) {
    const d = this.drawn[level];
    if (!d) return;
    d.locked = true;
    d.box.classList.add('tt-locked');
    d.arc.setAttribute('stroke-dashoffset', '0');
  }

  close(level: number) {
    this.drawn[level]?.box.remove();
    this.drawn.length = level;
    // the stack is done with the terms it closed
    if (this.over && this.over.level >= level) this.over = null;
    if (level > 0) return;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.listen(false);
  }

  /** Wire the terms under `scope`, in a panel: their tooltip opens at level 0. */
  wireTerms(scope: ParentNode) {
    for (const t of scope.querySelectorAll('.tt-term')) {
      const build = TERMS.get(t);
      if (!build || this.wired.has(t)) continue;
      this.wired.add(t);
      t.addEventListener('mouseenter', () => {
        // a panel drawn again before the tooltip opens takes the term out: anchor where it was
        const was = t.getBoundingClientRect();
        this.stack?.termEnter(
          -1,
          t,
          () => termAnchor(t.isConnected ? t.getBoundingClientRect() : was),
          build,
        );
      });
      t.addEventListener('mouseleave', () => this.stack?.termLeave(-1));
    }
  }

  /** Give the terms in `d` their slots: a term whose key (`termKeys`) was there keeps its slot. */
  private slotTerms(d: Drawn, level: number) {
    const found: [Element, TipBuild][] = [];
    for (const el of d.body.querySelectorAll('.tt-term')) {
      const build = TERMS.get(el);
      if (build) found.push([el, build]);
    }
    const keys = termKeys(found.map(([el]) => el.textContent ?? ''));
    const terms = new Map<string, TermSlot>();
    found.forEach(([el, build], i) => {
      const slot = d.terms.get(keys[i]) ?? { level, drawn: d, el, build };
      slot.el = el;
      slot.build = build;
      terms.set(keys[i], slot);
      this.slotOf.set(el, slot);
    });
    d.terms = terms;
  }

  /**
   * The pointer is over `node`: tell the stack when it comes onto a term of a tooltip or leaves
   * one. Read from every movement, not from the term's own enter and leave: a term `refresh` puts
   * under the pointer gets neither until the pointer crosses its edge.
   */
  private pointAt(node: EventTarget | null) {
    const t = node instanceof Element ? node.closest('.tt-term') : null;
    const slot = t ? this.slotOf.get(t) : undefined;
    const next = slot && slot.el === t && this.drawn[slot.level] === slot.drawn ? slot : null;
    if (next === this.over) return;
    const prev = this.over;
    this.over = null;
    if (prev) this.stack?.termLeave(prev.level);
    if (!next || this.drawn[next.level] !== next.drawn) return;
    this.over = next;
    this.stack?.termEnter(
      next.level,
      next,
      () => termAnchor(next.el.getBoundingClientRect()),
      () => next.build(),
    );
  }

  /** The level of the tooltip `node` is in, or null outside the stack. */
  private levelOf(node: EventTarget | null): number | null {
    if (!(node instanceof Node)) return null;
    const l = this.drawn.findIndex((d) => d.box.contains(node));
    return l < 0 ? null : l;
  }

  private place(d: Drawn) {
    // measured at the corner, so the window's right edge does not squeeze it while it is measured
    d.box.style.left = '0px';
    d.box.style.top = '0px';
    const at = placeTip(
      d.anchor,
      { w: d.box.offsetWidth, h: d.box.offsetHeight },
      { w: window.innerWidth, h: window.innerHeight },
    );
    d.box.style.left = `${at.x}px`;
    d.box.style.top = `${at.y}px`;
  }

  /** Fill the rings of the unlocked tooltips, one frame at a time, while there are any. */
  private animate() {
    if (this.raf) return;
    const tick = (now: number) => {
      this.raf = 0;
      let filling = false;
      for (const d of this.drawn) {
        if (d.locked || d.still) continue;
        d.arc.setAttribute(
          'stroke-dashoffset',
          String(ringDashOffset(holdProgress(now - d.openedAt))),
        );
        filling = true;
      }
      if (filling) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /**
   * A click outside the stack closes it, and still does what it does there (the map acts on it):
   * listened for in the capture phase, never stopped, and only while a tooltip is open.
   */
  private readonly onPointerDown = (e: PointerEvent) => {
    if (this.levelOf(e.target) === null) this.stack?.closeAll();
  };
  /** where the pointer goes: a mouseout's is its related target (null out of the window) */
  private readonly onPointerMove = (e: MouseEvent) =>
    this.pointAt(e.type === 'mouseout' ? e.relatedTarget : e.target);
  private listen(on: boolean) {
    if (on === this.listening) return;
    this.listening = on;
    if (on) {
      document.addEventListener('pointerdown', this.onPointerDown, true);
      for (const m of MOVES) document.addEventListener(m, this.onPointerMove, true);
      return;
    }
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    for (const m of MOVES) document.removeEventListener(m, this.onPointerMove, true);
    this.over = null;
  }
}
