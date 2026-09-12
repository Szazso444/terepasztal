import type { TrackClass, TrackKind } from '../world/track';
import type { StationJSON } from './stations';
import type { MapGenParams } from '../world/mapgen';
import { DEFAULT_MAP_PARAMS } from '../world/mapgen';
import type { LevelData } from '../world/level';
import type { Rules } from './rules';
import type { TownJSON } from './towns';

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
  economy: { money: number; tickets: number; reputation: number; tier: number; granted: number[] };
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
  /** v8: accept contract offers as they come */
  autoContracts?: boolean;
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
  autoContracts: true,
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
  { from: 8, note: 'every track piece counted as regular class', run: () => {} },
  {
    from: 9,
    note: 'locomotive modes set by the default rule (the first unit leads, units of its control class run in multiple, the rest double-headed); battery carts start empty',
    run: () => {},
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
  'trade',
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
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
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
