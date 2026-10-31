import { ageIcon } from './ageIcon';
import { vehicleProperties } from './vehicleProperties';
import { el, fmtMoney } from './dom';
import { rarityStars } from './labels';
import { AGE_ORDER, STR } from '../strings';
import {
  actionButton,
  card,
  cardGrid,
  emptyState,
  formRow,
  listRow,
  meter,
  note,
  searchField,
  segmented,
  well,
  type FootSpec,
} from './kit';
import type { Screen } from './modal';
import {
  CRAFT_CONFIG,
  CRAFT_TIERS,
  craftPool,
  craftResources,
  craftRarity,
  type Crafting,
  type CraftKind,
} from '../gacha/crafting';
import { itemDef, itemKind, type LocoDef, type WagonDef } from '../gacha/items';
import type { Economy } from '../sim/economy';
import { fmtCost, type ResourceStore, type StoreRegistry } from '../sim/stores';
import type { Cost } from '../data/content';
import type { Inventory } from '../gacha/inventory';
import { cargoDef } from '../sim/cargo';
import { sfx } from '../engine/audio';
import type { AtlasRegistry } from '../engine/atlas';
import { decorateSegmented, fragment, resIcon, ScrollKeep, vehicleArt } from './economyParts';
import {
  RECIPE_FILTERS,
  filterRecipes,
  heldChoice,
  knownShare,
  pickFilter,
  poolByRarity,
  stockLine,
  unlockOff,
} from './craftView';
import { rarityClass } from './rarityClass';

const KINDS: CraftKind[] = ['loco', 'wagon'];

/**
 * Two steps in one frame: pay money to draw recipe cards and keep one, then spend stored resources
 * to build copies of the recipes known. The unlock side stays where it is; a waiting draw takes the
 * place of the recipe list until a card is kept, and holds Kind and Age at what was bought.
 */
export class CraftingScreen implements Screen {
  readonly id = 'crafting';
  readonly title = STR.craft.title;
  readonly icon = 'factory';
  /** the search field is typed in, and Tab goes round the controls */
  readonly formKeys = true;
  readonly root = el('div', { class: 'k-page ec-split' });
  /** set by the game: show a model in the Inspect 3D screen over this one */
  onInspect: ((defId: string) => void) | null = null;

  private side = el('div', { class: 'ec-side' });
  private main = el('div', { class: 'ec-main' });
  private sideScroll = new ScrollKeep(this.side);
  private kind: CraftKind = 'loco';
  private tier = 0;
  private filter = 'all';
  private search = '';
  // the recipe list's head outlives every redraw of the list, so what is typed in it stays
  private filterSeg = segmented({
    options: RECIPE_FILTERS.map((id) => ({
      id,
      label: STR.craft.filterShort[id],
      title: STR.craft.filter[id],
    })),
    value: this.filter,
    cls: 'wide small',
    onChange: (id) => {
      this.filter = pickFilter(id, this.filter);
      this.drawList(true);
    },
  });
  private searchBox = searchField({
    placeholder: STR.craft.search,
    onInput: (text) => {
      this.search = text;
      this.drawList(true);
    },
  });
  private count = el('span', { class: 'ec-count' });
  private list = el('div', { class: 'ec-list' });
  private listScroll = new ScrollKeep(this.list);
  private recipesWell: HTMLElement;
  private drawWell: HTMLElement | null = null;
  /** what each part last drew, so the same state draws nothing */
  private sideKey = '';
  private mainKey = '';
  private listKey = '';

  constructor(
    private readonly crafting: Crafting,
    /** the draw's money is the Crafting object's own: the screen asks it, and does not read funds */
    _economy: Economy,
    /** the selected store is the one the workshop builds from and refunds into */
    private readonly stores: StoreRegistry,
    private readonly inventory: Inventory,
    private readonly now: () => number,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private readonly atlas: AtlasRegistry,
  ) {
    this.searchBox.input.setAttribute('aria-label', STR.craft.searchLabel);
    this.recipesWell = well(
      { title: STR.craft.recipes, cls: 'ec-fill' },
      el('div', { class: 'ec-rhead' }, this.filterSeg),
      el('div', { class: 'ec-rhead' }, this.searchBox.root, this.count),
      this.list,
    );
    this.root.append(this.side, this.main);
  }

  onOpen() {
    this.render(true);
  }
  refresh() {
    this.sideScroll.restore();
    this.listScroll.restore();
    this.render(false);
  }
  frameFooter(): FootSpec {
    return { note: this.stockNote() };
  }

  /** The store the workshop works from: the selected one, else the grid, which holds none. */
  private get stock(): ResourceStore {
    return this.stores.selected ?? this.stores.grid;
  }
  private stockNote(): string {
    const have = stockLine(craftResources(), (k) => this.stock.get(k));
    return `${STR.craft.resources(this.stores.label(this.stock))}: ${have}`;
  }

  // ---------------------------------------------------------------- what is on show
  /** Kind and Age as they stand: a draw waiting holds them at what was bought. */
  private held() {
    const p = this.crafting.pending;
    const h = heldChoice(p ? { kind: p.kind, tier: p.tier } : null, {
      kind: this.kind,
      tier: this.tier,
    });
    this.kind = h.choice.kind;
    this.tier = h.choice.tier;
    return h.held;
  }

  private render(force: boolean) {
    const held = this.held();
    const pool = craftPool(this.kind, this.tier);
    const sideKey = JSON.stringify([
      this.kind,
      this.tier,
      held,
      this.crafting.recipes.size,
      this.crafting.canDraw(this.kind, this.tier),
      pool.length,
    ]);
    if (force || sideKey !== this.sideKey) {
      this.sideKey = sideKey;
      this.sideScroll.around(() => this.side.replaceChildren(this.unlockWell(pool, held)));
    }
    const pending = this.crafting.pending;
    const mainKey = pending ? `draw|${pending.cards.join(',')}` : 'recipes';
    if (force || mainKey !== this.mainKey) {
      this.mainKey = mainKey;
      if (pending) {
        this.drawWell = this.pickWell(pending.cards, pending.kind, pending.tier);
        this.main.replaceChildren(this.drawWell);
      } else {
        this.drawWell = null;
        this.main.replaceChildren(this.recipesWell);
        this.drawList(true);
      }
    }
    if (!pending) this.drawList(false);
  }

  // ---------------------------------------------------------------- the unlock side
  private unlockWell(pool: string[], held: boolean): HTMLElement {
    const kindSeg = segmented({
      options: KINDS.map((k) => ({
        id: k,
        label: k === 'loco' ? STR.gacha.loco : STR.gacha.wagon,
      })),
      value: this.kind,
      cls: 'small',
      onChange: (id) => {
        this.kind = id as CraftKind;
        this.render(true);
      },
    });
    const ageSeg = segmented({
      options: CRAFT_TIERS.map((t) => ({
        id: String(t),
        label: STR.craft.filterShort[AGE_ORDER[t]],
        title: STR.ages.name[AGE_ORDER[t]],
      })),
      value: String(this.tier),
      cls: 'small',
      onChange: (id) => {
        this.tier = Number(id);
        this.render(true);
      },
    });
    decorateSegmented(
      ageSeg,
      CRAFT_TIERS.map((t) => ageIcon(AGE_ORDER[t])),
    );
    if (held) {
      for (const seg of [kindSeg, ageSeg]) {
        seg.classList.add('off');
        seg.title = STR.craft.heldHint;
      }
    }
    const k = knownShare(pool, (id) => this.crafting.knows(id));
    const price = this.crafting.unlockPrice(this.kind, this.tier);
    const off = unlockOff({
      pending: !!this.crafting.pending,
      poolSize: pool.length,
      canAfford: this.crafting.canDraw(this.kind, this.tier) || !!this.crafting.pending,
    });
    const button = actionButton(STR.craft.unlockBtn(fmtMoney(price)), () => this.doDraw(), {
      cls: 'pri',
      disabled: off !== null,
      title:
        off === 'pending'
          ? STR.craft.drawPending
          : off === 'noPool'
            ? STR.craft.noPool
            : off === 'funds'
              ? STR.build.funds
              : undefined,
    });
    return well(
      STR.craft.unlock,
      formRow(STR.craft.kind, kindSeg),
      formRow(STR.craft.age, ageSeg),
      meter(STR.craft.recipesKnown, `${k.known} / ${k.total}`, k.share),
      this.poolList(pool),
      el('div', { class: 'ec-price', text: fmtMoney(price) }),
      note(STR.craft.unlockHint(Math.min(CRAFT_CONFIG.cardsPerDraw, Math.max(pool.length, 1)))),
      el('div', { class: 'ec-buy' }, button),
    );
  }

  /** The models of the pool by quality, the ones known in bright text. */
  private poolList(pool: string[]): HTMLElement {
    const box = el('div', { class: 'ec-pool' });
    if (!pool.length) box.append(el('div', { class: 'k-p', text: STR.craft.noPool }));
    for (const g of poolByRarity(pool, (id) => craftRarity(id))) {
      const names = el('span', { class: 'ec-names' });
      g.ids.forEach((id, i) =>
        names.append(
          el('span', {
            class: this.crafting.knows(id) ? 'known' : 'dim',
            text: itemDef(id).name + (i < g.ids.length - 1 ? ', ' : ''),
          }),
        ),
      );
      box.append(
        el(
          'div',
          { class: `ec-poolrow r-${rarityClass(g.rarity)}` },
          el(
            'span',
            { class: 'ec-qual' },
            rarityStars(g.rarity, `rarity-${g.rarity}`),
            STR.craft.quality[g.rarity] ?? g.rarity,
          ),
          names,
        ),
      );
    }
    return box;
  }

  private doDraw() {
    const kind = this.kind;
    const tier = this.tier;
    if (!this.crafting.canDraw(kind, tier)) {
      if (!this.crafting.pending) this.toast(STR.build.funds, 'warn');
      return;
    }
    const drawn = this.crafting.draw(kind, tier);
    if (!drawn) return;
    sfx('gacha.pull');
    this.render(true);
  }

  // ---------------------------------------------------------------- the draw
  private pickWell(ids: string[], kind: CraftKind, tier: number): HTMLElement {
    const kindName = kind === 'loco' ? STR.gacha.loco : STR.gacha.wagon;
    return well(
      {
        title: STR.craft.pickTitle,
        right: STR.craft.drawOf(kindName, STR.ages.name[AGE_ORDER[tier]] ?? ''),
        cls: 'ec-fill',
      },
      note(STR.craft.pickHint),
      el(
        'div',
        { class: 'ec-draw' },
        cardGrid(
          ids.map((id) => this.drawCard(id)),
          220,
        ),
      ),
    );
  }

  private drawCard(id: string): HTMLElement {
    const d = itemDef(id);
    const owned = this.crafting.knows(id);
    const lines: string[] = [];
    if (itemKind(id) === 'loco') {
      const ld = d as LocoDef;
      lines.push(
        `${STR.depot.speed} ${ld.speed.toFixed(2)} · ${STR.depot.power} ${ld.power} t`,
        `${STR.roster.type[ld.type] ?? ld.type} · ${STR.depot.weight} ${ld.weight} t`,
      );
    } else {
      const wd = d as WagonDef;
      lines.push(
        `${STR.roster.capacity} ${wd.capacity} · ${STR.depot.weight} ${wd.weight} t`,
        (wd.accepts ?? []).map((c) => cargoDef(c).name).join(', '),
      );
    }
    const art = vehicleArt(this.atlas, id, 2);
    art.classList.add('ec-art');
    art.addEventListener('click', () => this.onInspect?.(id));
    return card({
      rarity: rarityClass(d.rarity),
      title: d.name,
      sprite: art,
      sub: fragment(
        el(
          'span',
          { class: `rarity-${d.rarity}` },
          rarityStars(d.rarity, `rarity-${d.rarity}`),
          ` ${STR.craft.quality[d.rarity] ?? d.rarity}`,
        ),
        ` · ${itemKind(id) === 'loco' ? STR.gacha.loco : STR.gacha.wagon}`,
      ),
      body: fragment(
        el(
          'div',
          { class: 'ec-lines' },
          ...lines.filter(Boolean).map((t) => el('div', { text: t })),
        ),
        el('div', {
          class: `ec-badge ${owned ? 'known' : 'new'}`,
          text: owned
            ? STR.craft.ownedBadge(fmtCost(CRAFT_CONFIG.ownedRefund))
            : STR.craft.newBadge,
        }),
      ),
      foot: fragment(
        actionButton(STR.craft.inspect, () => this.onInspect?.(id), { cls: 'small', icon: 'eye' }),
        el('span', { class: 'ec-grow' }),
        actionButton(STR.craft.keep, () => this.doChoose(id), { cls: 'small pri' }),
      ),
    });
  }

  private doChoose(id: string) {
    const res = this.crafting.choose(id, this.stock);
    if (res) {
      const name = itemDef(id).name;
      if (res.owned) this.toast(STR.craft.recipeRefund(name, fmtCost(res.refund)), 'info');
      else {
        sfx(craftRarity(id) === 'SSR' ? 'gacha.ssr' : 'gacha.reveal');
        this.toast(STR.craft.recipeLearned(name), 'good');
      }
    }
    this.render(true);
  }

  // ---------------------------------------------------------------- the recipes
  /** The recipes known that the filter and the search leave, in the game's order. */
  private visible(): string[] {
    const known = this.crafting.known().map((id) => {
      const d = itemDef(id);
      return { id, name: d.name, group: 'type' in d ? d.type : d.carries };
    });
    return filterRecipes(known, this.filter, this.search).map((r) => r.id);
  }

  private drawList(force: boolean) {
    const ids = this.visible();
    const total = this.crafting.recipes.size;
    const rows = ids.map((id) => {
      const cost = this.crafting.instanceCost(id);
      return { id, cost, missing: this.stock.missing(cost) };
    });
    const key = JSON.stringify([
      this.filter,
      rows.map((r) => [r.id, r.missing, this.inventory.count(r.id)]),
      total,
    ]);
    const count =
      ids.length === total ? STR.craft.count(total) : STR.craft.countOf(ids.length, total);
    if (this.count.textContent !== count) this.count.textContent = count;
    if (!force && key === this.listKey) return;
    this.listKey = key;
    this.listScroll.around(() => {
      if (!rows.length) {
        this.list.replaceChildren(
          emptyState({ text: total ? STR.roster.empty : STR.craft.noRecipes, icon: 'factory' }),
        );
        return;
      }
      this.list.replaceChildren(...rows.map((r) => this.recipeRow(r.id, r.cost, r.missing)));
    });
  }

  private costLine(cost: Cost, missing: Cost): HTMLElement {
    const line = el('div', { class: 'ec-cost' }, `${STR.craft.cost}: `);
    for (const [k, v] of Object.entries(cost)) {
      if (v <= 0) continue;
      line.append(
        el(
          'span',
          { class: `ec-c ${missing[k] ? 'short' : ''}`.trim(), title: k },
          resIcon(this.atlas, k),
          el('b', { text: String(Math.ceil(v)) }),
        ),
      );
    }
    return line;
  }

  private recipeRow(id: string, cost: Cost, missing: Cost): HTMLElement {
    const d = itemDef(id);
    const short = Object.keys(missing).length > 0;
    const props = vehicleProperties(id);
    const missingText = STR.craft.missing(fmtCost(missing));
    const art = vehicleArt(this.atlas, id, 1);
    art.classList.add('ec-art');
    art.addEventListener('click', () => this.onInspect?.(id));
    const sub: (HTMLElement | null)[] = [
      el(
        'span',
        {},
        el(
          'span',
          { class: `rarity-${d.rarity}` },
          rarityStars(d.rarity, `rarity-${d.rarity}`),
          ` ${STR.craft.quality[d.rarity] ?? d.rarity}`,
        ),
        ` · ${props.slice(0, 2).join(' · ')}`,
      ),
      el('span', { text: props[2] ?? '' }),
      this.costLine(cost, missing),
      el('span', {
        text: `${STR.craft.failChance(Math.round(this.crafting.failChance(id) * 100))} · ${STR.craft.copies(this.inventory.count(id))}`,
      }),
      short ? el('span', { class: 'ec-short', text: missingText }) : null,
    ];
    return listRow({
      cls: `ec-recipe r-${rarityClass(d.rarity)}`,
      sprite: art,
      title: el(
        'span',
        { class: `rarity-${d.rarity}` },
        d.name,
        el('em', {
          class: 'ec-tag',
          text: itemKind(id) === 'loco' ? STR.gacha.loco : STR.gacha.wagon,
        }),
      ),
      sub: sub.filter((n) => n !== null),
      right: [
        actionButton(STR.craft.inspect, () => this.onInspect?.(id), { cls: 'small', icon: 'eye' }),
        actionButton(STR.craft.craftBtn, () => this.doCraft(id), {
          cls: 'small pri',
          disabled: short,
          title: short ? missingText : undefined,
        }),
      ],
    });
  }

  private doCraft(id: string) {
    const res = this.crafting.craft(id, this.stock, this.now());
    const name = itemDef(id).name;
    if (!res) {
      this.toast(
        STR.craft.missing(fmtCost(this.stock.missing(this.crafting.instanceCost(id)))),
        'warn',
      );
      return;
    }
    if (res.ok) {
      sfx('gacha.reveal');
      this.toast(STR.craft.crafted(name), 'good');
    } else {
      const got = Object.values(res.refund).some((v) => v > 0);
      this.toast(
        got ? STR.craft.failed(name, fmtCost(res.refund)) : STR.craft.failedNothing(name),
        'warn',
      );
    }
    this.render(true);
  }
}
