import { locoFrame, wagonFrame } from '../art/frames';
import type { AtlasRegistry } from '../engine/atlas';
import type { Builder } from '../sim/build';
import { cargoName } from '../sim/cargo';
import { TRAIN_NAME_MAX, type Commands } from '../sim/commands';
import type { Fleet } from '../sim/fleet';
import { TRAIN_COLOURS, nextTrainColour, shownTrainColour } from '../sim/trainColours';
import type { Train } from '../sim/trains';
import { STR } from '../strings';
import { buildIcon } from './buildIcons';
import { btn, el } from './dom';
import { sectionHeader } from './kit';
import { vehicleLabels } from './labels';
import { classBadge } from './lineBadge';
import { renameField } from './renameField';
import { TrainStops } from './scheduleEditor';
import { spriteImg } from './spritePreview';
import { ttDim, ttLabel } from './tooltip';
import { emergencyRefuel } from './trainScreen';
import {
  climbSpeed,
  fmtSpeed,
  trainOverview,
  type Problem,
  type ProblemAction,
  type TrainOverview,
} from './trainView';

export type TrainTab = 'overview' | 'stops' | 'consist';
const TRAIN_TABS: readonly TrainTab[] = ['overview', 'stops', 'consist'];

/** Seconds between looks at the train: its numbers change each frame, a person reads slower. */
const REFRESH_S = 0.25;

/** What the panel reads, and what its buttons ask for. */
export interface TrainPanelHost {
  fleet: Fleet;
  builder: Builder;
  commands: Commands;
  atlas: AtlasRegistry;
  toast(m: string, k?: 'info' | 'warn' | 'good'): void;
  /** the train the camera follows; null with none */
  followedTrain(): number | null;
  /** the eye button: the camera on this train, or off it */
  toggleFollow(t: Train): void;
  /** the seconds a train has stood stuck; null if it has not */
  stuckFor(id: number): number | null;
  onClose(): void;
  onDetails(t: Train): void;
  onDepot(): void;
}

/**
 * Top left, for the train picked on the map or in the outliner: its status, stops and consist, with
 * the Train screen a button away for what it does not show. The head and the tab are each drawn
 * again only when their text changed, so what is under the pointer stays the same element.
 */
export class TrainPanel {
  readonly root = el('div', { id: 'train-panel', class: 'panel' });
  private readonly head = el('div', { class: 'panel-title' });
  private readonly tabs = new Map<TrainTab, HTMLButtonElement>();
  private readonly scroll = el('div', { class: 'panel-body tp-scroll' });
  private readonly stops: TrainStops;
  private tab: TrainTab = 'overview';
  train: Train | null = null;
  private headKey = '';
  private tabKey = '';
  private since = REFRESH_S;
  /** a button is down, so what is under it must stay what it came down on */
  private held = false;
  private renaming = false;
  /** the overview hides the panel: the Town list stands there */
  private overview = false;

  constructor(private readonly h: TrainPanelHost) {
    this.stops = new TrainStops(h.builder, h.commands, h.toast);
    const tabRow = el('div', { class: 'tp-tabs' });
    for (const id of TRAIN_TABS) {
      const b = btn(STR.trainPanel.tab[id], () => this.setTab(id), 'tp-tab');
      this.tabs.set(id, b);
      tabRow.append(b);
    }
    const details = btn(STR.depot.details, () => this.train && h.onDetails(this.train), 'small');
    this.root.append(
      this.head,
      tabRow,
      this.scroll,
      el(
        'div',
        { class: 'panel-foot' },
        ttLabel(details, 'tp-details', 'tp-details', () => [ttDim(STR.trainPanel.details)]),
      ),
    );
    this.root.addEventListener('pointerdown', () => (this.held = true));
    window.addEventListener('pointerup', () => (this.held = false));
    window.addEventListener('pointercancel', () => (this.held = false));
    this.root.style.display = 'none';
    this.markTab();
  }

  /** Show a train, or take the panel down. */
  show(t: Train | null) {
    this.train = t;
    this.headKey = '';
    this.tabKey = '';
    this.place();
    this.update(0, true);
  }
  /** The overview came or went. */
  setOverview(on: boolean) {
    this.overview = on;
    this.place();
  }
  private place() {
    const shown = !!this.train && !this.overview;
    this.root.style.display = shown ? '' : 'none';
    this.root.classList.toggle('open', shown);
  }
  private setTab(tab: TrainTab) {
    this.tab = tab;
    this.markTab();
    this.tabKey = '';
    this.scroll.scrollTop = 0;
    this.update(0, true);
  }
  private markTab() {
    for (const [id, b] of this.tabs) b.classList.toggle('on', id === this.tab);
  }

  /** A frame: look at the train when it is time, and draw what changed. */
  update(dt: number, force = false) {
    this.since += dt;
    if (!force && this.since < REFRESH_S) return;
    this.since = 0;
    const t = this.train;
    if (!t || this.overview || this.renaming || (this.held && !force)) return;
    const following = this.h.followedTrain() === t.id;
    const headKey = JSON.stringify([t.id, t.name, t.colour, t.trainClass, following]);
    if (headKey !== this.headKey) {
      this.headKey = headKey;
      this.drawHead(t, following);
    }
    // the stop editor is left alone while one of its controls is in use
    if (this.tab === 'stops' && this.scroll.contains(document.activeElement)) return;
    const view = this.tab === 'overview' ? this.overviewOf(t) : null;
    const tabKey = JSON.stringify([t.id, this.tab, view ?? this.keyOf(t)]);
    if (tabKey === this.tabKey) return;
    this.tabKey = tabKey;
    if (view) this.drawOverview(t, view);
    else if (this.tab === 'stops') this.drawStops(t);
    else this.drawConsist(t);
  }

  private overviewOf(t: Train) {
    return trainOverview(
      t,
      (id) => this.h.builder.stationById(id)?.name ?? null,
      this.h.stuckFor(t.id),
    );
  }
  /** What the Stops or the Consist tab was drawn from. */
  private keyOf(t: Train): unknown {
    const b = this.h.builder;
    if (this.tab === 'stops')
      return [
        t.program,
        t.mode,
        t.routeIndex,
        b.stations.map((s) => [s.id, s.name, b.platformTiles(s).length > 0]),
      ];
    return [
      t.locos.map((l) => [l.uid, l.mode, l.engaged]),
      t.wagons.map((w) => [w.uid, w.cargo, Math.round(w.amount)]),
    ];
  }

  // ---------------------------------------------------------------- the head

  private drawHead(t: Train, following: boolean) {
    const P = STR.trainPanel;
    const stripe = ttLabel(el('i'), 'tp-stripe', 'tp-stripe', () => [
      ttDim(STR.outliner.stripeTip),
    ]);
    stripe.style.background = TRAIN_COLOURS[shownTrainColour(t.colour)];
    stripe.addEventListener('click', () => {
      const did = this.h.commands.recolourTrain(t, nextTrainColour(t.colour));
      if (!did.ok) this.h.toast(did.message, 'warn');
      this.update(0, true);
    });
    const name = el('span', { class: 'panel-name', text: t.name, title: STR.outliner.renameTip });
    name.addEventListener('dblclick', () => this.rename(t, name));
    const eye = ttLabel(buildIcon('eye', 15), `tp-eye ${following ? 'on' : ''}`, 'tp-eye', () => [
      ttDim(following ? P.following : P.follow),
    ]);
    eye.addEventListener('click', () => {
      this.h.toggleFollow(t);
      this.update(0, true);
    });
    const close = btn('', () => this.h.onClose(), 'panel-x');
    close.title = P.close;
    close.append(buildIcon('close', 14));
    const tc = t.trainClass;
    this.head.replaceChildren(stripe, name, tc ? classBadge(tc) : '', eye, close);
  }

  private rename(t: Train, name: HTMLElement) {
    this.renaming = true;
    renameField(name, t.name, TRAIN_NAME_MAX, (typed) => {
      this.renaming = false;
      if (typed !== null) {
        const did = this.h.commands.renameTrain(t, typed);
        if (!did.ok) this.h.toast(did.message, 'warn');
      }
      this.headKey = '';
      this.update(0, true);
    });
  }

  // ---------------------------------------------------------------- Overview

  private icon(res: string) {
    const i = spriteImg(this.h.atlas, `icons/${res}`, 1, 'sprite-preview res-icon');
    i.title = cargoName(res);
    return i;
  }
  private meter(percent: number, cls = '') {
    return el('span', { class: `ol-meter ${cls}` }, el('i', { style: `width:${percent}%` }));
  }
  private section(title: string, right = '') {
    return sectionHeader(title, right);
  }
  private line(label: Node | string, value: string, cls = '') {
    return el(
      'div',
      { class: 'tp-line' },
      el('span', {}, label),
      el('b', { class: cls, text: value }),
    );
  }

  private problemBox(t: Train, p: Problem) {
    const box = el(
      'div',
      { class: `tp-problem sev-${p.sev}` },
      el('b', {}, buildIcon('alert', 13), p.title),
      el('span', { text: p.text }),
    );
    if (p.actions.length)
      box.append(el('div', { class: 'row' }, ...p.actions.map((a) => this.action(t, a))));
    return box;
  }
  private action(t: Train, a: ProblemAction) {
    const P = STR.trainPanel;
    switch (a) {
      case 'refuel':
        return btn(
          STR.train.emergency,
          () => emergencyRefuel(this.h.fleet, t, this.h.toast),
          'small',
        );
      case 'stops':
        return btn(P.editStops, () => this.setTab('stops'), 'small');
      case 'depot':
        return btn(P.openDepot, () => this.h.onDepot(), 'small');
    }
  }

  private drawOverview(t: Train, v: TrainOverview) {
    const P = STR.trainPanel;
    const out: (HTMLElement | null)[] = [
      el(
        'div',
        { class: 'tp-status' },
        el('span', { class: `ol-chip sev-${v.chip.sev}` }, buildIcon(v.chip.icon, 13), v.chip.text),
        el('span', { class: 'dim', text: `${v.speed} · ${P.topSpeed(v.topSpeed)}` }),
      ),
      el(
        'div',
        { class: 'tp-status' },
        el(
          'span',
          {},
          buildIcon('clock', 13),
          ` ${P.nextStop}: `,
          el('b', { text: v.next ?? P.noStop }),
        ),
        v.arrival ? el('span', { class: 'dim', text: v.arrival }) : null,
      ),
      v.problem ? this.problemBox(t, v.problem) : null,
      v.job ? el('div', { class: 'tp-note amber', text: v.job }) : null,
      this.section(P.cargo, `${v.load}%`),
    ];
    if (v.cargo.length)
      for (const c of v.cargo)
        out.push(
          el(
            'div',
            { class: 'tp-line' },
            el('span', {}, this.icon(c.res), cargoName(c.res)),
            el('b', { text: String(c.amount) }),
            this.meter(c.share),
          ),
        );
    else out.push(el('p', { class: 'bi-p dim', text: P.runningEmpty }));
    out.push(this.section(P.supplies));
    for (const k of v.supplies)
      out.push(
        el(
          'div',
          { class: 'tp-line' },
          el('span', {}, this.icon(k.res), cargoName(k.res)),
          el('b', { class: k.low ? 'red' : '', text: `${k.share}%` }),
          this.meter(k.share, k.low ? 'bad' : ''),
          k.tiles === null ? null : el('small', { text: P.tilesLeft(k.tiles) }),
        ),
      );
    if (v.electric) out.push(this.line(P.electric, v.electric));
    out.push(this.line(STR.train.range, v.range));
    out.push(this.section(P.week));
    out.push(this.line(P.income, v.income ?? P.afterFirstLoop, v.income ? 'good' : 'dim'));
    for (const f of v.flows)
      out.push(
        el(
          'div',
          { class: 'tp-line' },
          el('span', { text: f.label }),
          el(
            'span',
            { class: 'tp-goods' },
            ...(f.goods
              ? f.goods.map((g) => el('span', { class: 'ol-cg' }, this.icon(g.res), g.amount))
              : [el('span', { class: 'dim', text: P.afterFirstLoop })]),
          ),
        ),
      );
    this.scroll.replaceChildren(...out.filter((e) => e !== null));
  }

  // ---------------------------------------------------------------- Stops

  private drawStops(t: Train) {
    const P = STR.trainPanel;
    this.stops.show(t);
    this.scroll.replaceChildren(
      this.section(P.stops, P.repeats),
      el('div', { class: 'tp-note dim', text: `${STR.train.routing}: ${STR.train.mode[t.mode]}` }),
      this.stops.root,
      el('p', { class: 'bi-p dim', text: STR.depot.scheduleLiveHint }),
    );
  }

  // ---------------------------------------------------------------- Consist

  private drawConsist(t: Train) {
    const P = STR.trainPanel;
    const a = this.h.atlas;
    const car = (frame: string, title: string, cargo: string | null) => {
      const c = el('span', { class: 'tp-car', title });
      c.append(spriteImg(a, frame, 1, 'sprite-preview'));
      if (cargo) c.append(this.icon(cargo));
      return c;
    };
    const strip = el('div', { class: 'tp-strip' });
    for (const l of t.locos) strip.append(car(locoFrame(a, l.def, 3), l.def.name, null));
    for (const w of t.wagons) strip.append(car(wagonFrame(a, w.def, 0), w.def.name, w.cargo));
    if (!t.wagons.length) strip.append(el('span', { class: 'tp-none', text: P.noWagons }));
    const ph = t.physics;
    const out: HTMLElement[] = [strip, this.section(P.engine)];
    for (const l of t.locos)
      out.push(
        el(
          'div',
          { class: 'tp-loco' },
          this.line(l.def.name, STR.modes[l.mode]),
          vehicleLabels(l.def),
        ),
      );
    out.push(
      this.line(STR.train.speed, fmtSpeed(ph.vMax)),
      this.line(P.pulls, P.tons(Math.round(ph.haul))),
      this.section(P.train),
      this.line(P.wagons, String(t.wagons.length)),
      this.line(P.length, P.tiles(Math.round(t.length * 10) / 10)),
      this.line(P.weight, P.tons(Math.round(t.weight)), t.weight > t.power ? 'red' : ''),
      el('p', { class: 'bi-p dim', text: P.climb(fmtSpeed(climbSpeed(t))) }),
    );
    this.scroll.replaceChildren(...out);
  }
}
