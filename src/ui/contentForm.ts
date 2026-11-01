import { STR } from '../strings';
import { parseDecimal } from './decimal';
import {
  DEFAULT_CONTENT,
  type ContentBundle,
  type ContentKey,
  type LocoDef,
  type StationDef,
  type WagonDef,
} from '../data/content';

/**
 * The content editor's forms, without the DOM: which fields each form shows, what an entry's
 * input reads and what the player's text stores. A list form shows every field any entry of its
 * table may carry: the keys of every shipped entry, then the optional fields the table declares
 * that no shipped entry has yet. A field an entry does not carry shows empty, never another
 * entry's value, and stays absent until the player gives it one.
 */

export type Row = Record<string, unknown>;

/** What the input edits: a flag, a number, a word, a comma list, or anything else as JSON. */
export type FieldKind = 'bool' | 'number' | 'text' | 'list' | 'numList' | 'json';

export interface FormField {
  key: string;
  /** the kind of the shipped (or declared) value; an entry whose value it cannot hold edits JSON */
  kind: FieldKind;
  /**
   * Set when an entry may leave the field out: what the game uses instead, as the player reads it.
   * An entry without the field shows it empty with this; clearing the input removes the key.
   */
  unset?: string;
}

/** The keys of `T` an entry may leave out. */
type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];
/** A value of each optional field, for its kind; never shown. */
type Declared<T> = { [K in OptionalKeys<T>]?: NonNullable<T[K]> };

export interface FormSpec {
  /** the list of entries or the one object the form edits, in a bundle */
  pick: (b: ContentBundle) => unknown;
  list: boolean;
  /** heading above the form, on a tab with more than one */
  title?: string;
  /** keys of the object another form of the tab edits */
  skip?: string[];
  /** optional fields of the table that no shipped entry carries: a value of each, for its kind */
  declared?: Row;
  /** what an entry without the field gets, where the editor can say better than "default" */
  unset?: Record<string, string>;
}

/** The forms of each tab, top to bottom. */
export const TAB_FORMS: Record<ContentKey, FormSpec[]> = {
  locomotives: [
    {
      pick: (b) => b.locomotives,
      list: true,
      declared: { length: 1, maxLateralPlay: 0.35 } satisfies Declared<LocoDef>,
      unset: { length: STR.content.unsetLength },
    },
  ],
  wagons: [
    { pick: (b) => b.wagons, list: true, declared: { retired: true } satisfies Declared<WagonDef> },
  ],
  cargo: [{ pick: (b) => b.cargo, list: true }],
  stations: [
    { pick: (b) => b.stations.levels, list: false, title: STR.content.levels },
    {
      pick: (b) => b.stations.defs,
      list: true,
      title: STR.content.entries,
      declared: { lastTier: 2, span: { w: 2, h: 1 } } satisfies Declared<StationDef>,
    },
  ],
  contracts: [
    {
      pick: (b) => b.contracts,
      list: false,
      title: STR.content.config,
      skip: ['templates', 'rarities'],
    },
    { pick: (b) => b.contracts.templates, list: true, title: STR.content.entries },
    { pick: (b) => b.contracts.rarities, list: true, title: STR.settings.contractPolicy },
  ],
  decor: [{ pick: (b) => b.decor, list: true }],
  buildings: [{ pick: (b) => b.buildings, list: true }],
  track: [{ pick: (b) => b.track, list: false }],
  crafting: [{ pick: (b) => b.crafting, list: false }],
  houses: [{ pick: (b) => b.houses, list: false }],
};

/** The shipped entries a form is built from (one for an object form). */
export function shippedRows(spec: FormSpec): Row[] {
  const v = spec.pick(DEFAULT_CONTENT);
  return (spec.list ? v : [v]) as Row[];
}

function kindOf(v: unknown): FieldKind {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => typeof x === 'number')) return 'numList';
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) return 'list';
  }
  return 'json';
}

/** Whether an input of `kind` shows `v` and gives it back as it was. */
function holds(kind: FieldKind, v: unknown): boolean {
  switch (kind) {
    case 'bool':
      return typeof v === 'boolean';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'text':
      return typeof v === 'string';
    case 'numList':
      return Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    case 'list':
      // a word with a comma or edge spaces would not come back from the comma list as it was
      return (
        Array.isArray(v) &&
        v.every((x) => typeof x === 'string' && x !== '' && x === x.trim() && !x.includes(','))
      );
    case 'json':
      return true;
  }
}

/**
 * Every field a form shows, in the order the shipped entries first use them, then the declared
 * ones. A field some shipped entry leaves out, or one the table declares, is optional. The kind
 * comes from the first entry that carries the field with something in it.
 */
export function formFields(spec: FormSpec): FormField[] {
  const rows = shippedRows(spec);
  const skip = new Set(spec.skip);
  const samples = new Map<string, unknown>();
  const carriers = new Map<string, number>();
  for (const row of rows)
    for (const [k, v] of Object.entries(row)) {
      if (skip.has(k)) continue;
      carriers.set(k, (carriers.get(k) ?? 0) + 1);
      if (!samples.has(k) || isEmptyList(samples.get(k))) samples.set(k, v);
    }
  const declared = spec.declared ?? {};
  for (const [k, v] of Object.entries(declared)) if (!samples.has(k)) samples.set(k, v);
  return [...samples].map(([key, sample]) => {
    const optional = key in declared || carriers.get(key) !== rows.length;
    const f: FormField = { key, kind: kindOf(sample) };
    if (optional) f.unset = spec.unset?.[key] ?? STR.content.unset;
    return f;
  });
}

function isEmptyList(v: unknown) {
  return Array.isArray(v) && !v.length;
}

/**
 * The kind of input one entry gets: the field's, or JSON for a value that input cannot hold, and
 * for an optional value that would read blank there and so be taken for an absent one.
 */
export function kindFor(row: Row, f: FormField): FieldKind {
  if (!(f.key in row)) return f.kind;
  const v = row[f.key];
  if (!holds(f.kind, v)) return 'json';
  const blank = Array.isArray(v) ? !v.length : typeof v === 'string' && !v.trim();
  return f.unset !== undefined && blank ? 'json' : f.kind;
}

/**
 * What the input shows for one entry: empty when it does not carry the field. A flag reads
 * `true` or `false`.
 */
export function showField(row: Row, f: FormField, kind: FieldKind): string {
  if (!(f.key in row)) return '';
  const v = row[f.key];
  switch (kind) {
    case 'bool':
      return v ? 'true' : 'false';
    case 'number':
    case 'text':
      return String(v);
    case 'list':
    case 'numList':
      return (v as unknown[]).join(', ');
    case 'json':
      return JSON.stringify(v);
  }
}

/**
 * Store what the player gave a field: a flag as `true`, `false` or empty. An empty optional field
 * removes the key. Returns false, and changes nothing, when the text is not a value of the kind.
 */
export function readField(row: Row, f: FormField, kind: FieldKind, text: string): boolean {
  const blank = !text.trim();
  if (blank && f.unset !== undefined) {
    delete row[f.key];
    return true;
  }
  let v: unknown;
  switch (kind) {
    case 'bool':
      if (text !== 'true' && text !== 'false') return false;
      v = text === 'true';
      break;
    case 'number':
      v = parseDecimal(text);
      if (!Number.isFinite(v)) return false;
      break;
    case 'text':
      v = text;
      break;
    case 'list':
    case 'numList': {
      const parts = text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      v = kind === 'numList' ? parts.map(Number) : parts;
      if (!keepsAsJson(v)) return false;
      break;
    }
    case 'json':
      try {
        v = JSON.parse(text);
      } catch {
        return false;
      }
      // a number too large for a double parses as an infinity, which the store writes as null
      if (!keepsAsJson(v)) return false;
  }
  row[f.key] = v;
  return true;
}

/** Whether the content store, which writes JSON, keeps `v` as it is: no NaN and no infinity. */
function keepsAsJson(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(keepsAsJson);
  if (v !== null && typeof v === 'object') return Object.values(v).every(keepsAsJson);
  return true;
}
