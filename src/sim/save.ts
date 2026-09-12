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

/** What the map was built from; a level save carries the whole level. */
export type WorldSpec =
  | { kind: 'generated'; seed: number; params: MapGenParams }
  | { kind: 'level'; seed: number; level: LevelData };

export const SAVE_VERSION = 10;
/** oldest version `readSave` still accepts; missing fields get defaults */
export const SAVE_MIN_VERSION = 1;
export const SAVE_KEY = 'terepasztal.save';
export const SETTINGS_KEY = 'terepasztal.settings';

export interface SaveGame {
  version: number;
  savedAt: number;
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
  decor?: [number, number, string, number][];
  /** v9: electrified track [x, y, kind] */
  wires?: [number, number, string][];
  /** v2: weather generator state */
  weather?: unknown;
  /** v3: how the map was built */
  world?: WorldSpec;
  /** v3: the rules the game was played with */
  rules?: Partial<Rules>;
  /** v4: global resources */
  stockpile?: unknown;
  /** v4: processing buildings [x, y, id, acc] */
  buildings?: [number, number, string, number][];
  /** v5: owned chunks */
  regions?: boolean[];
  /** v6: season of day 1 (0 spring .. 3 winter) */
  seasonOffset?: number;
  /** v7: towns (names, colours) keyed by their town station */
  towns?: TownJSON[];
  /** v8: player settings travel with an exported save */
  settings?: Settings;
  /** v8: standing trade deals */
  trade?: unknown;
  /** v10: known crafting recipes, craft statistics and an unfinished recipe draw */
  crafting?: unknown;
  /** v9: townhouses (level, residents, construction) plus town traffic and first-train marks */
  houses?: HousesJSON;
  /** v9: production-chain mode the game was started with */
  supply?: SupplyMode;
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
  /** v10: signalling level (auto keeps the claims only) */
  signalling?: SignalLevel;
}
/** Contract rarities, commonest first; `contracts.json` carries the numbers for each. */
export const CONTRACT_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type ContractRarity = (typeof CONTRACT_RARITIES)[number];
/** accept: taken as it appears; prompt: left on the board; deny: dropped (free before acceptance) */
export type ContractPolicy = 'accept' | 'prompt' | 'deny';
export function uniformContractPolicy(p: ContractPolicy): Record<ContractRarity, ContractPolicy> {
  return { common: p, uncommon: p, rare: p, epic: p, legendary: p };
}
/** Policy for a rarity, with the retired boolean and missing entries filled in. */
export function contractPolicyFor(s: Settings, rarity: ContractRarity): ContractPolicy {
  const fallback: ContractPolicy = s.autoContracts === false ? 'prompt' : 'accept';
  return s.contractPolicy?.[rarity] ?? fallback;
}
/**
 * Turn the retired `autoContracts` flag into a per-rarity policy (true → accept, false → prompt).
 * Runs on the stored object before defaults are merged in, so a missing policy is still visible.
 */
export function migrateSettings<T extends Partial<Settings>>(s: T): T {
  if (!s.contractPolicy && s.autoContracts !== undefined)
    s.contractPolicy = uniformContractPolicy(s.autoContracts === false ? 'prompt' : 'accept');
  delete s.autoContracts;
  return s;
}
export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.8,
  music: 0.5,
  edgeScroll: true,
  autosave: true,
  dayNight: true,
  smoke: true,
  showFps: false,
  weather: true,
  advisor: true,
  contractPolicy: uniformContractPolicy('accept'),
};

/** One step of the migration chain: brings a save from `from` to `from + 1`. */
export interface Migration {
  from: number;
  /** what the step fills in with defaults, shown to the player */
  note: string;
  run(j: SaveGame): void;
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
  { from: 4, note: 'owned chunks reduced to the start chunk', run: () => {} },
  { from: 5, note: 'season of day 1 set to spring', run: () => {} },
  {
    from: 6,
    note: 'towns started empty, station orientation 0, routing modes mapped to the new names, a depot placed at the start',
    run: () => {},
  },
  { from: 7, note: 'player settings not in the file; the current settings stay', run: () => {} },
  {
    from: 8,
    note: 'every track piece counted as regular class; catenary strung over rails the poles powered; townhouses became level 1 houses with six residents each; reputation dropped: the tier reached becomes the age (capped at the Electric Age), lifetime income starts at 0, production chain set to simple; contracts rated Common with no train assigned; the auto-accept switch became a per-rarity policy',
    run: (j) => {
      const book = j.contracts as { contracts?: Record<string, unknown>[] } | undefined;
      for (const c of book?.contracts ?? []) {
        c.rarity = c.rarity ?? 'common';
        c.trainId = c.trainId ?? null;
        delete c.reputation;
      }
      if (j.settings) migrateSettings(j.settings);
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
    note: 'crafting recipes granted for every model already in the inventory; locomotive modes set by the default rule (the first unit leads, units of its control class run in multiple, the rest double-headed); battery carts start empty',
    run: (j) => {
      if (j.crafting) return;
      const inv = j.inventory as { items?: { defId?: unknown }[] } | undefined;
      const recipes = new Set<string>();
      for (const it of inv?.items ?? []) if (typeof it.defId === 'string') recipes.add(it.defId);
      j.crafting = { recipes: [...recipes], stats: { unlocks: 0, crafts: 0, failures: 0 } };
    },
  },
];
/** Fields the current build reads; everything else is carried through untouched. */
export const KNOWN_SAVE_KEYS = new Set<string>([
  'version',
  'savedAt',
  'seed',
  'clock',
  'economy',
  'track',
  'stations',
  'trains',
  'contracts',
  'inventory',
  'gacha',
  'camera',
  'lastDay',
  'decor',
  'weather',
  'world',
  'rules',
  'stockpile',
  'buildings',
  'regions',
  'seasonOffset',
  'towns',
  'settings',
  'wires',
  'trade',
  'crafting',
  'houses',
  'supply',
  'loadedFrom',
  'migrationNotes',
]);

/** Parse and migrate a save text. Never refuses on version: older saves are upgraded step by step, newer ones are loaded as they are with a warning. */
export function parseSave(raw: string): SaveGame | null {
  const j = JSON.parse(raw) as SaveGame;
  if (!j || typeof j !== 'object' || typeof j.seed !== 'number') return null;
  if (typeof j.version !== 'number') j.version = SAVE_MIN_VERSION;
  return migrate(j);
}
export function readSave(): SaveGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return parseSave(raw);
  } catch {
    return null;
  }
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
export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw
      ? { ...DEFAULT_SETTINGS, ...migrateSettings(JSON.parse(raw) as Partial<Settings>) }
      : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
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
export interface SlotMeta {
  name: string;
  savedAt: number;
  version: number;
  seed: number;
  day: number;
}
function readSlots(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function writeSlots(slots: Record<string, string>) {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
    return true;
  } catch {
    return false;
  }
}
/** Named saves, newest first. */
export function listSlots(): SlotMeta[] {
  const out: SlotMeta[] = [];
  for (const [name, raw] of Object.entries(readSlots())) {
    try {
      const j = JSON.parse(raw) as SaveGame;
      out.push({
        name,
        savedAt: j.savedAt ?? 0,
        version: j.version ?? 0,
        seed: j.seed,
        day: j.lastDay ?? 0,
      });
    } catch {
      /* skip a broken slot */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
export function writeSlot(name: string, s: SaveGame) {
  const slots = readSlots();
  slots[name.trim().slice(0, 32)] = JSON.stringify(s);
  return writeSlots(slots);
}
export function readSlot(name: string): SaveGame | null {
  const raw = readSlots()[name];
  if (!raw) return null;
  try {
    return parseSave(raw);
  } catch {
    return null;
  }
}
export function deleteSlot(name: string) {
  const slots = readSlots();
  delete slots[name];
  return writeSlots(slots);
}
