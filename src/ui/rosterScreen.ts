import { el, btn } from './dom';
import { STR } from '../strings';
import { rules } from '../sim/rules';
import type { Screen } from './modal';
import type { Inventory } from '../gacha/inventory';
import {
  RARITIES,
  itemDef,
  levelMul,
  LEVEL_CAP,
  type Item,
  type LocoDef,
  type WagonDef,
  locoDef,
} from '../gacha/items';
import { cargoDef } from '../sim/cargo';
import type { Fleet } from '../sim/fleet';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg, frameForItem } from './spritePreview';

type KindFilter = 'all' | 'loco' | 'wagon';
type SortKey = 'rarity' | 'name' | 'level' | 'newest';

/** Inventory browser with filters and sorting. */
export class RosterScreen implements Screen {
  readonly id = 'roster';
  readonly title = STR.roster.title;
  readonly root = el('div', { class: 'cols', style: 'flex-direction:column' });
  private bar = el('div', { class: 'col-foot', style: 'border:none;padding:0 0 6px 0' });
  private list = el('div', { class: 'col-body roster-grid' });
  private kind: KindFilter = 'all';
  private rarity: string = 'all';
  private sort: SortKey = 'rarity';
  private freeOnly = false;
  /** pay for a fit-out; returns false when short of money (set by the game) */
  spendMoney: ((amount: number) => boolean) | null = null;

  constructor(
    private readonly inventory: Inventory,
    private readonly fleet: Fleet,
    private readonly atlas: AtlasRegistry,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void = () => {},
  ) {
    this.root.append(this.bar, el('div', { class: 'col' }, this.list));
  }
  onOpen() {
    this.render();
  }
  refresh() {
    this.render();
  }

  private render() {
    const b = this.bar;
    b.innerHTML = '';
    const group = (
      label: string,
      opts: { v: string; t: string }[],
      cur: string,
      set: (v: string) => void,
    ) => {
      const g = el('div', { class: 'tb-group' }, el('span', { class: 'tb-label', text: label }));
      for (const o of opts)
        g.append(
          btn(
            o.t,
            () => {
              set(o.v);
              this.render();
            },
            `small ${cur === o.v ? 'active' : ''}`,
          ),
        );
      return g;
    };
    b.append(
      group(
        STR.roster.kind,
        [
          { v: 'all', t: STR.roster.all },
          { v: 'loco', t: STR.gacha.loco },
          { v: 'wagon', t: STR.gacha.wagon },
        ],
        this.kind,
        (v) => (this.kind = v as KindFilter),
      ),
      group(
        STR.roster.rarity,
        [{ v: 'all', t: STR.roster.all }, ...RARITIES.map((r) => ({ v: r, t: r }))],
        this.rarity,
        (v) => (this.rarity = v),
      ),
      group(
        STR.roster.sort,
        [
          { v: 'rarity', t: STR.roster.rarity },
          { v: 'name', t: STR.roster.name },
          { v: 'level', t: STR.roster.level },
          { v: 'newest', t: STR.roster.newest },
        ],
        this.sort,
        (v) => (this.sort = v as SortKey),
      ),
      group(
        '',
        [{ v: 'free', t: STR.roster.freeOnly }],
        this.freeOnly ? 'free' : '',
        () => (this.freeOnly = !this.freeOnly),
      ),
      el('span', {
        class: 'dim',
        style: 'margin-left:auto',
        text: STR.roster.count(this.inventory.items.length),
      }),
    );
    const items = this.inventory.items
      .filter((i) => this.kind === 'all' || i.kind === this.kind)
      .filter((i) => this.rarity === 'all' || itemDef(i.defId).rarity === this.rarity)
      .filter((i) => !this.freeOnly || i.assigned === null);
    const rIdx = (i: Item) => RARITIES.indexOf(itemDef(i.defId).rarity);
    items.sort((a, c) => {
      switch (this.sort) {
        case 'rarity':
          return rIdx(c) - rIdx(a) || itemDef(a.defId).name.localeCompare(itemDef(c.defId).name);
        case 'name':
          return itemDef(a.defId).name.localeCompare(itemDef(c.defId).name);
        case 'level':
          return c.level - a.level || rIdx(c) - rIdx(a);
        default:
          return c.obtainedAt - a.obtainedAt || c.uid - a.uid;
      }
    });
    const l = this.list;
    l.innerHTML = '';
    if (!items.length) l.append(el('div', { class: 'dim', text: STR.roster.empty }));
    for (const it of items) l.append(this.card(it));
  }

  private card(it: Item) {
    const d = itemDef(it.defId);
    const m = levelMul(it.level);
    const stats: string[] = [];
    if (it.kind === 'loco') {
      const ld = d as LocoDef;
      stats.push(
        `${STR.depot.speed} ${(ld.speed * m).toFixed(2)}`,
        `${STR.depot.power} ${Math.round(ld.power * m)} t`,
        `${STR.depot.weight} ${ld.weight} t · ${STR.roster.crew} ${ld.crew}`,
        STR.roster.fuelLine(ld),
      );
      if (ld.controlClass) stats.push(STR.depot.controlClass(ld.controlClass));
    } else {
      const wd = d as WagonDef;
      stats.push(
        `${STR.roster.capacity} ${Math.round(wd.capacity * m)}`,
        `${STR.depot.weight} ${wd.weight}t`,
        (wd.accepts ?? []).map((c) => cargoDef(c).name).join(', '),
      );
      if (wd.service) stats.push(STR.roster.serviceLine(wd.service, wd.serviceCap ?? 0));
    }
    const train = it.assigned !== null ? this.fleet.byId(it.assigned) : null;
    const spares = this.inventory.spares(it).length;
    const lvl = el(
      'div',
      { class: 'sub dim', style: 'display:flex;gap:6px;align-items:center' },
      el('span', {
        style: 'flex:1',
        text:
          it.level >= LEVEL_CAP
            ? STR.roster.maxLevel
            : STR.roster.copies(this.inventory.count(it.defId)),
      }),
    );
    if (it.level < LEVEL_CAP && spares > 0) {
      const up = btn(
        STR.roster.levelUp,
        () => {
          if (this.inventory.consumeForLevel(it)) {
            this.toast(STR.roster.leveled(d.name, it.level), 'good');
            this.render();
          }
        },
        'tiny',
      );
      up.title = STR.roster.levelUpHint;
      lvl.append(up);
    }
    // in-cab signalling: the one hard requirement of high-speed track, fitted for money
    if (it.kind === 'loco' && !it.inCab && !locoDef(it.defId).inCab && this.spendMoney) {
      const fit = btn(
        STR.roster.fitInCab(rules.inCabCost),
        () => {
          if (this.spendMoney!(rules.inCabCost)) {
            it.inCab = true;
            this.toast(STR.roster.fitted(d.name), 'good');
            this.render();
          } else this.toast(STR.roster.noMoney, 'warn');
        },
        'tiny',
      );
      fit.title = STR.roster.fitInCabHint;
      lvl.append(fit);
    } else if (it.kind === 'loco' && (it.inCab || locoDef(it.defId).inCab))
      lvl.append(el('span', { class: 'dim', text: STR.roster.hasInCab }));
    return el(
      'div',
      { class: `rcard rarity-${d.rarity}` },
      el(
        'div',
        { class: 'rcard-head' },
        el('span', { class: `rarity-${d.rarity}`, text: d.rarity }),
        el('span', { class: 'name', text: d.name }),
        el('span', { class: 'num', text: `Lv ${it.level}` }),
      ),
      el(
        'div',
        { class: 'rcard-body' },
        spriteImg(this.atlas, frameForItem(it.defId), 2, 'sprite-preview rcard-art'),
        el('div', { class: 'gcard-era', text: d.era }),
      ),
      el('div', { class: 'sub' }, ...stats.map((s) => el('div', { text: s }))),
      lvl,
      el('div', {
        class: `sub ${train ? 'cyan' : 'dim'}`,
        text: train ? STR.roster.assignedTo(train.name) : STR.roster.inDepot,
      }),
    );
  }
}
