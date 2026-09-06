import type { TrackKind } from '../world/track';
import type { StationJSON } from './stations';
import type { MapGenParams } from '../world/mapgen';
import { DEFAULT_MAP_PARAMS } from '../world/mapgen';
import type { LevelData } from '../world/level';
import type { Rules } from './rules';

/** What the map was built from; a level save carries the whole level. */
export type WorldSpec =
  | { kind: 'generated'; seed: number; params: MapGenParams }
  | { kind: 'level'; seed: number; level: LevelData };

export const SAVE_VERSION = 6;
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
  track: [number, number, TrackKind, number][];
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
  /** v6: footpath wear */
  people?: unknown;
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
};

export function readSave(): SaveGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as SaveGame;
    if (typeof j.version !== 'number' || j.version < SAVE_MIN_VERSION || j.version > SAVE_VERSION)
      return null;
    return migrate(j);
  } catch {
    return null;
  }
}
/** Bring an older save up to the current shape. Each step is additive. */
function migrate(j: SaveGame): SaveGame {
  if (j.version < 2) {
    j.decor = j.decor ?? [];
    j.version = 2;
  }
  if (j.version < 3) {
    j.world = j.world ?? { kind: 'generated', seed: j.seed, params: { ...DEFAULT_MAP_PARAMS } };
    j.version = 3;
  }
  if (j.version < 4) {
    j.buildings = j.buildings ?? [];
    j.version = 4;
  }
  if (j.version < 5) j.version = 5;
  if (j.version < 6) j.version = 6;
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
