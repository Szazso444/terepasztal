import { el, btn } from './dom';
import { STR } from '../strings';

export interface DebugActions {
  giveMoney(): void;
  giveTickets(): void;
  spawnContract(): void;
  toggleDepth(): boolean;
  regenerate(): void;
}

/** Backtick-toggled debug panel. */
export class DebugPanel {
  readonly root: HTMLElement;
  private rows = new Map<string, HTMLElement>();
  private seedInput: HTMLInputElement;

  constructor(seed: number, actions: DebugActions) {
    const table = el('table');
    for (const k of [
      STR.debug.fps,
      STR.debug.seed,
      STR.debug.entities,
      STR.debug.zoom,
      STR.debug.camera,
      STR.debug.tile,
    ]) {
      const v = el('td', { text: '-' });
      table.append(el('tr', {}, el('td', { text: k }), v));
      this.rows.set(k, v);
    }
    this.seedInput = el('input', {
      type: 'text',
      value: String(seed),
      class: 'num',
      style: 'width:110px;background:#111;color:#d8cfb8;border:1px solid #000',
    });
    const depthBtn = btn(
      STR.debug.depthOverlay,
      () => depthBtn.classList.toggle('active', actions.toggleDepth()),
      'small',
    );
    this.root = el(
      'div',
      { id: 'debug', class: 'panel' },
      el('div', { class: 'panel-title', text: STR.debug.title }),
      el(
        'div',
        { class: 'panel-body' },
        table,
        el(
          'div',
          { class: 'row' },
          btn(STR.debug.giveMoney, actions.giveMoney, 'small'),
          btn(STR.debug.giveTickets, actions.giveTickets, 'small'),
        ),
        el(
          'div',
          { class: 'row' },
          btn(STR.debug.spawnContract, actions.spawnContract, 'small'),
          depthBtn,
        ),
        el(
          'div',
          { class: 'row' },
          this.seedInput,
          btn(STR.debug.regenerate, actions.regenerate, 'small'),
        ),
      ),
    );
  }
  get seedValue() {
    return this.seedInput.value;
  }
  toggle() {
    this.root.classList.toggle('open');
  }
  get open() {
    return this.root.classList.contains('open');
  }
  set(key: string, value: string) {
    const r = this.rows.get(key);
    if (r) r.textContent = value;
  }
}
