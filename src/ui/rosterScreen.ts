import { el } from './dom';
import { STR } from '../strings';
import { rules } from '../sim/rules';
import {
  actionButton,
  card,
  cardGrid,
  emptyState,
  note,
  segmented,
  toggleSwitch,
  type SegOption,
} from './kit';
import type { Screen } from './modal';
import type { Confirm } from './menu';
import type { Inventory } from '../gacha/inventory';
import {
  RARITIES,
  STAT_PER_LEVEL,
  itemDef,
  levelMul,
  LEVEL_CAP,
  type Item,
  type LocoDef,
  type WagonDef,
  locoDef,
} from '../gacha/items';
import { cargoDef } from '../sim/cargo';
import { runsOn } from '../sim/compat';
import { rarityStars, vehicleLabels } from './labels';
import type { Fleet } from '../sim/fleet';
import type { Commands } from '../sim/commands';
import type { AtlasRegistry } from '../engine/atlas';
import { decorateSegmented, fragment, ScrollKeep, switchLine, vehicleArt } from './economyParts';
import { rarityClass } from './rarityClass';
import {
  KIND_FILTERS,
  SIZE_FILTERS,
  SORT_KEYS,
  filtered,
  levelGainPercent,
  levelUpState,
  pickOf,
  rosterItems,
  type KindFilter,
  type RosterEntry,
  type RosterFilters,
  type SortKey,
} from './rosterView';

/** Inventory browser: filters and sorting up top, one card per copy owned under them. */
export class RosterScreen implements Screen {
  readonly id = 'roster';
  readonly title = STR.roster.title;
  readonly icon = 'list';
  readonly root = el('div', { class: 'k-page ec-fixed' });
  private kind: KindFilter = 'all';
  private rarity = 'all';
  private sort: SortKey = 'rarity';
  private freeOnly = false;
  private size = 'all';
  private count = el('b', { class: 'ec-count' });
  private cards = el('div', { class: 'ec-scroll' });
  private scroll = new ScrollKeep(this.cards);
  /** what the cards were last built from: the same again builds nothing */
  private shown = '';
  /** set by the game: show a model in the Inspect 3D screen over this one */
  onInspect: ((defId: string) => void) | null = null;

  constructor(
    private readonly inventory: Inventory,
    private readonly fleet: Fleet,
    private readonly commands: Commands,
    private readonly atlas: AtlasRegistry,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void = () => {},
    /** the game's dialog, for the question before a copy is used up to level another */
    private readonly prompt: Confirm | null = null,
  ) {
    this.root.append(this.head(), this.cards);
  }

  onOpen() {
    this.render(true);
  }
  refresh() {
    this.scroll.restore();
    this.render(false);
  }

  // ---------------------------------------------------------------- the filters
  /** A filter strip: picking one starts the list again at the top. */
  private strip(
    label: string,
    options: SegOption[],
    value: string,
    set: (id: string) => void,
    marks?: (Node | null)[],
  ): HTMLElement {
    const seg = segmented({
      options,
      value,
      cls: 'small',
      onChange: (id) => {
        set(id);
        this.scroll.top();
        this.render(true);
      },
    });
    if (marks) decorateSegmented(seg, marks);
    return el('div', { class: 'ec-filter' }, el('span', { text: label }), seg);
  }

  private head(): HTMLElement {
    const kinds: SegOption[] = [
      { id: 'all', label: STR.roster.all },
      { id: 'loco', label: STR.rollingStock.loco },
      { id: 'wagon', label: STR.rollingStock.wagon },
    ];
    const rarities: SegOption[] = [
      { id: 'all', label: STR.roster.all },
      ...RARITIES.map((r) => ({ id: r, label: STR.craft.quality[r] ?? r })),
    ];
    const sorts: SegOption[] = [
      { id: 'rarity', label: STR.roster.rarity },
      { id: 'name', label: STR.roster.name },
      { id: 'level', label: STR.roster.level },
      { id: 'newest', label: STR.roster.newest },
    ];
    const sizes: SegOption[] = [
      { id: 'all', label: STR.roster.all },
      { id: 'tiny', label: STR.roster.sizes.tiny },
      { id: 'small', label: STR.roster.sizes.small },
      { id: 'medium', label: STR.roster.sizes.medium },
      { id: 'large', label: STR.roster.sizes.large },
    ];
    const free = toggleSwitch(
      STR.roster.freeOnly,
      () => this.freeOnly,
      (v) => {
        this.freeOnly = v;
        this.scroll.top();
        this.render(true);
      },
    );
    return el(
      'div',
      { class: 'ec-fhead' },
      el(
        'div',
        { class: 'ec-frow' },
        this.strip(STR.roster.kind, kinds, this.kind, (id) => {
          this.kind = pickOf(KIND_FILTERS, id, this.kind);
        }),
        this.strip(
          STR.roster.rarity,
          rarities,
          this.rarity,
          (id) => {
            this.rarity = pickOf(['all', ...RARITIES], id, this.rarity);
          },
          [null, ...RARITIES.map((r) => rarityStars(r, `rarity-${r}`))],
        ),
        this.count,
      ),
      el(
        'div',
        { class: 'ec-frow' },
        this.strip(STR.roster.sort, sorts, this.sort, (id) => {
          this.sort = pickOf(SORT_KEYS, id, this.sort);
        }),
        this.strip(STR.roster.sizeLabel, sizes, this.size, (id) => {
          this.size = pickOf(SIZE_FILTERS, id, this.size);
        }),
        switchLine(free, STR.roster.freeOnly),
      ),
    );
  }

  private filters(): RosterFilters {
    return {
      kind: this.kind,
      rarity: this.rarity,
      size: this.size,
      freeOnly: this.freeOnly,
      sort: this.sort,
    };
  }

  // ---------------------------------------------------------------- the cards
  private entry(it: Item): RosterEntry {
    const d = itemDef(it.defId);
    return {
      uid: it.uid,
      kind: it.kind,
      rarity: d.rarity,
      size: d.size,
      name: d.name,
      level: it.level,
      assigned: it.assigned,
      obtainedAt: it.obtainedAt,
    };
  }

  private render(force: boolean) {
    const f = this.filters();
    const all = this.inventory.items;
    const byUid = new Map(all.map((i) => [i.uid, i]));
    const items = rosterItems(
      all.map((i) => this.entry(i)),
      f,
    )
      .map((e) => byUid.get(e.uid))
      .filter((i): i is Item => !!i);
    const count = filtered(f)
      ? STR.roster.countOf(items.length, all.length)
      : STR.roster.count(all.length);
    if (this.count.textContent !== count) this.count.textContent = count;
    // what a card shows besides the model: its level, where it serves, whether it can be fitted
    const key = JSON.stringify([
      f,
      rules.inCabCost,
      items.map((i) => [
        i.uid,
        i.level,
        i.assigned === null ? null : (this.fleet.byId(i.assigned)?.name ?? '?'),
        !!i.inCab,
        this.inventory.spares(i).length > 0,
        this.inventory.count(i.defId),
      ]),
    ]);
    if (!force && key === this.shown) return;
    this.shown = key;
    this.scroll.around(() => {
      // the help stays when nothing matches: it is what explains Level up and the fitting
      this.cards.replaceChildren(
        note(STR.roster.help),
        items.length
          ? cardGrid(
              items.map((i) => this.card(i)),
              250,
            )
          : emptyState({ text: STR.roster.empty, icon: 'list' }),
      );
    });
  }

  private card(it: Item): HTMLElement {
    const d = itemDef(it.defId);
    const m = levelMul(it.level);
    const stats: string[] = [];
    if (it.kind === 'loco') {
      const ld = d as LocoDef;
      stats.push(
        `${STR.depot.speed} ${(ld.speed * m).toFixed(2)} · ${STR.depot.power} ${Math.round(ld.power * m)} t`,
        `${STR.depot.weight} ${ld.weight} t · ${STR.roster.crew} ${ld.crew}`,
        STR.roster.fuelLine(ld),
      );
      if (ld.controlClass) stats.push(STR.depot.controlClass(ld.controlClass));
    } else {
      const wd = d as WagonDef;
      stats.push(
        `${STR.roster.capacity} ${Math.round(wd.capacity * m)} · ${STR.depot.weight} ${wd.weight} t`,
        (wd.accepts ?? []).map((c) => cargoDef(c).name).join(', '),
      );
      if (wd.service) stats.push(STR.roster.serviceLine(wd.service, wd.serviceCap ?? 0));
    }
    // its train class and the lines it may run on
    stats.push(runsOn(d as LocoDef | WagonDef));
    const train = it.assigned !== null ? this.fleet.byId(it.assigned) : null;
    const art = vehicleArt(this.atlas, it.defId, 2);
    art.classList.add('ec-art');
    art.addEventListener('click', () => this.onInspect?.(it.defId));
    const eye = actionButton('', () => this.onInspect?.(it.defId), {
      cls: 'small ec-eye',
      icon: 'eye',
      title: STR.craft.inspect,
    });
    eye.setAttribute('aria-label', STR.craft.inspect);
    const foot: (Node | null)[] = [
      el('span', {
        class: 'ec-grow dim',
        text:
          it.level >= LEVEL_CAP
            ? STR.roster.maxLevel
            : STR.roster.copies(this.inventory.count(it.defId)),
      }),
      eye,
      this.levelButton(it),
      this.inCabPart(it),
    ];
    return card({
      rarity: rarityClass(d.rarity),
      title: d.name,
      badge: STR.roster.lv(it.level),
      sprite: art,
      sub: vehicleLabels(d),
      body: fragment(
        el('div', { class: 'ec-era', text: d.era }),
        el(
          'div',
          { class: 'ec-lines' },
          ...stats.filter(Boolean).map((t) => el('div', { text: t })),
        ),
        el('div', {
          class: `ec-where ${train ? 'on' : ''}`.trim(),
          text: train ? STR.roster.assignedTo(train.name) : STR.roster.inDepot,
        }),
      ),
      foot: fragment(...foot),
    });
  }

  /** Level up, as its state says: ready, off for want of a spare copy, or at the top (none). */
  private levelButton(it: Item): HTMLElement | null {
    const state = levelUpState(it.level, LEVEL_CAP, this.inventory.spares(it).length);
    if (state === 'max') return null;
    return actionButton(STR.roster.levelUp, () => void this.levelUp(it), {
      cls: 'small pri',
      disabled: state === 'noSpare',
      title: state === 'noSpare' ? STR.roster.levelUpNeedsSpare : STR.roster.levelUpHint,
    });
  }

  private async levelUp(it: Item) {
    const d = itemDef(it.defId);
    // a spare copy is used up: it is asked first, as the other questions that cost something are
    if (
      this.prompt &&
      !(await this.prompt.confirm(
        STR.roster.levelUpTitle(d.name, it.level, it.level + 1),
        STR.roster.levelUpText(it.kind === 'loco', levelGainPercent(STAT_PER_LEVEL)),
        { yes: STR.roster.levelUp },
      ))
    )
      return;
    if (this.inventory.consumeForLevel(it))
      this.toast(STR.roster.leveled(d.name, it.level), 'good');
    // the spare may have gone into a train while the question was up: say so, and show the stock
    else this.toast(STR.roster.levelUpNeedsSpare, 'warn');
    this.render(true);
  }

  /** In-cab signalling, fitted for money: with it a train runs on the shorter headway. */
  private inCabPart(it: Item): HTMLElement | null {
    if (it.kind !== 'loco') return null;
    if (it.inCab || locoDef(it.defId).inCab)
      return el('span', { class: 'dim ec-fitted', text: STR.roster.hasInCab });
    return actionButton(
      STR.roster.fitInCab(rules.inCabCost),
      () => {
        const done = this.commands.fitInCab(it);
        if (!done.ok) return this.toast(done.message, 'warn');
        this.toast(STR.roster.fitted(itemDef(it.defId).name), 'good');
        this.render(true);
      },
      { cls: 'small', title: STR.roster.fitInCabHint },
    );
  }
}
