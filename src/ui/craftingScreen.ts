import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
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
import { RARITIES, itemDef, itemKind, type LocoDef, type WagonDef } from '../gacha/items';
import type { Economy } from '../sim/economy';
import { fmtCost, type Stockpile } from '../sim/stockpile';
import type { Inventory } from '../gacha/inventory';
import { cargoDef } from '../sim/cargo';
import { sfx } from '../engine/audio';
import type { AtlasRegistry } from '../engine/atlas';
import { spriteImg, frameForItem } from './spritePreview';

/**
 * Two-step workshop: pay money to draw recipe cards and keep one, then spend stockpile
 * resources to build instances of known recipes.
 */
export class CraftingScreen implements Screen {
  readonly id = 'crafting';
  readonly title = STR.craft.title;
  readonly root = el('div', { class: 'craft' });
  private unlockCol = el('div', { class: 'col-body' });
  private recipeCol = el('div', { class: 'col-body' });
  private foot = el('div', { class: 'col-foot' });
  private pick: HTMLElement | null = null;
  private kind: CraftKind = 'loco';
  private tier = 0;
  /** what the last render showed, to skip needless rebuilds on refresh */
  private shownKey = '';

  constructor(
    private readonly crafting: Crafting,
    private readonly economy: Economy,
    private readonly stock: Stockpile,
    private readonly inventory: Inventory,
    private readonly now: () => number,
    private readonly toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private readonly atlas: AtlasRegistry,
  ) {
    const left = el(
      'div',
      { class: 'col', style: 'flex:0 0 300px' },
      el('div', { class: 'col-title', text: STR.craft.unlock }),
      this.unlockCol,
    );
    const right = el(
      'div',
      { class: 'col' },
      el('div', { class: 'col-title', text: STR.craft.recipes }),
      this.recipeCol,
      this.foot,
    );
    this.root.append(el('div', { class: 'cols' }, left, right));
  }
  onOpen() {
    this.shownKey = '';
    this.render();
    if (this.crafting.pending) this.showPick();
  }
  onClose() {
    this.hidePick();
  }
  refresh() {
    if (this.stateKey() !== this.shownKey) this.render();
  }
  private stateKey() {
    return [
      this.economy.money,
      ...craftResources().map((k) => Math.floor(this.stock.get(k))),
      this.crafting.recipes.size,
      this.inventory.items.length,
    ].join('|');
  }

  private render() {
    this.renderUnlock();
    this.renderRecipes();
    this.renderFoot();
    this.shownKey = this.stateKey();
  }

  // ------------------------------------------------------------------ left: recipes for money
  private renderUnlock() {
    const c = this.unlockCol;
    c.innerHTML = '';
    const group = (
      label: string,
      opts: { v: string; t: string }[],
      cur: string,
      set: (v: string) => void,
    ) => {
      const g = el(
        'div',
        { class: 'craft-choice' },
        el('span', { class: 'tb-label', text: label }),
      );
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
    c.append(
      group(
        STR.craft.kind,
        [
          { v: 'loco', t: STR.gacha.loco },
          { v: 'wagon', t: STR.gacha.wagon },
        ],
        this.kind,
        (v) => (this.kind = v as CraftKind),
      ),
      group(
        STR.craft.age,
        CRAFT_TIERS.map((t) => ({ v: String(t), t: STR.craft.ages[t] ?? String(t) })),
        String(this.tier),
        (v) => (this.tier = Number(v)),
      ),
    );
    const pool = craftPool(this.kind, this.tier);
    const known = pool.filter((id) => this.crafting.knows(id)).length;
    c.append(
      el('div', {
        class: 'sub dim',
        style: 'margin-top:6px',
        text: STR.craft.known(known, pool.length),
      }),
    );
    const list = el('div', { class: 'craft-pool' });
    if (!pool.length) list.append(el('div', { class: 'dim', text: STR.craft.noPool }));
    for (const r of [...RARITIES].reverse()) {
      const ids = pool.filter((id) => craftRarity(id) === r);
      if (!ids.length) continue;
      const line = el('div', { class: `sub rarity-${r}` }, `${STR.craft.quality[r] ?? r}: `);
      ids.forEach((id, i) => {
        line.append(
          el('span', {
            class: this.crafting.knows(id) ? 'known' : 'dim',
            text: itemDef(id).name + (i < ids.length - 1 ? ', ' : ''),
          }),
        );
      });
      list.append(line);
    }
    c.append(list);
    const price = this.crafting.unlockPrice(this.kind, this.tier);
    c.append(
      el('div', { class: 'craft-price', text: fmtMoney(price) }),
      el('div', {
        class: 'sub dim',
        style: 'margin:4px 0 8px',
        text: STR.craft.unlockHint(Math.min(CRAFT_CONFIG.cardsPerDraw, Math.max(pool.length, 1))),
      }),
    );
    const b = btn(STR.craft.unlockBtn(fmtMoney(price)), () => this.doDraw(), 'accent');
    b.disabled = !this.crafting.canDraw(this.kind, this.tier);
    if (this.crafting.pending) b.title = STR.craft.drawPending;
    c.append(b);
  }

  private doDraw() {
    const kind = this.kind;
    const tier = this.tier;
    if (!this.crafting.canDraw(kind, tier)) {
      if (this.crafting.pending) this.showPick();
      else this.toast(STR.build.funds, 'warn');
      return;
    }
    const drawn = this.crafting.draw(kind, tier);
    if (!drawn) return;
    sfx('gacha.pull');
    this.render();
    this.showPick();
  }

  // ------------------------------------------------------------------ card choice overlay
  private showPick() {
    const p = this.crafting.pending;
    if (!p) return;
    this.hidePick();
    const cards = el('div', { class: 'craft-cards' });
    for (const id of p.cards) cards.append(this.card(id));
    this.pick = el(
      'div',
      { class: 'craft-pick' },
      el('div', { class: 'craft-pick-title', text: STR.craft.pickTitle }),
      el('div', { class: 'dim', text: STR.craft.pickHint }),
      cards,
    );
    this.root.append(this.pick);
  }
  private hidePick() {
    this.pick?.remove();
    this.pick = null;
  }
  private card(id: string) {
    const d = itemDef(id);
    const r = d.rarity;
    const owned = this.crafting.knows(id);
    const stats: string[] = [];
    if (itemKind(id) === 'loco') {
      const ld = d as LocoDef;
      stats.push(
        `${STR.depot.speed} ${ld.speed.toFixed(2)} · ${STR.depot.power} ${ld.power} t`,
        `${STR.roster.type[ld.type] ?? ld.type} · ${STR.depot.weight} ${ld.weight} t`,
      );
    } else {
      const wd = d as WagonDef;
      stats.push(
        `${STR.roster.capacity} ${wd.capacity} · ${STR.depot.weight} ${wd.weight} t`,
        (wd.accepts ?? []).map((c) => cargoDef(c).name).join(', '),
      );
    }
    const card = el(
      'div',
      { class: `gcard flipped rarity-${r}` },
      el(
        'div',
        { class: 'gcard-front' },
        el(
          'div',
          { class: 'gcard-top' },
          el('div', { class: `gcard-rarity rarity-${r}`, text: STR.craft.quality[r] ?? r }),
          spriteImg(this.atlas, frameForItem(id), 2, 'sprite-preview gcard-art'),
        ),
        el('div', { class: 'gcard-name', text: d.name }),
        el('div', {
          class: 'gcard-kind',
          text: itemKind(id) === 'loco' ? STR.gacha.loco : STR.gacha.wagon,
        }),
        el('div', { class: 'gcard-stats' }, ...stats.map((s) => el('div', { text: s }))),
        el('div', {
          class: `gcard-dupe ${owned ? 'owned' : 'new'}`,
          text: owned
            ? STR.craft.ownedBadge(fmtCost(CRAFT_CONFIG.ownedRefund))
            : STR.craft.newBadge,
        }),
        btn(STR.craft.keep, () => this.doChoose(id), 'small accent'),
      ),
    );
    card.addEventListener('click', () => this.doChoose(id));
    return card;
  }
  private doChoose(id: string) {
    const res = this.crafting.choose(id);
    this.hidePick();
    if (!res) {
      this.render();
      return;
    }
    const name = itemDef(id).name;
    if (res.owned) this.toast(STR.craft.recipeRefund(name, fmtCost(res.refund)), 'info');
    else {
      sfx(craftRarity(id) === 'SSR' ? 'gacha.ssr' : 'gacha.reveal');
      this.toast(STR.craft.recipeLearned(name), 'good');
    }
    this.render();
  }

  // ------------------------------------------------------------------ right: instances for resources
  private renderRecipes() {
    const c = this.recipeCol;
    c.innerHTML = '';
    const known = this.crafting.known();
    if (!known.length) {
      c.append(el('div', { class: 'dim', text: STR.craft.noRecipes }));
      return;
    }
    for (const id of known) c.append(this.recipeRow(id));
  }
  private recipeRow(id: string) {
    const d = itemDef(id);
    const cost = this.crafting.instanceCost(id);
    const missing = this.stock.missing(cost);
    const short = Object.keys(missing).length > 0;
    const b = btn(STR.craft.craftBtn, () => this.doCraft(id), 'small accent');
    b.disabled = short;
    return el(
      'div',
      { class: `craft-recipe rarity-${d.rarity}` },
      spriteImg(this.atlas, frameForItem(id), 1, 'sprite-preview item-art'),
      el(
        'div',
        { class: 'body' },
        el(
          'div',
          {},
          el('span', {
            class: `rarity-${d.rarity}`,
            text: STR.craft.quality[d.rarity] ?? d.rarity,
          }),
          ' ',
          el('span', { class: 'name', text: d.name }),
          el('span', {
            class: 'tag',
            text: itemKind(id) === 'loco' ? STR.gacha.loco : STR.gacha.wagon,
          }),
        ),
        el('div', { class: 'sub', text: `${STR.craft.cost}: ${fmtCost(cost)}` }),
        el('div', {
          class: 'sub',
          text: `${STR.craft.failChance(Math.round(this.crafting.failChance(id) * 100))} · ${STR.craft.copies(this.inventory.count(id))}`,
        }),
        short ? el('div', { class: 'sub short', text: STR.craft.missing(fmtCost(missing)) }) : null,
      ),
      b,
    );
  }
  private doCraft(id: string) {
    const res = this.crafting.craft(id, this.now());
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
    this.render();
  }

  private renderFoot() {
    const f = this.foot;
    f.innerHTML = '';
    const s = this.crafting.stats;
    const res = craftResources()
      .map((k) => `${Math.floor(this.stock.get(k))} ${k}`)
      .join(' · ');
    f.append(
      el('span', { class: 'num', text: `${STR.craft.resources}: ${res}` }),
      el('span', { style: 'flex:1' }),
      el('span', {
        class: 'dim',
        text: STR.craft.stats(this.crafting.recipes.size, s.crafts, s.failures),
      }),
    );
  }
}
