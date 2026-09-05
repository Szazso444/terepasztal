import type { TrackKind } from '../world/track';
import type { StationJSON } from './stations';

export const SAVE_VERSION = 2;
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
