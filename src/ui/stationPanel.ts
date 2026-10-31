import { structureFrame } from '../art/frames';
import type { AtlasRegistry } from '../engine/atlas';
import { biomeAt } from '../sim/biomes';
import type { Builder } from '../sim/build';
import { buildingDef, buildingRate, buildingRecipe } from '../sim/buildings';
import { cargoName } from '../sim/cargo';
import { STATION_NAME_MAX, type Commands } from '../sim/commands';
import type { ContractBoard } from '../sim/contracts';
import type { Fleet } from '../sim/fleet';
import { rules } from '../sim/rules';
import { harvestBreakdown, weeklyOutput, type Station } from '../sim/stations';
import type { StoreRegistry } from '../sim/stores';
import type { GameClock } from '../sim/time';
import type { Town, TownRegistry } from '../sim/towns';
import type { Train } from '../sim/trains';
import type { Season } from '../sim/weather';
import { STR } from '../strings';
import { buildIcon } from './buildIcons';
import { btn, el, fmtInt } from './dom';
import type { Amount } from './outlinerRows';
import { groundRows } from './placingTooltip';
import { renameField } from './renameField';
import { spriteImg } from './spritePreview';
import {
  STATION_TABS,
  fillTone,
  stationCargo,
  stationExpansion,
  stationOverview,
  stationTabs,
  stationTimetable,
  stationTrains,
  type CallRow,
  type LevelRow,
  type ReachSource,
  type StationCargo,
  type StationExpansion,
  type StationFact,
  type StationTab,
  type StationTimetable,
  type StationWorld,
} from './stationView';
import type { TipContent } from './tooltip';
import { blockText, type TipDoc } from './tooltipDoc';
import type { Chip } from './trainView';
import { upgradeRow } from './upgradeRow';
import { upgradeView } from './upgradeView';

/** How the panel draws its ground rows, and the season their yield is worked out for (#336). */
export interface GroundView {
  /** the season production runs in */
  season(): Season;
  /** the nodes of a tooltip document's rows */
  render(doc: TipDoc): TipContent;
  /** wire the terms under `scope`: resting on one opens its tooltip (`Tooltip.bindTerms`) */
  bindTerms(scope: ParentNode): void;
}

/** What the panel reads, and what its buttons ask for. */
export interface StationPanelHost {
  builder: Builder;
  commands: Commands;
  board: ContractBoard;
  clock: GameClock;
  towns: TownRegistry;
  fleet: Fleet;
  stores: StoreRegistry;
  atlas: AtlasRegistry;
  view: GroundView;
  /** the seconds a train has stood stuck; null if it has not */
  stuckFor(id: number): number | null;
  toast(m: string, k?: 'info' | 'warn' | 'good'): void;
  onClose(): void;
  onRenameTown(t: Town): void;
  /** a train's row: pick it, which opens its panel in this one's place */
  onTrain(t: Train): void;
}

/**
 * Top left, in the train panel's frame, for the station picked on the map or in the outliner: only
 * one of the two is open. Its tabs are those of its kind (`stationTabs`), each drawn from
 * `stationView.ts` and drawn again only when what it says changed, so what is under the pointer
 * stays the same element.
 */
export class StationPanel {
  readonly root = el('div', { id: 'station-panel', class: 'panel' });
  private readonly head = el('div', { class: 'tp-head' });
  private readonly tabs = new Map<StationTab, HTMLButtonElement>();
  private readonly scroll = el('div', { class: 'tp-scroll' });
  private readonly foot = el('div', { class: 'tp-foot' });
  /** the Overview's picture: drawn only when the level or the season changes */
  private readonly picture = el('div', { class: 'sp-illu' });
  /** the rows of the Overview above the ground rows, and below them */
  private readonly upper = el('div');
  private readonly lower = el('div');
  /**
   * The ground rows: the biome as a term, or a harvest station's yield rows. Drawn again only when
   * what they say changes, so the term the pointer rests on stays the same element and its
   * tooltip can fill its ring and lock.
   */
  private readonly ground = el('div', { class: 'station-ground' });
  private groundSaid = '';
  /** the name in the head, where it is edited */
  private name: HTMLElement | null = null;
  private tab: StationTab = 'overview';
  station: Station | null = null;
  private headKey = '';
  private footKey = '';
  private pictureKey = '';
  private tabKey = '';
  /** the tab the scroll area holds now */
  private shown: StationTab | null = null;
  /** a button is down, so what is under it must stay what it came down on */
  private held = false;
  private renaming = false;

  constructor(private readonly h: StationPanelHost) {
    const tabRow = el('div', { class: 'tp-tabs' });
    for (const id of STATION_TABS) {
      const b = btn(STR.stationPanel.tab[id], () => this.setTab(id), 'tp-tab');
      this.tabs.set(id, b);
      tabRow.append(b);
    }
    this.root.append(this.head, tabRow, this.scroll, this.foot);
    this.root.addEventListener('pointerdown', () => (this.held = true));
    window.addEventListener('pointerup', () => (this.held = false));
    window.addEventListener('pointercancel', () => (this.held = false));
    this.root.style.display = 'none';
  }

  open(s: Station) {
    this.station = s;
    this.resetKeys();
    this.root.style.display = '';
    this.root.classList.add('open');
    this.scroll.scrollTop = 0;
    this.render();
  }
  close() {
    this.station = null;
    this.root.style.display = 'none';
    this.root.classList.remove('open');
    this.ground.replaceChildren();
    this.groundSaid = '';
    this.resetKeys();
    this.h.onClose();
  }
  private resetKeys() {
    this.headKey = this.footKey = this.pictureKey = this.tabKey = '';
    this.shown = null;
  }
  private setTab(tab: StationTab) {
    this.tab = tab;
    this.tabKey = '';
    this.scroll.scrollTop = 0;
    this.render();
  }

  /** Look at the station, and draw what changed. */
  render() {
    const s = this.station;
    if (!s || this.held || this.renaming) return;
    const kinds = stationTabs(s.def);
    // a kind without the tab the panel stood on opens on its Overview
    if (!kinds.includes(this.tab)) this.tab = 'overview';
    for (const [id, b] of this.tabs) {
      b.style.display = kinds.includes(id) ? '' : 'none';
      b.classList.toggle('on', id === this.tab);
    }
    this.drawHead(s);
    this.drawFoot(s);
    if (this.tab === 'overview') this.drawOverview(s);
    else if (this.tab === 'cargo') this.drawTab(s, stationCargo, (v) => this.drawCargo(v));
    else if (this.tab === 'trains') this.drawTab(s, stationTrains, (v) => this.drawTrains(v));
    else if (this.tab === 'timetable')
      this.drawTab(s, stationTimetable, (v) => this.drawTimetable(v));
    else this.drawExpansion(s);
  }

  /** A tab: what it says now, drawn when that differs from what it said. */
  private drawTab<V>(
    s: Station,
    read: (s: Station, w: StationWorld) => V,
    draw: (view: V) => void,
  ) {
    const view = read(s, this.world(s));
    const key = JSON.stringify([s.id, this.tab, view]);
    if (key === this.tabKey) return;
    this.tabKey = key;
    this.shown = this.tab;
    draw(view);
  }

  private world(s: Station): StationWorld {
    const h = this.h;
    return {
      age: h.builder.economy.tier,
      free: h.builder.free,
      town: h.towns.townOfStation(s)?.name ?? null,
      hasTrack: h.builder.platformTiles(s).length > 0,
      perWeek: this.perWeek(s),
      outletName: s.outlet ? h.stores.label(s.outlet) : null,
      reach: this.tab === 'overview' ? this.reach(s) : [],
      now: h.clock.time,
      contracts: h.board.active,
      remaining: (c) => {
        const live = h.board.active.find((k) => k.id === c.id);
        return live ? h.board.remaining(live, h.clock.time) : 0;
      },
      trains: h.fleet.trains,
      stationName: (id) => h.builder.stationById(id)?.name ?? null,
      stuck: (id) => h.stuckFor(id),
    };
  }

  /** What it makes a week: a harvest station's breakdown figure, none while it is closed. */
  private perWeek(s: Station): number {
    const b = this.breakdown(s);
    if (!b) return s.productionPerWeek;
    return s.closed ? 0 : b.perWeek;
  }
  /** Why a harvest station makes what it does, at its level and in this season. */
  private breakdown(s: Station) {
    if (!s.def.terrain) return null;
    const season = this.h.view.season();
    return harvestBreakdown(this.h.builder.map, s.x, s.y, s.def.id, s.level, season, rules);
  }
  /** The harvesters and works at work, each with the store it goes to. */
  private reach(s: Station): ReachSource[] {
    const { builder, stores } = this.h;
    const out: ReachSource[] = [];
    for (const o of builder.stations) {
      const goods = o.producedCargo();
      if (o === s || o.closed || !o.outlet || !goods.length) continue;
      const each = (o.productionPerWeek * o.productionMul) / goods.length;
      out.push({
        name: o.name,
        tiles: s.distTo(o.x, o.y),
        store: o.outlet.key,
        makes: Object.fromEntries(goods.map((c) => [c, each])),
      });
    }
    for (const b of builder.buildings.values()) {
      if (b.work) continue;
      const made = Object.entries(buildingRecipe(b).out);
      out.push({
        name: buildingDef(b.id).name,
        tiles: s.distTo(b.x, b.y),
        store: stores.supplierFor(b.x, b.y)?.key ?? null,
        makes: Object.fromEntries(made.map(([c, v]) => [c, v * buildingRate(b)])),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- frame

  private drawHead(s: Station) {
    const key = JSON.stringify([s.id, s.name, s.level]);
    if (key === this.headKey) return;
    this.headKey = key;
    const name = el('span', { class: 'tp-name', text: s.name, title: STR.outliner.renameTip });
    name.addEventListener('dblclick', () => this.rename(s));
    this.name = name;
    const close = btn('', () => this.close(), 'small bi-x');
    close.title = STR.trainPanel.close;
    close.append(buildIcon('close', 14));
    this.head.replaceChildren(
      buildIcon('station', 16),
      name,
      el('span', { class: 'ol-lv', text: STR.outliner.level(s.level) }),
      close,
    );
  }

  /** A Townhouse goes by its town's name: anything else is named where it stands. */
  private rename(s: Station) {
    const town = this.townOf(s);
    if (town) return this.h.onRenameTown(town);
    if (!this.name || this.renaming) return;
    this.renaming = true;
    renameField(this.name, s.name, STATION_NAME_MAX, (typed) => {
      this.renaming = false;
      // cancelled, left blank or left as it was: nothing to rename
      if (typed?.trim() && typed !== s.name) {
        const done = this.h.commands.renameStation(s, typed);
        if (!done.ok) this.h.toast(done.message, 'warn');
      }
      this.headKey = '';
      this.render();
    });
  }
  private townOf(s: Station) {
    return s.def.id === 'town' ? this.h.towns.townOfStation(s) : null;
  }

  private drawFoot(s: Station) {
    const town = this.townOf(s);
    const key = JSON.stringify([s.id, !!town]);
    if (key === this.footKey) return;
    this.footKey = key;
    this.foot.replaceChildren(
      btn(town ? STR.station.renameTown : STR.station.rename, () => this.rename(s), 'small'),
      btn(
        STR.station.demolish,
        () => {
          this.h.commands.act(() => this.h.builder.removeStation(s));
          this.close();
        },
        'small',
      ),
    );
  }

  // ---------------------------------------------------------------- parts

  private icon(res: string) {
    const i = spriteImg(this.h.atlas, `icons/${res}`, 1, 'sprite-preview res-icon');
    i.title = cargoName(res);
    return i;
  }
  private section(title: string, right = '') {
    return el('div', { class: 'bi-sec' }, title, right ? el('em', { text: right }) : '');
  }
  private meter(percent: number, cls = '') {
    return el('span', { class: `ol-meter ${cls}` }, el('i', { style: `width:${percent}%` }));
  }
  private storageMeter(f: StationFact) {
    const share = f.meter ?? 0;
    return this.meter(share, fillTone(share));
  }
  private chip(c: Chip) {
    return el('span', { class: `ol-chip sev-${c.sev}` }, buildIcon(c.icon, 12), c.text);
  }
  private note(text: string) {
    return el('p', { class: 'bi-p dim', text });
  }
  private goods(list: Amount[]) {
    return list.map((g) => el('span', { class: 'ol-cg' }, this.icon(g.res), fmtInt(g.amount)));
  }
  /** The picture of the kind at one of its pictured levels. */
  private frameOf(s: Station, picture: number, rot: number) {
    const fam = `structures/${s.def.art}_${picture}`;
    const a = this.h.atlas;
    return structureFrame(a, a.has(fam) ? fam : `structures/station_${picture}`, rot);
  }

  // ---------------------------------------------------------------- Overview

  private drawOverview(s: Station) {
    if (this.shown !== 'overview') {
      this.scroll.replaceChildren(this.picture, this.upper, this.ground, this.lower);
      this.shown = 'overview';
    }
    this.drawPicture(s);
    this.drawGround(s);
    const v = stationOverview(s, this.world(s));
    const key = JSON.stringify([s.id, s.def.flavor, v]);
    if (key === this.tabKey) return;
    this.tabKey = key;
    const P = STR.stationPanel;
    const facts = el('div', { class: 'sp-kv' });
    for (const f of v.facts) facts.append(this.fact(f));
    if (v.week) facts.append(this.week(v.week));
    this.upper.replaceChildren(
      el('p', { class: 'bi-p sp-flavor dim', text: s.def.flavor }),
      ...v.notes.map((n) => el('div', { class: `tp-note ${n.cls}`, text: n.text })),
      facts,
    );
    if (v.production.length) this.upper.append(this.section(P.production, P.perWeek));
    for (const p of v.production)
      this.upper.append(
        el(
          'div',
          { class: 'tp-line' },
          el(
            'span',
            {},
            this.icon(p.res),
            p.name,
            p.tiles === null ? null : el('small', { text: P.tilesAway(p.tiles) }),
          ),
          el('b', { text: String(p.perWeek) }),
        ),
      );
    if (v.residents !== null)
      this.upper.append(
        el(
          'div',
          { class: 'tp-line' },
          el('span', { text: P.residents }),
          el('b', { text: String(v.residents) }),
        ),
      );
    this.lower.replaceChildren(
      this.section(P.waitingNow),
      v.waiting.length
        ? el('div', { class: 'sp-goods' }, ...v.waiting.map((g) => this.waitingChip(g)))
        : this.note(P.nothingWaiting),
    );
  }

  private drawPicture(s: Station) {
    const season = STR.placing.season[this.h.view.season()];
    const frame = this.frameOf(s, s.spriteLevel, s.rot);
    const level = STR.station.level(s.level);
    const key = JSON.stringify([frame, s.def.name, level, season]);
    if (key === this.pictureKey) return;
    this.pictureKey = key;
    this.picture.replaceChildren(
      spriteImg(this.h.atlas, frame, 2, 'sp-sprite'),
      el('span', { text: STR.stationPanel.picture(s.def.name, level, season) }),
    );
  }
  private fact(f: StationFact) {
    return el(
      'div',
      { class: f.wide ? 'wide' : '' },
      el('span', { text: f.label }),
      el('b', { text: f.value }),
      f.meter === undefined ? null : this.storageMeter(f),
    );
  }
  private week(goods: Amount[]) {
    const P = STR.stationPanel;
    return el(
      'div',
      { class: 'wide' },
      el('span', { text: P.handled }),
      el('b', { class: 'sp-week' }, ...(goods.length ? this.goods(goods) : [P.nothingHandled])),
    );
  }
  private waitingChip(g: Amount) {
    return el(
      'span',
      { class: 'sp-good' },
      this.icon(g.res),
      `${cargoName(g.res)} ${fmtInt(g.amount)}`,
    );
  }

  /**
   * The ground rows (#336): a harvest station's yield rows, from its breakdown at its level, in
   * this season and under the tuning (the tiles they count are lit while it is selected, which
   * is while this panel is open); any other station's biome as a term.
   */
  private drawGround(s: Station) {
    const weeklyAtLevel1 = weeklyOutput(1, 1);
    const doc = groundRows({
      biome: biomeAt(this.h.builder.map, s.x, s.y),
      breakdown: this.breakdown(s),
      cargo: s.producedCargo(),
      weeklyAtLevel1,
    });
    // the station, what the rows say, and what the biome's nested tooltips will print
    const said = [s.id, weeklyAtLevel1, ...doc.map(blockText)].join('\n');
    if (said === this.groundSaid) return;
    this.groundSaid = said;
    this.ground.replaceChildren(...this.h.view.render(doc));
    this.h.view.bindTerms(this.ground);
  }

  // ---------------------------------------------------------------- Cargo

  private drawCargo(v: StationCargo) {
    const P = STR.stationPanel;
    const cls = `sp-cargo ${v.counted ? 'counted' : ''}`;
    const out: HTMLElement[] = [this.section(P.cargoHere, v.counted ? P.thisWeek : '')];
    if (v.rows.length)
      out.push(
        el(
          'div',
          { class: `${cls} sp-cargo-head` },
          el('span'),
          el('b', { text: P.waiting }),
          v.counted ? el('b', { text: P.inWeek }) : null,
          v.counted ? el('b', { text: P.outWeek }) : null,
        ),
      );
    else out.push(this.note(P.noCargo));
    for (const r of v.rows)
      out.push(
        el(
          'div',
          { class: cls },
          el('span', {}, this.icon(r.res), cargoName(r.res)),
          el('b', { text: fmtInt(r.waiting) }),
          r.in === null ? null : el('b', { text: fmtInt(r.in) }),
          r.out === null ? null : el('b', { text: fmtInt(r.out) }),
          this.meter(r.share, fillTone(r.share)),
        ),
      );
    out.push(
      this.section(v.storage.label, v.storage.value),
      el('div', { class: 'sp-pad' }, this.storageMeter(v.storage)),
    );
    if (v.carried) out.push(this.note(v.carried));
    if (v.accepts.length)
      out.push(
        this.section(P.accepts),
        el(
          'div',
          { class: 'sp-goods' },
          ...v.accepts.map((c) => el('span', { class: 'sp-good' }, this.icon(c), cargoName(c))),
        ),
      );
    if (v.contracts.length) out.push(this.section(STR.station.contracts));
    for (const c of v.contracts)
      out.push(
        el(
          'div',
          { class: 'tp-line' },
          el('span', { text: c.title }),
          el('b', { class: c.late ? 'red' : '', text: `${c.progress} · ${c.left}` }),
        ),
      );
    this.scroll.replaceChildren(...out);
  }

  // ---------------------------------------------------------------- Trains

  /** A train's row picks it, here as in the outliner. */
  private picks(row: HTMLElement, id: number) {
    row.dataset.train = String(id);
    row.addEventListener('click', () => {
      const t = this.h.fleet.byId(id);
      if (t) this.h.onTrain(t);
    });
    return row;
  }
  private stripe(hex: string) {
    return el('i', { class: 'ol-stripe', style: `background:${hex}` });
  }

  private drawTrains(rows: CallRow[]) {
    const P = STR.stationPanel;
    this.scroll.replaceChildren(
      this.section(P.calling, rows.length ? String(rows.length) : ''),
      ...(rows.length ? rows.map((r) => this.callRow(r)) : [this.note(P.noTrains)]),
    );
  }
  private callRow(r: CallRow) {
    return this.picks(
      el(
        'div',
        { class: 'ol-row' },
        this.stripe(r.hex),
        el(
          'div',
          { class: 'ol-main' },
          el(
            'div',
            { class: 'ol-l1' },
            el('b', { class: 'ol-name', text: r.name }),
            this.chip(r.chip),
          ),
          el(
            'div',
            { class: 'ol-l2' },
            ...(r.cargo.length ? this.goods(r.cargo) : [el('span', { text: STR.outliner.empty })]),
            el('span', { class: 'ol-route', text: r.where }),
            this.meter(r.load),
          ),
        ),
      ),
      r.id,
    );
  }

  // ---------------------------------------------------------------- Expansion

  private drawExpansion(s: Station) {
    const { builder, commands } = this.h;
    const v = stationExpansion(s, this.world(s));
    const upgrade = upgradeView({
      check: builder.canUpgrade(s),
      level: s.level,
      work: s.work,
      // a depot's upgrade is instant (Builder.upgradeStation)
      instant: !!s.def.depot,
    });
    const key = JSON.stringify([s.id, this.tab, builder.free, v, upgrade]);
    if (key === this.tabKey) return;
    this.tabKey = key;
    this.shown = 'expansion';
    const P = STR.stationPanel;
    const raise = () => {
      if (commands.act(() => builder.upgradeStation(s))) this.render();
    };
    const lower = () => {
      if (commands.act(() => builder.downgradeStation(s))) this.render();
    };
    const out: HTMLElement[] = [
      el('div', { class: 'sp-ladder' }, ...v.levels.map((l) => this.rung(s, l))),
      this.section(v.next ? P.nextLevel(v.next.level) : P.topLevel),
    ];
    for (const c of v.compare)
      out.push(
        el(
          'div',
          { class: 'sp-compare' },
          el('span', { text: c.label }),
          el('b', { text: c.now }),
          el('em', { text: c.next === null ? '' : `→ ${c.next}` }),
        ),
      );
    if (v.next?.unlocks.length)
      out.push(
        el('div', {
          class: 'tp-note cyan',
          text: P.adds(v.next.unlocks.map(cargoName).join(', ')),
        }),
      );
    out.push(
      builder.free
        ? el(
            'div',
            { class: 'sp-buy' },
            btn(STR.editor.levelDown, lower, 'small'),
            btn(STR.editor.levelUp, raise, 'small'),
          )
        : el('div', { class: 'sp-buy' }, upgradeRow(upgrade, raise)),
      this.section(P.levels),
      this.levelTable(v),
    );
    this.scroll.replaceChildren(...out);
  }
  private rung(s: Station, l: LevelRow) {
    const rung = el(
      'span',
      { class: `${l.state === 'now' ? 'on' : ''} ${l.locked ? 'lock' : ''}` },
      spriteImg(this.h.atlas, this.frameOf(s, l.picture, 0), 1, 'sp-rung'),
      el('b', { text: String(l.level) }),
    );
    rung.title = l.opens ?? STR.station.level(l.level);
    return rung;
  }
  private levelTable(v: StationExpansion) {
    const P = STR.stationPanel;
    const made = v.levels.some((l) => l.output !== null);
    const cls = `sp-levels ${made ? 'made' : ''}`;
    return el(
      'div',
      { class: 'sp-pad' },
      el(
        'div',
        { class: `${cls} sp-levels-head` },
        el('b', { text: P.levelShort }),
        el('b', { text: STR.station.storage }),
        el('b', { text: P.loadPerSec }),
        el('b', { text: STR.station.platforms }),
        el('b', { text: P.crew }),
        made ? el('b', { text: P.makesShort }) : null,
      ),
      ...v.levels.map((l) => this.levelRow(l, cls, made)),
    );
  }
  private levelRow(l: LevelRow, cls: string, made: boolean) {
    const P = STR.stationPanel;
    const said = [
      ...l.unlocks.map((c) => P.adds(cargoName(c))),
      ...(l.hours > 0 ? [`${Math.ceil(l.hours)} h`] : []),
      ...(l.opens ? [l.opens] : []),
    ];
    const cost = Object.entries(l.cost).filter(([, n]) => n > 0);
    return el(
      'div',
      { class: `${cls} ${l.state} ${l.locked ? 'lock' : ''}` },
      el('b', { text: String(l.level) }),
      el('span', { text: fmtInt(l.storage) }),
      el('span', { text: String(l.loadRate) }),
      el('span', { text: String(l.platforms) }),
      el('span', { text: String(l.crew) }),
      made ? el('span', { text: l.output === null ? '-' : String(l.output) }) : null,
      cost.length || said.length
        ? el(
            'small',
            {},
            ...this.goods(cost.map(([res, amount]) => ({ res, amount }))),
            said.join(' · '),
          )
        : null,
    );
  }

  // ---------------------------------------------------------------- Timetable

  private drawTimetable(v: StationTimetable) {
    const P = STR.stationPanel;
    const out: HTMLElement[] = [this.section(P.arrivals)];
    if (!v.board.length) out.push(this.note(P.noArrivals));
    for (const r of v.board)
      out.push(
        this.picks(
          el(
            'div',
            { class: 'ol-row sp-board' },
            this.stripe(r.hex),
            el('b', { text: r.when }),
            el(
              'span',
              { class: 'ol-main' },
              el('b', { class: 'ol-name', text: r.name }),
              el('small', { text: r.to ? P.leavesFor(r.to) : '' }),
            ),
            this.chip(r.chip),
          ),
          r.id,
        ),
      );
    out.push(
      this.section(P.platformUse),
      el(
        'div',
        { class: 'tp-line' },
        el('span', { text: P.inUse }),
        el('b', { text: P.stored(String(v.used), String(v.platforms)) }),
        this.meter(v.share, fillTone(v.share)),
      ),
    );
    if (v.queued)
      out.push(
        el(
          'div',
          { class: 'tp-line' },
          el('span', { text: P.waitingForOne }),
          el('b', { class: 'amber', text: String(v.queued) }),
        ),
      );
    this.scroll.replaceChildren(...out);
  }
}
