import { el, fmtMoney } from './dom';
import { STR } from '../strings';
import { noteText } from './noteText';
import type { Screen } from './modal';
import type { Inventory } from '../gacha/inventory';
import { Fleet, MAX_LOCOS, MAX_WAGONS } from '../sim/fleet';
import type { Builder } from '../sim/build';
import { itemDef, locoDef, wagonDef, levelMul } from '../gacha/items';
import {
  consistPhysics,
  defaultLocoMode,
  serviceLocoType,
  DYNAMIC_MODES,
  type RouteMode,
  type Train,
  type StopPlan,
} from '../sim/trains';
import type { Station } from '../sim/stations';
import { cargoDef } from '../sim/cargo';
import { TRAIN_COLOURS, shownTrainColour } from '../sim/trainColours';
import type { AtlasRegistry } from '../engine/atlas';
import { sfx } from '../engine/audio';
import { buildIcon } from './buildIcons';
import {
  actionButton,
  emptyState,
  labelValue,
  lineIcon,
  listDetail,
  listRow,
  meter,
  note,
  numberField,
  sectionHeader,
  segmented,
  tabStrip,
  textField,
  well,
  type FootSpec,
} from './kit';
import { trainLabels } from './labels';
import { ScheduleEditor } from './scheduleEditor';
import { Bindings, bindMeter, keepScroll } from './liveView';
import { DepotBar } from './depotBar';
import { consistStrip } from './depotStrip';
import { vehicleArt } from './economyParts';
import { copyTip, vehicleRow } from './vehicleRow';
import {
  checkLifetime,
  clickedCount,
  copiesLike,
  foldStock,
  gateShown,
  haulShare,
  haulTone,
  locoStats,
  movedPick,
  pruneToFree,
  refusalAt,
  setPicked,
  staleGate,
  stateText,
  stateTone,
  stockGroups,
  stockOrder,
  stopSummary,
  stripCars,
  trainRowText,
  trainsByDepot,
  trainsShown,
  wagonStats,
  type Car,
  type GateAnswer,
  type StockGroup,
  type TrainScope,
} from './depotView';
import { currentStopIndex } from './trainScreenView';
import { trainChip } from './trainView';
import type { Confirm } from './menu';

type RouteChoice = 'auto' | 'custom' | RouteMode;
type NewTab = 'consist' | 'route';

const TONES: readonly string[] = ['good', 'info', 'warn', 'bad'];

type StockKind = 'loco' | 'wagon';

/** One train in the list on the left: its row, and the part of it that follows the train. */
interface TrainRow {
  root: HTMLElement;
  update(): void;
}

/** A depot's head in the list of all trains. */
interface GroupHead {
  root: HTMLElement;
  count: HTMLElement;
}

/** What the dock and the footer say of the new train: the answer of `Fleet.dispatchCheck`. */
interface Check {
  /** why `create` would refuse it, null when it would roll out */
  reason: string | null;
  /** the dock's line: the gate it would take, or what stops it */
  dock: { text: string; ok: boolean };
  depot: Station | null;
  gate: { x: number; y: number } | null;
  /** the depot this consist's gauge finds, when it is not the one chosen */
  elsewhere: Station | null;
  /** the stations the automatic route would visit, in order */
  auto: string[];
  /** stations on the depot's rails */
  served: number;
  /** how long the answer stands, ms */
  lifetime: number;
}

/**
 * Depot: assemble trains from owned rolling stock and program their looped schedule. One order,
 * from the top: the depot, the consist, the route, the name and Dispatch.
 */
export class DepotScreen implements Screen {
  readonly id = 'depot';
  readonly title = STR.depot.title;
  readonly icon = 'train';
  private readonly split = listDetail(300);
  private readonly bar = new DepotBar({
    chosen: () => this.depotId,
    trains: (id) => [...this.homes.values()].filter((h) => h === id).length,
    gate: (id) => gateShown(this.gates.get(id)),
    pick: (id) => this.chooseDepot(id),
  });
  readonly root = el('div', { class: 'dp-screen' }, this.bar.root, this.split.root);
  // the list on the left
  private readonly newBtn = actionButton(STR.depot.newTrain, () => this.showDraft(), {
    icon: 'plus',
    cls: 'dp-new',
  });
  private readonly scopeBox = el('div', { class: 'dp-scope' });
  private readonly count = el('span');
  private readonly rowsBox = el('div', { class: 'dp-rows' });
  private readonly emptyBox = el('div');
  private readonly rows = new Map<Train, TrainRow>();
  private readonly heads = new Map<number | null, GroupHead>();
  /** the depot each train belongs to, read at each refresh */
  private readonly homes = new Map<Train, number | null>();
  /** the last answer about each depot's gates */
  private readonly gates = new Map<number, GateAnswer>();
  private scope: TrainScope = 'here';
  /** what the list's choice was drawn from, and what the empty list says */
  private scopeShown = '';
  private emptyShown = '';
  // the roll-out block under the new train: the gate it would take, the train's name
  private readonly dock = el('div', { class: 'dp-dock' });
  private readonly gateLine = el('span', { class: 'dp-gate' });
  private readonly servedLine = el('span', { class: 'k-note' });
  private readonly nameField = textField({
    placeholder: STR.depot.namePlaceholder,
    maxLength: 24,
    title: STR.depot.nameHint,
    // the name is the last thing a new train asks for
    onEnter: () => this.dispatch(),
  });
  /** a train of another gauge: one press takes the screen to the depot that can roll it out */
  private readonly useDepot = actionButton(
    '',
    () => {
      const d = this.check().elsewhere;
      if (d) this.chooseDepot(d.id);
    },
    { cls: 'small dp-use' },
  );
  /** what follows the picked train, or the new train's route */
  private readonly live = new Bindings();
  private readonly dockLive = new Bindings();
  private readonly scheduleEditor: ScheduleEditor;
  private detailSig = '';
  private shown = '';
  private locoUids: number[] = [];
  private wagonUids: number[] = [];
  private schedule: StopPlan[] = [];
  private editing: Train | null = null;
  private tab: NewTab = 'consist';
  private routeMode: RouteChoice = 'auto';
  /** what cannot roll out of this depot is unfolded */
  private showBarred = false;
  /** the depot chosen: the new train rolls out of it, and the list shows its trains */
  private depotId: number | null = null;
  private checkCache: { key: string; at: number; value: Check } | null = null;
  onFocusTrain: ((t: Train) => void) | null = null;
  /** the player picked a depot: the game peeks at it and marks the gate */
  onFocusDepot: ((d: Station, gate: { x: number; y: number } | null) => void) | null = null;
  onDetails: ((t: Train) => void) | null = null;
  /** the Roster over this screen, on a copy */
  onRoster: ((uid: number) => void) | null = null;
  /** the seconds a train has stood stuck; null if it has not */
  stuckFor: ((id: number) => number | null) | null = null;
  /** the footer's actions changed: the frame draws it now, not at the next refresh */
  onRedraw: (() => void) | null = null;

  constructor(
    private readonly inventory: Inventory,
    private readonly fleet: Fleet,
    private readonly builder: Builder,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private readonly atlas: AtlasRegistry,
    /** the game's dialog: a recall is asked first */
    private readonly prompt: Confirm,
  ) {
    this.scheduleEditor = new ScheduleEditor(builder, () => this.stopsEdited());
    this.split.list.head.append(this.newBtn, this.scopeBox);
    this.split.list.body.append(
      well({ title: STR.depot.trains, right: this.count }, this.rowsBox, this.emptyBox),
    );
    this.dock.append(
      el('div', { class: 'dp-rl dp-rl-g' }, this.gateLine, this.servedLine, this.useDepot),
      el(
        'div',
        { class: 'dp-rl dp-rl-n' },
        actionButton(STR.depot.show, () => this.showDepot(), {
          cls: 'small',
          icon: 'eye',
          title: STR.depot.showHint,
        }),
        this.nameField.root,
      ),
    );
    // the dock stands under the detail pane's scroll
    this.split.root.lastElementChild?.append(this.dock);
    this.dockLive.text(this.gateLine, () => this.check().dock.text);
    // a long refusal is clipped in the dock: the whole of it is the line's title
    this.dockLive.add(() => {
      const t = this.check().dock.text;
      if (this.gateLine.title !== t) this.gateLine.title = t;
    });
    this.dockLive.tone(this.gateLine, ['ok', 'bad'], () => (this.check().dock.ok ? 'ok' : 'bad'));
    this.dockLive.text(this.servedLine, () => {
      const c = this.check();
      return c.depot ? `· ${STR.depot.servedBy(c.served)}` : '';
    });
    this.dockLive.add(() => {
      const d = this.check().elsewhere;
      this.useDepot.hidden = !d;
      const label = d ? STR.depot.useDepot(d.name) : '';
      if (this.useDepot.textContent !== label) this.useDepot.textContent = label;
    });
    keepScroll(this.root);
  }

  /**
   * Open on this depot: its trains in the list, a new train rolling out of it. The caller puts the
   * screen up; the draft stands as it was left.
   */
  openOnDepot(id: number) {
    this.depotId = id;
    this.scope = 'here';
    this.showBarred = false;
    this.editing = null;
    this.checkCache = null;
    if (this.root.isConnected) this.render();
  }

  /** Open on a train: its depot, its row, its detail. The caller puts the screen up. */
  showTrain(t: Train) {
    this.depotId = this.fleet.homeDepot(t)?.id ?? this.depotId;
    this.scope = 'here';
    this.editing = t;
    this.checkCache = null;
    if (this.root.isConnected) this.render();
  }

  onOpen() {
    this.gates.clear();
    this.checkCache = null;
    this.render();
  }
  refresh() {
    // covered by another screen, nothing here is looked at; it is read again as it comes back
    if (!this.root.isConnected) return;
    // a train recalled elsewhere leaves the screen with it
    if (this.editing && !this.fleet.trains.includes(this.editing)) this.showDraft();
    this.syncList();
    if (this.detailSignature() !== this.detailSig) this.renderDetail();
    else {
      this.live.run();
      if (!this.editing && this.tab === 'route' && this.routeMode === 'custom')
        this.scheduleEditor.sync(this.schedule);
    }
    if (!this.editing) this.dockLive.run();
  }

  frameFooter(): FootSpec {
    const t = this.editing;
    if (t)
      return {
        actions: [
          {
            label: STR.depot.locate,
            icon: 'eye',
            title: STR.depot.locateHint,
            onClick: () => this.onFocusTrain?.(t),
          },
          {
            label: STR.depot.recall,
            icon: 'undo',
            danger: true,
            title: STR.depot.recallHint,
            onClick: () => void this.recall(t),
          },
          {
            label: STR.depot.again,
            icon: 'copy',
            title: STR.depot.againHint,
            onClick: () => this.buildLike(t),
          },
          {
            label: STR.depot.details,
            primary: true,
            title: STR.depot.detailsHint,
            onClick: () => this.onDetails?.(t),
          },
        ],
      };
    const c = this.check();
    const why = c.reason;
    return {
      actions: [
        {
          label: STR.depot.dispatch,
          icon: 'play',
          primary: true,
          disabled: !!why,
          title: why ?? undefined,
          onClick: () => this.dispatch(),
        },
      ],
      // what the dock already says is not said twice
      note: why && why !== c.dock.text ? why : undefined,
    };
  }

  // ---------------------------------------------------------------- the actions

  /** New train: the train picked is let go, and the draft stands as it was left. */
  private showDraft() {
    this.editing = null;
    this.render();
  }

  /** A train gone out: the draft is cleared, to be made again. */
  private startNew() {
    this.editing = null;
    this.locoUids = [];
    this.wagonUids = [];
    this.schedule = [];
    this.routeMode = 'auto';
    this.tab = 'consist';
    this.nameField.input.value = '';
    this.checkCache = null;
    this.render();
  }

  private pick(t: Train) {
    this.editing = t;
    this.render();
  }

  /** A new train like this one: its models from the free stock, its route, its depot. */
  private buildLike(t: Train) {
    const copies = (vehicles: readonly { def: { id: string }; level: number }[], k: StockKind) =>
      copiesLike(
        vehicles.map((v) => ({ defId: v.def.id, level: v.level })),
        this.inventory.free(k),
      );
    const locos = copies(t.locos, 'loco');
    const wagons = copies(t.wagons, 'wagon');
    this.locoUids = locos.uids;
    this.wagonUids = wagons.uids;
    this.routeMode = t.mode === 'schedule' ? 'custom' : t.mode;
    this.schedule = t.mode === 'schedule' ? t.program.map((s) => ({ ...s })) : [];
    this.tab = 'consist';
    this.nameField.input.value = '';
    this.depotId = this.homes.get(t) ?? this.depotId;
    this.editing = null;
    this.checkCache = null;
    const short = locos.missing + wagons.missing;
    if (short) this.toast(STR.depot.notFree(short), 'warn');
    this.render();
  }

  private async recall(t: Train) {
    const ok = await this.prompt.confirm(STR.depot.recallTitle, STR.depot.confirmRecall(t.name), {
      yes: STR.depot.recall,
      no: STR.prompt.keep,
      danger: true,
      detail: STR.depot.recallDetail(Math.round(t.totalCargo())),
    });
    // the train may have gone while the question stood
    if (!ok || !this.fleet.trains.includes(t)) return;
    const salvage = this.fleet.recall(t);
    if (salvage > 0) this.toast(STR.depot.salvaged(fmtMoney(salvage)), 'info');
    if (this.editing === t) this.editing = null;
    this.render();
  }

  private dispatch() {
    if (this.check().reason) return;
    const res = this.fleet.create(
      this.locoUids,
      this.wagonUids,
      this.routeMode === 'custom' ? this.schedule : [],
      this.nameField.input.value.trim() || undefined,
      this.routeMode === 'auto' || this.routeMode === 'custom' ? 'schedule' : this.routeMode,
      this.depotId,
    );
    // the check can stand a moment behind the track: create has the last word
    if (typeof res === 'string') {
      this.toast(res, 'warn');
      this.checkCache = null;
      this.onRedraw?.();
    } else {
      this.toast(STR.depot.dispatched(res.name), 'good');
      this.startNew();
    }
  }

  /** Track around the depots changed: re-check what can roll out. */
  onTrackChanged() {
    if (!this.root.isConnected) return;
    this.checkCache = null;
    this.gates.clear();
    this.render();
  }

  /** The player chose a depot: everything below follows it. */
  private chooseDepot(id: number) {
    if (id !== this.depotId) {
      this.depotId = id;
      this.checkCache = null;
      this.scope = 'here';
      this.showBarred = false;
      // a train of another depot leaves the detail; the draft stays
      if (this.editing && this.homes.get(this.editing) !== id) this.editing = null;
      this.render();
    }
    this.showDepot();
  }

  /** Look at the depot behind the screen and mark the gate the train would take. */
  private showDepot() {
    const c = this.check();
    if (c.depot) this.onFocusDepot?.(c.depot, c.gate);
  }

  /** The stop editor changed the new train's stops. */
  private stopsEdited() {
    this.checkCache = null;
    this.drawHead();
    this.onRedraw?.();
  }

  // ---------------------------------------------------------------- the list of trains

  private render() {
    this.syncList();
    this.renderDetail();
    this.onRedraw?.();
  }

  /** The bar and the list follow the depots and the fleet. */
  private syncList() {
    const depots = this.builder.depots();
    if (this.depotId === null || !depots.some((d) => d.id === this.depotId)) {
      this.depotId = depots[0]?.id ?? null;
      this.checkCache = null;
    }
    this.homes.clear();
    for (const t of this.fleet.trains) this.homes.set(t, this.fleet.homeDepot(t)?.id ?? null);
    this.askGates(depots);
    this.bar.sync(depots.map((d) => ({ id: d.id, name: d.name, gauge: d.def.gauge ?? 'regular' })));
    this.syncTrains(depots);
  }

  /** Each depot's gates: a new depot at once, the others one at a time as their answer runs out. */
  private askGates(depots: readonly Station[]) {
    const ask = (d: Station, now: number) => {
      const r = this.fleet.previewSpawn([], [], d.id);
      this.gates.set(d.id, {
        at: now,
        lifetime: checkLifetime(r.depot !== null && r.gate === null),
        reason: r.reason,
      });
    };
    const now = performance.now();
    for (const d of depots) if (!this.gates.has(d.id)) ask(d, now);
    const next = staleGate(
      depots.map((d) => d.id),
      this.gates,
      now,
    );
    const stale = depots.find((d) => d.id === next);
    if (stale) ask(stale, now);
  }

  /** The rows follow the fleet: new trains get a row, gone ones lose theirs, the rest only update. */
  private syncTrains(depots: readonly Station[]) {
    const trains = this.fleet.trains;
    for (const [t, r] of this.rows)
      if (!trains.includes(t)) {
        r.root.remove();
        this.rows.delete(t);
      }
    const all = trains.map((train) => ({ train, home: this.homes.get(train) ?? null }));
    const shown = trainsShown(all, this.scope, this.depotId);
    const here = trainsShown(all, 'here', this.depotId).length;
    const wanted: HTMLElement[] = [];
    const row = (t: Train) => {
      let r = this.rows.get(t);
      if (!r) {
        r = this.makeRow(t);
        this.rows.set(t, r);
      }
      r.update();
      wanted.push(r.root);
    };
    if (this.scope === 'all' && depots.length > 1)
      for (const g of trainsByDepot(shown, depots)) {
        wanted.push(this.groupHead(g.depotId, g.title, g.trains.length));
        g.trains.forEach((x) => row(x.train));
      }
    else shown.forEach((x) => row(x.train));
    wanted.forEach((e, i) => {
      if (this.rowsBox.children[i] !== e)
        this.rowsBox.insertBefore(e, this.rowsBox.children[i] ?? null);
    });
    while (this.rowsBox.children.length > wanted.length) this.rowsBox.lastElementChild?.remove();
    const n = String(shown.length);
    if (this.count.textContent !== n) this.count.textContent = n;
    const empty = shown.length ? '' : trains.length ? STR.depot.noTrainsHere : STR.depot.noTrains;
    if (empty !== this.emptyShown) {
      this.emptyShown = empty;
      this.emptyBox.replaceChildren(...(empty ? [emptyState({ icon: 'train', text: empty })] : []));
    }
    this.drawScope(depots.length, here, trains.length);
    this.newBtn.classList.toggle('open', !this.editing);
  }

  /** This depot or All; with one depot they are the same list, and there is nothing to choose. */
  private drawScope(depots: number, here: number, all: number) {
    const key = JSON.stringify([depots > 1, here, all, this.scope]);
    if (key === this.scopeShown) return;
    this.scopeShown = key;
    this.scopeBox.replaceChildren(
      ...(depots > 1
        ? [
            segmented({
              options: [
                { id: 'here', label: STR.depot.scopeHere(here) },
                { id: 'all', label: STR.depot.scopeAll(all) },
              ],
              value: this.scope,
              cls: 'small wide',
              onChange: (id) => {
                this.scope = id === 'all' ? 'all' : 'here';
                this.render();
              },
            }),
          ]
        : []),
    );
  }

  private groupHead(id: number | null, title: string, n: number): HTMLElement {
    let h = this.heads.get(id);
    if (!h) {
      const count = el('em');
      h = { root: el('div', { class: 'ol-grp' }, el('span', { text: title }), count), count };
      this.heads.set(id, h);
    }
    h.root.firstElementChild?.replaceChildren(title);
    h.count.textContent = String(n);
    return h.root;
  }

  /** A train as a compact row: a list of fifty stays one to read, the outliner's colour and state. */
  private makeRow(t: Train): TrainRow {
    const stripe = el('i', { class: 'dp-stripe' });
    const name = el('span', { class: 'dp-tn' });
    const chip = el('span');
    const consist = el('span');
    const root = listRow({
      title: el('span', { class: 'dp-tl' }, name, chip),
      sprite: vehicleArt(this.atlas, t.locos[0]?.def.id ?? ''),
      sub: [consist],
      onClick: () => this.pick(t),
      cls: 'dp-li dp-pick dp-train',
    });
    root.prepend(stripe);
    const set = (e: HTMLElement, s: string) => {
      if (e.textContent !== s) e.textContent = s;
    };
    let chipShown = '';
    const update = () => {
      const next = this.builder.stationById(t.route[t.routeIndex % Math.max(1, t.route.length)]);
      const x = trainRowText({
        locoNames: t.locos.map((l) => l.def.name),
        wagonCount: t.wagons.length,
        mode: t.mode,
        routeNames: t.route.map((id) => this.builder.stationById(id)?.name ?? '?'),
        state: t.state,
        blocked: t.blocked,
        next: next?.name ?? null,
        cargoUnits: t.totalCargo(),
        weight: t.weight,
        power: t.power,
        message: noteText(t.lastMessage),
      });
      set(name, t.name);
      set(consist, x.consist);
      // what the row has no room for stands in its title
      const more = [x.consist, x.status, x.load, x.aboard].join('\n');
      if (root.title !== more) root.title = more;
      const c = trainChip(t, this.stuckFor?.(t.id) ?? null);
      const key = `${c.sev} ${c.icon} ${c.text}`;
      if (key !== chipShown) {
        chipShown = key;
        chip.className = `ol-chip sev-${c.sev}`;
        chip.replaceChildren(buildIcon(c.icon, 12), c.text);
      }
      const colour = TRAIN_COLOURS[shownTrainColour(t.colour)];
      if (stripe.dataset.colour !== colour) {
        stripe.dataset.colour = colour;
        stripe.style.background = colour;
      }
      root.classList.toggle('on', this.editing === t);
    };
    return { root, update };
  }

  // ---------------------------------------------------------------- the detail

  /** What the detail was drawn from: when it changes, it is drawn again. */
  private detailSignature(): string {
    const t = this.editing;
    if (t)
      return JSON.stringify([
        t.id,
        t.mode,
        t.locos.map((l) => [l.def.id, l.level, l.mode]),
        t.wagons.map((w) => [w.def.id, w.level, t.cartMatched(w)]),
        t.program.map((s) => [
          s.stationId,
          s.load,
          s.unload,
          s.depart,
          s.waitFull,
          s.refuel,
          s.pass,
          s.minDwell ?? 0,
          s.maxDwell ?? 0,
        ]),
      ]);
    return JSON.stringify([
      this.inventory.free('loco').map((i) => [i.uid, i.level, !!i.inCab]),
      this.inventory.free('wagon').map((i) => [i.uid, i.level]),
      this.builder.depots().map((d) => d.id),
      this.depotId,
    ]);
  }

  private renderDetail() {
    this.pruneDraft();
    const key = this.editing ? `t${this.editing.id}` : `new:${this.tab}`;
    const d = this.split.detail;
    this.live.clear();
    this.detailSig = this.detailSignature();
    if (this.editing) this.drawPicked(this.editing);
    else this.drawNew();
    this.dock.hidden = !!this.editing;
    if (!this.editing) this.dockLive.run();
    // another train or another tab starts at the top; a pick in the same list keeps its place
    if (key !== this.shown) d.body.scrollTop = 0;
    this.shown = key;
  }

  /** The picks that left the free stock go from the draft: the counts and the rows show it. */
  private pruneDraft() {
    const free = (k: 'loco' | 'wagon') => this.inventory.free(k).map((i) => i.uid);
    this.locoUids = pruneToFree(this.locoUids, free('loco'));
    this.wagonUids = pruneToFree(this.wagonUids, free('wagon'));
  }

  /** The head of a new train: the consist as a train, then the tabs. */
  private drawHead() {
    const d = this.split.detail;
    const picked = this.locoUids.length + this.wagonUids.length;
    const tabs = tabStrip(
      [
        { id: 'consist', label: STR.depot.consist, count: picked },
        {
          id: 'route',
          label: `${STR.depot.routeTab}: ${STR.depot.routeMode[this.routeMode]}`,
          count: this.routeMode === 'custom' ? this.schedule.length : null,
        },
      ],
      this.tab,
      (id) => {
        this.tab = id as NewTab;
        this.render();
      },
    );
    d.head.replaceChildren(this.summaryWell(), tabs);
  }

  /** A train of the stock's copies, in the order it runs; a copy that has gone is left out. */
  private cars(locos: readonly number[], wagons: readonly number[]): Car[] {
    return stripCars(locos, wagons, (u) => this.inventory.byUid(u));
  }

  /** The strip of the new train, and its engines' haul against the wagons' weight. */
  private summaryWell(): HTMLElement {
    const depot = this.chosen();
    const cars = this.cars(this.locoUids, this.wagonUids).map((c) => ({
      ...c,
      bad: !!depot && this.fleet.modelDeployReason(itemDef(c.defId), depot) !== null,
    }));
    const strip = cars.length
      ? consistStrip(this.atlas, cars, (c) => copyTip(this.fleet, c.uid), {
          remove: (c) => this.takeOff(c),
          move: (c, to) => this.moveCar(c, to),
          clear: () => this.clearConsist(),
        })
      : null;
    if (!this.locoUids.length) return well({ cls: 'dp-sum' }, strip, note(STR.depot.pickLoco));
    const s = this.newPhysics();
    return well(
      { cls: 'dp-sum' },
      strip,
      meter(
        STR.depot.haul(Math.round(s.weight), Math.round(s.haul)),
        STR.train.weightPower(Math.round(s.weight), Math.round(s.haul)),
        haulShare(s.weight, s.haul),
        haulTone(s.weight, s.haul),
      ),
      el('p', {
        class: 'dp-phys',
        text: STR.depot.physics(Math.round(s.effort), Math.round(s.mass), s.acceleration, s.vMax),
      }),
    );
  }

  /** A click on the strip: the vehicle goes back to the stock. */
  private takeOff(c: Car) {
    if (c.loco) this.locoUids = this.locoUids.filter((u) => u !== c.uid);
    else this.wagonUids = this.wagonUids.filter((u) => u !== c.uid);
    this.checkCache = null;
    this.render();
  }

  /** The strip's Clear: the draft starts again, its route and name kept. */
  private clearConsist() {
    this.locoUids = [];
    this.wagonUids = [];
    this.checkCache = null;
    this.render();
  }

  /** A drag or an arrow key on the strip: the train runs in this order. */
  private moveCar(c: Car, to: number) {
    if (c.loco) this.locoUids = movedPick(this.locoUids, c.uid, to);
    else this.wagonUids = movedPick(this.wagonUids, c.uid, to);
    this.checkCache = null;
    this.render();
    // the arrow keys go on working on the vehicle they moved
    this.split.detail.head.querySelector<HTMLElement>(`[data-uid="${c.uid}"]`)?.focus();
  }

  /** The physics of the consist as picked, and the weight of its wagons before any cargo. */
  private newPhysics() {
    const slots = this.locoUids.flatMap((u) => {
      const it = this.inventory.byUid(u);
      return it ? [{ def: locoDef(it.defId), level: it.level }] : [];
    });
    const wagons = this.wagonUids.flatMap((u) => {
      const it = this.inventory.byUid(u);
      return it ? [{ def: wagonDef(it.defId), level: it.level, cargo: null, amount: 0 }] : [];
    });
    const ph = consistPhysics(
      slots.map((l, i) => ({
        ...l,
        mode: defaultLocoMode(i, l.def, slots[0].def),
        engaged: true,
      })),
      wagons,
    );
    return { ...ph, weight: wagons.reduce((a, w) => a + w.def.weight, 0) };
  }

  // ---- a train in service: its consist as it is, and its route to read

  private drawPicked(t: Train) {
    const d = this.split.detail;
    const stateEl = el('span', { class: 'dp-st' });
    const haul = meter(STR.train.haul, '', 0);
    const phys = el('p', { class: 'dp-phys' });
    this.live.text(stateEl, () => stateText(t.state, t.blocked));
    this.live.tone(stateEl, TONES, () => stateTone(t.state, t.blocked));
    bindMeter(this.live, haul, () => ({
      value: STR.train.weightPower(Math.round(t.weight), Math.round(t.power)),
      share: haulShare(t.weight, t.power),
      tone: haulTone(t.weight, t.power),
    }));
    this.live.text(phys, () => {
      const p = t.physics;
      return STR.depot.physics(Math.round(p.effort), Math.round(p.mass), p.acceleration, p.vMax);
    });
    const labels = trainLabels(t.trainClass);
    d.head.replaceChildren(
      well(
        { cls: 'dp-sum' },
        sectionHeader(t.name, el('span', { class: 'dp-pickt' }, labels, stateEl)),
        consistStrip(
          this.atlas,
          this.cars(
            t.locos.map((l) => l.uid),
            t.wagons.map((w) => w.uid),
          ),
          (c) => copyTip(this.fleet, c.uid),
        ),
        haul,
        phys,
      ),
    );
    const rows: HTMLElement[] = [];
    for (const l of t.locos) {
      const sub = el('span');
      this.live.text(sub, () => {
        const m = levelMul(l.level);
        return `${STR.depot.speed} ${(l.def.speed * m).toFixed(1)} · ${STR.depot.power} ${Math.round(l.def.power * m)} t · ${STR.modes[l.mode]}`;
      });
      rows.push(
        vehicleRow(this.atlas, {
          def: l.def,
          level: l.level,
          sub: [sub],
          inline: true,
          card: copyTip(this.fleet, l.uid),
          right: [this.rosterButton(l.uid)],
        }),
      );
    }
    for (const w of t.wagons) {
      const sub = el('span');
      this.live.text(sub, () => {
        if (w.def.service) return wagonStats(w.def, levelMul(w.level));
        const cap = Math.round(w.def.capacity * levelMul(w.level));
        return w.cargo
          ? `${cargoDef(w.cargo).name} ${Math.round(w.amount)}/${cap}`
          : `${STR.depot.empty} ${cap}`;
      });
      rows.push(
        vehicleRow(this.atlas, {
          def: w.def,
          level: w.level,
          sub: [sub],
          inline: true,
          card: copyTip(this.fleet, w.uid),
          right: [this.rosterButton(w.uid)],
          warn:
            w.def.service && !t.cartMatched(w)
              ? STR.depot.deadWeight(STR.roster.type[serviceLocoType(w.def.service)])
              : null,
        }),
      );
    }
    const stops = t.program;
    d.body.replaceChildren(
      well(
        { title: STR.depot.consist, right: `${t.locos.length} + ${t.wagons.length}` },
        note(STR.depot.inService(t.name)),
        ...rows,
      ),
      well(
        { title: STR.depot.route, right: `${stops.length} ${STR.depot.stops.toLowerCase()}` },
        labelValue(STR.train.routing, STR.train.mode[t.mode] ?? t.mode),
        note(STR.train.modeHint[t.mode] ?? ''),
        note(STR.depot.scheduleHint),
        t.mode === 'schedule' ? this.stopsRead(t) : note(STR.depot.dynamicPlans),
      ),
    );
  }

  /**
   * A stop list to read: number, station and what the train does there. The stop it heads for is
   * marked, and the mark follows the train without the list being drawn again.
   */
  private stopsRead(t: Train): HTMLElement {
    const current = () =>
      currentStopIndex(t.program === t.schedule, t.routeIndex, t.schedule.length);
    return el(
      'div',
      { class: 'dp-stops' },
      ...t.program.map((s, i) => {
        const st = this.builder.stationById(s.stationId);
        const sum = stopSummary(s).join(' · ') || STR.depot.stopSum.plain;
        const mark = el('em', { class: 'dp-cur', text: `▸ ${STR.depot.next}` });
        const block = el(
          'div',
          { class: 'dp-stop ro' },
          el(
            'div',
            { class: 'dp-sh' },
            el('b', { class: 'dp-si', text: String(i + 1) }),
            el('span', { class: 'dp-sn', text: st?.name ?? '?' }, mark),
            el('small', { class: 'dp-ss', text: sum, title: sum }),
          ),
        );
        this.live.toggle(block, 'on', () => current() === i);
        this.live.add(() => (mark.hidden = current() !== i));
        return block;
      }),
    );
  }

  // ---- a new train: pick its consist from the free stock, set its route

  private drawNew() {
    this.drawHead();
    this.split.detail.body.replaceChildren(
      ...(this.tab === 'route' ? this.routeWells() : this.consistWells()),
    );
  }

  private consistWells(): HTMLElement[] {
    return [this.stockWell('loco'), this.stockWell('wagon')];
  }

  /** The depot chosen, while it stands. */
  private chosen(): Station | null {
    return this.builder.depots().find((d) => d.id === this.depotId) ?? null;
  }

  /** The free stock of a kind, a row per model: what cannot roll out of this depot stands last. */
  private stockWell(kind: StockKind): HTMLElement {
    const loco = kind === 'loco';
    const picks = loco ? this.locoUids : this.wagonUids;
    const free = this.inventory.free(kind);
    const depot = this.chosen();
    const barred = (g: StockGroup) =>
      depot ? this.fleet.modelDeployReason(itemDef(g.defId), depot) : null;
    const groups = stockOrder(stockGroups(free, picks), (g) => ({
      name: itemDef(g.defId).name,
      barred: barred(g) !== null,
    }));
    const fold = foldStock(
      groups.map((g) => ({ g, reason: barred(g) })),
      this.showBarred,
    );
    const rows = fold.shown.map((l) => this.stockRow(kind, l.g, l.reason));
    if (fold.folded) rows.push(this.foldRow(fold.folded, fold.reason));
    return well(
      {
        title: `${loco ? STR.depot.locomotive : STR.depot.wagons} (${picks.length}/${loco ? MAX_LOCOS : MAX_WAGONS})`,
        right: String(free.length),
        cls: 'dp-stockw',
      },
      ...(rows.length
        ? rows
        : [emptyState({ text: loco ? STR.depot.noFreeLoco : STR.depot.noFreeWagons })]),
    );
  }

  /** The line what cannot roll out of this depot folds under. */
  private foldRow(n: number, reason: string | null): HTMLElement {
    const open = this.showBarred;
    const row = el(
      'button',
      { type: 'button', class: `dp-fold ${open ? 'on' : ''}`.trim() },
      lineIcon('chevl'),
      el('span', { text: open ? STR.depot.barredHide : STR.depot.barredFold(n) }),
      reason && !open ? el('small', { class: 'k-bad', title: reason, text: reason }) : null,
    );
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx('ui.click');
      this.showBarred = !open;
      this.renderDetail();
    });
    return row;
  }

  /** The types of the engines picked: a refuelling cart serves those. */
  private pickedTypes(): Set<string> {
    return new Set(
      this.locoUids.flatMap((u) => {
        const it = this.inventory.byUid(u);
        return it ? [locoDef(it.defId).type] : [];
      }),
    );
  }

  /** One model at one level: how many are free, how many are in the train. */
  private stockRow(kind: StockKind, g: StockGroup, reason: string | null): HTMLElement {
    const def = itemDef(g.defId);
    const mul = levelMul(g.level);
    const stats =
      kind === 'loco' ? locoStats(locoDef(g.defId), mul) : wagonStats(wagonDef(g.defId), mul);
    const line = g.inCab ? `${stats} · ${STR.roster.hasInCab}` : stats;
    const cart = kind === 'wagon' ? wagonDef(g.defId).service : undefined;
    const counts = el(
      'span',
      { class: 'dp-stock' },
      el('small', { text: STR.depot.freeCount(g.uids.length) }),
      numberField({
        label: def.name,
        value: g.picked,
        min: 0,
        max: g.uids.length,
        step: 1,
        cls: 'small',
        onChange: (v) => this.setCount(kind, g, v),
      }),
      this.rosterButton(g.uids[0]),
    );
    // what is pressed here is not a click on the row
    counts.addEventListener('click', (e) => e.stopPropagation());
    return vehicleRow(this.atlas, {
      def,
      level: g.level,
      inline: true,
      sub: [el('span', { title: line, text: line })],
      // a barred model still shows why; picking it is allowed so the roll-out box can explain
      reason,
      // a refuelling cart without an engine of its type aboard only adds mass
      warn:
        cart && !this.pickedTypes().has(serviceLocoType(cart))
          ? STR.depot.deadWeight(STR.roster.type[serviceLocoType(cart)])
          : null,
      on: g.picked > 0,
      onClick: () => this.setCount(kind, g, clickedCount(g)),
      card: copyTip(this.fleet, g.uids[0]),
      right: [counts],
    });
  }

  /** The Roster over this screen, on a copy: Back returns here as it was left. */
  private rosterButton(uid: number): HTMLElement {
    return actionButton(STR.depot.toRoster, () => this.onRoster?.(uid), {
      cls: 'small',
      icon: 'list',
      title: STR.depot.toRosterHint,
    });
  }

  /** The stepper of a row, or a click on it: this many copies of the model in the train. */
  private setCount(kind: StockKind, g: StockGroup, want: number) {
    const loco = kind === 'loco';
    const max = loco ? MAX_LOCOS : MAX_WAGONS;
    const r = setPicked(loco ? this.locoUids : this.wagonUids, g.uids, want, max);
    if (loco) this.locoUids = r.list;
    else this.wagonUids = r.list;
    if (r.full)
      this.toast(loco ? STR.fleet.tooManyLocos(max) : STR.fleet.tooManyWagons(max), 'warn');
    // the engines' gauge decides whether the train can go from this depot
    this.checkCache = null;
    this.render();
  }

  private routeWells(): HTMLElement[] {
    const staticMode = this.routeMode === 'auto' || this.routeMode === 'custom';
    const choose = (id: string) => {
      this.routeMode = id as RouteChoice;
      this.checkCache = null;
      this.render();
    };
    const modes = el(
      'div',
      { class: 'k-inrow dp-modes' },
      el('small', { text: STR.depot.groupStatic }),
      segmented({
        options: (['auto', 'custom'] as const).map((m) => ({
          id: m,
          label: STR.depot.routeMode[m],
        })),
        value: staticMode ? this.routeMode : '',
        onChange: choose,
      }),
      el('small', { text: STR.depot.groupDynamic }),
      segmented({
        options: DYNAMIC_MODES.map((m) => ({ id: m, label: STR.depot.routeMode[m] })),
        value: staticMode ? '' : this.routeMode,
        onChange: choose,
      }),
    );
    const content: HTMLElement[] = [modes, note(STR.depot.routeHint[this.routeMode])];
    // only a custom route has a stop list to edit; a dynamic mode has nothing more to set up
    if (this.routeMode === 'auto') {
      const row = labelValue(STR.depot.stops, '');
      this.live.text(row.lastElementChild as HTMLElement, () => {
        const names = this.check().auto;
        return names.length ? names.join(' > ') : STR.depot.noStations;
      });
      content.push(row);
    } else if (this.routeMode === 'custom') {
      this.scheduleEditor.render(this.schedule);
      content.push(this.scheduleEditor.root);
    }
    return [
      well(
        { title: STR.depot.route, right: staticMode ? undefined : STR.depot.dynamicTag },
        ...content,
      ),
    ];
  }

  // ---- the roll-out block

  /**
   * Whether the new train would roll out, and where: `Fleet.dispatchCheck`, the question `create`
   * itself asks, so the screen never allows what `create` refuses, and `refusalAt` holds a train
   * of another gauge at the depot chosen. It walks the track, so the
   * answer stands for a while (`checkLifetime`) and is asked again at once when the consist, the
   * route or the depot changes.
   */
  private check(): Check {
    const stops = this.routeMode === 'custom' ? this.schedule : [];
    const key = JSON.stringify([this.locoUids, this.wagonUids, stops, this.depotId]);
    const now = performance.now();
    const c = this.checkCache;
    if (c && c.key === key && now - c.at < c.value.lifetime) return c.value;
    const asked = this.fleet.dispatchCheck(this.locoUids, this.wagonUids, stops, this.depotId);
    // with no engine yet nothing can be checked, but the dock still says where a train would appear
    const seen = this.locoUids.length ? asked : this.fleet.previewSpawn([], stops, this.depotId);
    const chosen = this.chosen();
    const depot = chosen ?? seen.depot ?? null;
    const auto = this.fleet.autoSchedule(depot ?? undefined);
    const first = this.builder.stationById(seen.stops[0]?.stationId);
    const refused = refusalAt(seen, chosen);
    const elsewhere = seen.depot && chosen && seen.depot.id !== chosen.id ? seen.depot : null;
    const dock =
      seen.gate && seen.depot && !refused
        ? {
            text: STR.depot.gateAt(seen.depot.name, seen.gate.x, seen.gate.y, first?.name ?? '?'),
            ok: true,
          }
        : { text: refused ?? '', ok: false };
    const value: Check = {
      reason: refusalAt(asked, chosen),
      dock,
      depot,
      gate: seen.gate,
      elsewhere,
      auto: auto.map((s) => this.builder.stationById(s.stationId)?.name ?? '?'),
      served: auto.length,
      lifetime: checkLifetime(depot !== null && seen.gate === null),
    };
    this.checkCache = { key, at: now, value };
    return value;
  }
}
