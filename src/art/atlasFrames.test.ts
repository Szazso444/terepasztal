/**
 * The sprite frame table: every frame the generators in `ATLAS_GROUPS` emit keeps its key, size
 * and anchor, checked against `atlasFrames.golden.json`. This replaces the manual screenshot check
 * for a generator change. The invariants hold whatever the table says.
 *
 * `track` is compared by key set only: `AtlasBuilder.add` trims each frame to its ink, and the
 * stub canvas has none, so every track frame comes out 1x1 at one constant anchor (OX * R,
 * OY * R). `tunnel` is painted on canvases too and comes out the same way; its canvas sizes and
 * anchors are pinned in `tunnelArt.test.ts`. That leaves track frame sizes and anchors unpinned;
 * they stay on `node scratchpad/atlas-frames.mjs <label>` (needs a browser). Also unpinned are frames only a
 * shipped `public/assets/<group>.png` pair carries: this checks what the generators emit.
 *
 * `rolling` and `wagons` follow content, and a frame size is the trimmed ink box, so a new body,
 * size or paint, or a change at a sprite's edge, moves the table on purpose. Art re-records it in
 * the pull request that changes a generator and QA reads the table diff. From the repository root:
 *
 *   UPDATE_ATLAS_FRAMES=1 npx vitest run src/art/atlasFrames.test.ts
 *   $env:UPDATE_ATLAS_FRAMES=1; npx vitest run src/art/atlasFrames.test.ts     (PowerShell)
 *
 * A plain `npm test` never writes the table.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FrameDef } from '../engine/atlas';
import { DRAWN_FACINGS } from '../sim/body';
import { ATLAS_GROUPS } from './index';

const TABLE_URL = new URL('./atlasFrames.golden.json', import.meta.url);
const TABLE_PATH = 'src/art/atlasFrames.golden.json';
const RECORD = [
  'UPDATE_ATLAS_FRAMES=1 npx vitest run src/art/atlasFrames.test.ts',
  '$env:UPDATE_ATLAS_FRAMES=1; npx vitest run src/art/atlasFrames.test.ts   (PowerShell)',
];
const UPDATE = process.env.UPDATE_ATLAS_FRAMES === '1';
/** Groups whose frames are pinned by key only (see the header). */
const KEYS_ONLY = new Set(['track', 'tunnel']);
/** Groups whose keys all end in `_f<facing>`, one family per sprite. */
const FACED = ['rolling', 'wagons'];
const SHOWN = 30;

/** group -> frame key -> "WxH@ax,ay" ('' for a keys-only group) */
type Table = Record<string, Record<string, string>>;

/** Node has no ImageData or canvas: a stand-in that keeps the pixels (all clear) the packer reads. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    this.width = typeof a === 'number' ? a : b;
    this.height = typeof a === 'number' ? b : (c ?? a.length / 4 / b);
    this.data = typeof a === 'number' ? new Uint8ClampedArray(a * b * 4) : a;
  }
}
/** A 2D context that accepts every drawing call and reads back blank pixels. */
const context = new Proxy(
  {},
  {
    get: (_, name) =>
      name === 'getImageData'
        ? (_x: number, _y: number, w: number, h: number) => new FakeImageData(w, h)
        : name === 'createLinearGradient'
          ? () => ({ addColorStop: () => undefined })
          : () => undefined,
    set: () => true,
  },
);

const frameDefs: Record<string, Record<string, FrameDef>> = {};
const generated: Table = {};
const owners = new Map<string, string[]>();
let randomCalls = -1;

beforeAll(async () => {
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  const random = vi.spyOn(Math, 'random');
  try {
    for (const { name, generate } of ATLAS_GROUPS) {
      const frames = (await generate()).frames;
      frameDefs[name] = frames;
      generated[name] = {};
      for (const [key, f] of Object.entries(frames)) {
        generated[name][key] = KEYS_ONLY.has(name) ? '' : `${f.w}x${f.h}@${f.ax},${f.ay}`;
        owners.set(key, [...(owners.get(key) ?? []), name]);
      }
    }
  } finally {
    randomCalls = random.mock.calls.length;
    random.mockRestore();
    vi.unstubAllGlobals();
  }
}, 60_000);

/** Code-unit order, so the file is the same on every machine. */
const sorted = (items: Iterable<string>) => [...items].sort();

/** The table as the file holds it: sorted, keys-only groups as lists, one trailing newline. */
function serialise(table: Table) {
  const out: Record<string, string[] | Record<string, string>> = {};
  for (const group of sorted(Object.keys(table))) {
    const frames = table[group];
    out[group] = KEYS_ONLY.has(group)
      ? sorted(Object.keys(frames))
      : Object.fromEntries(sorted(Object.keys(frames)).map((k) => [k, frames[k]]));
  }
  return JSON.stringify(out, null, 2) + '\n';
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
const fail = (problem: string): never => {
  throw new Error(`${TABLE_PATH} ${problem}. Record it with:\n  ${RECORD.join('\n  ')}`);
};

/** The recorded table, or an error that says what is wrong with the file and how to record it. */
function readTable(url = TABLE_URL): Table {
  let text = '';
  try {
    text = readFileSync(url, 'utf8');
  } catch (err) {
    return fail(`cannot be read (${why(err)})`);
  }
  return parseTable(text);
}

function parseTable(text: string): Table {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return fail(`is not valid JSON (${why(err)})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return fail('is not an object');
  const table: Table = {};
  for (const [group, body] of Object.entries(raw)) {
    const keysOnly = KEYS_ONLY.has(group);
    const isObject = typeof body === 'object' && body !== null && !Array.isArray(body);
    if (keysOnly ? !Array.isArray(body) : !isObject)
      return fail(`has a malformed group "${group}"`);
    const entries = keysOnly
      ? (body as unknown[]).map((k) => [k, ''])
      : Object.entries(body as object);
    if (entries.some(([k, v]) => typeof k !== 'string' || typeof v !== 'string'))
      return fail(`has a non-string entry in group "${group}"`);
    table[group] = Object.fromEntries(entries);
  }
  return table;
}

/** Added, removed and moved frames of `got` against `want`, one line each: "key [group] ...". */
function diffTables(want: Table, got: Table) {
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  for (const group of sorted(new Set([...Object.keys(want), ...Object.keys(got)]))) {
    const a = want[group] ?? {};
    const b = got[group] ?? {};
    for (const key of sorted(new Set([...Object.keys(a), ...Object.keys(b)]))) {
      const tag = `${key} [${group}]`;
      if (!Object.hasOwn(a, key)) added.push(b[key] ? `${tag} ${b[key]}` : tag);
      else if (!Object.hasOwn(b, key)) removed.push(a[key] ? `${tag} ${a[key]}` : tag);
      else if (a[key] !== b[key]) moved.push(`${tag} ${a[key]} -> ${b[key]}`);
    }
  }
  return { added, removed, moved };
}

/** The failure text: each kind with its total and at most SHOWN lines, then how to re-record. */
function describeDiff(diff: ReturnType<typeof diffTables>) {
  const parts = Object.entries(diff).flatMap(([kind, lines]) =>
    lines.length === 0
      ? []
      : [
          `${kind} (${lines.length}):`,
          ...lines.slice(0, SHOWN).map((l) => `  ${l}`),
          ...(lines.length > SHOWN ? [`  ... and ${lines.length - SHOWN} more`] : []),
        ],
  );
  return [
    `The generated sprite frames differ from ${TABLE_PATH}:`,
    ...parts,
    'If the change is intended, re-record the table and review its diff:',
    ...RECORD.map((r) => `  ${r}`),
  ].join('\n');
}

describe('sprite frame table', () => {
  it('matches the generated frames of every atlas group (track by key only)', () => {
    if (UPDATE) {
      writeFileSync(fileURLToPath(TABLE_URL), serialise(generated));
      console.log(`recorded ${TABLE_PATH}`);
      return;
    }
    const diff = diffTables(readTable(), generated);
    if (Object.values(diff).some((lines) => lines.length)) throw new Error(describeDiff(diff));
  });

  it('is stored as the record command writes it: sorted, one trailing newline', () => {
    const table = readTable();
    const text = readFileSync(TABLE_URL, 'utf8').replace(/\r\n/g, '\n');
    expect(text === serialise(table), `${TABLE_PATH} was edited by hand; ${RECORD[0]}`).toBe(true);
  });

  it('fails a missing or malformed table with the problem and the record command', () => {
    const bad: [() => unknown, string][] = [
      [() => readTable(new URL('./no-such-table.json', TABLE_URL)), 'cannot be read'],
      [() => parseTable(''), 'not valid JSON'],
      [() => parseTable('[]'), 'not an object'],
      [() => parseTable('{"fx":null}'), 'malformed group "fx"'],
      [() => parseTable('{"track":{}}'), 'malformed group "track"'],
      [() => parseTable('{"fx":{"a":1}}'), 'non-string entry in group "fx"'],
      [() => parseTable('{"track":[1]}'), 'non-string entry in group "track"'],
    ];
    for (const [run, problem] of bad) {
      expect(run).toThrow(problem);
      expect(run).toThrow(RECORD[0]);
    }
  });

  it('serialises sorted, with decimals kept and one trailing newline', () => {
    const text = serialise({
      b: { 'z/b': '1x1@3.5,3.5', 'z/a': '2x3@1,0' },
      track: { t2: '', t1: '' },
    });
    expect(text).toBe(
      `{\n  "b": {\n    "z/a": "2x3@1,0",\n    "z/b": "1x1@3.5,3.5"\n  },\n  "track": [\n    "t1",\n    "t2"\n  ]\n}\n`,
    );
    const keys = { 'z/b': '', 'z/a': '', 'z/_': '', 'z/B': '', 'z/1': '' };
    const order = Object.keys(JSON.parse(serialise({ b: keys })).b);
    expect(order, 'code-unit order, not locale order').toEqual(['z/1', 'z/B', 'z/_', 'z/a', 'z/b']);
  });

  it('reports added, removed and moved frames, at most 30 of each, with the re-record command', () => {
    const many = (n: number, size: string) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, size]));
    const diff = diffTables(
      { g: { gone: '1x1@0,0', ...many(40, '2x2@1,1') } },
      { g: { fresh: '3x3@1.5,2', ...many(40, '2x2@1,2') }, track: { t: '' } },
    );
    expect(diff.added).toEqual(['fresh [g] 3x3@1.5,2', 't [track]']);
    expect(diff.removed).toEqual(['gone [g] 1x1@0,0']);
    expect(diff.moved).toHaveLength(40);
    expect(diff.moved[0]).toBe('k0 [g] 2x2@1,1 -> 2x2@1,2');
    const text = describeDiff(diff);
    expect(text).toContain('added (2):');
    expect(text).toContain('moved (40):');
    expect(text.split('\n').filter((l) => l.startsWith('  k'))).toHaveLength(SHOWN);
    expect(text).toContain('... and 10 more');
    expect(text).toContain(RECORD[0]);
  });
});

describe('sprite frame invariants', () => {
  it('no frame key comes from two groups', () => {
    const doubled = [...owners].filter(([, groups]) => groups.length > 1);
    expect(doubled.map(([key, groups]) => `${key}: ${groups.join(', ')}`)).toEqual([]);
  });

  it('every frame outside track has a positive whole-number size and finite anchors', () => {
    const bad: string[] = [];
    for (const [group, frames] of Object.entries(frameDefs))
      for (const [key, f] of KEYS_ONLY.has(group) ? [] : Object.entries(frames))
        if (
          !(Number.isInteger(f.w) && f.w > 0 && Number.isInteger(f.h) && f.h > 0) ||
          !(Number.isFinite(f.ax) && Number.isFinite(f.ay))
        )
          bad.push(`${key} [${group}] ${f.w}x${f.h}@${f.ax},${f.ay}`);
    expect(bad.slice(0, SHOWN)).toEqual([]);
  });

  it('rolling and wagons carry exactly the drawn facings in every family', () => {
    const families = new Map<string, Set<number>>();
    const bad: string[] = [];
    for (const group of FACED)
      for (const key of Object.keys(generated[group] ?? {})) {
        const m = /^(.*)_f(\d+)$/.exec(key);
        if (!m) bad.push(`${key} [${group}] does not end in _f<facing>`);
        else families.set(m[1], (families.get(m[1]) ?? new Set()).add(Number(m[2])));
      }
    const list = (facings: number[]) => facings.sort((a, b) => a - b).join(' ') || 'none';
    for (const [family, facings] of families) {
      const missing = [...DRAWN_FACINGS].filter((f) => !facings.has(f));
      const extra = [...facings].filter((f) => !DRAWN_FACINGS.has(f));
      if (missing.length || extra.length)
        bad.push(`${family}: missing ${list(missing)}; extra ${list(extra)}`);
    }
    expect(families.size, 'families found').toBeGreaterThan(0);
    expect(bad.slice(0, SHOWN)).toEqual([]);
  });

  it('leaves neither stub behind once the groups are generated', () => {
    expect([typeof ImageData, typeof document]).toEqual(['undefined', 'undefined']);
  });

  it('generation does not call Math.random', () => {
    expect(randomCalls, 'Math.random calls while generating').toBe(0);
  });
});
