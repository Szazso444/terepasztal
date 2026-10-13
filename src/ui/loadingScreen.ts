import { STR } from '../strings';
import { el } from './dom';
import {
  LOADING_PICTURES,
  canSkip,
  clampProgress,
  irisMask,
  irisRadius,
  isPlainKey,
  pickIndex,
  pictureUrl,
  revealDuration,
  revealFrame,
} from './loadingMath';

export interface LoadingScreenOptions {
  /** the source of the picture and tip picks, a number in 0..1 each call (`Math.random`) */
  random?: () => number;
  /** see `LoadingScreen.onRevealStart` */
  onRevealStart?: () => void;
}

/** loading while the boot works; ready from `waitForClick`; begun once it is clicked */
type Phase = 'loading' | 'ready' | 'begun' | 'reveal' | 'gone';

/**
 * The screen the game loads behind: one of three pictures at random, a tip, and a progress bar
 * along the bottom. It ends in "Click to begin", and the reveal that click starts is a fade to
 * black and an iris that opens from the centre of the viewport onto the game.
 *
 * The boot drives it:
 *
 *     const screen = new LoadingScreen({ onRevealStart: () => audio.startMusic() });
 *     screen.setProgress(0.4);
 *     ...
 *     screen.done();
 *     await screen.waitForClick();
 *     await screen.reveal(); // resolves once the game is uncovered
 *
 * The root is `position: fixed` on `<body>`, above every layer of the game (style.css), and takes
 * the pointer for as long as it is up: the world under it sees no hover and no hotkey. Any click
 * or key skips the reveal to its end; `onRevealStart` has fired by then, since it fires as the
 * reveal begins. Under `prefers-reduced-motion` the iris is a plain fade of the black away.
 */
export class LoadingScreen {
  readonly root: HTMLElement;
  /**
   * Called once, as the reveal begins (the click that starts it, or `reveal()`): the music
   * starts here, and a skip never costs it.
   */
  onRevealStart: (() => void) | null;

  private phase: Phase = 'loading';
  private progress = 0;
  private readonly fill = el('div', { class: 'ls-bar-fill' });
  private readonly bar = el('div', {
    class: 'ls-bar',
    role: 'progressbar',
    'aria-label': STR.loadingScreen.progress,
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
  });
  private readonly black = el('div', { class: 'ls-black' });
  private clicked: Promise<void> | null = null;
  private resolveClick: (() => void) | null = null;
  private revealed: Promise<void> | null = null;
  private resolveReveal: (() => void) | null = null;
  private fired = false;
  private t0 = 0;
  private reduced = false;
  private opened = false;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: LoadingScreenOptions = {}) {
    const random = opts.random ?? Math.random;
    this.onRevealStart = opts.onRevealStart ?? null;

    // a picture that is missing or fails to decode leaves the plain #0e150f of the root
    const picture = el('div', { class: 'ls-picture' });
    const n = pickIndex(random(), LOADING_PICTURES) + 1;
    picture.style.backgroundImage = `url("${pictureUrl(import.meta.env.BASE_URL, n)}")`;

    const tips = STR.loadingScreen.tips;
    const tip = el('div', { class: 'ls-tip', text: tips[pickIndex(random(), tips.length)] ?? '' });
    const begin = el('div', { class: 'ls-begin', text: STR.loadingScreen.begin });
    this.bar.append(this.fill);

    this.root = el(
      'div',
      { id: 'loading-screen' },
      picture,
      el('div', { class: 'ls-footer' }, begin, tip),
      this.bar,
      this.black,
    );
    this.root.addEventListener('click', this.onClick);
    // the world listens on window for the pointer; what moves over this screen is not its hover
    this.root.addEventListener('mousemove', (e) => e.stopPropagation());
    // capture, so it runs before the game's own key listeners on window
    window.addEventListener('keydown', this.onKey, true);
    document.body.append(this.root);
  }

  /** The bar to `p` (0..1). It never moves back: a lower value than before is ignored. */
  setProgress(p: number) {
    this.progress = clampProgress(this.progress, p);
    this.fill.style.transform = `scaleX(${this.progress})`;
    this.bar.setAttribute('aria-valuenow', String(Math.round(this.progress * 100)));
  }

  /** Loading is over: the bar is full. */
  done() {
    this.setProgress(1);
  }

  /**
   * Shows "Click to begin" and resolves at the player's click (or Enter or Space). It does not
   * start the reveal: `reveal()` does, so the boot can ready what is under the screen first.
   */
  waitForClick(): Promise<void> {
    if (this.clicked) return this.clicked;
    this.done();
    if (this.phase === 'gone' || this.phase === 'reveal') return (this.clicked = Promise.resolve());
    this.phase = 'ready';
    this.root.classList.add('ls-ready');
    return (this.clicked = new Promise<void>((resolve) => (this.resolveClick = resolve)));
  }

  /**
   * The fade to black, then the iris. Fires `onRevealStart` as it begins and resolves when it has
   * finished and the screen is gone; a click or key skips to that end. A second call returns the
   * same promise.
   */
  reveal(): Promise<void> {
    if (this.revealed) return this.revealed;
    this.beginClick();
    this.phase = 'reveal';
    this.root.classList.remove('ls-ready');
    this.root.classList.add('ls-revealing');
    this.reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.t0 = performance.now();
    const done = new Promise<void>((resolve) => (this.resolveReveal = resolve));
    this.revealed = done;
    this.fireRevealStart();
    this.paint(0);
    this.raf = requestAnimationFrame(this.tick);
    // a hidden tab stops animation frames: the screen still ends on time
    this.timer = setTimeout(() => this.finish(), revealDuration(this.reduced) + 250);
    return done;
  }

  private fireRevealStart() {
    if (this.fired) return;
    this.fired = true;
    this.onRevealStart?.();
  }

  /** A click or key that is the click of `waitForClick`. */
  private beginClick() {
    if (this.phase === 'ready') this.phase = 'begun';
    this.resolveClick?.();
    this.resolveClick = null;
  }

  private onClick = () => {
    if (this.phase === 'ready') this.beginClick();
    else if (this.phase === 'reveal') this.skip();
  };

  private onKey = (e: KeyboardEvent) => {
    if (!isPlainKey(e)) return;
    // no hotkey of the game acts on a key pressed over this screen
    e.stopImmediatePropagation();
    if (e.key === 'Tab' || e.key === ' ' || e.key === 'Enter') e.preventDefault();
    if (e.repeat) return;
    if (this.phase === 'ready') {
      if (e.key === 'Enter' || e.key === ' ') this.beginClick();
    } else if (this.phase === 'reveal') this.skip();
  };

  private skip() {
    if (!canSkip(performance.now() - this.t0)) return;
    this.finish();
  }

  private tick = (now: number) => {
    this.paint(now - this.t0);
    if (this.phase === 'reveal') this.raf = requestAnimationFrame(this.tick);
  };

  private paint(elapsed: number) {
    const f = revealFrame(elapsed, this.reduced);
    if (f.phase === 'done') return this.finish();
    this.black.style.opacity = f.black.toFixed(3);
    if (f.phase !== 'open') return;
    if (!this.opened) {
      // the black covers everything now: the picture and the bar can go
      this.opened = true;
      this.root.classList.add('ls-open');
    }
    if (this.reduced) return;
    const { width, height } = this.root.getBoundingClientRect();
    const mask = irisMask(irisRadius(f.open, width, height));
    this.black.style.maskImage = mask;
    this.black.style.setProperty('-webkit-mask-image', mask);
  }

  private finish() {
    if (this.phase === 'gone') return;
    this.phase = 'gone';
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    this.resolveReveal?.();
  }
}
