import type { Gauge } from '../data/content';
import { sfx } from '../engine/audio';
import { gaugeLine } from '../sim/compat';
import { STR } from '../strings';
import { el } from './dom';
import { lineBadge } from './lineBadge';
import { Bindings } from './liveView';

/** One depot in the bar. */
export interface BarDepot {
  id: number;
  name: string;
  gauge: Gauge;
}

/** What the bar reads, and what a choice asks for. */
export interface DepotBarHost {
  chosen(): number | null;
  /** how many trains belong to a depot */
  trains(id: number): number;
  /** what its gate says: `tone` `ok`, `bad` or none yet, `why` the whole of it */
  gate(id: number): { text: string; tone: string; why: string };
  pick(id: number): void;
}

const GATE_TONES: readonly string[] = ['ok', 'bad'];
/** How many depots the bar shows in full. */
const ROOMY = 4;

/**
 * The head of the Depot: every depot with its gauge, its trains and its gate. It is drawn again
 * only when the depots change; the counts and the gates follow in place.
 */
export class DepotBar {
  readonly root = el('div', { class: 'dp-bar', role: 'radiogroup' });
  private readonly live = new Bindings();
  /** what the chips were drawn from */
  private drawn = '';

  constructor(private readonly h: DepotBarHost) {
    // more depots than it shows: a mouse wheel goes along the line
    this.root.addEventListener(
      'wheel',
      (e) => {
        if (!e.deltaY || this.root.scrollWidth <= this.root.clientWidth) return;
        this.root.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** Bring the bar up to the depots there are. */
  sync(depots: readonly BarDepot[]) {
    const key = JSON.stringify(depots);
    if (key !== this.drawn) {
      this.drawn = key;
      this.draw(depots);
    }
    this.live.run();
  }

  private draw(depots: readonly BarDepot[]) {
    this.live.clear();
    // past what fits, the chips drop the gauge's word: its badge still shows it
    this.root.classList.toggle('many', depots.length > ROOMY);
    this.root.replaceChildren(
      ...(depots.length
        ? depots.map((d) => this.chip(d))
        : [el('p', { class: 'k-p bad', text: STR.fleet.noDepot })]),
    );
  }

  private chip(d: BarDepot): HTMLElement {
    const count = el('span');
    const dot = el('i', { class: 'dp-dot' });
    const gate = el('span', { class: 'dp-gst' }, dot);
    const word = el('span');
    gate.append(word);
    const root = el(
      'button',
      { type: 'button', class: 'dp-dep', role: 'radio' },
      el('span', { class: 'dp-dep-h' }, lineBadge(gaugeLine(d.gauge)), el('b', { text: d.name })),
      el(
        'small',
        {},
        el('span', { class: 'dp-gz', text: `${STR.depot.gaugeName[d.gauge]} · ` }),
        count,
      ),
      gate,
    );
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx('ui.click');
      this.h.pick(d.id);
    });
    this.live.text(count, () => STR.depot.trainCount(this.h.trains(d.id)));
    this.live.text(word, () => this.h.gate(d.id).text);
    this.live.tone(gate, GATE_TONES, () => this.h.gate(d.id).tone);
    // a refusal is too long for the chip: the whole of it is the chip's title
    this.live.add(() => {
      const why = this.h.gate(d.id).why;
      if (root.title !== why) root.title = why;
    });
    this.live.add(() => {
      const on = this.h.chosen() === d.id;
      const came = on && !root.classList.contains('on');
      root.classList.toggle('on', on);
      root.setAttribute('aria-checked', String(on));
      // with more depots than the bar shows, the one chosen stays in sight
      if (came) root.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    return root;
  }
}
