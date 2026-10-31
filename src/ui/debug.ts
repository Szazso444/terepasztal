import { el } from './dom';
import { STR } from '../strings';
import {
  actionButton,
  buttonRow,
  formRow,
  labelValue,
  textField,
  toggleSwitch,
  well,
  type TextField,
} from './kit';

export interface DebugActions {
  giveMoney(): void;
  giveTickets(): void;
  nextAge(): void;
  giveResources(): void;
  spawnContract(): void;
  toggleDepth(): boolean;
  regenerate(): void;
}

/**
 * Backtick-toggled debug panel. It stays a panel at the side, not a screen: the depth overlay and
 * the camera readouts are looked at on the map, which a screen would dim.
 */
export class DebugPanel {
  readonly root: HTMLElement;
  private rows = new Map<string, HTMLElement>();
  private seedField: TextField;

  constructor(seed: number, actions: DebugActions) {
    const readouts = [
      STR.debug.fps,
      STR.debug.seed,
      STR.debug.entities,
      STR.debug.zoom,
      STR.debug.camera,
      STR.debug.landscape,
      STR.debug.traffic,
      STR.debug.recovery,
      STR.debug.junctions,
      STR.debug.tile,
    ].map((k) => {
      const v = el('span', { text: '-' });
      this.rows.set(k, v);
      return labelValue(k, v);
    });
    this.seedField = textField({ value: String(seed) });
    let depthOn = false;
    this.root = el(
      'div',
      { id: 'debug', class: 'panel' },
      el('div', { class: 'panel-title', text: STR.debug.title }),
      el(
        'div',
        { class: 'panel-body k-dbg' },
        well(null, ...readouts),
        well(
          null,
          buttonRow(
            actionButton(STR.debug.giveMoney, actions.giveMoney, { cls: 'small' }),
            actionButton(STR.debug.giveTickets, actions.giveTickets, { cls: 'small' }),
            actionButton(STR.debug.nextAge, actions.nextAge, { cls: 'small' }),
            actionButton(STR.debug.spawnContract, actions.spawnContract, { cls: 'small' }),
            actionButton(STR.debug.giveResources, actions.giveResources, { cls: 'small' }),
          ),
          formRow(
            STR.debug.depthOverlay,
            toggleSwitch(
              STR.debug.depthOverlay,
              () => depthOn,
              () => (depthOn = actions.toggleDepth()),
            ),
          ),
          el(
            'div',
            { class: 'k-inrow' },
            this.seedField.root,
            actionButton(STR.debug.regenerate, actions.regenerate, { cls: 'small' }),
          ),
        ),
      ),
    );
  }
  get seedValue() {
    return this.seedField.input.value;
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
