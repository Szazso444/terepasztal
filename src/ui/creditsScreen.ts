import { content } from '../data/content';
import { el } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import {
  CREDITS,
  licenceOf,
  requiredCredits,
  thanksByAuthor,
  vehicleNames,
  type Credit,
  type CreditsData,
} from './credits';

/** Pixels a second the list rolls by on its own. */
const ROLL_SPEED = 28;
/** How long the list stands before it starts rolling, in ms. */
const ROLL_DELAY = 1500;

/** A link that opens in a new tab, showing `text` (the address without its scheme by default). */
function link(url: string, text = url.replace(/^https?:\/\//, '')) {
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text });
}

/** The game's name for a locomotive or wagon id, undefined for an id the game does not have. */
function nameOf(id: string) {
  return (
    content.locomotives.find((l) => l.id === id)?.name ??
    content.wagons.find((w) => w.id === id)?.name
  );
}

/** One credit in full: title, author, the vehicles it became, source and licence. */
function fullEntry(data: CreditsData, c: Credit) {
  const lic = licenceOf(data, c);
  const names = vehicleNames(c, nameOf);
  return el(
    'div',
    { class: 'credit-entry' },
    el('div', { class: 'credit-kind dim', text: c.kind }),
    el('div', { class: 'credit-title', text: c.title }),
    el('div', { class: 'credit-author', text: STR.credits.by(c.author) }),
    names.length ? el('div', { class: 'dim', text: STR.credits.usedFor(names.join(', ')) }) : null,
    el('div', { class: 'credit-links' }, `${STR.credits.source}: `, link(c.url)),
    el(
      'div',
      { class: 'credit-links' },
      `${STR.credits.licence}: `,
      lic.url ? link(lic.url, lic.name) : lic.name,
    ),
  );
}

/** One author of the thanks list, with each of their assets on its own line. */
function authorBlock(author: string, credits: Credit[]) {
  return el(
    'div',
    { class: 'credit-group' },
    el('div', { class: 'credit-author-name', text: author }),
    ...credits.map((c) => {
      const names = vehicleNames(c, nameOf);
      return el(
        'div',
        { class: 'credit-line' },
        link(c.url, c.title),
        names.length ? el('span', { class: 'dim', text: ` · ${names.join(', ')}` }) : null,
      );
    }),
  );
}

/**
 * The credits (stáblista): every third-party asset the game uses, from `src/data/credits.json`.
 * Assets whose licence asks for credit come first, each in full; the rest follow by author, with
 * thanks. The list rolls up by itself like film credits; it waits while the pointer is over it
 * and stops rolling once the player scrolls or clicks.
 */
export class CreditsScreen implements Screen {
  readonly id = 'credits';
  readonly title = STR.credits.title;
  readonly root = el('div', { class: 'credits' });
  private roll = el('div', { class: 'credits-roll' });
  private frame = 0;
  private startAt = 0;
  private last = 0;
  /** where the roll stands, in fractional pixels (scrollTop keeps whole ones only) */
  private pos = 0;
  private hovered = false;
  private stopped = false;

  constructor(private readonly data: CreditsData = CREDITS) {
    this.root.append(this.roll);
    const stop = () => (this.stopped = true);
    this.roll.addEventListener('wheel', stop, { passive: true });
    this.roll.addEventListener('pointerdown', stop);
    this.roll.addEventListener('keydown', stop);
    this.roll.addEventListener('pointerenter', () => (this.hovered = true));
    this.roll.addEventListener('pointerleave', () => (this.hovered = false));
  }

  private render() {
    const data = this.data;
    const required = requiredCredits(data);
    const thanks = thanksByAuthor(data);
    // the licences the thanks list is under, once each, in the order they first come
    const thanksLicences = [
      ...new Map(
        thanks.flatMap((g) => g.credits).map((c) => [c.licence, licenceOf(data, c)]),
      ).values(),
    ];
    const r = this.roll;
    r.innerHTML = '';
    r.append(
      el('div', { class: 'credits-spacer' }),
      el('div', { class: 'credits-game', text: STR.title }),
      el('div', { class: 'credits-intro', text: STR.credits.intro }),
    );
    if (required.length)
      r.append(
        el('div', { class: 'credits-head', text: STR.credits.required }),
        el('div', { class: 'credits-note dim', text: STR.credits.requiredNote }),
        ...required.map((c) => fullEntry(data, c)),
      );
    if (thanks.length)
      r.append(
        el('div', { class: 'credits-head', text: STR.credits.thanks }),
        el('div', { class: 'credits-note dim', text: STR.credits.thanksNote }),
        ...thanks.map((g) => authorBlock(g.author, g.credits)),
        el(
          'div',
          { class: 'credit-links credits-licences' },
          `${STR.credits.licence}: `,
          ...thanksLicences.flatMap((l, i) => [
            i ? ' · ' : '',
            l.url ? link(l.url, l.name) : l.name,
          ]),
        ),
      );
    r.append(el('div', { class: 'credits-spacer' }));
  }

  onOpen() {
    this.render();
    this.roll.scrollTop = 0;
    this.pos = 0;
    this.stopped = false;
    this.startAt = performance.now() + ROLL_DELAY;
    this.last = 0;
    const step = (now: number) => {
      this.frame = requestAnimationFrame(step);
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
      this.last = now;
      if (this.stopped || this.hovered || now < this.startAt) {
        this.pos = this.roll.scrollTop;
        return;
      }
      const end = this.roll.scrollHeight - this.roll.clientHeight;
      this.pos = Math.min(end, this.pos + ROLL_SPEED * dt);
      this.roll.scrollTop = this.pos;
      if (this.pos >= end) this.stopped = true;
    };
    this.frame = requestAnimationFrame(step);
  }

  onClose() {
    cancelAnimationFrame(this.frame);
  }
}
