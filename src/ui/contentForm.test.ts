import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import {
  CONTENT_KEYS,
  DEFAULT_CONTENT,
  changedTables,
  content,
  validateContent,
  type ContentBundle,
} from '../data/content';
import type { Rng } from '../engine/rng';
import { OWN_LENGTH } from '../sim/body';
import { SEEDS, forAll, shrinkArray, shrinkInt } from '../testing/property';
import {
  TAB_FORMS,
  formFields,
  kindFor,
  readField,
  shippedRows,
  showField,
  type FieldKind,
  type FormField,
  type FormSpec,
  type Row,
} from './contentForm';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Every form of every tab, named by its tab and position. */
const FORMS: [string, FormSpec][] = CONTENT_KEYS.flatMap((k) =>
  TAB_FORMS[k].map((spec, i): [string, FormSpec] => [`${k}#${i}`, spec]),
);

/** Each field written back exactly as the form shows it, as a form saved untouched would. */
function saveAsShown(row: Row, fields: FormField[]) {
  for (const f of fields) {
    const kind = kindFor(row, f);
    expect(readField(row, f, kind, showField(row, f, kind)), f.key).toBe(true);
  }
}

const field = (spec: FormSpec, key: string) => formFields(spec).find((f) => f.key === key)!;
const locoForm = TAB_FORMS.locomotives[0];

describe('the fields of a content form', () => {
  it.each(FORMS)('%s shows every key a shipped entry carries and every declared one', (_, spec) => {
    const keys = formFields(spec).map((f) => f.key);
    const expected = new Set([
      ...shippedRows(spec).flatMap((r) => Object.keys(r)),
      ...Object.keys(spec.declared ?? {}),
    ]);
    for (const k of spec.skip ?? []) expected.delete(k);
    expect(new Set(keys)).toEqual(expected);
    expect(keys.length).toBe(expected.size);
  });

  it("shows a locomotive's own length though no shipped locomotive has one", () => {
    expect(DEFAULT_CONTENT.locomotives.some((l) => 'length' in l)).toBe(false);
    const f = field(locoForm, 'length');
    expect(f.kind).toBe('number');
    expect(f.unset).toBe(STR.content.unsetLength);
    // the length says what it falls back to, not only that it has a default
    expect(f.unset).not.toBe(STR.content.unset);
  });

  it('marks optional exactly the fields some shipped entry leaves out or the table declares', () => {
    for (const [name, spec] of FORMS) {
      const rows = shippedRows(spec);
      for (const f of formFields(spec)) {
        const optional = f.key in (spec.declared ?? {}) || rows.some((r) => !(f.key in r));
        expect(f.unset !== undefined, `${name} ${f.key}`).toBe(optional);
        if (optional) expect(f.unset, `${name} ${f.key}`).toBeTruthy();
      }
    }
  });

  it('leaves nothing of a table out of its tab', () => {
    for (const k of CONTENT_KEYS) {
      const table = DEFAULT_CONTENT[k] as unknown as Row;
      const specs = TAB_FORMS[k];
      const picked = specs.map((s) => s.pick(DEFAULT_CONTENT));
      const whole = specs.find((s) => s.pick(DEFAULT_CONTENT) === table);
      // what the form of the whole table skips, or every part of a table no form takes whole,
      // is edited by another form of the tab
      for (const part of whole ? (whole.skip ?? []) : Object.keys(table))
        expect(picked, `${k}.${part}`).toContain(table[part]);
    }
  });
});

describe('an entry in a content form', () => {
  it('shows a field it does not carry as empty, never with another entry its value', () => {
    for (const [name, spec] of FORMS) {
      const rows = shippedRows(spec);
      for (const f of formFields(spec))
        for (const row of rows)
          if (!(f.key in row))
            expect(showField(row, f, kindFor(row, f)), `${name} ${String(row.id)} ${f.key}`).toBe(
              '',
            );
    }
  });

  it.each(FORMS)('%s: every shipped entry comes back from a form saved as shown', (_, spec) => {
    const fields = formFields(spec);
    for (const row of shippedRows(spec)) {
      const copy = clone(row);
      saveAsShown(copy, fields);
      expect(copy, String(row.id)).toStrictEqual(row);
    }
  });

  it('does not give a locomotive a length it did not have', () => {
    const fields = formFields(locoForm);
    for (const loco of DEFAULT_CONTENT.locomotives) {
      const copy = clone(loco) as unknown as Row;
      saveAsShown(copy, fields);
      expect('length' in copy, loco.id).toBe(false);
    }
  });

  it('stores a typed length as a number and drops the key when it is cleared', () => {
    const f = field(locoForm, 'length');
    const loco = clone(DEFAULT_CONTENT.locomotives[0]) as unknown as Row;
    const before = clone(loco);
    expect(readField(loco, f, kindFor(loco, f), '1.4')).toBe(true);
    expect(loco.length).toBe(1.4);
    expect(showField(loco, f, kindFor(loco, f))).toBe('1.4');
    for (const cleared of ['', '  ']) {
      expect(readField(loco, f, kindFor(loco, f), '2')).toBe(true);
      expect(readField(loco, f, kindFor(loco, f), cleared)).toBe(true);
      expect('length' in loco).toBe(false);
      expect(loco).toStrictEqual(before);
    }
  });

  it('keeps a required field when its input is cleared', () => {
    const f = field(locoForm, 'speed');
    expect(f.unset).toBeUndefined();
    const loco = clone(DEFAULT_CONTENT.locomotives[0]) as unknown as Row;
    readField(loco, f, kindFor(loco, f), '');
    expect('speed' in loco).toBe(true);
  });

  it('sets an optional flag, and drops it again, through the empty choice', () => {
    const f = field(locoForm, 'retired');
    expect(f.kind).toBe('bool');
    const loco = clone(DEFAULT_CONTENT.locomotives.find((l) => !l.retired)!) as unknown as Row;
    expect(showField(loco, f, kindFor(loco, f))).toBe('');
    expect(readField(loco, f, 'bool', 'false')).toBe(true);
    expect(loco.retired).toBe(false);
    expect(showField(loco, f, kindFor(loco, f))).toBe('false');
    expect(readField(loco, f, 'bool', '')).toBe(true);
    expect('retired' in loco).toBe(false);
  });

  it('refuses text that is not a value of the field, and changes nothing', () => {
    const loco = clone(DEFAULT_CONTENT.locomotives[0]) as unknown as Row;
    const before = clone(loco);
    expect(readField(loco, field(locoForm, 'length'), 'number', 'long')).toBe(false);
    expect(readField(loco, field(locoForm, 'speed'), 'number', 'fast')).toBe(false);
    expect(readField(loco, field(locoForm, 'bogieStyle'), 'json', '{oops')).toBe(false);
    // a number too large for a double: the store would write the infinity it parses to as null
    expect(readField(loco, field(locoForm, 'speed'), 'json', '1e400')).toBe(false);
    expect(readField(loco, field(locoForm, 'bogieStyle'), 'json', '{"a":[-1e400]}')).toBe(false);
    expect(loco).toStrictEqual(before);

    const levelsForm = TAB_FORMS.stations[0];
    const levels = clone(shippedRows(levelsForm)[0]);
    const levelsBefore = clone(levels);
    const capacity = field(levelsForm, 'capacity');
    expect(capacity.kind).toBe('numList');
    expect(readField(levels, capacity, 'numList', '60, x')).toBe(false);
    expect(readField(levels, capacity, 'numList', '1e400')).toBe(false);
    expect(levels).toStrictEqual(levelsBefore);
  });
});

describe('the input an entry gets', () => {
  // made-up table: `tags` and `note` are optional, `extra` only declared
  const spec: FormSpec = {
    pick: () => [
      { id: 'a', n: 1, tags: ['x', 'y'], on: true, note: 'hi' },
      { id: 'b', n: 2 },
    ],
    list: true,
    declared: { extra: 5 },
  };
  const fields = formFields(spec);

  it('takes its kind from the first entry that has the field, or from the declaration', () => {
    expect(Object.fromEntries(fields.map((f) => [f.key, f.kind]))).toEqual({
      id: 'text',
      n: 'number',
      tags: 'list',
      on: 'bool',
      note: 'text',
      extra: 'number',
    });
  });

  it('edits as JSON a value the field input could not give back', () => {
    const row: Row = { id: 'c', n: 3, tags: [], note: '', on: 'yes', extra: [1] };
    const kinds = Object.fromEntries(fields.map((f) => [f.key, kindFor(row, f)]));
    // an empty optional value would read as absent; a value of another type would be lost
    expect(kinds).toMatchObject({ tags: 'json', note: 'json', on: 'json', extra: 'json' });
    const copy = clone(row);
    saveAsShown(copy, fields);
    expect(copy).toStrictEqual(row);
  });

  it('keeps a word list that a comma list could not give back', () => {
    const row: Row = { id: 'd', n: 4, tags: ['a, b', ' c'] };
    expect(
      kindFor(
        row,
        fields.find((f) => f.key === 'tags')!,
      ),
    ).toBe('json');
    const copy = clone(row);
    saveAsShown(copy, fields);
    expect(copy).toStrictEqual(row);
  });
});

/** content.ts, parsed: its interfaces by name. */
const TYPES = (() => {
  const file = new URL('../data/content.ts', import.meta.url);
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile('content.ts', text, ts.ScriptTarget.Latest, true);
  const out = new Map<string, ts.InterfaceDeclaration>();
  src.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n)) out.set(n.name.text, n);
  });
  return out;
})();

/** The properties a form's `pick` reads from a bundle, in order: `['stations', 'defs']`. */
function pickPath(spec: FormSpec): string[] {
  const path: string[] = [];
  const probe: object = new Proxy(
    {},
    {
      get: (_t, k) => {
        path.push(String(k));
        return probe;
      },
    },
  );
  spec.pick(probe as ContentBundle);
  return path;
}

const nameOf = (m: ts.TypeElement) =>
  m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))
    ? m.name.text
    : String(m.name?.getText());

function membersOf(type: ts.TypeNode | undefined, where: string): readonly ts.TypeElement[] {
  if (type && ts.isTypeLiteralNode(type)) return type.members;
  if (type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const decl = TYPES.get(type.typeName.text);
    // only the interface's own members are read: one that extends another would hide fields
    if (decl?.heritageClauses?.length)
      throw new Error(`${where}: ${decl.name.text} extends another type, whose fields go unread`);
    if (decl) return decl.members;
  }
  throw new Error(`${where} is not an interface or object type of content.ts`);
}

/**
 * What content.ts declares one entry of a form to be: each property, and whether an entry may
 * leave it out. Found by following the form's pick down from `ContentBundle`, so it is the
 * table's own declaration, not the list of declared fields the form keeps.
 */
function typeMembers(spec: FormSpec): { key: string; optional: boolean }[] {
  const path = pickPath(spec);
  let members: readonly ts.TypeElement[] = TYPES.get('ContentBundle')!.members;
  let type: ts.TypeNode | undefined;
  for (const [i, key] of path.entries()) {
    if (i > 0) members = membersOf(type, path.slice(0, i).join('.'));
    const m = members.find((m) => ts.isPropertySignature(m) && nameOf(m) === key);
    type = m && ts.isPropertySignature(m) ? m.type : undefined;
  }
  if (spec.list) {
    if (!type || !ts.isArrayTypeNode(type)) throw new Error(`${path.join('.')} is not a list`);
    type = type.elementType;
  }
  return membersOf(type, path.join('.'))
    .filter(ts.isPropertySignature)
    .map((m) => ({ key: nameOf(m), optional: m.questionToken !== undefined }));
}

describe('a content form against the type content.ts declares for its table', () => {
  it.each(FORMS)('%s shows every property of the type, optional ones included', (name, spec) => {
    const members = typeMembers(spec);
    expect(members.length, name).toBeGreaterThan(0);
    const shown = new Set(formFields(spec).map((f) => f.key));
    const skip = new Set(spec.skip);
    for (const m of members)
      if (!skip.has(m.key)) expect(shown.has(m.key), `${name} ${m.key}`).toBe(true);
  });

  it.each(FORMS)('%s never lets the player clear a property the type requires', (name, spec) => {
    const optional = new Map(typeMembers(spec).map((m) => [m.key, m.optional]));
    for (const key of Object.keys(spec.declared ?? {}))
      expect(optional.get(key), `${name} declares ${key}`).toBe(true);
    // clearing an optional field removes the key, which an entry must never lose when it is required
    for (const f of formFields(spec))
      if (f.unset !== undefined && optional.has(f.key))
        expect(optional.get(f.key), `${name} ${f.key}`).toBe(true);
  });
});

/** Characters stored words and typed text are made of: separators, quotes and JSON syntax too. */
const CHARS = [...'abZé109.-+eE ,"[]{}:x'];

const word = (rng: Rng, max = 6) =>
  Array.from({ length: rng.int(0, max) }, () => rng.pick(CHARS)).join('');

/** A finite number: an integer, a fraction of up to 17 digits, or a tiny or huge one. */
function num(rng: Rng): number {
  switch (rng.int(0, 2)) {
    case 0:
      return rng.int(-1000, 1000);
    case 1:
      return Number(rng.range(-100, 100).toPrecision(rng.int(1, 17)));
    default:
      return Number(`${rng.int(1, 9)}e${rng.int(-30, 30)}`);
  }
}

/** Any value a stored table could hold at a field: JSON of every shape. */
function anyValue(rng: Rng, depth = 0): unknown {
  switch (rng.int(0, depth < 2 ? 7 : 5)) {
    case 0:
      return rng.chance(0.5);
    case 1:
      return num(rng);
    case 2:
      return word(rng);
    case 3:
      return Array.from({ length: rng.int(0, 3) }, () => word(rng));
    case 4:
      return Array.from({ length: rng.int(0, 3) }, () => num(rng));
    case 5:
      return null;
    case 6:
      return Array.from({ length: rng.int(0, 3) }, () => anyValue(rng, depth + 1));
    default:
      return Object.fromEntries(
        Array.from({ length: rng.int(0, 3) }, () => [word(rng, 3), anyValue(rng, depth + 1)]),
      );
  }
}

/** A value of the kind a field's input edits, which may still be one that input cannot hold. */
function valueOfKind(rng: Rng, kind: FieldKind): unknown {
  switch (kind) {
    case 'bool':
      return rng.chance(0.5);
    case 'number':
      return num(rng);
    case 'text':
      return word(rng);
    case 'list':
      return Array.from({ length: rng.int(0, 3) }, () => word(rng));
    case 'numList':
      return Array.from({ length: rng.int(0, 4) }, () => num(rng));
    case 'json':
      return anyValue(rng);
  }
}

function* shrinkValue(v: unknown): Iterable<unknown> {
  if (typeof v === 'string') for (const cs of shrinkArray([...v])) yield cs.join('');
  else if (Array.isArray(v)) yield* shrinkArray(v, shrinkValue);
  else if (typeof v === 'number' && Number.isInteger(v)) yield* shrinkInt(v);
  else if (v && typeof v === 'object')
    for (const es of shrinkArray(Object.entries(v))) yield Object.fromEntries(es);
}

/** A key no form shows: saving the form carries it through untouched. */
const UNKNOWN = 'notAField';

/** A change to a shipped entry: a field given a value, or left out when `value` is missing. */
interface Edit {
  key: string;
  value?: unknown;
}
interface EntryCase {
  at: number;
  edits: Edit[];
}

function entryOf(spec: FormSpec, c: EntryCase): Row {
  const row = clone(shippedRows(spec)[c.at]);
  for (const e of c.edits)
    if ('value' in e) row[e.key] = clone(e.value);
    else delete row[e.key];
  return row;
}

/**
 * A shipped entry with up to six fields changed: optional ones left out, any field (and a key no
 * form shows) given a value of its kind or of any other shape. Only an optional field is left out.
 */
const entryCase =
  (spec: FormSpec, fields: FormField[]) =>
  (rng: Rng): EntryCase => ({
    at: rng.int(0, shippedRows(spec).length - 1),
    edits: Array.from({ length: rng.int(0, 6) }, (): Edit => {
      const f = rng.pick([...fields, { key: UNKNOWN, kind: 'json' } as FormField]);
      if (f.unset !== undefined && rng.chance(0.3)) return { key: f.key };
      return { key: f.key, value: rng.chance(0.5) ? valueOfKind(rng, f.kind) : anyValue(rng) };
    }),
  });

function* shrinkEntry(c: EntryCase): Iterable<EntryCase> {
  const smaller = (e: Edit) =>
    'value' in e ? [...shrinkValue(e.value)].map((value) => ({ key: e.key, value })) : [];
  for (const edits of shrinkArray(c.edits, smaller)) yield { at: c.at, edits };
  for (const at of shrinkInt(c.at)) yield { at, edits: c.edits };
}

describe('a generated entry in a content form', () => {
  it.each(FORMS)('%s: saved exactly as shown, it comes back unchanged', (_, spec) => {
    const fields = formFields(spec);
    forAll(
      entryCase(spec, fields),
      (c) => {
        const row = entryOf(spec, c);
        const copy = clone(row);
        saveAsShown(copy, fields);
        expect(copy).toStrictEqual(row);
      },
      { shrink: shrinkEntry },
    );
  });

  it.each(FORMS)('%s: a field shows only the entry its own value, or nothing', (_, spec) => {
    const fields = formFields(spec);
    forAll(
      entryCase(spec, fields),
      (c) => {
        const row = entryOf(spec, c);
        for (const f of fields) {
          // the same field of an entry holding nothing else
          const own: Row = f.key in row ? { [f.key]: row[f.key] } : {};
          const kind = kindFor(row, f);
          expect(kind, f.key).toBe(kindFor(own, f));
          const shown = showField(row, f, kind);
          expect(shown, f.key).toBe(f.key in row ? showField(own, f, kind) : '');
        }
      },
      { shrink: shrinkEntry },
    );
  });
});

/** Every input a form can give a field: one of its own kind, and JSON for a value that cannot. */
const INPUTS = FORMS.flatMap(([name, spec]) =>
  formFields(spec).flatMap((f) =>
    [...new Set<FieldKind>([f.kind, 'json'])].map((kind) => ({ name, spec, f, kind })),
  ),
);

/** Text a player could type: blanks, numbers in any notation, flags, comma lists, JSON, junk. */
function typed(rng: Rng): string {
  const pad = (s: string) => ' '.repeat(rng.int(0, 1)) + s + ' '.repeat(rng.int(0, 1));
  const numText = () =>
    rng.chance(0.5) ? String(num(rng)) : `${rng.int(-9, 9)}e${rng.int(-400, 400)}`;
  switch (rng.int(0, 5)) {
    case 0:
      return ' '.repeat(rng.int(0, 2));
    case 1:
      return pad(numText());
    case 2:
      return pad(rng.pick(['true', 'false']));
    case 3:
      return Array.from({ length: rng.int(1, 3) }, () =>
        rng.chance(0.5) ? numText() : word(rng, 3),
      ).join(rng.pick([',', ', ']));
    case 4:
      return JSON.stringify(anyValue(rng));
    default:
      return word(rng);
  }
}

/** A value the content store keeps as it is through JSON: no NaN, no infinity, no undefined. */
function isJson(v: unknown): boolean {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJson);
  return typeof v === 'object' && Object.values(v).every(isJson);
}

/** Whether a stored value is one the input of `kind` edits. */
function ofKind(kind: FieldKind, v: unknown): boolean {
  switch (kind) {
    case 'bool':
      return typeof v === 'boolean';
    case 'number':
      return typeof v === 'number';
    case 'text':
      return typeof v === 'string';
    case 'list':
      return Array.isArray(v) && v.every((x) => typeof x === 'string');
    case 'numList':
      return Array.isArray(v) && v.every((x) => typeof x === 'number');
    case 'json':
      return true;
  }
}

/** JSON that spells out NaN and the infinities instead of writing null. */
const spell = (v: unknown) =>
  (
    JSON.stringify(v, (_k, x: unknown) =>
      typeof x === 'number' && !Number.isFinite(x) ? String(x) : x,
    ) ?? String(v)
  ).replace(/"(NaN|-?Infinity)"/g, '$1');

const without = (row: Row, key: string) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => k !== key));

interface TypedCase {
  input: number;
  at: number;
  text: string;
}

describe('text typed into a content form', () => {
  const kinds = [...new Set(INPUTS.map((i) => i.kind))];

  it('has an input of every kind to type into', () => {
    expect([...kinds].sort()).toEqual(['bool', 'json', 'list', 'numList', 'number', 'text']);
  });

  it.each(kinds)(
    'a %s input refuses it and changes nothing, or stores a value of its kind the store keeps',
    (kind) => {
      const inputs = INPUTS.filter((i) => i.kind === kind);
      const rowOf = (c: TypedCase) => {
        const rows = shippedRows(inputs[c.input].spec);
        return rows[c.at % rows.length];
      };
      forAll(
        (rng): TypedCase => ({
          input: rng.int(0, inputs.length - 1),
          at: rng.int(0, 999),
          text: typed(rng),
        }),
        (c) => {
          const { f } = inputs[c.input];
          const row = clone(rowOf(c));
          const before = clone(row);
          const stored = readField(row, f, kind, c.text);
          expect(without(row, f.key), 'another key changed').toStrictEqual(without(before, f.key));
          if (!stored) return void expect(row, 'refused, yet changed').toStrictEqual(before);
          if (f.unset !== undefined && !c.text.trim())
            return void expect(f.key in row, 'blank, yet kept').toBe(false);
          const v = row[f.key];
          expect(isJson(v), `stored ${spell(v)}, which JSON turns into ${JSON.stringify(v)}`).toBe(
            true,
          );
          expect(ofKind(kind, v), `stored ${spell(v)}, not a ${kind}`).toBe(true);
        },
        {
          *shrink(c) {
            for (const cs of shrinkArray([...c.text])) yield { ...c, text: cs.join('') };
            for (const at of shrinkInt(c.at)) yield { ...c, at };
            for (const input of shrinkInt(c.input)) yield { ...c, input };
          },
          format: (c) =>
            JSON.stringify({
              form: inputs[c.input].name,
              field: inputs[c.input].f.key,
              entry: rowOf(c).id ?? 0,
              text: c.text,
            }),
        },
      );
    },
  );
});

/** A number as a player may type it; a third of them overflow a double, unless the digit is 0. */
const numLiteral = (rng: Rng) =>
  rng.chance(1 / 3)
    ? `${rng.int(-9, 9)}e${rng.pick(['', '+'])}${rng.int(309, 999)}`
    : rng.chance(0.5)
      ? String(num(rng))
      : `${rng.int(-9, 9)}e${rng.int(-400, 300)}`;

/** JSON text with its numbers written as typed: overflowing ones at the top or nested deep. */
function jsonText(rng: Rng, depth = 0): string {
  const items = () => Array.from({ length: rng.int(1, 3) }, () => jsonText(rng, depth + 1));
  // a list or object most often at the top, a number most often inside one
  if (depth < 2 && rng.chance(depth ? 0.25 : 0.6))
    return rng.chance(0.5)
      ? `[${items().join(', ')}]`
      : `{${items()
          .map((v, i) => `"${'abc'[i]}": ${v}`)
          .join(', ')}}`;
  switch (rng.int(0, 3)) {
    case 0:
      return rng.pick(['true', 'false', 'null']);
    case 1:
      return JSON.stringify(word(rng, 3));
    default:
      return numLiteral(rng);
  }
}

/** A comma list as typed: numbers in any notation, words, and parts left empty. */
const listText = (rng: Rng) =>
  Array.from({ length: rng.int(1, 4) }, () => {
    const part = rng.pick([numLiteral, numLiteral, (r: Rng) => word(r, 3), () => ''])(rng);
    return ' '.repeat(rng.int(0, 1)) + part + ' '.repeat(rng.int(0, 1));
  }).join(',');

/** What a flag's choice gives, and text near it. */
const flagText = (rng: Rng) => rng.pick(['true', 'false', '', ' true', 'false ', 'True', '1', '0']);

/** Deep equality with `===` at the leaves: NaN is never equal, and -0 is 0. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a === null || typeof a !== 'object') return a === b;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length && ka.every((k) => kb.includes(k) && same((a as Row)[k], (b as Row)[k]))
  );
}

/** Whether the content store, writing `v` as JSON and reading it back, gets `v` again. */
const storeKeeps = (v: unknown) => same(v, JSON.parse(JSON.stringify(v)) as unknown);

type Outcome =
  | { is: 'refused' }
  | { is: 'removed' }
  | { is: 'stored'; value: unknown }
  // blank text in a required number input: whether it may store 0 is the author's to say
  | { is: 'open' };

/**
 * What an input of `kind` makes of typed text, the long way round: the value the text spells, kept
 * when the store gives it back as it is and refused otherwise; blank text removes an optional key.
 */
function outcome(f: FormField, kind: FieldKind, text: string): Outcome {
  const blank = text.trim() === '';
  if (blank && f.unset !== undefined) return { is: 'removed' };
  const keep = (value: unknown): Outcome =>
    storeKeeps(value) ? { is: 'stored', value } : { is: 'refused' };
  const parts = () =>
    text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  switch (kind) {
    case 'bool':
      return text === 'true' || text === 'false' ? keep(text === 'true') : { is: 'refused' };
    case 'number':
      return blank ? { is: 'open' } : keep(Number(text));
    case 'text':
      return keep(text);
    case 'list':
      return keep(parts());
    case 'numList':
      return keep(parts().map(Number));
    case 'json': {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return { is: 'refused' };
      }
      return keep(value);
    }
  }
}

/** A list of numbers, or a JSON array or object, holding a number the store cannot keep. */
function cannotKeepInside(kind: FieldKind, text: string): boolean {
  if (kind === 'numList') return text.split(',').some((s) => s.trim() && !storeKeeps(Number(s)));
  if (kind !== 'json') return false;
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !storeKeeps(v);
  } catch {
    return false;
  }
}

describe('text typed into a content form, against what the content store keeps', () => {
  const kinds = [...new Set(INPUTS.map((i) => i.kind))];

  it.each(kinds)(
    'a %s input stores the value the text spells, and refuses only what the store cannot keep',
    (kind) => {
      const inputs = INPUTS.filter((i) => i.kind === kind);
      const rowOf = (c: TypedCase) => {
        const rows = shippedRows(inputs[c.input].spec);
        return rows[c.at % rows.length];
      };
      // how often each outcome came up, and how often a refusal was for a number the store
      // cannot keep inside a list or JSON value rather than at its top
      const seen = { refused: 0, removed: 0, stored: 0, open: 0, inside: 0 };
      forAll(
        (rng): TypedCase => ({
          input: rng.int(0, inputs.length - 1),
          at: rng.int(0, 999),
          text: rng.pick([typed, jsonText, jsonText, listText, flagText])(rng),
        }),
        (c) => {
          const { f } = inputs[c.input];
          const row = clone(rowOf(c));
          const before = clone(row);
          const stored = readField(row, f, kind, c.text);
          const want = outcome(f, kind, c.text);
          seen[want.is]++;
          if (want.is === 'refused' && cannotKeepInside(kind, c.text)) seen.inside++;
          expect(without(row, f.key), 'another key changed').toStrictEqual(without(before, f.key));
          switch (want.is) {
            case 'refused':
              expect(stored, `accepted, storing ${spell(row[f.key])}`).toBe(false);
              expect(row, 'refused, yet changed').toStrictEqual(before);
              break;
            case 'removed':
              expect(stored, 'blank, yet refused').toBe(true);
              expect(f.key in row, 'blank, yet kept').toBe(false);
              break;
            case 'stored':
              expect(stored, `refused ${spell(want.value)}, which the store keeps`).toBe(true);
              expect(row[f.key]).toStrictEqual(want.value);
              break;
          }
        },
        {
          *shrink(c) {
            for (const cs of shrinkArray([...c.text])) yield { ...c, text: cs.join('') };
            for (const at of shrinkInt(c.at)) yield { ...c, at };
            for (const input of shrinkInt(c.input)) yield { ...c, input };
          },
          format: (c) =>
            JSON.stringify({
              form: inputs[c.input].name,
              field: inputs[c.input].f.key,
              entry: rowOf(c).id ?? 0,
              text: c.text,
            }),
        },
      );
      // the cases reach both sides of the line, and the numbers the fix is about
      expect(seen.stored, 'cases stored').toBeGreaterThanOrEqual(5);
      if (kind !== 'text' && kind !== 'list')
        expect(seen.refused, 'cases refused').toBeGreaterThanOrEqual(5);
      if (kind === 'json' || kind === 'numList')
        expect(seen.inside, 'cases refused for a number inside').toBeGreaterThanOrEqual(5);
    },
  );
});

describe("a locomotive's length typed into its form", () => {
  interface LengthCase {
    at: number;
    had?: number;
    text: string;
    blank: string;
  }

  it('stores the number typed on any locomotive, and clearing it gives the entry back', () => {
    const f = field(locoForm, 'length');
    const locos = shippedRows(locoForm);
    forAll(
      (rng): LengthCase => {
        const x = rng.chance(0.5) ? rng.int(3, 35) / 10 : num(rng);
        const notation = rng.int(0, 2);
        const text =
          notation === 0
            ? String(x)
            : notation === 1
              ? x.toFixed(rng.int(0, 4))
              : x.toExponential(rng.int(0, 4));
        return {
          at: rng.int(0, locos.length - 1),
          // a locomotive that already has a length of its own, or not
          had: rng.chance(0.3) ? rng.int(3, 35) / 10 : undefined,
          text: ' '.repeat(rng.int(0, 1)) + text,
          blank: ' '.repeat(rng.int(0, 2)),
        };
      },
      (c) => {
        const loco = clone(locos[c.at]);
        if (c.had !== undefined) loco.length = c.had;
        const before = clone(loco);
        expect(readField(loco, f, kindFor(loco, f), c.text)).toBe(true);
        expect(loco.length).toBe(Number(c.text));
        expect(without(loco, 'length')).toStrictEqual(without(before, 'length'));
        expect(readField(loco, f, kindFor(loco, f), c.blank)).toBe(true);
        expect(loco).toStrictEqual(without(before, 'length'));
      },
      {
        *shrink(c) {
          if (c.had !== undefined) yield { ...c, had: undefined };
          for (const at of shrinkInt(c.at)) yield { ...c, at };
        },
      },
    );
  });
});

/** A made-up table and what its form declares: entries, declared fields, skipped keys, defaults. */
interface TableCase {
  list: boolean;
  rows: Row[];
  declared: [string, unknown][];
  skip: string[];
  unset: [string, string][];
}

/** Keys a made-up entry is built from; `f` and `g` are only ever declared. */
const TABLE_KEYS = ['a', 'b', 'c', 'd', 'e'];
const KINDS: FieldKind[] = ['bool', 'number', 'text', 'list', 'numList', 'json'];

/** A value at a field of a made-up table: often an empty list, else of any kind or shape. */
const cell = (rng: Rng): unknown =>
  rng.chance(0.25) ? [] : rng.chance(0.5) ? valueOfKind(rng, rng.pick(KINDS)) : anyValue(rng);

/**
 * A table no shipped one is like: one to four entries (one for an object form), each carrying
 * keys in its own order, with optional fields declared (some of them carried too), keys skipped
 * and defaults described. A skipped key is never declared.
 */
function tableCase(rng: Rng): TableCase {
  const list = rng.chance(0.75);
  const rows = Array.from({ length: list ? rng.int(1, 4) : 1 }, () =>
    Object.fromEntries(
      rng
        .shuffle([...TABLE_KEYS])
        .filter(() => rng.chance(0.6))
        .map((k) => [k, cell(rng)]),
    ),
  );
  const declared = rng
    .shuffle(['c', 'd', 'e', 'f', 'g'])
    .filter(() => rng.chance(0.4))
    .map((k): [string, unknown] => [k, cell(rng)]);
  const skip = TABLE_KEYS.filter((k) => !declared.some(([d]) => d === k) && rng.chance(0.15));
  const unset = [...TABLE_KEYS, 'f', 'g']
    .filter(() => rng.chance(0.3))
    .map((k): [string, string] => [k, `no ${k}`]);
  return { list, rows: clone(rows), declared: clone(declared), skip, unset };
}

function specOf(c: TableCase): FormSpec {
  const rows = clone(c.rows);
  return {
    pick: () => (c.list ? rows : rows[0]),
    list: c.list,
    declared: Object.fromEntries(c.declared),
    skip: c.skip,
    unset: Object.fromEntries(c.unset),
  };
}

/** The kind of input a value calls for, spelled out. */
function kindModel(v: unknown): FieldKind {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  if (!Array.isArray(v)) return 'json';
  if (v.length && v.every((x) => typeof x === 'number')) return 'numList';
  return v.every((x) => typeof x === 'string' || typeof x === 'number') ? 'list' : 'json';
}

/** A field as the model expects it; `kind` is left out where which kind it gets is not settled. */
type ModelField = Omit<FormField, 'kind'> & { kind?: FieldKind };

/**
 * The fields a form of the table shows, the long way round: each key in the order the entries
 * first use it, then each declared key no entry carries; optional when an entry leaves it out or
 * it is declared; its kind from the first entry that carries it with something in it (an empty
 * list is nothing), else from the declaration, else from an empty list. A declared key that the
 * entries carry only as empty lists is open: `declared` is for fields no shipped entry carries,
 * and whether the declaration or the empty list sets the kind there is not decided.
 */
function fieldsModel(c: TableCase): ModelField[] {
  const declared = new Map(c.declared);
  const unset = new Map(c.unset);
  const keys: string[] = [];
  for (const row of c.rows)
    for (const k of Object.keys(row)) if (!c.skip.includes(k) && !keys.includes(k)) keys.push(k);
  for (const [k] of c.declared) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => {
    const held = c.rows.filter((r) => key in r).map((r) => r[key]);
    const filled = held.filter((v) => !(Array.isArray(v) && !v.length));
    const f: ModelField = { key };
    if (filled.length) f.kind = kindModel(filled[0]);
    else if (!held.length) f.kind = kindModel(declared.get(key));
    else if (!declared.has(key)) f.kind = kindModel(held[0]);
    if (declared.has(key) || held.length < c.rows.length)
      f.unset = unset.get(key) ?? STR.content.unset;
    return f;
  });
}

/** The form's fields, with the kind left out where the model leaves it open. */
function fieldsAgainst(want: ModelField[], got: FormField[]): ModelField[] {
  return got.map((f, i) => {
    if (want[i]?.kind !== undefined || want[i]?.key !== f.key) return f;
    const { key, unset } = f;
    return unset === undefined ? { key } : { key, unset };
  });
}

function* shrinkTable(c: TableCase): Iterable<TableCase> {
  const smallerRow = (r: Row) =>
    [
      ...shrinkArray(Object.entries(r), ([k, v]): [string, unknown][] =>
        [...shrinkValue(v)].map((x) => [k, x]),
      ),
    ].map((es) => Object.fromEntries(es));
  for (const rows of shrinkArray(c.rows, smallerRow)) if (rows.length) yield { ...c, rows };
  for (const declared of shrinkArray(c.declared)) yield { ...c, declared };
  for (const skip of shrinkArray(c.skip)) yield { ...c, skip };
  for (const unset of shrinkArray(c.unset)) yield { ...c, unset };
}

describe('a content form of any table, not only the shipped ones', () => {
  it('shows every key an entry carries and every declared one, in order, of the right kind', () => {
    // how often the cases reach what the order and the kind turn on, and how many kinds are held
    const seen = { emptyFirst: 0, declaredCarried: 0, reordered: 0, settled: 0 };
    forAll(
      tableCase,
      (c) => {
        const want = fieldsModel(c);
        expect(fieldsAgainst(want, formFields(specOf(c)))).toStrictEqual(want);
        const held = (k: string) => c.rows.filter((r) => k in r).map((r) => r[k]);
        const isEmpty = (v: unknown) => Array.isArray(v) && !v.length;
        for (const f of want) {
          const vs = held(f.key);
          if (vs.length > 1 && isEmpty(vs[0]) && vs.some((v) => !isEmpty(v))) seen.emptyFirst++;
          if (c.declared.some(([k]) => k === f.key) && vs.some((v) => !isEmpty(v)))
            seen.declaredCarried++;
          if (f.kind !== undefined) seen.settled++;
        }
        const firsts = c.rows.map((r) => Object.keys(r).filter((k) => !c.skip.includes(k)));
        if (firsts.some((ks) => ks.join() !== [...ks].sort().join())) seen.reordered++;
      },
      { shrink: shrinkTable },
    );
    expect(seen.emptyFirst, 'a field first carried as an empty list').toBeGreaterThanOrEqual(5);
    expect(seen.declaredCarried, 'a declared field an entry carries').toBeGreaterThanOrEqual(5);
    expect(seen.reordered, 'an entry with its keys out of order').toBeGreaterThanOrEqual(5);
    expect(seen.settled, 'fields whose kind is held to the model').toBeGreaterThanOrEqual(200);
  });

  it('gives back every entry saved as shown, and never a field it did not carry', () => {
    forAll(
      tableCase,
      (c) => {
        const fields = formFields(specOf(c));
        for (const row of c.rows) {
          for (const f of fields)
            if (!(f.key in row)) expect(showField(row, f, kindFor(row, f)), f.key).toBe('');
          const copy = clone(row);
          saveAsShown(copy, fields);
          expect(copy).toStrictEqual(row);
        }
      },
      { shrink: shrinkTable },
    );
  });
});

/** Every form of every tab with its fields, as the screen lays them out. */
const LAYOUT = FORMS.map(([name, spec]) => ({ name, spec, fields: formFields(spec) }));

/**
 * The forms, every one unless named, saved exactly as shown on the draft the screen edits. It
 * throws at the first input that refuses its own text, without `expect` per field, which is slow.
 */
function saveDraftAsShown(draft: ContentBundle, forms = LAYOUT) {
  for (const { name, spec, fields } of forms) {
    const target = spec.pick(draft);
    for (const row of (spec.list ? target : [target]) as Row[])
      for (const f of fields) {
        const kind = kindFor(row, f);
        if (!readField(row, f, kind, showField(row, f, kind)))
          throw new Error(`${name} ${String(row.id)} ${f.key}: refused the text it showed`);
      }
  }
}

interface ApplyCase {
  at: number;
  text: string;
  blank: string;
}

describe('what Apply stores once the forms are saved', () => {
  it('stores no table when every form of every tab is saved as shown', () => {
    const draft = clone(content);
    saveDraftAsShown(draft);
    expect(changedTables(draft)).toEqual({});
    expect(draft).toStrictEqual(clone(content));
  });

  /** Text that changes what an input of `kind` showing `shown` holds. */
  const otherText = (kind: FieldKind, shown: string) => {
    switch (kind) {
      case 'bool':
        return shown === 'true' ? 'false' : 'true';
      case 'number':
        return String(Number(shown || 0) + 1);
      case 'text':
        return `${shown}x`;
      case 'list':
        return shown ? `${shown}, zz` : 'zz';
      case 'numList':
        return shown ? `${shown}, 7` : '7';
      case 'json':
        return JSON.stringify([shown ? (JSON.parse(shown) as unknown) : null]);
    }
  };

  it.each(LAYOUT.map((l) => [l.name, l] as const))(
    '%s edits the draft it is handed, and Apply stores that tab alone until the edit is undone',
    (name, { spec, fields }) => {
      const tab = name.slice(0, name.indexOf('#'));
      const live = clone(content);
      // the first field and the last, which on a table that declares fields is a declared one
      for (const f of [fields[0], fields[fields.length - 1]]) {
        const draft = clone(content);
        const target = spec.pick(draft);
        const row = (spec.list ? (target as Row[])[0] : target) as Row;
        const kind = kindFor(row, f);
        const shown = showField(row, f, kind);
        const before = clone(row);
        expect(readField(row, f, kind, otherText(kind, shown)), f.key).toBe(true);
        expect(row, f.key).not.toStrictEqual(before);
        expect(Object.keys(changedTables(draft)), f.key).toEqual([tab]);
        expect(readField(row, f, kind, shown), f.key).toBe(true);
        expect(changedTables(draft), `${f.key} undone`).toEqual({});
      }
      // the live bundle the draft was copied from is never written
      expect(content).toStrictEqual(live);
    },
  );

  it('stores a length typed on one locomotive, validated as the number, and nothing once cleared', () => {
    const locos = content.locomotives;
    // the test above saves the other tabs; here the locomotive tab is saved after each edit
    const locoTab = LAYOUT.filter((l) => l.name.startsWith('locomotives#'));
    expect(validateContent(content), 'the shipped content is valid').toEqual([]);
    // how many typed lengths were inside and outside the range content validation allows
    const seen = { inside: 0, outside: 0 };
    forAll(
      (rng): ApplyCase => {
        const x = rng.chance(0.7) ? rng.int(0, 45) / 10 : num(rng);
        const text = rng.pick([
          String(x),
          x.toFixed(rng.int(0, 3)),
          x.toExponential(rng.int(0, 3)),
        ]);
        return {
          at: rng.int(0, locos.length - 1),
          text: ' '.repeat(rng.int(0, 1)) + text + ' '.repeat(rng.int(0, 1)),
          blank: ' '.repeat(rng.int(0, 2)),
        };
      },
      (c) => {
        // a shrunk text that no longer spells a number is outside the class
        if (!c.text.trim() || !Number.isFinite(Number(c.text))) return;
        const draft = clone(content);
        // the entry as the screen's locomotive form holds it, and its length field
        const loco = (locoForm.pick(draft) as Row[])[c.at];
        const f = field(locoForm, 'length');
        expect(readField(loco, f, kindFor(loco, f), c.text), 'refused').toBe(true);
        saveDraftAsShown(draft, locoTab);

        const length = Number(c.text);
        const want: ContentBundle = { ...content, locomotives: clone(content.locomotives) };
        want.locomotives[c.at].length = length;
        const changed = changedTables(draft);
        expect(Object.keys(changed), 'tables Apply stores').toEqual(['locomotives']);
        expect(changed.locomotives).toStrictEqual(want.locomotives);
        // the editor's problem line reads the same as for the number set on the entry directly
        const inside = length >= OWN_LENGTH.min && length <= OWN_LENGTH.max;
        seen[inside ? 'inside' : 'outside']++;
        const problems = validateContent(draft);
        expect(problems).toEqual(validateContent(want));
        expect(problems.length > 0, `problems: ${problems.join('; ')}`).toBe(!inside);

        expect(readField(loco, f, kindFor(loco, f), c.blank), 'blank, yet refused').toBe(true);
        saveDraftAsShown(draft, locoTab);
        expect(changedTables(draft), 'cleared, yet stored').toEqual({});
        expect(validateContent(draft)).toEqual([]);
      },
      {
        *shrink(c) {
          for (const cs of shrinkArray([...c.text])) yield { ...c, text: cs.join('') };
          for (const at of shrinkInt(c.at)) yield { ...c, at };
        },
        format: (c) => JSON.stringify({ ...c, loco: locos[c.at]?.id }),
        // each case compares whole tables as Apply does; half the seeds still reach both sides
        // of the range, and the model test above types a length on every locomotive
        seeds: SEEDS.slice(0, 50),
      },
    );
    expect(seen.inside, 'lengths inside the range').toBeGreaterThanOrEqual(10);
    expect(seen.outside, 'lengths outside the range').toBeGreaterThanOrEqual(10);
  });
});
