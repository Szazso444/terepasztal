import { el, fmtMoney } from './dom';
import { STR } from '../strings';
import { noteText } from './noteText';
import { rarityLabel } from './labels';
import type { FrameTabs, Screen } from './modal';
import {
  DYNAMIC_MODES,
  serviceLocoType,
  type RouteMode,
  type Train,
  type TripStats,
} from '../sim/trains';
import type { Fleet } from '../sim/fleet';
import type { Commands, CommandResult } from '../sim/commands';
import type { Builder } from '../sim/build';
import { cargoDef, cargoName, cargoWord } from '../sim/cargo';
import { levelMul } from '../gacha/items';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg } from './spritePreview';
import { TrainStops } from './scheduleEditor';
import {
  actionButton,
  columns,
  emptyState,
  formRow,
  labelValue,
  listDetail,
  meter,
  note,
  sectionHeader,
  segmented,
  well,
  type FootSpec,
} from './kit';
import { Bindings, bindMeter, keepPlace, keepScroll } from './liveView';
import { nextStopId } from './trainView';
import { vehicleRow, vehicleSprite } from './vehicleRow';
import {
  haulShare,
  haulTone,
  serviceResource,
  stateText,
  stateTone,
  wagonStats,
} from './depotView';
import {
  cargoAboard,
  emergencyState,
  levelGain,
  perTileText,
  rangeText,
  recordText,
  splitFuel,
  tankRows,
  tankShare,
  tankValue,
  type TankRow,
} from './trainScreenView';

/** Fill a train from its supplier at twice the cost, and say what came of it. */
export function emergencyRefuel(
  fleet: Fleet,
  t: Train,
  toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
) {
  const taken = fleet.emergencyRefuel(t);
  const got = Object.entries(taken)
    .map(([k, v]) => `${Math.round(v)} ${cargoWord(k)}`)
    .join(', ');
  toast(
    got
      ? STR.train.emergencyDone(got)
      : fleet.supplierOf(t)
        ? STR.train.emergencyNone
        : STR.train.emergencyNoStore,
    got ? 'good' : 'warn',
  );
}

/**
 * The routing buttons: the stop list, every dynamic mode the simulation offers, then Maintenance,
 * which a train takes only with a maintenance wagon.
 */
const ROUTE_BUTTONS: readonly RouteMode[] = ['schedule', ...DYNAMIC_MODES, 'maintenance'];

type Tab = 'overview' | 'stops' | 'consist';
type Wagon = Train['wagons'][number];
interface Picked {
  kind: 'l' | 'w';
  index: number;
}

/** One train in detail: engines, tanks, weight, wagons, schedule and the last loop's statistics. */
export class TrainScreen implements Screen {
  readonly id = 'train';
  title: string = STR.train.title;
  readonly icon = 'train';
  /** one tab's page at a time stands in it */
  readonly root = el('div', { class: 'dp-tab' });
  train: Train | null = null;
  onLocate: ((t: Train) => void) | null = null;
  /** the frame's strip or footer changed: it is drawn now, not at the next refresh */
  onRedraw: (() => void) | null = null;
  private tab: Tab = 'overview';
  private picked: Picked = { kind: 'l', index: 0 };
  /** what follows the train on the tab drawn */
  private readonly live = new Bindings();
  /** what the tab was drawn from: when it changes, it is drawn again */
  private built = '';
  /** the tab and the train on show: drawn again for the same ones, the scroll stays */
  private shown = '';
  private readonly stops: TrainStops;

  constructor(
    private readonly fleet: Fleet,
    private readonly builder: Builder,
    private readonly commands: Commands,
    private readonly atlas: AtlasRegistry,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
  ) {
    this.stops = new TrainStops(builder, commands, toast);
    keepScroll(this.root);
  }

  open(t: Train) {
    this.train = t;
    this.title = `${STR.train.title}: ${t.name}`;
    this.tab = 'overview';
    this.picked = { kind: 'l', index: 0 };
    this.built = '';
    this.shown = '';
  }
  onOpen() {
    this.render();
  }
  refresh() {
    const t = this.inService();
    if (!t) {
      if (this.built !== 'gone') this.render();
      return;
    }
    this.title = `${STR.train.title}: ${t.name}`;
    if (this.signature(t) !== this.built) {
      this.render();
      return;
    }
    this.live.run();
    if (this.tab === 'stops') this.stops.sync(t);
  }

  frameTabs(): FrameTabs | null {
    const t = this.inService();
    if (!t) return null;
    return {
      tabs: [
        { id: 'overview', label: STR.train.overview },
        { id: 'stops', label: STR.depot.stops, count: t.program.length },
        { id: 'consist', label: STR.depot.consist, count: t.locos.length + t.wagons.length },
      ],
      current: this.tab,
      pick: (id) => {
        this.tab = id as Tab;
        this.render();
      },
    };
  }

  frameFooter(): FootSpec | null {
    const t = this.inService();
    if (!t) return null;
    const e = emergencyState(this.tankInput(t));
    return {
      actions: [
        {
          label: STR.train.emergency,
          icon: 'fuel',
          disabled: e.disabled,
          title: e.title,
          onClick: () => this.refuelNow(t),
        },
        { label: STR.depot.locate, icon: 'eye', onClick: () => this.onLocate?.(t) },
      ],
    };
  }

  /** The train on show while it is in service; null once it is not. */
  private inService(): Train | null {
    const t = this.train;
    return t && this.fleet.byId(t.id) ? t : null;
  }

  /** Say why a command was refused; true when it went through. */
  private accepted(r: CommandResult) {
    if (!r.ok) this.toast(r.message, 'warn');
    return r.ok;
  }

  private refuelNow(t: Train) {
    emergencyRefuel(this.fleet, t, this.toast);
    this.live.run();
    this.onRedraw?.();
  }

  // ---------------------------------------------------------------- what is drawn

  /** What a tab's structure depends on; the numbers on it are bound and follow by themselves. */
  private signature(t: Train): string {
    const common = [this.tab, t.id];
    switch (this.tab) {
      case 'overview':
        return JSON.stringify([
          ...common,
          t.hasSteam,
          t.hasDiesel,
          t.hasElectric,
          t.batteryCap > 0,
          t.fuelKind,
          t.oilKind,
          !!(t.job ?? t.jobs[0]),
          !!t.lastMessage,
          t.hungry,
          !!t.lastTrip,
          t.locos.map((l) => l.def.id),
          t.wagons.map((w) => [w.def.id, w.cargo]),
        ]);
      case 'stops':
        return JSON.stringify([...common, t.hasSteam, t.mode]);
      case 'consist':
        return JSON.stringify([
          ...common,
          this.picked,
          t.locos.map((l) => [l.def.id, l.level, l.mode]),
          t.wagons.map((w) => [w.def.id, w.level, w.cargo, t.cartMatched(w)]),
        ]);
    }
  }

  private render() {
    const t = this.inService();
    this.live.clear();
    const key = t ? `${this.tab}:${t.id}` : 'gone';
    const draw = () => {
      if (!t) {
        this.root.replaceChildren(
          el('div', { class: 'k-page' }, well(null, emptyState({ text: STR.train.gone }))),
        );
        return;
      }
      this.root.replaceChildren(
        this.tab === 'overview'
          ? this.overview(t)
          : this.tab === 'stops'
            ? this.stopsPage(t)
            : this.consistPage(t),
      );
    };
    this.built = t ? this.signature(t) : 'gone';
    // the same tab of the same train drawn again keeps its place; another starts at the top
    if (key === this.shown) keepPlace(this.root, draw);
    else draw();
    this.shown = key;
    this.onRedraw?.();
  }

  // ---- bound rows

  /** A label and a value that follows `get`; `tone` colours it. */
  private kv(label: string, get: () => string, tone?: () => string): HTMLElement {
    const row = labelValue(label, '');
    this.live.text(row.lastElementChild as HTMLElement, get);
    if (tone) this.live.tone(row, ['bad', 'good', 'warn'], tone);
    return row;
  }

  /** A resource's atlas icon at the size of a line of text. */
  private resIcon(res: string): HTMLElement {
    return spriteImg(this.atlas, `icons/${res}`, 1, 'sprite-preview res-icon');
  }

  private tankInput(t: Train) {
    return {
      steam: t.hasSteam,
      diesel: t.hasDiesel,
      electric: t.hasElectric,
      fuelKind: t.fuelKind,
      oilKind: t.oilKind,
      coal: t.coal,
      coalCap: t.coalCap,
      coalRate: t.coalRate,
      water: t.water,
      waterCap: t.waterCap,
      waterRate: t.waterRate,
      oil: t.oil,
      oilCap: t.oilCap,
      oilRate: t.oilRate,
      battery: t.battery,
      batteryCap: t.batteryCap,
      powerRate: t.powerRate,
    };
  }

  // ---- Overview

  private overview(t: Train): HTMLElement {
    const next = () => {
      const stop = nextStopId(t);
      return stop === null ? undefined : this.builder.stationById(stop)?.name;
    };
    const status: HTMLElement[] = [
      this.kv(
        STR.train.state,
        () => `${stateText(t.state, t.blocked)}${next() ? ` → ${next()}` : ''}`,
        () => (stateTone(t.state, t.blocked) === 'bad' ? 'bad' : ''),
      ),
    ];
    if (t.lastMessage) status.push(this.kv(STR.train.note, () => noteText(t.lastMessage)));
    if (t.hungry)
      status.push(
        this.kv(
          STR.train.note,
          () => STR.train.hungry,
          () => 'bad',
        ),
      );
    if (t.job ?? t.jobs[0])
      status.push(
        this.kv(
          STR.contracts.train,
          () => {
            const j = t.job ?? t.jobs[0];
            if (!j) return '';
            const queued = t.jobs.length - (t.job ? 0 : 1);
            const dest = this.builder.stationById(j.destId)?.name ?? '?';
            return `${STR.trainSide.onContract(j.name, dest)}${queued > 0 ? ` · ${STR.trainSide.queuedContracts(queued)}` : ''}`;
          },
          () => 'warn',
        ),
      );
    const haul = bindMeter(this.live, meter(STR.train.haul, '', 0), () => ({
      value: STR.train.weightPower(Math.round(t.weight), Math.round(t.power)),
      share: haulShare(t.weight, t.power),
      tone: haulTone(t.weight, t.power),
    }));
    const left = [
      well(STR.train.status, ...status),
      well(
        STR.train.performance,
        this.kv(STR.train.speed, () => `${t.physics.vMax.toFixed(2)} ${STR.train.tilesPerSecond}`),
        this.kv(STR.train.effort, () => {
          const p = t.physics;
          return `${Math.round(p.effort)} · ${STR.train.pulling(p.engaged)}${p.doubleHeaded ? ` · ${STR.modes.doubleHeaded}` : ''}`;
        }),
        this.kv(STR.train.mass, () => `${Math.round(t.physics.mass)} t`),
        this.kv(
          STR.train.acceleration,
          () => `${t.physics.acceleration.toFixed(2)} ${STR.train.tilesPerSecondSq}`,
        ),
        this.kv(STR.train.crew, () => String(t.crew)),
        haul,
      ),
      this.loopWell(STR.train.lastLoop, () => t.lastTrip),
    ];
    const right = [
      this.tanksWell(t),
      this.consistWell(t),
      this.loopWell(STR.train.currentLoop, () => t.trip),
    ];
    return el('div', { class: 'k-page' }, columns(left, right));
  }

  /** A loop's record: distance, consumed, refuelled, gathered, delivered, income. */
  private loopWell(title: string, get: () => TripStats | null): HTMLElement {
    if (!get()) return well(title, note(STR.train.noTrip));
    const fuel = () => splitFuel(get()?.fuel ?? {});
    return well(
      title,
      this.kv(STR.train.distance, () => `${Math.round(get()?.distance ?? 0)} ${STR.train.tiles}`),
      this.kv(STR.train.fuelUsed, () => recordText(fuel().used)),
      this.kv(STR.train.refuelled, () => recordText(fuel().refuelled)),
      this.kv(STR.train.gathered, () => recordText(get()?.loaded ?? {})),
      this.kv(STR.train.delivered, () => recordText(get()?.delivered ?? {})),
      this.kv(STR.train.income, () => fmtMoney(get()?.income ?? 0)),
    );
  }

  private tanksWell(t: Train): HTMLElement {
    // one reading of the tanks per run, shared by the meters
    let now: TankRow[] = [];
    this.live.add(() => (now = tankRows(this.tankInput(t), cargoName(t.oilKind))));
    const shown = [...now];
    // the power an electric engine draws from the wire is a row, ahead of the battery carts
    const power = t.hasElectric
      ? this.kv(
          STR.train.power,
          () =>
            `${t.powerRate.toFixed(2)} / ${STR.train.tile} · ${STR.train.stockPower(Math.floor(this.builder.stores.grid.get('power')))}`,
        )
      : null;
    const parts: HTMLElement[] = [];
    for (const r of shown) {
      if (power && r.key === 'battery') parts.push(power);
      const m = meter(r.label, '', 0);
      m.firstElementChild?.prepend(this.resIcon(r.icon));
      bindMeter(this.live, m, () => {
        const x = now.find((k) => k.key === r.key) ?? r;
        return { value: tankValue(x), share: tankShare(x), tone: x.tone };
      });
      parts.push(m);
    }
    if (power && !parts.includes(power)) parts.push(power);
    return well(
      STR.train.tanks,
      ...parts,
      this.kv(STR.train.perTile, () => perTileText(t)),
      this.kv(
        STR.train.range,
        () => rangeText(t.rangeTiles),
        () => (t.rangeTiles < 10 ? 'bad' : ''),
      ),
    );
  }

  /** The consist as a strip of vehicles, each opening the Consist tab, and the cargo aboard. */
  private consistWell(t: Train): HTMLElement {
    const veh = (kind: 'l' | 'w', index: number, defId: string, name: string, cap: HTMLElement) => {
      const b = el(
        'button',
        { type: 'button', class: 'dp-veh', title: name },
        vehicleSprite(this.atlas, defId),
        cap,
      );
      b.addEventListener('click', () => {
        this.picked = { kind, index };
        this.tab = 'consist';
        this.render();
      });
      return b;
    };
    const strip = el('div', { class: 'dp-strip' });
    t.locos.forEach((l) => {
      const cap = el('small');
      this.live.text(cap, () => STR.modes[l.mode]);
      strip.append(veh('l', t.locos.indexOf(l), l.def.id, l.def.name, cap));
    });
    t.wagons.forEach((w, i) => {
      const cap = el('small');
      if (w.cargo) cap.append(this.resIcon(w.cargo));
      const text = el('span');
      cap.append(text);
      this.live.text(text, () =>
        w.def.service
          ? `+${w.def.serviceCap ?? 0}`
          : w.cargo
            ? String(Math.round(w.amount))
            : STR.depot.empty.toLowerCase(),
      );
      strip.append(veh('w', i, w.def.id, w.def.name, cap));
    });
    const aboard = cargoAboard(t.wagons);
    const chips = aboard.length
      ? el(
          'div',
          { class: 'dp-cargo' },
          ...aboard.map(([res]) => {
            const amount = el('b');
            this.live.text(
              amount,
              () => `${Math.round(cargoAboard(t.wagons).find(([r]) => r === res)?.[1] ?? 0)}`,
            );
            return el('span', { class: 'dp-chip' }, this.resIcon(res), cargoDef(res).name, amount);
          }),
        )
      : note(STR.train.runningEmpty);
    const total = el('span', { class: 'dp-total' });
    this.live.text(total, () => STR.depot.cargo(Math.round(t.totalCargo())));
    return well({ title: STR.depot.consist, right: total }, strip, chips);
  }

  // ---- Stops

  private stopsPage(t: Train): HTMLElement {
    const dyn = t.mode !== 'schedule';
    const modes = el(
      'div',
      { class: 'k-inrow dp-modes' },
      segmented({
        options: ROUTE_BUTTONS.map((m) => {
          const off = m === 'maintenance' && !t.hasMaintenanceWagon;
          return {
            id: m,
            label: STR.train.mode[m],
            disabled: off,
            title: off ? STR.fleet.needMaintenanceWagon : undefined,
          };
        }),
        value: t.mode,
        onChange: (id) => {
          this.accepted(this.commands.setTrainMode(t, id as RouteMode));
          this.render();
        },
      }),
    );
    if (t.hasSteam)
      modes.append(
        el('small', { text: STR.train.prefer }),
        segmented({
          options: [
            { id: 'coal', label: STR.train.coal },
            { id: 'wood', label: STR.train.wood },
          ],
          value: t.fuelPreference,
          onChange: (id) => {
            this.accepted(this.commands.setFuelPreference(t, id as 'coal' | 'wood'));
            this.render();
          },
        }),
      );
    // the train's own program, also while a contract job runs its two stops
    this.stops.show(t);
    const count = el('span');
    this.live.text(count, () => String(t.program.length));
    return el(
      'div',
      { class: 'k-page' },
      well(
        { title: STR.train.routing, right: dyn ? STR.depot.dynamicTag : STR.train.staticTag },
        modes,
        note(STR.train.modeHint[t.mode] ?? ''),
        dyn ? note(STR.depot.dynamicPlans) : null,
      ),
      well(
        { title: STR.depot.stops, right: count },
        note(STR.depot.scheduleLiveHint),
        this.stops.root,
      ),
    );
  }

  // ---- Consist

  private consistPage(t: Train): HTMLElement {
    const ld = listDetail(400);
    const at = this.pickedIn(t);
    const standby = (i: number) => {
      const off = t.locos[i].mode === 'standby';
      return actionButton(
        off ? STR.train.engage : STR.train.standby,
        () => {
          t.setStandby(i, !off);
          this.render();
        },
        { cls: 'small', title: STR.modes.hint },
      );
    };
    const engines = t.locos.map((l, i) => {
      const mode = el('span');
      this.live.text(mode, () => this.modeText(t.locos[i] ?? l));
      this.live.toggle(mode, 'dp-mode', () => (t.locos[i] ?? l).engaged);
      return vehicleRow(this.atlas, {
        def: l.def,
        level: l.level,
        sub: [
          `${STR.roster.type[l.def.type]} · ${Math.round(l.def.power * levelMul(l.level))} t`,
          mode,
        ],
        on: at.kind === 'l' && at.index === i,
        onClick: () => this.pickVehicle('l', i),
        right: i > 0 ? [standby(i)] : undefined,
      });
    });
    const wagons = t.wagons.map((w, i) => {
      const sub = el('span');
      this.live.text(sub, () => this.wagonNow(t.wagons[i] ?? w));
      return vehicleRow(this.atlas, {
        def: w.def,
        level: w.level,
        sub: [sub],
        warn: this.deadWeight(t, w),
        on: at.kind === 'w' && at.index === i,
        onClick: () => this.pickVehicle('w', i),
      });
    });
    ld.list.body.append(
      well({ title: STR.train.engines, right: STR.train.pulling(t.physics.engaged) }, ...engines),
      well({ title: STR.depot.wagons, right: String(t.wagons.length) }, ...wagons),
    );
    ld.detail.body.append(
      ...(at.kind === 'l'
        ? this.engineDetail(t, at.index, standby)
        : this.wagonDetail(t, at.index)),
      well(STR.train.engineModes, note(STR.modes.hint)),
    );
    return ld.root;
  }

  /** The picked vehicle, kept inside the train's own consist. */
  private pickedIn(t: Train): Picked {
    const { kind, index } = this.picked;
    if (kind === 'w' && t.wagons[index]) return this.picked;
    if (kind === 'l' && t.locos[index]) return this.picked;
    return { kind: 'l', index: 0 };
  }

  private pickVehicle(kind: 'l' | 'w', index: number) {
    this.picked = { kind, index };
    this.render();
  }

  /** An engine's mode, and what has become of it: stepped in, or without usable power. */
  private modeText(l: Train['locos'][number]): string {
    const text =
      STR.modes[l.mode] +
      (l.mode === 'standby' && l.engaged
        ? ` (${STR.modes.rescuing})`
        : l.mode !== 'standby' && !l.engaged
          ? ` (${STR.modes.dormant})`
          : '');
    return `${text}${l.def.controlClass ? ` · ${STR.depot.controlClass(l.def.controlClass)}` : ''}`;
  }

  private deadWeight(t: Train, w: Wagon): string | null {
    return w.def.service && !t.cartMatched(w)
      ? STR.depot.deadWeight(STR.roster.type[serviceLocoType(w.def.service)])
      : null;
  }

  /** A wagon's line: its cargo against its capacity and the weight, or empty. */
  private wagonNow(w: Wagon): string {
    const cap = w.def.capacity * levelMul(w.level);
    if (w.def.service || w.def.capacity <= 0) return wagonStats(w.def, levelMul(w.level));
    return w.cargo
      ? `${cargoDef(w.cargo).name} ${Math.round(w.amount)}/${Math.round(cap)} · ${(w.def.weight + w.amount * cargoDef(w.cargo).weight).toFixed(1)} t`
      : `${STR.depot.empty} · ${Math.round(cap)} u · ${w.def.weight} t`;
  }

  private rarityRow(rarity: string): HTMLElement {
    const name = STR.craft.quality[rarity] ?? rarity;
    return labelValue(
      STR.roster.rarity,
      el(
        'span',
        {},
        rarityLabel(rarity),
        ' ',
        el('span', { class: `rarity-${rarity}`, text: name }),
      ),
    );
  }

  private engineDetail(t: Train, i: number, standby: (i: number) => HTMLElement): HTMLElement[] {
    const l = t.locos[i];
    const m = levelMul(l.level);
    const modeText = el('b');
    this.live.text(modeText, () => STR.modes[(t.locos[i] ?? l).mode]);
    return [
      well(
        null,
        sectionHeader(l.def.name, STR.train.engineOf(i + 1, t.locos.length)),
        el('div', { class: 'dp-big' }, vehicleSprite(this.atlas, l.def.id, 2)),
        this.rarityRow(l.def.rarity),
        labelValue(STR.roster.level, levelGain(l.level, m, STR.train.speedAndPower)),
        labelValue(
          STR.train.type,
          `${STR.roster.type[l.def.type]} · ${STR.roster.size[l.def.size ?? 'small']}`,
        ),
        labelValue(STR.depot.speed, `${(l.def.speed * m).toFixed(2)} ${STR.train.tilesPerSecond}`),
        labelValue(STR.depot.power, `${Math.round(l.def.power * m)} t`),
        labelValue(STR.depot.weight, `${l.def.weight} t`),
        labelValue(STR.train.crew, String(l.def.crew)),
        labelValue(STR.train.tanks, STR.roster.fuelLine(l.def)),
        l.def.controlClass
          ? labelValue(STR.train.controlClassLabel, l.def.controlClass.toUpperCase())
          : null,
        formRow(
          STR.train.engineMode,
          el('span', { class: 'dp-modectl' }, modeText, i > 0 ? standby(i) : null),
        ),
      ),
    ];
  }

  private wagonDetail(t: Train, i: number): HTMLElement[] {
    const w = t.wagons[i];
    const m = levelMul(w.level);
    const cap = Math.round(w.def.capacity * m);
    const cart = w.def.service;
    // a wagon that holds nothing has no capacity to show
    const holds = w.def.capacity > 0;
    const parts: (HTMLElement | null)[] = [
      sectionHeader(w.def.name, STR.train.wagonOf(i + 1, t.wagons.length)),
      el('div', { class: 'dp-big' }, vehicleSprite(this.atlas, w.def.id, 2)),
      this.rarityRow(w.def.rarity),
      cart || !holds
        ? null
        : labelValue(STR.roster.level, levelGain(w.level, m, STR.train.capacity)),
      labelValue(STR.train.carries, STR.roster.carries[w.def.carries] ?? w.def.carries),
      labelValue(STR.train.size, STR.roster.size[w.def.size ?? 'small']),
    ];
    if (cart)
      parts.push(
        labelValue(STR.train.refuelCart, `+${w.def.serviceCap ?? 0} ${serviceResource(cart)}`),
      );
    else if (holds) {
      parts.push(labelValue(STR.roster.capacity, `${cap} u`));
      parts.push(
        bindMeter(this.live, meter(STR.train.cargoAboard, '', 0), () => {
          const cur = t.wagons[i] ?? w;
          return {
            value: cur.cargo
              ? `${cargoDef(cur.cargo).name} ${Math.round(cur.amount)} / ${cap} u`
              : STR.depot.empty,
            share: cap > 0 ? Math.min(1, cur.amount / cap) : 0,
            tone: '',
          };
        }),
      );
    }
    parts.push(
      this.kv(STR.depot.weight, () => {
        const cur = t.wagons[i] ?? w;
        return `${(cur.def.weight + (cur.cargo ? cur.amount * cargoDef(cur.cargo).weight : 0)).toFixed(1)} t`;
      }),
    );
    const dead = this.deadWeight(t, w);
    if (dead) parts.push(note(dead, 'bad'));
    const out = [well(null, ...parts)];
    if (cart)
      out.push(
        well(STR.train.refuelCart, note(STR.roster.serviceLine(cart, w.def.serviceCap ?? 0))),
      );
    return out;
  }
}
