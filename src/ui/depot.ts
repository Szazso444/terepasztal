import { el, fmtMoney } from './dom';
import { STR } from '../strings';
import type { Screen } from './modal';
import type { Inventory } from '../gacha/inventory';
import { Fleet, MAX_LOCOS, MAX_WAGONS } from '../sim/fleet';
import type { Builder } from '../sim/build';
import { locoDef, wagonDef, levelMul } from '../gacha/items';
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
import { consistGauge } from '../sim/compat';
import { cargoDef } from '../sim/cargo';
import type { AtlasRegistry } from '../engine/atlas';
import {
  actionButton,
  emptyState,
  labelValue,
  listDetail,
  listRow,
  meter,
  note,
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
import { vehicleRow, vehicleSprite } from './vehicleRow';
import {
  checkLifetime,
  pruneToFree,
  haulShare,
  haulTone,
  locoStats,
  stateText,
  stateTone,
  stopSummary,
  togglePick,
  trainRowText,
  wagonStats,
} from './depotView';
import { currentStopIndex } from './trainScreenView';
import type { Confirm } from './menu';

type RouteChoice = 'auto' | 'custom' | RouteMode;
type NewTab = 'consist' | 'route';

const TONES: readonly string[] = ['good', 'info', 'warn', 'bad'];

/** One train in the list on the left: its row, and the part of it that follows the train. */
interface TrainRow {
  root: HTMLElement;
  update(): void;
}

/** What the dock and the footer say of the new train: the answer of `Fleet.dispatchCheck`. */
interface Check {
  /** why `create` would refuse it, null when it would roll out */
  reason: string | null;
  /** the dock's line: the gate it would take, or what stops it */
  dock: { text: string; ok: boolean };
  depot: Station | null;
  gate: { x: number; y: number } | null;
  /** the stations the automatic route would visit, in order */
  auto: string[];
  /** stations on the depot's rails */
  served: number;
  /** how long the answer stands, ms */
  lifetime: number;
}

/** Depot: assemble trains from owned rolling stock and program their looped schedule. */
export class DepotScreen implements Screen {
  readonly id = 'depot';
  readonly title = STR.depot.title;
  readonly icon = 'train';
  private readonly split = listDetail(360);
  readonly root = this.split.root;
  // the list on the left
  private readonly newBtn = actionButton(STR.depot.newTrain, () => this.showDraft(), {
    icon: 'plus',
    cls: 'dp-new',
  });
  private readonly count = el('span');
  private readonly rowsBox = el('div', { class: 'dp-rows' });
  private readonly emptyBox = el('div');
  private readonly rows = new Map<Train, TrainRow>();
  // the roll-out block under the new train: its depots, the gate it would take, the train's name
  private readonly dock = el('div', { class: 'dp-dock' });
  private readonly dockDepots = el('div', { class: 'dp-rl' });
  private readonly gateLine = el('span', { class: 'dp-gate' });
  private readonly servedLine = el('span', { class: 'k-note' });
  private readonly nameField = textField({
    placeholder: STR.depot.namePlaceholder,
    maxLength: 24,
    title: STR.depot.nameHint,
  });
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
  /** depot the new train rolls out of (null: the first one) */
  private depotId: number | null = null;
  private checkCache: { key: string; at: number; value: Check } | null = null;
  onFocusTrain: ((t: Train) => void) | null = null;
  /** the player picked a depot: the game peeks at it and marks the gate */
  onFocusDepot: ((d: Station, gate: { x: number; y: number } | null) => void) | null = null;
  onDetails: ((t: Train) => void) | null = null;
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
    this.split.list.head.append(this.newBtn);
    this.split.list.body.append(
      well({ title: STR.depot.trains, right: this.count }, this.rowsBox, this.emptyBox),
    );
    this.dock.append(
      this.dockDepots,
      el('div', { class: 'dp-rl' }, this.gateLine, this.servedLine),
      el('div', { class: 'dp-rl' }, this.nameField.root),
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
    keepScroll(this.root);
  }

  onOpen() {
    this.render();
  }
  refresh() {
    // a train recalled elsewhere leaves the screen with it
    if (this.editing && !this.fleet.trains.includes(this.editing)) this.showDraft();
    this.syncTrains();
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
            label: STR.depot.details,
            primary: true,
            title: STR.depot.detailsHint,
            onClick: () => this.onDetails?.(t),
          },
        ],
      };
    const why = this.check().reason;
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
      note: why ?? undefined,
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
    this.render();
  }

  /** The stop editor changed the new train's stops. */
  private stopsEdited() {
    this.checkCache = null;
    this.drawHead();
    this.onRedraw?.();
  }

  // ---------------------------------------------------------------- the list of trains

  private render() {
    this.renderDetail();
    this.syncTrains();
    this.onRedraw?.();
  }

  /** The rows follow the fleet: new trains get a row, gone ones lose theirs, the rest only update. */
  private syncTrains() {
    const trains = this.fleet.trains;
    for (const [t, r] of this.rows)
      if (!trains.includes(t)) {
        r.root.remove();
        this.rows.delete(t);
      }
    trains.forEach((t, i) => {
      let r = this.rows.get(t);
      if (!r) {
        r = this.makeRow(t);
        this.rows.set(t, r);
      }
      if (this.rowsBox.children[i] !== r.root)
        this.rowsBox.insertBefore(r.root, this.rowsBox.children[i] ?? null);
      r.update();
    });
    const n = String(trains.length);
    if (this.count.textContent !== n) this.count.textContent = n;
    if (!trains.length && !this.emptyBox.firstChild)
      this.emptyBox.append(emptyState({ icon: 'train', text: STR.depot.noTrains }));
    else if (trains.length && this.emptyBox.firstChild) this.emptyBox.replaceChildren();
    this.newBtn.classList.toggle('open', !this.editing);
  }

  private makeRow(t: Train): TrainRow {
    const name = el('span');
    const consist = el('span');
    const status = el('span', { class: 'dp-st' });
    const load = el('span');
    const aboard = el('span');
    const labels = trainLabels(t.trainClass);
    const root = listRow({
      title: name,
      sprite: vehicleSprite(this.atlas, t.locos[0]?.def.id ?? ''),
      sub: [consist, el('span', {}, status, ' · ', load), aboard],
      foot: labels ? [labels] : undefined,
      onClick: () => this.pick(t),
      cls: 'dp-li dp-pick dp-train',
    });
    const set = (e: HTMLElement, s: string) => {
      if (e.textContent !== s) e.textContent = s;
    };
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
        message: t.lastMessage,
      });
      set(name, t.name);
      set(consist, x.consist);
      if (consist.title !== x.consist) consist.title = x.consist;
      set(status, x.status);
      set(load, x.load);
      set(aboard, x.aboard);
      if (aboard.title !== x.aboard) aboard.title = x.aboard;
      const tone = `dp-st ${x.tone}`.trim();
      if (status.className !== tone) status.className = tone;
      const over = x.over ? 'k-bad' : '';
      if (load.className !== over) load.className = over;
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
      this.inventory.free('loco').map((i) => i.uid),
      this.inventory.free('wagon').map((i) => i.uid),
      this.builder.depots().map((d) => d.id),
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
    if (!this.editing) this.renderDock();
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

  /** The head of a new train: the tabs and the summary. */
  private drawHead() {
    const d = this.split.detail;
    const picked = this.locoUids.length + this.wagonUids.length;
    const tabs = tabStrip(
      [
        { id: 'consist', label: STR.depot.consist, count: picked },
        {
          id: 'route',
          label: STR.depot.routeTab,
          count: this.routeMode === 'custom' ? this.schedule.length : null,
        },
      ],
      this.tab,
      (id) => {
        this.tab = id as NewTab;
        this.render();
      },
    );
    d.head.replaceChildren(tabs, this.summaryWell());
  }

  /** The picked engines' haul against the wagons' weight, and the physics of the consist. */
  private summaryWell(): HTMLElement {
    if (!this.locoUids.length) return well({ cls: 'dp-sum' }, note(STR.depot.pickLoco));
    const s = this.newPhysics();
    return well(
      { cls: 'dp-sum' },
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
    d.head.replaceChildren(well({ cls: 'dp-sum' }, sectionHeader(t.name, stateEl), haul, phys));
    const rows: HTMLElement[] = [];
    for (const l of t.locos) {
      const sub = el('span');
      this.live.text(sub, () => {
        const m = levelMul(l.level);
        return `${STR.depot.speed} ${(l.def.speed * m).toFixed(1)} · ${STR.depot.power} ${Math.round(l.def.power * m)} t · ${STR.modes[l.mode]}`;
      });
      rows.push(vehicleRow(this.atlas, { def: l.def, level: l.level, sub: [sub] }));
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
    const depot = this.syncDepot();
    const locos = this.inventory.free('loco');
    const wagons = this.inventory.free('wagon');
    const pickedTypes = new Set(
      this.locoUids.flatMap((u) => {
        const it = this.inventory.byUid(u);
        return it ? [locoDef(it.defId).type] : [];
      }),
    );
    const locoRows = locos.map((it) => {
      const def = locoDef(it.defId);
      return vehicleRow(this.atlas, {
        def,
        level: it.level,
        sub: [locoStats(def, levelMul(it.level))],
        // a barred model still shows why; picking it is allowed so the roll-out box can explain
        reason: depot ? this.fleet.modelDeployReason(def, depot) : null,
        on: this.locoUids.includes(it.uid),
        onClick: () => this.toggleLoco(it.uid),
      });
    });
    const wagonRows = wagons.map((it) => {
      const def = wagonDef(it.defId);
      return vehicleRow(this.atlas, {
        def,
        level: it.level,
        sub: [wagonStats(def, levelMul(it.level))],
        reason: depot ? this.fleet.modelDeployReason(def, depot) : null,
        // a refuelling cart without an engine of its type aboard only adds mass
        warn:
          def.service && !pickedTypes.has(serviceLocoType(def.service))
            ? STR.depot.deadWeight(STR.roster.type[serviceLocoType(def.service)])
            : null,
        on: this.wagonUids.includes(it.uid),
        onClick: () => this.toggleWagon(it.uid),
      });
    });
    return [
      well(
        {
          title: `${STR.depot.locomotive} (${this.locoUids.length}/${MAX_LOCOS})`,
          right: String(locos.length),
        },
        ...(locoRows.length ? locoRows : [emptyState({ text: STR.depot.noFreeLoco })]),
      ),
      well(
        {
          title: `${STR.depot.wagons} (${this.wagonUids.length}/${MAX_WAGONS})`,
          right: String(wagons.length),
        },
        ...(wagonRows.length ? wagonRows : [emptyState({ text: STR.depot.noFreeWagons })]),
      ),
    ];
  }

  private toggleLoco(uid: number) {
    const r = togglePick(this.locoUids, uid, MAX_LOCOS);
    this.locoUids = r.list;
    if (r.full) this.toast(STR.fleet.tooManyLocos(MAX_LOCOS), 'warn');
    // the engines' gauge decides which depots the train can roll out of
    this.checkCache = null;
    this.render();
  }
  private toggleWagon(uid: number) {
    const r = togglePick(this.wagonUids, uid, MAX_WAGONS);
    this.wagonUids = r.list;
    if (r.full) this.toast(STR.fleet.tooManyWagons(MAX_WAGONS), 'warn');
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

  /** Depots the chosen locomotives can roll out of: those of their gauge (all when none chosen). */
  private depotChoices(): Station[] {
    const gauge = consistGauge(
      this.locoUids.flatMap((u) => {
        const it = this.inventory.byUid(u);
        return it ? [locoDef(it.defId)] : [];
      }),
    );
    return gauge === 'regular' || gauge === 'narrow'
      ? this.builder.depotsOf(gauge)
      : this.builder.depots();
  }
  /** Keep the selected depot among those the chosen engines can use; returns it. */
  private syncDepot(): Station | undefined {
    const depots = this.depotChoices();
    if (this.depotId === null || !depots.some((d) => d.id === this.depotId))
      this.depotId = depots[0]?.id ?? null;
    return depots.find((d) => d.id === this.depotId);
  }

  /** The depot choice and Show; the gate line and the name field stand as they are. */
  private renderDock() {
    const depots = this.depotChoices();
    this.syncDepot();
    const show = () => {
      const c = this.check();
      if (c.depot) this.onFocusDepot?.(c.depot, c.gate);
    };
    this.dockDepots.replaceChildren(
      el('span', { class: 'k-note', text: STR.depot.from }),
      segmented({
        options: depots.map((d) => ({ id: String(d.id), label: d.name })),
        value: String(this.depotId),
        cls: 'small',
        onChange: (id) => {
          this.depotId = Number(id);
          this.checkCache = null;
          this.renderDock();
          show();
          this.onRedraw?.();
        },
      }),
      actionButton(STR.depot.show, show, { cls: 'small', icon: 'eye', title: STR.depot.showHint }),
    );
    this.dockLive.run();
  }

  /**
   * Whether the new train would roll out, and where: `Fleet.dispatchCheck`, the question `create`
   * itself asks, so the screen never allows what `create` refuses. It walks the track, so the
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
    const seen = this.locoUids.length
      ? asked
      : { ...this.fleet.previewSpawn([], stops, this.depotId), reason: asked.reason };
    const depot = seen.depot ?? this.syncDepot() ?? null;
    const auto = this.fleet.autoSchedule(depot ?? undefined);
    const first = this.builder.stationById(seen.stops[0]?.stationId);
    const dock =
      seen.gate && seen.depot
        ? {
            text: STR.depot.gateAt(seen.depot.name, seen.gate.x, seen.gate.y, first?.name ?? '?'),
            ok: true,
          }
        : { text: this.locoUids.length ? (asked.reason ?? '') : (seen.reason ?? ''), ok: false };
    const value: Check = {
      reason: asked.reason,
      dock,
      depot,
      gate: seen.gate,
      auto: auto.map((s) => this.builder.stationById(s.stationId)?.name ?? '?'),
      served: auto.length,
      lifetime: checkLifetime(depot !== null && seen.gate === null),
    };
    this.checkCache = { key, at: now, value };
    return value;
  }
}
