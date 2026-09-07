import { el, btn } from './dom';
import { STR } from '../strings';
import type { Builder, Decor } from '../sim/build';
import { decorDef } from '../sim/build';
import type { PowerGrid } from '../sim/power';

/** Side panel for a selected service or utility (water tower, coaling stage, signal, pole). */
export class DecorPanel {
  readonly root: HTMLElement;
  private body = el('div', { class: 'panel-body' });
  private title = el('span');
  decor: Decor | null = null;

  constructor(
    private readonly builder: Builder,
    private readonly power: PowerGrid,
    private readonly onClose: () => void,
  ) {
    this.root = el(
      'div',
      { id: 'station-panel', class: 'panel' },
      el(
        'div',
        { class: 'panel-title' },
        this.title,
        btn('x', () => this.close(), 'small'),
      ),
      this.body,
    );
    this.root.style.display = 'none';
  }
  open(d: Decor) {
    this.decor = d;
    this.root.style.display = '';
    this.render();
  }
  close() {
    this.decor = null;
    this.root.style.display = 'none';
    this.onClose();
  }

  /** Lines shared with the hover tooltip. */
  static lines(d: Decor, builder: Builder, power: PowerGrid): string[] {
    const def = decorDef(d.id);
    const out: string[] = [];
    if (def.radius) {
      const served = builder.stations.filter(
        (s) => Math.max(Math.abs(s.x - d.x), Math.abs(s.y - d.y)) <= def.radius!,
      );
      out.push(STR.decorInfo.reach(def.radius));
      out.push(
        served.length
          ? STR.decorInfo.serves(served.map((s) => s.name).join(', '))
          : STR.decorInfo.servesNone,
      );
    }
    if (def.power) out.push(power.isPowered(d.x, d.y) ? STR.decorInfo.live : STR.decorInfo.dead);
    if (d.id === 'signal') out.push(STR.decorInfo.signal);
    if (def.crew) out.push(`${STR.building.crew}: ${def.crew}`);
    return out;
  }

  render() {
    const d = this.decor;
    if (!d || this.builder.decorAt(d.x, d.y) !== d) {
      if (d) this.close();
      return;
    }
    const def = decorDef(d.id);
    this.title.textContent = def.name;
    const b = this.body;
    b.innerHTML = '';
    b.append(el('div', { class: 'flavor', text: def.flavor }));
    for (const line of DecorPanel.lines(d, this.builder, this.power))
      b.append(el('div', { class: 'kv' }, el('span', { class: 'k', text: line })));
    b.append(
      el(
        'div',
        { class: 'row' },
        btn(
          STR.station.demolish,
          () => {
            this.builder.removeDecor(d.x, d.y);
            this.close();
          },
          'small',
        ),
      ),
    );
  }
}
