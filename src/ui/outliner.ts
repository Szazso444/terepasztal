import { el, btn } from './dom';
import { sfx } from '../engine/audio';
import type { AtlasRegistry } from '../engine/atlas';
import type { Builder } from '../sim/build';
import {
  BUILDING_DEFS,
  buildingLevel,
  buildingRate,
  buildingRecipe,
  buildingSpan,
  type Building,
} from '../sim/buildings';
import { cargoName } from '../sim/cargo';
import { TRAIN_NAME_MAX, type Commands } from '../sim/commands';
import type { ContractBoard } from '../sim/contracts';
import type { Fleet } from '../sim/fleet';
import { rules } from '../sim/rules';
import type { Station } from '../sim/stations';
import type { GameClock } from '../sim/time';
import { nextTrainColour } from '../sim/trainColours';
import type { Train } from '../sim/trains';
import { STR } from '../strings';
import { buildIcon, type BuildIcon } from './buildIcons';
import { BuildingPanel } from './buildingPanel';
import { contractRarityLabel } from './labels';
import {
  DOUBLE_CLICK_MS,
  OUTLINER_TABS,
  contractRows,
  countsLine,
  secondClick,
  stationRows,
  trainGroups,
  worksRows,
  type Amount,
  type ContractFacts,
  type ContractRow,
  type Listed,
  type OutlinerScope,
  type OutlinerTab,
  type Point,
  type StationFacts,
  type StationRow,
  type TrainGroup,
  type TrainRow,
  type ViewRect,
  type WorksFacts,
  type WorksRow,
} from './outlinerRows';
import { renameField } from './renameField';
import { spriteImg } from './spritePreview';
import { ttDim, ttLabel } from './tooltip';
import type { Chip } from './trainView';

/** Seconds between looks at the world: the rows change slowly, the camera at will. */
const REFRESH_S = 0.25;

const TAB_ICON: Record<OutlinerTab, BuildIcon> = {
  trains: 'train',
  stations: 'station',
  contracts: 'scroll',
  works: 'factory',
};

/** What the outliner reads, and what its clicks ask for. */
export interface OutlinerHost {
  fleet: Fleet;
  builder: Builder;
  contracts: ContractBoard;
  clock: GameClock;
  commands: Commands;
  atlas: AtlasRegistry;
  toast(m: string, k?: 'info' | 'warn' | 'good'): void;
  /** what the camera shows; null in the overview, which shows everything */
  view(): ViewRect | null;
  /** where a tile point is drawn, in world pixels */
  tilePoint(x: number, y: number): Point;
  /** the train picked, and the one the camera follows */
  selectedTrain(): Train | null;
  followedTrain(): number | null;
  /** the seconds a train has stood stuck; null if it has not */
  stuckFor(id: number): number | null;
  /** go to a train and open its panel */
  onTrain(t: Train): void;
  /** trace a train's path while the pointer is on its row; null when it leaves */
  onHover(t: Train | null): void;
  onStation(s: Station): void;
  onWorks(b: Building): void;
  /** open the Contracts screen on that contract's card */
  onContract(id: number): void;
}

/**
 * Top right: everything on the map in four tabs, what the camera shows or all of it. Trains go by
 * their colour code. It looks at the world a few times a second and draws its list only when the
 * text of its rows changed (`BuildInfo.refreshTrain` does the same for one card).
 */
export class Outliner {
  readonly root = el('div', { id: 'outliner', class: 'panel' });
  private readonly tabsBox = el('div', { class: 'ol-tabs' });
  private readonly tabs = new Map<OutlinerTab, HTMLButtonElement>();
  private readonly scopeBtns = new Map<OutlinerScope, HTMLButtonElement>();
  private readonly body = el('div', { class: 'panel-body ol-body' });
  private readonly counts = el('span', { class: 'ol-counts' });
  private readonly extra = el('span', { class: 'ol-extra' });
  private readonly refuel = btn(STR.trainSide.refuelAll, () => this.refuelShown(), 'small');
  private tab: OutlinerTab = 'trains';
  private scope: OutlinerScope = 'view';
  /** seconds since the last look */
  private since = REFRESH_S;
  /** the text of what is drawn */
  private key = '';
  /** the trains the list shows: what Refuel all fills */
  private shown: Train[] = [];
  /** the train whose row is open */
  private expanded: number | null = null;
  /** the train picked at the last look: a train picked anywhere opens its row */
  private picked: number | null = null;
  /** a pending open: a click on a name waits, as it may be the first of two */
  private opening = 0;
  /** the colours the rows stay grouped by while the stripes are worked (`TrainContext`) */
  private heldColours: ReadonlyMap<number, number> | null = null;
  /** the last click on a name */
  private lastName: { id: number; at: number } | null = null;
  private hovered: Train | null = null;
  /** a button is down, so the row under it must stay the one it came down on */
  private held = false;
  /** a name is being typed: the list stands still under it */
  private renaming = false;

  constructor(private readonly h: OutlinerHost) {
    for (const id of OUTLINER_TABS) {
      const b = btn('', () => this.setTab(id), 'ol-tab');
      b.title = STR.outliner.tab[id];
      this.tabs.set(id, b);
      this.tabsBox.append(b);
    }
    const seg = el('div', { class: 'ol-seg' });
    for (const [id, text] of [
      ['view', STR.outliner.scopeView],
      ['all', STR.outliner.scopeAll],
    ] as const) {
      const b = btn(text, () => this.setScope(id), 'ol-scope');
      this.scopeBtns.set(id, b);
      seg.append(b);
    }
    this.root.append(
      this.tabsBox,
      el('div', { class: 'ol-bar' }, seg),
      this.body,
      el('div', { class: 'panel-foot ol-foot' }, this.counts, this.extra),
    );
    this.root.addEventListener('pointerdown', () => (this.held = true));
    window.addEventListener('pointerup', () => (this.held = false));
    window.addEventListener('pointercancel', () => (this.held = false));
    this.body.addEventListener('mouseover', (e) => {
      const row = (e.target as Element).closest<HTMLElement>('[data-train]');
      this.setHover(row ? (h.fleet.byId(Number(row.dataset.train)) ?? null) : null);
    });
    this.root.addEventListener('mouseleave', () => this.setHover(null));
    this.body.addEventListener('mouseleave', () => {
      if (!this.heldColours) return;
      this.heldColours = null;
      this.update(0, true);
    });
    this.markTabs();
  }

  private setHover(t: Train | null) {
    if (this.hovered === t) return;
    this.hovered = t;
    this.h.onHover(t);
  }
  private setTab(tab: OutlinerTab) {
    this.tab = tab;
    this.markTabs();
    this.body.scrollTop = 0;
    this.update(0, true);
  }
  private setScope(scope: OutlinerScope) {
    this.scope = scope;
    this.markTabs();
    this.update(0, true);
  }
  /** The tab open shows its name beside its icon, the others only theirs. */
  private markTabs() {
    for (const [id, b] of this.tabs) {
      const on = id === this.tab;
      b.classList.toggle('on', on);
      b.replaceChildren(buildIcon(TAB_ICON[id], 15));
      if (on) b.append(el('b', { text: STR.outliner.tab[id] }));
    }
    for (const [id, b] of this.scopeBtns) b.classList.toggle('on', id === this.scope);
  }

  /** The corners of a footprint as drawn. */
  private corners(x: number, y: number, w: number, h: number): Point[] {
    const at = (dx: number, dy: number) => this.h.tilePoint(x + dx, y + dy);
    return [at(0, 0), at(w, 0), at(0, h), at(w, h)];
  }
  private stationCorners(s: Station) {
    return this.corners(s.x, s.y, s.w, s.h);
  }

  private trains(view: ViewRect | null): Listed<TrainGroup> {
    const h = this.h;
    const list = trainGroups(h.fleet.trains, view, {
      tilePoint: (x, y) => h.tilePoint(x, y),
      stationName: (id) => h.builder.stationById(id)?.name ?? null,
      stuck: (id) => h.stuckFor(id),
      selected: h.selectedTrain()?.id ?? null,
      following: h.followedTrain(),
      expanded: this.expanded,
      heldColours: this.heldColours,
    });
    const ids = new Set(list.rows.flatMap((g) => g.rows.map((r) => r.id)));
    this.shown = h.fleet.trains.filter((t) => ids.has(t.id));
    return list;
  }

  private stations(view: ViewRect | null): Listed<StationRow> {
    const facts: StationFacts[] = this.h.builder.stations.map((s) => {
      const goods = s
        .availableCargo()
        .map((res) => ({ res, amount: s.stored(res) }))
        .filter((g) => g.amount >= 1);
      const dock = s.dock;
      const fill = dock
        ? Math.max(0, ...goods.map((g) => g.amount / (dock.cap(g.res) || Infinity)))
        : s.totalStored() / Math.max(1, s.capacity);
      return {
        id: s.id,
        name: s.name,
        level: s.level,
        closed: s.closed,
        goods,
        fill,
        at: this.stationCorners(s),
      };
    });
    return stationRows(facts, view);
  }

  private contractList(view: ViewRect | null): Listed<ContractRow> {
    const h = this.h;
    const now = h.clock.time;
    const end = (id: number) => {
      const s = h.builder.stationById(id);
      return s ? this.stationCorners(s) : [];
    };
    const facts: ContractFacts[] = h.contracts.active.map((c) => ({
      id: c.id,
      rarity: c.rarity,
      cargo: c.cargo,
      amount: c.amount,
      delivered: c.delivered,
      payout: c.payout,
      expires: c.expires,
      remaining: h.contracts.remaining(c, now),
      dest: h.builder.stationById(c.destId)?.name ?? '?',
      ends: [...end(c.originId), ...end(c.destId)],
    }));
    return contractRows(facts, now, view);
  }

  private works(view: ViewRect | null): Listed<WorksRow> {
    const h = this.h;
    const stores = h.builder.stores;
    const facts: WorksFacts[] = [];
    for (const [key, b] of h.builder.buildings) {
      const def = BUILDING_DEFS.find((d) => d.id === b.id);
      // a bridge carries trains and makes nothing; a kind the content lost has nothing to show
      if (!def || def.bridge) continue;
      const store = stores.worksStore(b);
      const [out] = Object.entries(buildingRecipe(b).out);
      const span = buildingSpan(def, b.rot ?? 0);
      facts.push({
        key,
        name: def.name,
        level: buildingLevel(b),
        res: out?.[0] ?? null,
        perWeek: (out?.[1] ?? 0) * buildingRate(b) * rules.productionMul,
        status: BuildingPanel.statusKind(b, store),
        store: store ? stores.label(store) : null,
        at: this.corners(b.x, b.y, span.w, span.h),
      });
    }
    return worksRows(facts, view);
  }

  /** A frame: look at the world when it is time, and draw what changed. */
  update(dt: number, force = false) {
    this.since += dt;
    if (!force && this.since < REFRESH_S) return;
    this.since = 0;
    if (this.renaming || (!force && (this.held || this.opening))) return;
    const picked = this.h.selectedTrain()?.id ?? null;
    if (picked !== this.picked) {
      this.picked = picked;
      if (!this.opening) this.expanded = picked;
    }
    const view = this.scope === 'view' ? this.h.view() : null;
    const list = this.listed(view);
    const key = JSON.stringify([this.tab, this.scope, this.h.contracts.offers.length, list]);
    if (key === this.key) return;
    this.key = key;
    this.draw(list);
  }

  private listed(view: ViewRect | null) {
    switch (this.tab) {
      case 'trains':
        return this.trains(view);
      case 'stations':
        return this.stations(view);
      case 'contracts':
        return this.contractList(view);
      case 'works':
        return this.works(view);
    }
  }

  private draw(list: Listed<unknown>) {
    this.counts.textContent = countsLine(this.scope, list.shown, list.total);
    this.extra.replaceChildren();
    const rows = this.rows(list);
    this.body.replaceChildren(
      ...(rows.length ? rows : [el('p', { class: 'ol-empty', text: this.emptyText(list) })]),
    );
    if (this.tab === 'trains') {
      this.refuel.disabled = !list.shown;
      this.refuel.title =
        this.scope === 'all' ? STR.trainSide.refuelAllHint : STR.trainSide.refuelViewHint;
      this.extra.append(this.refuel);
    }
    const offers = this.h.contracts.offers.length;
    if (this.tab === 'contracts' && offers)
      this.extra.append(el('span', { class: 'amber', text: STR.contracts.offersBadge(offers) }));
  }

  private rows(list: Listed<unknown>): HTMLElement[] {
    switch (this.tab) {
      case 'trains':
        return (list.rows as TrainGroup[]).flatMap((g) => [
          this.groupHead(g),
          ...g.rows.map((r) => this.trainRow(r)),
        ]);
      case 'stations':
        return (list.rows as StationRow[]).map((r) => this.stationRow(r));
      case 'contracts':
        return (list.rows as ContractRow[]).map((r) => this.contractRow(r));
      case 'works':
        return (list.rows as WorksRow[]).map((r) => this.worksRow(r));
    }
  }

  private emptyText(list: Listed<unknown>) {
    const O = STR.outliner;
    if (list.total) return O.nothingInView;
    if (this.tab === 'contracts')
      return this.h.contracts.offers.length
        ? STR.contracts.sideEmptyOffers
        : STR.contracts.sideEmpty;
    return { trains: O.noTrains, stations: O.noStations, works: O.noWorks }[this.tab];
  }

  // ---------------------------------------------------------------- the parts of a row

  private icon(res: string, size = 14) {
    const i = spriteImg(this.h.atlas, `icons/${res}`, 1, 'sprite-preview res-icon');
    i.style.width = i.style.height = `${size}px`;
    i.title = cargoName(res);
    return i;
  }
  private goods(list: Amount[]) {
    return list.map((g) => el('span', { class: 'ol-cg' }, this.icon(g.res), String(g.amount)));
  }
  private chip(c: Chip) {
    return el('span', { class: `ol-chip sev-${c.sev}` }, buildIcon(c.icon, 12), c.text);
  }
  private bar(percent: number, cls = '') {
    return el('span', { class: `ol-meter ${cls}` }, el('i', { style: `width:${percent}%` }));
  }
  private shell(cls: string, ...parts: (Node | string | null)[]) {
    return el('div', { class: `ol-row ${cls}` }, ...parts);
  }

  private groupHead(g: TrainGroup) {
    return el(
      'div',
      { class: 'ol-grp' },
      el('i', { style: `background:${g.hex}` }),
      el('span', { text: g.title }),
      el('em', { text: String(g.rows.length) }),
    );
  }

  private trainRow(r: TrainRow) {
    const name = el('b', { class: 'ol-name', text: r.name, title: STR.outliner.renameTip });
    const stripe = ttLabel(el('i'), 'ol-stripe', `ol-stripe-${r.id}`, () => [
      ttDim(STR.outliner.stripeTip),
    ]);
    stripe.style.background = r.hex;
    stripe.addEventListener('click', (e) => {
      e.stopPropagation();
      this.recolour(r.id);
    });
    const cargo = this.goods(r.cargo);
    const route =
      r.to === null
        ? null
        : el('span', { class: 'ol-route', text: r.from ? `${r.from} → ${r.to}` : `→ ${r.to}` });
    const row = this.shell(
      `${r.detail ? 'exp' : ''} ${r.selected ? 'sel' : ''}`,
      stripe,
      el(
        'div',
        { class: 'ol-main' },
        el(
          'div',
          { class: 'ol-l1' },
          name,
          r.following ? buildIcon('eye', 13) : null,
          this.chip(r.chip),
        ),
        el(
          'div',
          { class: 'ol-l2' },
          ...(cargo.length ? cargo : [el('span', { text: r.work ?? STR.outliner.empty })]),
          route,
        ),
        r.detail ? this.trainDetail(r.detail) : null,
      ),
    );
    row.dataset.train = String(r.id);
    row.addEventListener('click', (e) => this.clickTrain(r.id, e, name));
    return row;
  }

  private trainDetail(d: NonNullable<TrainRow['detail']>) {
    const bars = el(
      'div',
      { class: 'ol-l3' },
      el('span', { text: STR.outliner.load }),
      this.bar(d.load),
    );
    for (const k of d.tanks)
      bars.append(
        el('span', {}, this.icon(k.res, 12), cargoName(k.res)),
        this.bar(k.share, k.low ? 'bad' : ''),
      );
    const next = el(
      'div',
      { class: 'ol-l4' },
      el(
        'span',
        {},
        buildIcon('clock', 12),
        `${STR.outliner.nextStop}: `,
        el('b', { text: d.next ?? '-' }),
        d.eta ? ` · ${d.eta}` : '',
      ),
      d.income ? el('span', { class: 'good', text: d.income }) : null,
    );
    return el('div', { class: 'ol-open' }, bars, next);
  }

  private stationRow(r: StationRow) {
    const row = this.shell(
      '',
      el('span', { class: 'ol-blank' }),
      el(
        'div',
        { class: 'ol-main' },
        el(
          'div',
          { class: 'ol-l1' },
          el('b', { class: 'ol-name', text: r.name }),
          el('span', { class: 'ol-lv', text: r.level }),
          r.chip ? this.chip(r.chip) : null,
        ),
        el(
          'div',
          { class: 'ol-l2' },
          ...this.goods(r.goods),
          el('span', { class: 'ol-route', text: STR.outliner.storage }),
          this.bar(r.fill, r.fill >= 100 ? 'bad' : ''),
        ),
      ),
    );
    row.addEventListener('click', () => {
      const s = this.h.builder.stationById(r.id);
      if (!s) return;
      sfx('ui.click');
      this.h.onStation(s);
    });
    return row;
  }

  private contractRow(r: ContractRow) {
    const row = this.shell(
      '',
      el('span', { class: 'ol-blank' }),
      el(
        'div',
        { class: 'ol-main' },
        el(
          'div',
          { class: 'ol-l1' },
          this.icon(r.res, 16),
          el('b', { class: 'ol-name', text: r.title }),
          contractRarityLabel(r.rarity),
          r.atRisk
            ? this.chip({ sev: 'attention', icon: 'alert', text: STR.outliner.atRisk })
            : null,
        ),
        el(
          'div',
          { class: 'ol-l2' },
          el('span', { text: r.progress }),
          this.bar(r.share, r.atRisk ? 'warn' : ''),
          el('span', { text: r.left }),
          el('span', { class: 'good', text: r.pay }),
        ),
      ),
    );
    row.title = STR.outliner.contractTip;
    row.addEventListener('click', () => {
      sfx('ui.click');
      this.h.onContract(r.id);
    });
    return row;
  }

  private worksRow(r: WorksRow) {
    const row = this.shell(
      '',
      el('span', { class: 'ol-blank' }),
      el(
        'div',
        { class: 'ol-main' },
        el(
          'div',
          { class: 'ol-l1' },
          r.res ? this.icon(r.res, 16) : null,
          el('b', { class: 'ol-name', text: r.name }),
          el('span', { class: 'ol-lv', text: r.level }),
          r.chip ? this.chip(r.chip) : null,
        ),
        el(
          'div',
          { class: 'ol-l2' },
          el('span', { class: 'good', text: r.rate }),
          r.store ? el('span', { class: 'ol-route', text: `→ ${r.store}` }) : null,
        ),
      ),
    );
    row.addEventListener('click', () => {
      const b = this.h.builder.buildings.get(r.key);
      if (!b) return;
      sfx('ui.click');
      this.h.onWorks(b);
    });
    return row;
  }

  // ---------------------------------------------------------------- what a train row does

  private clickTrain(id: number, e: MouseEvent, name: HTMLElement) {
    const t = this.h.fleet.byId(id);
    if (!t) return;
    const onName = name.contains(e.target as Node);
    const now = performance.now();
    if (onName && secondClick(this.lastName, id, now)) {
      this.lastName = null;
      window.clearTimeout(this.opening);
      this.opening = 0;
      this.rename(t, name);
      return;
    }
    this.lastName = onName ? { id, at: now } : null;
    sfx('ui.click');
    const next = this.expanded === id ? null : id;
    // the train already picked: the click is about its row, and leaves the camera to the player
    if (this.h.selectedTrain() !== t || !this.h.view()) this.h.onTrain(t);
    window.clearTimeout(this.opening);
    if (onName) {
      // the row opens a moment later: a row closing above would pull the name from under a second click
      this.opening = window.setTimeout(() => {
        this.opening = 0;
        this.expanded = next;
        this.update(0, true);
      }, DOUBLE_CLICK_MS);
    } else {
      this.opening = 0;
      this.expanded = next;
      this.update(0, true);
    }
  }

  private recolour(id: number) {
    const t = this.h.fleet.byId(id);
    if (!t) return;
    sfx('ui.click');
    // the row stays under the pointer for the next click: the list takes its order again when the
    // pointer leaves it
    this.heldColours ??= new Map(this.h.fleet.trains.map((x) => [x.id, x.colour]));
    const did = this.h.commands.recolourTrain(t, nextTrainColour(t.colour));
    if (!did.ok) this.h.toast(did.message, 'warn');
    this.update(0, true);
  }

  private rename(t: Train, name: HTMLElement) {
    this.renaming = true;
    renameField(name, t.name, TRAIN_NAME_MAX, (typed) => {
      this.renaming = false;
      if (typed !== null) {
        const did = this.h.commands.renameTrain(t, typed);
        if (!did.ok) this.h.toast(did.message, 'warn');
      }
      this.key = '';
      this.update(0, true);
    });
  }

  private refuelShown() {
    const ok = this.h.fleet.refuelAll(this.shown);
    this.h.toast(ok ? STR.trainSide.refuelled : STR.trainSide.refuelShort, ok ? 'good' : 'warn');
    this.update(0, true);
  }
}
