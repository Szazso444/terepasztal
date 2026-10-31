import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import { harvestBreakdown, weeklyOutput, type Station } from '../sim/stations';
import type { Builder } from '../sim/build';
import type { Commands } from '../sim/commands';
import { cargoDef } from '../sim/cargo';
import { inSupplyMode } from '../sim/supply';
import type { ContractBoard } from '../sim/contracts';
import type { GameClock } from '../sim/time';
import { rules } from '../sim/rules';
import type { Season } from '../sim/weather';
import { fmtDuration } from './contractsScreen';
import { biomeAt } from '../sim/biomes';
import type { TownRegistry, Town } from '../sim/towns';
import { upgradeView } from './upgradeView';
import { upgradeRow } from './upgradeRow';
import { groundRows } from './placingTooltip';
import { blockText, type TipDoc } from './tooltipDoc';
import type { TipContent } from './tooltip';

/** How the panel draws its ground rows, and the season their yield is worked out for (#336). */
export interface GroundView {
  /** the season production runs in */
  season(): Season;
  /** the nodes of a tooltip document's rows */
  render(doc: TipDoc): TipContent;
  /** wire the terms under `scope`: resting on one opens its tooltip (`Tooltip.bindTerms`) */
  bindTerms(scope: ParentNode): void;
}

/** Side panel for a selected station. */
export class StationPanel {
  readonly root: HTMLElement;
  private body = el('div', { class: 'panel-body' });
  /** the rows above the ground rows, and the rows below them, drawn again at every render */
  private head = el('div');
  private tail = el('div');
  /**
   * The ground rows: the biome as a term, or a harvest station's yield rows. Drawn again only when
   * what they say changes, so the term the pointer rests on stays the same element and its
   * tooltip can fill its ring and lock.
   */
  private ground = el('div', { class: 'station-ground' });
  private groundSaid = '';
  private title = el('span');
  station: Station | null = null;

  constructor(
    private readonly builder: Builder,
    private readonly onClose: () => void,
    private readonly board: ContractBoard,
    private readonly clock: GameClock,
    private readonly towns: TownRegistry,
    private readonly onRenameTown: (t: Town) => void,
    private readonly commands: Commands,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private readonly view: GroundView,
  ) {
    this.body.append(this.head, this.ground, this.tail);
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

  open(s: Station) {
    this.station = s;
    this.root.style.display = '';
    this.render();
  }
  close() {
    this.station = null;
    this.root.style.display = 'none';
    this.ground.replaceChildren();
    this.groundSaid = '';
    this.onClose();
  }

  render() {
    const s = this.station;
    if (!s) return;
    this.title.textContent = `${s.name}`;
    let b = this.head;
    b.replaceChildren();
    this.tail.replaceChildren();
    const row = (k: string, v: string, cls = '') =>
      el(
        'div',
        { class: 'kv' },
        el('span', { class: 'k', text: k }),
        el('span', { class: `v ${cls}`, text: v }),
      );
    b.append(el('div', { class: 'flavor', text: s.def.flavor }));
    b.append(row(STR.station.level(s.level), `${s.def.name}`));
    if (s.closed) b.append(el('div', { class: 'amber', text: STR.upgrade.closed }));
    const town = this.towns.townOfStation(s);
    if (town) b.append(row(STR.station.town, town.name));
    const perWeek = this.drawGround(s);
    b = this.tail;
    const produced =
      s
        .producedCargo()
        .map((c) => cargoDef(c).name)
        .join(', ') || '-';
    b.append(
      row(
        STR.station.produces,
        `${produced} (${STR.station.perWeek(Math.round(perWeek * 10) / 10)})`,
      ),
    );
    b.append(
      row(
        STR.station.accepts,
        s.def.accepts
          .filter((c) => inSupplyMode(cargoDef(c)))
          .map((c) => cargoDef(c).name)
          .join(', ') || '-',
      ),
    );
    b.append(row(STR.station.platforms, `${s.occupants.size} / ${s.platforms}`));
    b.append(row(STR.station.loadRate, STR.station.perSec(s.loadRate)));
    if (!s.def.depot)
      b.append(row(STR.station.storage, `${Math.floor(s.shownStored())} / ${s.capacity}`));
    const bars = el('div', { class: 'bars' });
    for (const c of s.availableCargo()) {
      const v = s.stored(c);
      const bar = el(
        'div',
        { class: 'bar' },
        el('div', { class: 'bar-fill', style: `width:${Math.min(100, (v / s.capacity) * 100)}%` }),
        el('span', { class: 'bar-label', text: `${cargoDef(c).name} ${Math.floor(v)}` }),
      );
      bars.append(bar);
    }
    b.append(bars);
    if (this.builder.platformTiles(s).length === 0)
      b.append(el('div', { class: 'red', text: STR.station.noPlatform }));
    if (s.loadBoost > 1)
      b.append(
        el('div', { class: 'cyan', text: STR.station.boost(Math.round((s.loadBoost - 1) * 100)) }),
      );
    // spot market for cargo delivered without a contract
    if (s.def.accepts.length) {
      b.append(
        el('div', { class: 'col-title', style: 'margin-top:6px', text: STR.station.market }),
      );
      for (const c of s.def.accepts) {
        const sat = s.satiety(c);
        b.append(
          el(
            'div',
            { class: 'bar market' },
            el('div', { class: 'bar-fill', style: `width:${Math.round((1 - sat) * 100)}%` }),
            el('span', {
              class: 'bar-label',
              text: `${cargoDef(c).name} ${fmtMoney(s.marketPrice(c, 0))}/u`,
            }),
          ),
        );
      }
      b.append(el('div', { class: 'sub dim', text: STR.station.marketHint }));
    }
    // contracts touching this station
    const mine = this.board.active
      .filter((c) => c.originId === s.id || c.destId === s.id)
      .sort((p, q) => p.expires - q.expires);
    if (mine.length) {
      b.append(
        el('div', { class: 'col-title', style: 'margin-top:6px', text: STR.station.contracts }),
      );
      for (const c of mine) {
        const other = this.builder.stationById(c.originId === s.id ? c.destId : c.originId);
        const rem = this.board.remaining(c, this.clock.time);
        b.append(
          el(
            'div',
            { class: 'kv' },
            el('span', {
              class: 'k',
              text: `${c.originId === s.id ? '→' : '←'} ${other?.name ?? '?'}: ${Math.round(c.amount)} ${cargoDef(c.cargo).name}`,
            }),
            el('span', {
              class: `v ${rem < 0.25 ? 'red' : ''}`,
              text: `${Math.floor(c.delivered)}/${c.amount} · ${fmtDuration(Math.max(0, c.expires - this.clock.time))}`,
            }),
          ),
        );
      }
    }
    const actions = el('div', { class: 'row' });
    if (this.builder.free) {
      actions.append(
        btn(
          STR.editor.levelDown,
          () => {
            if (this.builder.downgradeStation(s)) this.render();
          },
          'small',
        ),
        btn(
          STR.editor.levelUp,
          () => {
            if (this.builder.upgradeStation(s)) this.render();
          },
          'small',
        ),
      );
    } else {
      const view = upgradeView({
        check: this.builder.canUpgrade(s),
        level: s.level,
        work: s.work,
        // a depot's upgrade is instant (Builder.upgradeStation)
        instant: !!s.def.depot,
      });
      const up = upgradeRow(view, () => {
        if (this.commands.act(() => this.builder.upgradeStation(s))) this.render();
      });
      // the work's bar takes the panel's width; the button sits in the row with what it unlocks
      if (view.kind === 'work') b.append(up);
      else actions.append(up);
      const nx = view.kind === 'top' ? [] : s.nextLevelUnlocks();
      if (nx.length)
        actions.append(
          el('span', {
            class: 'dim',
            text: STR.station.unlocks(nx.map((c) => cargoDef(c).name).join(', ')),
          }),
        );
    }
    b.append(actions);
    b.append(
      el(
        'div',
        { class: 'row' },
        s.def.id === 'town' && town
          ? btn(STR.station.renameTown, () => this.onRenameTown(town), 'small')
          : btn(
              STR.station.rename,
              () => {
                const n = prompt(STR.station.rename, s.name);
                // cancelled, or left blank: nothing to rename
                if (!n?.trim()) return;
                const done = this.commands.renameStation(s, n);
                if (!done.ok) this.toast(done.message, 'warn');
                this.render();
              },
              'small',
            ),
        btn(
          STR.station.demolish,
          () => {
            this.commands.act(() => this.builder.removeStation(s));
            this.close();
          },
          'small',
        ),
      ),
    );
  }

  /**
   * The ground rows (#336): a harvest station's yield rows, from its breakdown at its level, in
   * this season and under the tuning (the tiles they count are lit while it is selected, which
   * is while this panel is open); any other station's biome as a term. Returns what it makes a
   * week: a harvest station's breakdown figure, none while it is closed.
   */
  private drawGround(s: Station): number {
    const map = this.builder.map;
    const b = s.def.terrain
      ? harvestBreakdown(map, s.x, s.y, s.def.id, s.level, this.view.season(), rules)
      : null;
    const weeklyAtLevel1 = weeklyOutput(1, 1);
    const doc = groundRows({
      biome: biomeAt(map, s.x, s.y),
      breakdown: b,
      cargo: s.producedCargo(),
      weeklyAtLevel1,
    });
    // the station, what the rows say, and what the biome's nested tooltips will print
    const said = [s.id, weeklyAtLevel1, ...doc.map(blockText)].join('\n');
    if (said !== this.groundSaid) {
      this.groundSaid = said;
      this.ground.replaceChildren(...this.view.render(doc));
      this.view.bindTerms(this.ground);
    }
    if (!b) return s.productionPerWeek;
    return s.closed ? 0 : b.perWeek;
  }
}
