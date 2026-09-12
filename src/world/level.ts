import type { GameMap } from './tiles';
import type { TrackClass, TrackKind } from './track';
import type { SupplyMode } from '../sim/supply';
import { decorateProps, placeOilFields, emptyMap } from './mapgen';

/** A hand-made map: terrain plus pre-placed track, stations and decor, and the starting economy. */
export interface LevelData {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  w: number;
  h: number;
  /** seed used for prop placement and any generated content */
  seed: number;
  /** base64 of one byte per tile */
  terrain: string;
  variant: string;
  /** base64 biome ids (missing: plains everywhere) */
  biome?: string;
  track: [number, number, TrackKind, number, TrackClass?, TrackClass?][];
  stations: { defId: string; x: number; y: number; level: number; name: string }[];
  decor: [number, number, string, number][];
  /** processing buildings [x, y, id] */
  buildings?: [number, number, string][];
  start: {
    money: number;
    tickets: number;
    /** age the level starts in (0 steam, 1 diesel, 2 electric) */
    tier: number;
    /** multiplier on the default starting stockpile (1 = normal) */
    stockMul?: number;
    /** production chain the level is played in (missing: simple) */
    supply?: SupplyMode;
  };
}

export const LEVELS_KEY = 'terepasztal.levels';
export const EDITOR_DRAFT_KEY = 'terepasztal.editorDraft';

export function packBytes(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unpackBytes(b64: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  try {
    const s = atob(b64);
    for (let i = 0; i < len && i < s.length; i++) out[i] = s.charCodeAt(i);
  } catch {
    /* corrupt string: leave zeros (grass) */
  }
  return out;
}

export function newLevelId() {
  return `lvl_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Terrain and props of a level as a GameMap. */
export function mapFromLevel(level: LevelData): GameMap {
  const map = emptyMap(level.seed, level.w, level.h);
  map.terrain.set(unpackBytes(level.terrain, level.w * level.h));
  map.variant.set(unpackBytes(level.variant, level.w * level.h));
  if (level.biome) map.biome.set(unpackBytes(level.biome, level.w * level.h));
  decorateProps(map, level.seed);
  placeOilFields(map, level.seed);
  return map;
}

export function listLevels(): LevelData[] {
  try {
    const raw = localStorage.getItem(LEVELS_KEY);
    const list = raw ? (JSON.parse(raw) as LevelData[]) : [];
    return Array.isArray(list) ? list.filter(isLevel) : [];
  } catch {
    return [];
  }
}
export function getLevel(id: string): LevelData | null {
  return listLevels().find((l) => l.id === id) ?? null;
}
export function saveLevel(level: LevelData): boolean {
  const list = listLevels().filter((l) => l.id !== level.id);
  list.push(level);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  try {
    localStorage.setItem(LEVELS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
export function deleteLevel(id: string) {
  try {
    localStorage.setItem(LEVELS_KEY, JSON.stringify(listLevels().filter((l) => l.id !== id)));
  } catch {
    /* ignore */
  }
}
export function isLevel(v: unknown): v is LevelData {
  const l = v as LevelData;
  return (
    !!l &&
    typeof l === 'object' &&
    typeof l.id === 'string' &&
    typeof l.w === 'number' &&
    typeof l.h === 'number' &&
    typeof l.terrain === 'string' &&
    Array.isArray(l.track) &&
    Array.isArray(l.stations) &&
    !!l.start
  );
}

/** Wrap a map (and optional content) as a level; terrain and variant are packed. */
export function levelFromMap(map: GameMap, name: string, id = newLevelId()): LevelData {
  const now = Date.now();
  return {
    id,
    name,
    description: '',
    createdAt: now,
    updatedAt: now,
    w: map.w,
    h: map.h,
    seed: map.seed,
    terrain: packBytes(map.terrain),
    variant: packBytes(map.variant),
    biome: packBytes(map.biome),
    track: [],
    stations: [],
    decor: [],
    buildings: [],
    start: { money: 25000, tickets: 3, tier: 0, stockMul: 1 },
  };
}
