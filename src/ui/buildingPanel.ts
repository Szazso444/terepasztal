import { bridgeCapacity, BRIDGE_SLOW_SHARE } from '../sim/bridges';
import { el, btn } from './dom';
import { STR } from '../strings';
import type { Builder } from '../sim/build';
import type { Commands } from '../sim/commands';
import {
  buildingDef,
  buildingRecipe,
  buildingRate,
  buildingLevel,
  missingInput,
  type Building,
} from '../sim/buildings';
import { rules } from '../sim/rules';
import { fmtCost, type ResourceStore } from '../sim/stores';
import { cargoName } from '../sim/cargo';
import { upgradeView } from './upgradeView';
import { upgradeRow } from './upgradeRow';
import type { WorksStatus } from './tooltipContent';

/** Side panel for a selected processing building: recipe, state and lifetime output. */
export class BuildingPanel {
  readonly root: HTMLElement;
  private body = el('div', { class: 'panel-body' });
  private title = el('span');
  building: Building | null = null;

  constructor(
    private readonly builder: Builder,
    private readonly onClose: () => void,
    private readonly commands: Commands,
  ) {
    this.root = el(
      'div',
      { id: 'building-panel', class: 'panel' },
      el(
        'div',
        { class: 'panel-title' },
        this.title,
        btn('×', () => this.close(), 'small'),
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

  /**
   * What a works is doing. A works is closed while it is upgraded; a bridge being strengthened
   * still carries trains, so it reads as it does without one. The panel words it in `status`; the
   * hover tooltip words it from this (`WorksSnapshot.status`), so the two cannot disagree. A
   * starved works names the input its store (`StoreRegistry.worksStore`) is short of; one with
   * no store at all says no store is in reach.
   */
  static statusKind(b: Building, store: Pick<ResourceStore, 'get'> | null): WorksStatus {
    const def = buildingDef(b.id);
    if (b.work && !def.bridge) return { kind: 'closed' };
    if (b.reason === 'full') return { kind: 'full' };
    if (b.reason === 'inputs' && !store) return { kind: 'noStore', range: rules.buildReach };
    if (b.reason === 'inputs') return { kind: 'starved', missing: missingInput(def, store) };
    return { kind: 'running' };
  }
  /** One-line status of the panel, with the colour class it is shown in. */
  static status(
    b: Building,
    store: Pick<ResourceStore, 'get'> | null,
  ): { text: string; cls: string } {
    const s = BuildingPanel.statusKind(b, store);
    switch (s.kind) {
      case 'closed':
        return { text: STR.upgrade.closed, cls: 'amber' };
      case 'full':
        return { text: STR.building.full, cls: 'amber' };
      case 'starved':
        return {
          text: STR.building.starved(s.missing ? cargoName(s.missing) : STR.building.unknownInput),
          cls: 'red',
        };
      case 'running':
        return { text: STR.building.running, cls: 'good' };
      case 'noStore':
        return { text: STR.stores.noStoreNear(s.range), cls: 'red' };
    }
  }
  /** The crew the panel shows: none while the works is closed for its upgrade (`crewTotal`). */
  static crew(b: Building): number {
    return b.work ? 0 : buildingDef(b.id).crew;
  }
  static recipeText(id: string, building?: Building) {
    const def = buildingDef(id);
    const alt = def.altIn ? ` (${STR.building.or} ${fmtCost(def.altIn)})` : '';
    const r = building ? buildingRecipe(building) : def.recipe;
    return `${fmtCost(r.in)}${alt} → ${fmtCost(r.out)}`;
  }

  render() {
    const b = this.building;
    if (!b || !this.builder.buildingAt(b.x, b.y)) {
      if (b) this.close();
      return;
    }
    const def = buildingDef(b.id);
    this.title.textContent = STR.building.title(def.name, buildingLevel(b));
    const body = this.body;
    body.innerHTML = '';
    const row = (k: string, v: string, cls = '') =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: k }),
        el('span', { class: `v ${cls}`, text: v }),
      );
    // what it runs from: its town's store, else the nearest in reach
    const store = this.builder.stores.worksStore(b);
    const st = BuildingPanel.status(b, store);
    body.append(el('div', { class: 'flavor', text: def.flavor }));
    const capacity = bridgeCapacity(b);
    if (capacity !== null)
      body.append(
        row(
          STR.building.bridgeCapacity,
          STR.building.bridgeLimit(capacity, Math.round(capacity * BRIDGE_SLOW_SHARE)),
        ),
      );
    if (!def.bridge) {
      body.append(row(STR.building.recipe, BuildingPanel.recipeText(b.id, b)));
      body.append(row(STR.building.rate, STR.station.perWeek(Math.round(b.rate * 10) / 10)));
      body.append(row(STR.building.maxRate, STR.station.perWeek(buildingRate(b))));
      body.append(row(STR.building.status, st.text, st.cls));
      body.append(row(STR.building.progress, `${Math.round(b.acc * 100)}%`));
      body.append(row(STR.building.crew, String(BuildingPanel.crew(b))));
      const made = Object.entries(b.made ?? {})
        .map(([k, v]) => `${Math.round(v)} ${cargoName(k)}`)
        .join(', ');
      body.append(row(STR.building.made, made || '-'));
      for (const k of Object.keys(def.recipe.out))
        body.append(
          row(STR.building.inStock(cargoName(k)), String(Math.floor(store?.get(k) ?? 0))),
        );
    } else {
      body.append(el('p', { class: 'dim', text: STR.building.bridgeHint }));
    }
    const view = upgradeView({
      check: this.builder.canUpgradeBuilding(b),
      level: buildingLevel(b),
      work: b.work,
      instant: this.builder.free,
    });
    body.append(
      upgradeRow(view, () => {
        this.commands.act(() => this.builder.upgradeBuilding(b));
        this.render();
      }),
    );
    body.append(
      el(
        'div',
        { class: 'row' },
        btn(
          STR.station.demolish,
          () => {
            const { x, y } = b;
            this.commands.act(() => this.builder.removeBuilding(x, y));
            this.close();
          },
          'small',
        ),
      ),
    );
  }
}
