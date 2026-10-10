import type { TrackClass, TrackKind } from '../world/track';
import type { StationJSON } from './stations';
import type { MapGenParams } from '../world/mapgen';
import { DEFAULT_MAP_PARAMS } from '../world/mapgen';
import type { LevelData } from '../world/level';
import type { Rules } from './rules';
import type { TownJSON } from './towns';
import type { HousesJSON } from './houses';
import type { SupplyMode } from './supply';
import type { SignalLevel } from './signals';
import type { PeopleJSON } from './people';
import type { BuildingJSON } from './buildings';
import { CHUNK_TILES } from './expand';

/** What the map was built from; a level save carries the whole level. */
export type WorldSpec =
  | { kind: 'generated'; seed: number; params: MapGenParams }
  | { kind: 'level'; seed: number; level: LevelData };

export const SAVE_VERSION = 13;
/**
 * Regular curves and switches were one tile until v13. One-tile track is narrow gauge now: those
 * pieces become narrow, and the lines meeting them need re-laying with 2×2 pieces.
 */
export function convertOneTileRegular(track: SaveGame['track']): SaveGame['track'] {
  return track.map(([x, y, kind, rot, cls, cls2]) =>
    (kind === 'curve' || kind === 'switch') && (cls ?? 'regular') === 'regular'
      ? [x, y, kind, rot, 'narrow', cls2]
      : [x, y, kind, rot, cls, cls2],
  );
}
/** oldest version `readSave` still accepts; missing fields get defaults */
export const SAVE_MIN_VERSION = 1;
export const SAVE_KEY = 'terepasztal.save';
export const SETTINGS_KEY = 'terepasztal.settings';

/**
 * Everything a save holds besides its version and time stamp: what `buildSave` writes. Every
 * field is required, so a save cannot be written with one left out, and `KNOWN_SAVE_KEYS` is
 * built from the same names. A file read back may lack the fields added after v1 (`SaveGame`).
 */
export interface SaveParts {
  seed: number;
  clock: { time: number; speedIndex: number };
  /** v9: `tier` is the age index; `earned` the lifetime income (reputation dropped) */
  economy: {
    money: number;
    tickets: number;
    tier: number;
    granted: number[];
    earned?: number;
    /** pre-v9 field, ignored */
    reputation?: number;
  };
  /** anchor tiles: x, y, kind, rotation, class (v9), second class of crossings (v9) */
  track: [number, number, TrackKind, number, TrackClass?, TrackClass?][];
  stations: StationJSON[];
  trains: unknown[];
  contracts: unknown;
  inventory: unknown;
  gacha: unknown;
  camera: { x: number; y: number; zoomIndex: number };
  lastDay: number;
  /** v2: signals and water towers [x, y, id, rot] */
  decor: [number, number, string, number][];
  /** v9: electrified track [x, y, kind] */
  wires: [number, number, string][];
  /** v2: weather generator state */
  weather: unknown;
  /** v3: how the map was built */
  world: WorldSpec;
  /** v3: the rules the game was played with */
  rules: Partial<Rules>;
  /** v4: global resources */
  stockpile: unknown;
  /** v4: processing buildings, as `buildingToJSON` writes them */
  buildings: BuildingJSON[];
  /** v5: owned chunks */
  regions: boolean[];
  /** v6: season of day 1 (0 spring .. 3 winter) */
  seasonOffset: number;
  /** v7: towns (names, colours) keyed by their town station */
  towns: TownJSON[];
  /** v8: standing trade deals */
  trade: unknown;
  /** v10: known crafting recipes, craft statistics and an unfinished recipe draw */
  crafting: unknown;
  /** v9: townhouses (level, residents, construction) plus town traffic and first-train marks */
  houses: HousesJSON;
  /** v9: production-chain mode the game was started with */
  supply: SupplyMode;
  /**
   * The walkers' random stream (no format version of its own): a file without it seeds them from
   * the map. The persons themselves are not saved and start over on load.
   */
  people: PeopleJSON;
}
/** The fields every format version since v1 has; the others arrived later and may be missing. */
type SaveCore =
  | 'seed'
  | 'clock'
  | 'economy'
  | 'track'
  | 'stations'
  | 'trains'
  | 'contracts'
  | 'inventory'
  | 'gacha'
  | 'camera'
  | 'lastDay';

/** A save as read from a file of any version: `SaveParts`, the later fields optional. */
export interface SaveGame extends Pick<SaveParts, SaveCore>, Partial<Omit<SaveParts, SaveCore>> {
  version: number;
  savedAt: number;
  /**
   * v8 to v13: player settings travelled with a save. Retired, as they travel with the settings
   * alone: never read, never written, and an old file's copy goes on its next save.
   */
  settings?: Settings;
  /** set on load when the file was written by another format version (not persisted) */
  loadedFrom?: number;
  /** what the migration steps filled in (not persisted) */
  migrationNotes?: string[];
  /** anything a newer or unknown build wrote is kept and written back */
  [extra: string]: unknown;
}

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  ambient?: number;
  edgeScroll: boolean;
  autosave: boolean;
  dayNight: boolean;
  smoke: boolean;
  showFps: boolean;
  weather: boolean;
  /** v6: helper tips shown */
  advisor?: boolean;
  /** v8 (retired in v9): accept contract offers as they come; migrated into `contractPolicy` */
  autoContracts?: boolean;
  /** v9: what happens to a new offer of each rarity */
  contractPolicy?: Record<ContractRarity, ContractPolicy>;
  /**
   * Which default `contractPolicy` was written under: absent (1) when every offer was accepted
   * by default, `CONTRACT_POLICY_VERSION` once offers wait for the player by default.
   */
  contractPolicyVersion?: number;
  /** v10: signalling level (auto keeps the claims only) */
  signalling?: SignalLevel;
}
/** Contract rarities, commonest first; `contracts.json` carries the numbers for each. */
export const CONTRACT_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type ContractRarity = (typeof CONTRACT_RARITIES)[number];
/** accept: taken as it appears; prompt: left on the board; deny: dropped (free before acceptance) */
export type ContractPolicy = 'accept' | 'prompt' | 'deny';
/** What a new offer of any rarity meets unless the player chose otherwise: it waits for them. */
export const DEFAULT_CONTRACT_POLICY: ContractPolicy = 'prompt';
/** `Settings.contractPolicyVersion` of settings written since offers wait by default. */
export const CONTRACT_POLICY_VERSION = 2;
export function uniformContractPolicy(p: ContractPolicy): Record<ContractRarity, ContractPolicy> {
  return { common: p, uncommon: p, rare: p, epic: p, legendary: p };
}
/** Policy for a rarity; a missing entry is the default. */
export function contractPolicyFor(s: Settings, rarity: ContractRarity): ContractPolicy {
  return s.contractPolicy?.[rarity] ?? DEFAULT_CONTRACT_POLICY;
}
/**
 * Turn the retired `autoContracts` flag into a per-rarity policy (true → accept, false → prompt),
 * as settings that travelled with a version 8 save had it.
 */
function retireAutoContracts(s: Partial<Settings>) {
  if (!s.contractPolicy && s.autoContracts !== undefined)
    s.contractPolicy = uniformContractPolicy(s.autoContracts === false ? 'prompt' : 'accept');
  delete s.autoContracts;
}
/**
 * Bring stored settings to the current shape. Runs on the stored object before defaults are
 * merged in, so a missing policy is still visible. The retired `autoContracts` flag becomes a
 * per-rarity policy; then, once, settings written while every offer was accepted by default move
 * to the new default: a policy that accepts every rarity (a missing entry read as accept then),
 * or none at all, becomes `DEFAULT_CONTRACT_POLICY` for every rarity. Any other policy is the
 * player's own choice and stays, its missing entries filled with the accept they meant.
 */
export function migrateSettings<T extends Partial<Settings>>(s: T): T {
  retireAutoContracts(s);
  const v = s.contractPolicyVersion;
  if (typeof v === 'number' && v >= CONTRACT_POLICY_VERSION) return s;
  const old: Partial<Record<ContractRarity, unknown>> = isRecord(s.contractPolicy)
    ? s.contractPolicy
    : {};
  const policy = Object.fromEntries(
    CONTRACT_RARITIES.map((r) => [r, old[r] ?? 'accept']),
  ) as Record<ContractRarity, ContractPolicy>;
  s.contractPolicy = CONTRACT_RARITIES.every((r) => policy[r] === 'accept')
    ? uniformContractPolicy(DEFAULT_CONTRACT_POLICY)
    : policy;
  s.contractPolicyVersion = CONTRACT_POLICY_VERSION;
  return s;
}
export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.8,
  music: 0.5,
  ambient: 0.35,
  edgeScroll: true,
  autosave: true,
  dayNight: true,
  smoke: true,
  showFps: false,
  weather: true,
  advisor: true,
  contractPolicy: uniformContractPolicy(DEFAULT_CONTRACT_POLICY),
  contractPolicyVersion: CONTRACT_POLICY_VERSION,
};

/** One step of the migration chain: brings a save from `from` to `from + 1`. */
export interface Migration {
  from: number;
  /** what the step fills in with defaults, shown to the player */
  note: string;
  run(j: SaveGame): void;
}
/** Starter models version 13 added: John Bull took the Rocket's place, and narrow wagons arrived. */
const V13_STARTERS: [id: string, kind: 'loco' | 'wagon', copies: number][] = [
  ['john_bull', 'loco', 1],
  ['mine_tub', 'wagon', 2],
  ['narrow_tank', 'wagon', 2],
  ['narrow_box', 'wagon', 2],
  ['narrow_coach', 'wagon', 2],
];
/** Give an older save the models it has none of, with their recipes, like a fresh game has. */
function grantStarters(j: SaveGame, models: typeof V13_STARTERS) {
  const inv = j.inventory as
    { items?: { uid?: number; defId?: unknown }[]; nextUid?: number } | undefined;
  if (!inv || !Array.isArray(inv.items)) return;
  let uid = Math.max(inv.nextUid ?? 1, ...inv.items.map((i) => (i.uid ?? 0) + 1));
  const crafting = j.crafting as { recipes?: string[] } | undefined;
  for (const [defId, kind, copies] of models) {
    if (inv.items.some((i) => i.defId === defId)) continue;
    for (let n = 0; n < copies; n++)
      inv.items.push({
        uid: uid++,
        defId,
        kind,
        level: 1,
        assigned: null,
        dupes: 0,
        obtainedAt: 0,
      } as { uid: number; defId: string });
    if (crafting?.recipes && !crafting.recipes.includes(defId)) crafting.recipes.push(defId);
  }
  inv.nextUid = uid;
}

/** The map size a world description builds, read the way map generation and levels read it. */
function worldSize(world: unknown): { w: number; h: number } {
  const spec = isRecord(world) ? world : {};
  const size = spec.kind === 'level' ? spec.level : spec.params;
  const dim = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    w: dim(isRecord(size) ? size.w : undefined, DEFAULT_MAP_PARAMS.w),
    h: dim(isRecord(size) ? size.h : undefined, DEFAULT_MAP_PARAMS.h),
  };
}
/** The tier a file stored, uncapped (the step from v8 caps it later): 0 when absent. */
function storedTier(economy: unknown): number {
  const tier = isRecord(economy) ? economy.tier : undefined;
  return typeof tier === 'number' && tier > 0 ? tier : 0;
}
/**
 * Chunk ownership before chunks were bought, as the load code rebuilt it from the tier reached:
 * one entry per chunk of the map the world builds (`emptyMap`'s grid), owned when it lies within
 * `tier` rings of the chunk map generation starts in. A chunk's ring is its Chebyshev distance
 * from the start chunk in whole chunks, `regionTierMap`'s rule, so tier 0 owns the start chunk
 * alone.
 */
function chunksWithinTier(world: unknown, tier: number): boolean[] {
  const { w, h } = worldSize(world);
  const regionsX = Math.max(1, Math.ceil(w / CHUNK_TILES));
  const regionsY = Math.max(1, Math.ceil(h / CHUNK_TILES));
  const startX = Math.floor((regionsX - 1) / 2);
  const startY = Math.floor((regionsY - 1) / 2);
  return Array.from({ length: regionsX * regionsY }, (_, i) => {
    const ring = Math.max(
      Math.abs((i % regionsX) - startX),
      Math.abs(Math.floor(i / regionsX) - startY),
    );
    return ring <= tier;
  });
}
/**
 * The names route modes had when a train's `mode` arrived, and the names they have now. A train
 * older than its `mode` has only the `dynamic` flag.
 */
const OLD_ROUTE_MODES = new Map([
  ['fixed', 'schedule'],
  ['dynamic', 'production'],
  ['collect', 'collection'],
]);
/** A train's route mode under its current name: an old name mapped, a missing one from the flag. */
function routeMode(train: Record<string, unknown>): unknown {
  const m = train.mode;
  if (typeof m === 'string' && OLD_ROUTE_MODES.has(m)) return OLD_ROUTE_MODES.get(m);
  if (!m) return train.dynamic ? 'production' : 'schedule';
  return m;
}

/**
 * Registry of version-to-version upgrades, run in order. Each step only knows the shape it
 * upgrades from; adding a format version means adding one entry here.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    note: 'services and signals list started empty',
    run: (j) => (j.decor = j.decor ?? []),
  },
  {
    from: 2,
    note: 'world description rebuilt from the seed with default map parameters',
    run: (j) =>
      (j.world = j.world ?? {
        kind: 'generated',
        seed: j.seed,
        params: { ...DEFAULT_MAP_PARAMS },
      }),
  },
  {
    from: 3,
    note: 'works buildings list started empty',
    run: (j) => (j.buildings = j.buildings ?? []),
  },
  {
    from: 4,
    note: 'owned chunks rebuilt from the tier reached: every chunk within that many rings of the start chunk',
    run: (j) => (j.regions = j.regions ?? chunksWithinTier(j.world, storedTier(j.economy))),
  },
  {
    from: 5,
    note: 'season of day 1 set to spring',
    run: (j) => (j.seasonOffset = j.seasonOffset ?? 0),
  },
  {
    from: 6,
    note: 'towns started empty, station orientation 0, routing modes mapped to the new names, a depot placed at the start (applied on load)',
    run: (j) => {
      j.towns = j.towns ?? [];
      for (const s of j.stations) if (isRecord(s)) s.rot = s.rot ?? 0;
      for (const t of j.trains) if (isRecord(t)) t.mode = routeMode(t);
    },
  },
  {
    from: 7,
    note: 'trade desk opened empty: no standing deals, fuel at its base price',
    run: (j) => (j.trade = j.trade ?? { deals: {}, nextAt: 0, fuelMul: 1, driftDay: 0 }),
  },
  {
    from: 8,
    note: 'every track piece counted as wide track; catenary strung over rails the poles powered (applied on load); townhouses became level 1 houses with six residents each; reputation dropped: the tier reached becomes the age (capped at the Electric Age), lifetime income starts at 0, production chain set to simple; contracts rated Common with no train assigned; the auto-accept switch became a per-rarity policy',
    run: (j) => {
      const book = j.contracts as { contracts?: Record<string, unknown>[] } | undefined;
      for (const c of book?.contracts ?? []) {
        c.rarity = c.rarity ?? 'common';
        c.trainId = c.trainId ?? null;
        delete c.reputation;
      }
      if (j.settings) retireAutoContracts(j.settings);
      j.supply = j.supply ?? 'simple';
      if (j.economy) {
        j.economy.tier = Math.max(0, Math.min(2, j.economy.tier ?? 0));
        j.economy.earned = j.economy.earned ?? 0;
        delete j.economy.reputation;
      }
      if (j.houses) return;
      const list = (j.decor ?? []).filter(([, , id]) => id === 'townhouse');
      j.houses = {
        list: list.map(([x, y]) => ({ x, y, level: 1, residents: 6, progress: 1 })),
        arrivals: [],
        visited: [],
      };
    },
  },
  {
    from: 9,
    note: 'crafting recipes granted for every model already in the inventory; locomotive modes set by the default rule (the first unit leads, units of its control class run in multiple, the rest double-headed; applied on load); battery carts start empty',
    run: (j) => {
      for (const t of j.trains) {
        const tanks = isRecord(t) ? t.tanks : undefined;
        if (isRecord(tanks)) tanks.battery = tanks.battery ?? 0;
      }
      if (j.crafting) return;
      const inv = j.inventory as { items?: { defId?: unknown }[] } | undefined;
      const recipes = new Set<string>();
      for (const it of inv?.items ?? []) if (typeof it.defId === 'string') recipes.add(it.defId);
      j.crafting = { recipes: [...recipes], stats: { unlocks: 0, crafts: 0, failures: 0 } };
    },
  },
  {
    from: 10,
    note: 'contract offers slowed down (two at a time, every six days) unless tuned by hand; the high-speed quest starts unfinished',
    run: (j) => {
      const r = j.rules as
        { contractRefreshDays?: number; contractOfferCount?: number } | undefined;
      if (r) {
        if (r.contractRefreshDays === 1.5) r.contractRefreshDays = 6;
        if (r.contractOfferCount === 3) r.contractOfferCount = 2;
      }
    },
  },
  {
    from: 11,
    note: 'weekly food economy, works upgrades, independent bridge platforms and passenger Stations; existing Townhouses retain their town identity',
    run: (j) => {
      if (j.rules) {
        if ([2, 6].includes(j.rules.contractRefreshDays ?? 0)) j.rules.contractRefreshDays = 21;
        if (j.rules.contractOfferCount === 2) j.rules.contractOfferCount = 1;
        j.rules.tradeCycleDays = 7;
      }
      const trade = j.trade as { nextAt?: number; driftDay?: number } | undefined;
      if (trade) {
        trade.nextAt = 0;
        trade.driftDay = Math.floor((trade.driftDay ?? 0) / 7);
      }
      const stock = j.stockpile as { amounts?: Record<string, number> } | undefined;
      if (stock?.amounts && stock.amounts.food === undefined)
        stock.amounts.food = Math.max(600, (stock.amounts.wheat ?? 0) * 5);
      for (const s of j.stations)
        if (s.defId === 'town') {
          delete s.storage.passengers;
          if (s.name.startsWith('Town Station'))
            s.name = s.name.replace('Town Station', 'Townhouse');
        }
      const board = j.contracts as { contracts?: { cargo: string; status: string }[] } | undefined;
      for (const c of board?.contracts ?? [])
        if (c.cargo === 'passengers' && ['active', 'offer'].includes(c.status))
          c.status = 'expired';
      j.buildings = j.buildings ?? [];
      j.track = j.track.map(([x, y, kind, rot, cls, cls2]) => {
        if (kind === 'bridge') {
          if (!j.buildings!.some((b) => b[0] === x && b[1] === y))
            j.buildings!.push([x, y, 'bridge_wood', 0, 1]);
          return [x, y, 'straight', rot, cls, cls2];
        }
        return [x, y, kind, rot, cls, cls2];
      });
    },
  },
  {
    from: 12,
    note: "wide-track curves and switches were one tile: they became narrow gauge, and lines meeting them need re-laying with 2×2 pieces. Stephenson's Rocket and the Mk48 are narrow gauge now: recall their trains and build them again with the narrow wagons added to the inventory",
    run: (j) => {
      j.track = convertOneTileRegular(j.track);
      grantStarters(j, V13_STARTERS);
    },
  },
];
/** Every field of `SaveParts`, once: leaving one out, or naming one it lacks, fails to compile. */
const SAVE_PART_KEYS: Record<keyof SaveParts, true> = {
  seed: true,
  clock: true,
  economy: true,
  track: true,
  stations: true,
  trains: true,
  contracts: true,
  inventory: true,
  gacha: true,
  camera: true,
  lastDay: true,
  decor: true,
  wires: true,
  weather: true,
  world: true,
  rules: true,
  stockpile: true,
  buildings: true,
  regions: true,
  seasonOffset: true,
  towns: true,
  trade: true,
  crafting: true,
  houses: true,
  supply: true,
  people: true,
};
/** The names a type declares, without the `string` and `number` of an index signature. */
type DeclaredKey<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};
/** The rest of what `SaveGame` declares: the stamps, the retired settings and the load notes. */
const SAVE_OWN_KEYS: Record<Exclude<DeclaredKey<SaveGame>, keyof SaveParts>, true> = {
  version: true,
  savedAt: true,
  settings: true,
  loadedFrom: true,
  migrationNotes: true,
};
/**
 * Fields the current build knows; everything else is carried through untouched. The retired
 * `settings` is known too, so an old file's copy is dropped on the next save instead of carried.
 */
export const KNOWN_SAVE_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(SAVE_PART_KEYS),
  ...Object.keys(SAVE_OWN_KEYS),
]);

/**
 * A save of the current format: the fields of the loaded file this build does not know
 * (`extra`), then the parts, then the version and time stamp. A known name in `extra` is left
 * out, so neither the retired settings nor the load notes are written back.
 */
export function buildSave(
  parts: SaveParts,
  extra: Record<string, unknown> = {},
  now = Date.now(),
): SaveGame {
  const unknown = Object.fromEntries(
    Object.entries(extra).filter(([k]) => !KNOWN_SAVE_KEYS.has(k)),
  );
  return { ...unknown, ...parts, version: SAVE_VERSION, savedAt: now };
}

/**
 * Why a text was not taken as a save: it is not JSON, it is JSON but no save (no numeric seed),
 * or it is a save without something every version since v1 holds; or, for an import, storage
 * refused to keep it (full or blocked).
 */
export type SaveRefusal = 'json' | 'notSave' | 'damaged' | 'storage';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** The numbers inside the blocks every version since v1 has, checked before migrating. */
const CORE_NUMBERS: Record<string, readonly string[]> = {
  clock: ['time', 'speedIndex'],
  economy: ['money', 'tickets', 'tier'],
  camera: ['x', 'y', 'zoomIndex'],
};
/** The lists every version since v1 has. */
const CORE_LISTS = ['track', 'stations', 'trains'];
/** Does a parsed file hold what every version since v1 holds, with the types it was written as? */
function holdsCore(j: Record<string, unknown>) {
  for (const [block, fields] of Object.entries(CORE_NUMBERS)) {
    const b = j[block];
    if (!isRecord(b) || fields.some((f) => typeof b[f] !== 'number')) return false;
  }
  return CORE_LISTS.every((k) => Array.isArray(j[k])) && typeof j.lastDay === 'number';
}
/** The save object in a text: a diagnostics bundle gives the save it carries. */
function openSave(
  raw: string,
): { file: Record<string, unknown> & { seed: number } } | { error: 'json' | 'notSave' } {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { error: 'json' };
  }
  if (isRecord(j) && j.diagnostics === 1 && isRecord(j.save)) j = j.save;
  if (!isRecord(j) || typeof j.seed !== 'number') return { error: 'notSave' };
  return { file: j as Record<string, unknown> & { seed: number } };
}
/** A file that holds every v1 field, migrated to the current version; null when it does not. */
function settle(file: Record<string, unknown>): SaveGame | null {
  if (!holdsCore(file)) return null;
  const j = file as SaveGame;
  // no version, or none the chain can count up from, is the oldest
  if (!Number.isInteger(j.version) || j.version < SAVE_MIN_VERSION) j.version = SAVE_MIN_VERSION;
  try {
    return migrate(j);
  } catch {
    // a step met something deeper in the file that no version wrote
    return null;
  }
}

/**
 * Read a save text: an exported save, a stored one or a diagnostics bundle. Never refuses on
 * version: older saves are upgraded step by step, newer ones are loaded as they are with a
 * warning. Text that is not a whole save is refused, with the reason.
 */
export function readSaveText(raw: string): { save: SaveGame } | { error: SaveRefusal } {
  const opened = openSave(raw);
  if ('error' in opened) return opened;
  const save = settle(opened.file);
  return save ? { save } : { error: 'damaged' };
}
/** Parse and migrate a save text; null for anything `readSaveText` refuses. */
export function parseSave(raw: string): SaveGame | null {
  const read = readSaveText(raw);
  return 'save' in read ? read.save : null;
}
/** The stored game Continue loads; null when there is none or it is refused (it stays stored). */
export function readSave(): SaveGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return parseSave(raw);
  } catch {
    return null;
  }
}
/**
 * Store a save text the player brought (an export or a diagnostics bundle) as the game Continue
 * loads. A refused text stores nothing; a save storage will not keep (full or blocked) is refused
 * as `storage`, and Continue still loads what it did. The player's settings are never touched: the
 * copy that files from v8 to v13 carry is not applied.
 */
export function importSave(
  raw: string,
): { ok: true; save: SaveGame } | { ok: false; error: SaveRefusal } {
  const read = readSaveText(raw);
  if ('error' in read) return { ok: false, error: read.error };
  if (!writeSave(read.save)) return { ok: false, error: 'storage' };
  return { ok: true, save: read.save };
}
/** Run the migration chain from the save's version to the current one; records where it came from. */
export function migrate(j: SaveGame): SaveGame {
  const from = j.version;
  const notes: string[] = [];
  while (j.version < SAVE_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === j.version);
    if (!step) {
      notes.push(`no upgrade step from format v${j.version}; defaults apply`);
      j.version++;
      continue;
    }
    step.run(j);
    notes.push(`v${step.from}→v${step.from + 1}: ${step.note}`);
    j.version = step.from + 1;
  }
  if (from !== SAVE_VERSION) {
    j.loadedFrom = from;
    j.migrationNotes = notes;
  }
  return j;
}

export function writeSave(s: SaveGame) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
/** The defaults overlaid by `stored`, sharing no object with `DEFAULT_SETTINGS`. */
function settingsFrom(stored: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...stored };
  if (s.contractPolicy) s.contractPolicy = { ...s.contractPolicy };
  return s;
}
export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return settingsFrom(raw ? migrateSettings(JSON.parse(raw) as Partial<Settings>) : {});
  } catch {
    return settingsFrom({});
  }
}
export function writeSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ named slots
export const SLOTS_KEY = 'terepasztal.slots';
/** What a list of saves shows of one; a field the file lacks reads 0. */
export interface SlotMeta {
  /** the slot's name; '' for the save Continue loads */
  name: string;
  savedAt: number;
  /** the format version the file was written in */
  version: number;
  seed: number;
  day: number;
  /** the age reached (`economy.tier`) */
  age: number;
  money: number;
}
function readSlots(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    const slots: unknown = raw ? JSON.parse(raw) : {};
    return isRecord(slots) ? (slots as Record<string, string>) : {};
  } catch {
    return {};
  }
}
/** The name a slot is stored under: trimmed, at most 32 characters. */
function slotName(name: string) {
  return name.trim().slice(0, 32).trimEnd();
}
const numberOr0 = (v: unknown) => (typeof v === 'number' ? v : 0);
/**
 * What a stored text shows in a list, or null when it holds no save. A whole save is described
 * after migrating, so an old file's tier reads as the age it became; a damaged one as it stands,
 * unless `whole` asks for whole saves only.
 */
function describeSave(name: string, raw: unknown, whole: boolean): SlotMeta | null {
  if (typeof raw !== 'string') return null;
  const opened = openSave(raw);
  if ('error' in opened) return null;
  const { file } = opened;
  const version = numberOr0(file.version);
  const savedAt = numberOr0(file.savedAt);
  const save = settle(file);
  if (!save && whole) return null;
  const s: Record<string, unknown> = save ?? file;
  const economy = isRecord(s.economy) ? s.economy : {};
  return {
    name,
    savedAt,
    version,
    seed: file.seed,
    day: numberOr0(s.lastDay),
    age: numberOr0(economy.tier),
    money: numberOr0(economy.money),
  };
}
/** The save Continue loads, described like a slot (name ''); null when Continue has none to load. */
export function continueMeta(): SlotMeta | null {
  try {
    return describeSave('', localStorage.getItem(SAVE_KEY), true);
  } catch {
    return null;
  }
}
/** Is there a named save that `writeSlot(name, ...)` would replace? */
export function hasSlot(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(readSlots(), slotName(name));
}
function writeSlots(slots: Record<string, string>) {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
    return true;
  } catch {
    return false;
  }
}
/**
 * Named saves, newest first. A damaged one is listed too, so it can be deleted (loading it is
 * refused); text that holds no save at all is skipped.
 */
export function listSlots(): SlotMeta[] {
  const out: SlotMeta[] = [];
  for (const [name, raw] of Object.entries(readSlots())) {
    const meta = describeSave(name, raw, false);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
export function writeSlot(name: string, s: SaveGame) {
  const slots = readSlots();
  slots[slotName(name)] = JSON.stringify(s);
  return writeSlots(slots);
}
/** A named save, migrated; null when there is none by that name or it is refused. */
export function readSlot(name: string): SaveGame | null {
  const raw: unknown = readSlots()[name];
  return typeof raw === 'string' ? parseSave(raw) : null;
}
export function deleteSlot(name: string) {
  const slots = readSlots();
  delete slots[name];
  return writeSlots(slots);
}
