import { el, btn } from './dom';
import { STR } from '../strings';
import type { Builder } from '../sim/build';
import { buildingDef, missingInput, type Building } from '../sim/buildings';
import type { Stockpile } from '../sim/stockpile';
import { fmtCost } from '../sim/stockpile';
import { cargoName } from '../sim/cargo';

/** Side panel for a selected processing building: recipe, state and lifetime output. */
export class BuildingPanel {
  readonly root: HTMLElement;
  private body = el('div', { class: 'panel-body' });
  private title = el('span');
  building: Building | null = null;

  constructor(
    private readonly builder: Builder,
    private readonly stock: Stockpile,
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
  open(b: Building) {
    this.building = b;
    this.root.style.display = '';
    this.render();
  }
  close() {
    this.building = null;
    this.root.style.display = 'none';
    this.onClose();
  }

  /** One-line status used by the panel and the hover tooltip. */
  static status(b: Building, stock: Stockpile): { text: string; cls: string } {
    const def = buildingDef(b.id);
    if (b.reason === 'full') return { text: STR.building.full, cls: 'amber' };
    if (b.reason === 'inputs') {
      const m = missingInput(def, stock);
      return { text: STR.building.starved(m ? cargoName(m) : '?'), cls: 'red' };
    }
    return { text: STR.building.running, cls: 'good' };
  }
  static recipeText(id: string) {
    const def = buildingDef(id);
    const alt = def.altIn ? ` (${STR.building.or} ${fmtCost(def.altIn)})` : '';
    return `${fmtCost(def.recipe.in)}${alt} → ${fmtCost(def.recipe.out)}`;
  }

  render() {
    const b = this.building;
    if (!b || !this.builder.buildingAt(b.x, b.y)) {
      if (b) this.close();
      return;
    }
    const def = buildingDef(b.id);
    this.title.textContent = def.name;
    const body = this.body;
    body.innerHTML = '';
    const row = (k: string, v: string, cls = '') =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: k }),
        el('span', { class: `v ${cls}`, text: v }),
      );
    const st = BuildingPanel.status(b, this.stock);
    body.append(el('div', { class: 'flavor', text: def.flavor }));
    body.append(row(STR.building.recipe, BuildingPanel.recipeText(b.id)));
    body.append(row(STR.building.rate, STR.station.perDay(Math.round(b.rate * 10) / 10)));
    body.append(row(STR.building.maxRate, STR.station.perDay(def.perDay)));
    body.append(row(STR.building.status, st.text, st.cls));
    body.append(row(STR.building.progress, `${Math.round(b.acc * 100)}%`));
    body.append(row(STR.building.crew, String(def.crew)));
    const made = Object.entries(b.made ?? {})
      .map(([k, v]) => `${Math.round(v)} ${cargoName(k)}`)
      .join(', ');
    body.append(row(STR.building.made, made || '-'));
    for (const k of Object.keys(def.recipe.out))
      body.append(row(STR.building.inStock(cargoName(k)), String(Math.floor(this.stock.get(k)))));
    body.append(
      el(
        'div',
        { class: 'row' },
        btn(
          STR.station.demolish,
          () => {
            const { x, y } = b;
            this.builder.removeBuilding(x, y);
            this.close();
          },
          'small',
        ),
      ),
    );
  }
}
