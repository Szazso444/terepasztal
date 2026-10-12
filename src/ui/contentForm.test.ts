import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { CONTENT_KEYS, DEFAULT_CONTENT, type ContentBundle } from '../data/content';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
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
