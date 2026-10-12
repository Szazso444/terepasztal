import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { CONTENT_KEYS, DEFAULT_CONTENT } from '../data/content';
import {
  TAB_FORMS,
  formFields,
  kindFor,
  readField,
  shippedRows,
  showField,
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
    expect(loco).toStrictEqual(before);
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
