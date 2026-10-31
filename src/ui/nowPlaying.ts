import { btn, el } from './dom';
import { lineIcon, type IconName } from './kit';
import { ttTerm, type TipBuild } from './tooltip';
import { STR } from '../strings';
import type { MusicView } from '../engine/audio';

/** A title's speed as it rolls, in pixels a second: slow enough to read. */
const ROLL_SPEED = 16;
/** The part of a roll spent moving; the rest it stands at its ends (`@keyframes np-roll`). */
const ROLL_MOVING = 0.6;
/** The shortest roll, in seconds: a title a little too wide still rolls slowly. */
const ROLL_LEAST = 7;

export interface TitleRoll {
  /** how far the title moves, in pixels */
  distance: number;
  /** how long one way takes, rest included, in seconds */
  seconds: number;
}

/**
 * How a title in a box moves: it rolls there and back, as Spotify's does, when it is wider than its
 * room, and with null it stands still: it fits, or its box is not laid out (the title is dropped).
 */
export function titleRoll(textWidth: number, boxWidth: number): TitleRoll | null {
  if (boxWidth <= 0 || textWidth <= boxWidth) return null;
  const distance = textWidth - boxWidth;
  return { distance, seconds: Math.max(ROLL_LEAST, distance / ROLL_SPEED / ROLL_MOVING) };
}

/** What the widget reads and works: the audio bus. */
export interface MusicDeck {
  readonly view: MusicView;
  togglePause(): void;
  back(): void;
  forward(): void;
}

/**
 * The music in the top bar: back, pause or play, forward and the title. It changes no volume and
 * no setting. The title is the track's, never a file's name, and its tooltip says it in full.
 */
export class NowPlaying {
  private text = el('span', { class: 'np-text' });
  private box = el('span', { class: 'np-title' }, this.text);
  private backBtn = this.press('trackback', () => this.deck.back());
  private toggleBtn = this.press('pause', () => this.deck.togglePause());
  private forwardBtn = this.press('trackforward', () => this.deck.forward());
  /** what the widget shows now; it is written only where this changes, as it runs every frame */
  private shown: MusicView | null = null;
  readonly root: HTMLElement;

  /** `tip` builds a tooltip that says the text it reads when it opens. */
  constructor(
    private readonly deck: MusicDeck,
    tip: (text: () => string) => TipBuild,
  ) {
    const title = () => this.shown?.title ?? STR.nowPlaying.noTrack;
    const pause = () => (this.shown?.paused ? STR.nowPlaying.play : STR.nowPlaying.pause);
    const back = () => (this.shown?.canGoBack ? STR.nowPlaying.back : STR.nowPlaying.noBack);
    this.root = el(
      'div',
      { class: 'panel stat now-playing' },
      // a term around the button: one that is off still says why
      ttTerm(this.backBtn, tip(back)),
      ttTerm(this.toggleBtn, tip(pause)),
      ttTerm(
        this.forwardBtn,
        tip(() => STR.nowPlaying.forward),
      ),
      ttTerm(this.box, tip(title)),
    );
    if (typeof ResizeObserver !== 'undefined') {
      // the room changes with the window, and the text's width when its font arrives
      const ro = new ResizeObserver(() => this.roll());
      ro.observe(this.box);
      ro.observe(this.text);
    }
  }

  private press(icon: IconName, run: () => void): HTMLButtonElement {
    const b = btn('', run, 'small');
    b.append(lineIcon(icon));
    return b;
  }

  /** Roll the title or let it stand, as it measures now. */
  private roll() {
    const roll = titleRoll(this.text.offsetWidth, this.box.clientWidth);
    this.box.classList.toggle('roll', roll !== null);
    if (!roll) return;
    this.text.style.setProperty('--np-shift', `-${roll.distance}px`);
    this.text.style.setProperty('--np-time', `${roll.seconds}s`);
  }

  update() {
    const now = this.deck.view;
    const was = this.shown;
    this.shown = now;
    if (now.title !== was?.title) {
      this.text.textContent = now.title ?? STR.nowPlaying.noTrack;
      this.roll();
    }
    if (now.paused !== was?.paused) {
      this.toggleBtn.replaceChildren(lineIcon(now.paused ? 'play' : 'pause'));
      this.box.classList.toggle('paused', now.paused);
    }
    if (now.held !== was?.held) this.root.classList.toggle('held', now.held);
    this.backBtn.disabled = !now.canGoBack;
    this.forwardBtn.disabled = !now.canGoForward;
  }
}
