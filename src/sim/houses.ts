import type { Builder, Decor, PlacementCheck } from './build';
import { decorDef } from './build';
import type { Town, TownRegistry } from './towns';
import { TOWN_RADIUS } from './towns';
import type { Stockpile } from './stockpile';
import { scaleCost } from './stockpile';
import type { Station } from './stations';
import { content, type Cost } from '../data/content';
import { rules, daySeconds } from './rules';
import { inBounds } from '../world/tiles';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import { STR } from '../strings';
import { sfx } from '../engine/audio';

/** Decor id of the townhouse (its tile, cost and toolbar slot stay with the decor system). */
export const HOUSE_ID = 'townhouse';

/** A townhouse: the decor piece on its tile plus the people in it and how far it is built. */
export interface House {
  x: number;
  y: number;
  /** 1 .. number of capacity steps in the data */
  level: number;
  residents: number;
  /** construction, 0 = foundations laid .. 1 = finished */
  progress: number;
  /** in-game days spent waiting for the next resident */
  grow: number;
  /** in-game days spent at capacity (a full house grows a storey on its own) */
  full: number;
}
export interface HouseJSON {
  x: number;
  y: number;
  level: number;
  residents: number;
  progress: number;
  grow?: number;
  full?: number;
}
export interface HousesJSON {
  list: HouseJSON[];
  /** [town id, game time] of recent train arrivals (the town's traffic) */
  arrivals: [number, number][];
  /** towns a train has already reached (first-train newcomers granted) */
  visited: number[];
}
/** Construction stages 0..2; 3 = finished. */
export type HouseStage = 0 | 1 | 2 | 3;
/** Housing figures of one town for the town panel. */
export interface TownHousing {
  houses: number;
  building: number;
  capacity: number;
  residents: number;
  growthPerDay: number;
  /** residents at which the town builds the next house */
  spawnAt: number;
  /** train arrivals inside the traffic window */
  traffic: number;
  /** houses built per spawn (1 + traffic / trafficPerMul, capped) */
  mul: number;
  /** no tile left to build on */
  cramped: boolean;
}

/**
 * Townhouses: each holds residents up to its level's capacity, fills slowly while there is wheat,
 * and grows a storey once it has been full for a while. Founded towns raise new houses on their
 * own when housing gets tight, faster where trains call often. The decor entry stays the tile
 * owner (placement, cost, town founding); this registry keeps the simulated state.
 */
export class HouseRegistry {
  readonly houses = new Map<number, House>();
  private arrivals: { town: number; at: number }[] = [];
  private visited = new Set<number>();
  /** game time after which a town that found no free tile may look again */
  private retryAt = new Map<number, number>();
  /** sprite or panel refresh after a stage or level change */
  onChanged: ((h: House) => void) | null = null;
  onMessage: ((msg: string, kind: 'info' | 'warn' | 'good') => void) | null = null;

  constructor(
    private readonly builder: Builder,
    private readonly towns: TownRegistry,
    private readonly stock: Stockpile,
  ) {}

  private key(x: number, y: number) {
    return y * this.builder.map.w + x;
  }
  get cfg() {
    return content.houses;
  }
  get maxLevel() {
    return this.cfg.capacity.length;
  }
  static isHouse(d: Decor) {
    return !!decorDef(d.id).residents;
  }
  at(x: number, y: number): House | undefined {
    return this.houses.get(this.key(x, y));
  }
  /** Keep the registry in step with the decor map (called for every decor change). */
  sync(d: Decor, removed: boolean) {
    if (!HouseRegistry.isHouse(d)) return;
    const k = this.key(d.x, d.y);
    if (removed) {
      this.houses.delete(k);
      return;
    }
    if (!this.houses.has(k))
      this.houses.set(k, { x: d.x, y: d.y, level: 1, residents: 0, progress: 0, grow: 0, full: 0 });
  }
  /** Pre-built houses (a level's content) stand finished with their first residents. */
  finishAll() {
    for (const h of this.houses.values())
      if (h.progress < 1) {
        h.progress = 1;
        h.residents = Math.min(this.capacity(h), this.cfg.startResidents);
        this.onChanged?.(h);
      }
  }

  capacity(h: House) {
    const c = this.cfg.capacity;
    return c[Math.min(c.length, Math.max(1, h.level)) - 1];
  }
  finished(h: House) {
    return h.progress >= 1;
  }
  stage(h: House): HouseStage {
    if (this.finished(h)) return 3;
    return Math.min(2, Math.floor(h.progress * 3)) as HouseStage;
  }
  /** Atlas frame of a house at its current stage and level. */
  frame(h: House) {
    const s = this.stage(h);
    if (s < 3) return `structures/${HOUSE_ID}_s${s}`;
    return h.level > 1 ? `structures/${HOUSE_ID}_${h.level}` : `structures/${HOUSE_ID}`;
  }
  /** Frame for any decor piece: houses by stage and level, everything else by id. */
  frameFor(d: Decor) {
    const h = HouseRegistry.isHouse(d) ? this.at(d.x, d.y) : undefined;
    return h ? this.frame(h) : `structures/${d.id}`;
  }
  residentsAt(x: number, y: number) {
    return this.at(x, y)?.residents ?? 0;
  }
  residentsTotal() {
    let n = 0;
    for (const h of this.houses.values()) n += h.residents;
    return n;
  }
  /** Wheat on hand and nobody starving: people only move in while there is food. */
  foodOk() {
    return this.stock.get('wheat') > 0 && !this.stock.famine;
  }
  /** Days until the next resident arrives in a house (null when nobody is coming). */
  growthDaysLeft(h: House): number | null {
    if (!this.finished(h) || h.residents >= this.capacity(h) || !this.foodOk()) return null;
    return Math.max(0, this.cfg.growthDays - h.grow);
  }

  // ------------------------------------------------------------------ upgrades
  upgradeCost(h: House): Cost | null {
    if (h.level >= this.maxLevel) return null;
    const c = this.cfg.upgradeCost[h.level - 1] ?? {};
    return this.builder.free ? {} : scaleCost(c, rules.buildCostMul);
  }
  canUpgrade(h: House): PlacementCheck {
    const cost = this.upgradeCost(h);
    if (!cost) return { ok: false, cost: {}, reason: STR.house.maxed };
    if (!this.finished(h)) return { ok: false, cost, reason: STR.house.building };
    if (!this.builder.free && !this.stock.canAfford(cost)) {
      const miss = this.stock.missing(cost);
      return {
        ok: false,
        cost,
        reason: STR.build.needResources(
          Object.entries(miss)
            .map(([k, v]) => `${v} ${k}`)
            .join(', '),
        ),
      };
    }
    return { ok: true, cost };
  }
  /** The player pays for a bigger house. */
  upgrade(h: House) {
    const c = this.canUpgrade(h);
    if (!c.ok) return false;
    if (!this.builder.free && !this.stock.spend(c.cost)) return false;
    this.levelUp(h);
    return true;
  }
  private levelUp(h: House) {
    h.level++;
    h.full = 0;
    this.onChanged?.(h);
    sfx('station.upgrade');
    this.onMessage?.(STR.house.upgraded(h.level), 'good');
  }

  // ------------------------------------------------------------------ towns
  private townHouses(t: Town): House[] {
    const out: House[] = [];
    for (const d of this.towns.members(t).decor) {
      const h = HouseRegistry.isHouse(d) ? this.at(d.x, d.y) : undefined;
      if (h) out.push(h);
    }
    return out;
  }
  /** Train arrivals at the town's stations inside the traffic window. */
  traffic(t: Town) {
    let n = 0;
    for (const a of this.arrivals) if (a.town === t.id) n++;
    return n;
  }
  spawnMul(t: Town) {
    return Math.min(
      this.cfg.spawnMulCap,
      1 + this.traffic(t) / Math.max(1, this.cfg.trafficPerMul),
    );
  }
  townHousing(t: Town): TownHousing {
    const list = this.townHouses(t);
    const out: TownHousing = {
      houses: 0,
      building: 0,
      capacity: 0,
      residents: 0,
      growthPerDay: 0,
      spawnAt: 0,
      traffic: this.traffic(t),
      mul: this.spawnMul(t),
      cramped: false,
    };
    const food = this.foodOk();
    for (const h of list) {
      out.capacity += this.capacity(h);
      out.residents += h.residents;
      if (this.finished(h)) {
        out.houses++;
        if (food && h.residents < this.capacity(h)) out.growthPerDay += 1 / this.cfg.growthDays;
      } else out.building++;
    }
    out.spawnAt = Math.ceil(this.cfg.spawnAt * out.capacity);
    out.cramped = (this.retryAt.get(t.id) ?? 0) > 0;
    return out;
  }
  /** Move `n` people into the town's finished houses that have room; returns how many fit. */
  private welcome(t: Town, n: number) {
    const list = this.townHouses(t).filter((h) => this.finished(h));
    let left = n;
    let guard = 0;
    while (left > 0 && guard++ < 1000) {
      const h = list.find((x) => x.residents < this.capacity(x));
      if (!h) break;
      h.residents++;
      left--;
      // round robin: the next newcomer tries the following house
      list.push(list.splice(list.indexOf(h), 1)[0]);
    }
    return n - left;
  }
  /** A producing station or works was built: newcomers for the town it stands in. */
  industryPlaced(x: number, y: number) {
    const t = this.towns.townAt(x, y);
    if (!t) return;
    const n = this.welcome(t, this.cfg.bonusIndustry);
    if (n > 0) this.onMessage?.(STR.town.newcomers(t.name, n), 'good');
  }
  /** A train pulled into a station: counts as traffic; the first one brings newcomers. */
  arrival(s: Station, now: number) {
    const t = this.towns.townOfStation(s);
    if (!t) return;
    this.arrivals.push({ town: t.id, at: now });
    if (this.visited.has(t.id)) return;
    const n = this.welcome(t, this.cfg.bonusFirstTrain);
    if (n <= 0) return;
    this.visited.add(t.id);
    this.onMessage?.(STR.town.firstTrain(t.name, n), 'good');
  }

  /** A free tile in the town's reach, preferring spots beside track and other houses. */
  private pickTile(t: Town): { x: number; y: number } | null {
    const s0 = this.towns.station(t);
    if (!s0) return null;
    const map = this.builder.map;
    const picks: { x: number; y: number; w: number }[] = [];
    for (let dy = -TOWN_RADIUS; dy <= TOWN_RADIUS; dy++)
      for (let dx = -TOWN_RADIUS; dx <= TOWN_RADIUS; dx++) {
        const x = s0.x + dx;
        const y = s0.y + dy;
        if (!inBounds(map, x, y) || !this.builder.regions.isTileUnlocked(x, y)) continue;
        if (this.towns.townAt(x, y)?.id !== t.id) continue;
        if (this.builder.canPlaceDecor(x, y, HOUSE_ID)) continue;
        let track = 0;
        let homes = 0;
        for (const d of DIRS) {
          const nx = x + DIR_DX[d];
          const ny = y + DIR_DY[d];
          if (this.builder.track.has(nx, ny)) track++;
          const dec = this.builder.decorAt(nx, ny);
          if (dec && HouseRegistry.isHouse(dec)) homes++;
        }
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const w = (1 + (track ? 2 : 0) + 1.5 * homes) / (1 + dist / 5);
        picks.push({ x, y, w });
      }
    if (!picks.length) return null;
    let r = Math.random() * picks.reduce((a, p) => a + p.w, 0);
    for (const p of picks) {
      r -= p.w;
      if (r <= 0) return p;
    }
    return picks[picks.length - 1];
  }
  /** The town builds `n` houses at its own expense; returns how many it could site. */
  private spawn(t: Town, n: number) {
    let done = 0;
    for (let i = 0; i < n; i++) {
      const p = this.pickTile(t);
      if (!p) break;
      const d = this.builder.spawnDecor(p.x, p.y, HOUSE_ID, Math.floor(Math.random() * 2));
      if (!d) break;
      done++;
    }
    return done;
  }

  // ------------------------------------------------------------------ sim
  /** Construction, growth and upgrades every tick; towns build new houses only while `spawn`. */
  tick(gdt: number, now: number, spawn = true) {
    const cfg = this.cfg;
    const days = gdt / daySeconds();
    const food = this.foodOk();
    for (const h of this.houses.values()) {
      if (!this.finished(h)) {
        const before = this.stage(h);
        h.progress = Math.min(1, h.progress + days / cfg.constructionDays);
        if (this.finished(h)) {
          h.residents = Math.min(this.capacity(h), cfg.startResidents);
          this.onMessage?.(STR.house.finished, 'info');
        }
        if (this.stage(h) !== before) this.onChanged?.(h);
        continue;
      }
      const cap = this.capacity(h);
      if (h.residents < cap) {
        h.full = 0;
        if (!food) continue;
        h.grow += days;
        while (h.grow >= cfg.growthDays && h.residents < cap) {
          h.grow -= cfg.growthDays;
          h.residents++;
        }
        if (h.residents >= cap) h.grow = 0;
      } else {
        h.grow = 0;
        if (!food) continue;
        h.full += days;
        if (h.full >= cfg.autoUpgradeDays && h.level < this.maxLevel) this.levelUp(h);
      }
    }
    // traffic window, then let tight towns build
    const oldest = now - cfg.trafficWindowDays * daySeconds();
    if (this.arrivals.length && this.arrivals[0].at < oldest)
      this.arrivals = this.arrivals.filter((a) => a.at >= oldest);
    if (!spawn) return;
    for (const t of this.towns.towns) {
      if ((this.retryAt.get(t.id) ?? 0) > now) continue;
      if (!this.towns.founded(t)) continue;
      const hs = this.townHousing(t);
      if (hs.capacity <= 0 || hs.residents < cfg.spawnAt * hs.capacity) continue;
      const want = Math.max(1, Math.round(hs.mul));
      const built = this.spawn(t, want);
      if (built > 0) {
        this.retryAt.delete(t.id);
        this.onMessage?.(STR.town.spawned(t.name, built), 'info');
      } else this.retryAt.set(t.id, now + daySeconds() / 2);
    }
  }

  toJSON(): HousesJSON {
    return {
      list: [...this.houses.values()].map((h) => ({
        x: h.x,
        y: h.y,
        level: h.level,
        residents: h.residents,
        progress: h.progress,
        grow: h.grow,
        full: h.full,
      })),
      arrivals: this.arrivals.map((a) => [a.town, a.at]),
      visited: [...this.visited],
    };
  }
  /** Apply saved state to the houses already synced from the decor map. */
  load(j: HousesJSON | undefined) {
    this.arrivals = [];
    this.visited.clear();
    this.retryAt.clear();
    if (!j) return;
    for (const hj of j.list ?? []) {
      const h = this.at(hj.x, hj.y);
      if (!h) continue;
      h.level = Math.max(1, Math.min(this.maxLevel, Math.round(hj.level) || 1));
      h.progress = Math.max(0, Math.min(1, hj.progress ?? 1));
      h.residents = Math.max(0, Math.min(this.capacity(h), Math.round(hj.residents) || 0));
      h.grow = hj.grow ?? 0;
      h.full = hj.full ?? 0;
      this.onChanged?.(h);
    }
    this.arrivals = (j.arrivals ?? []).map(([town, at]) => ({ town, at }));
    this.visited = new Set(j.visited ?? []);
  }
}
