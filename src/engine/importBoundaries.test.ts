import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

// The import-direction rule of eslint.config.js, checked by running that very config over probe
// sources: the layers below the UI may not import `ui` or `editor`, and nothing else is touched.
// The lint is syntactic, so the probes' targets need not exist.

/** The areas below the UI. A new lower area is a one-line addition here and in eslint.config.js. */
const LOWER_AREAS = ['engine', 'world', 'sim', 'gacha', 'data', 'render'];
/** The areas under src that the rule does not cover: the UI itself and the two it leaves out. */
const FREE_AREAS = ['ui', 'editor', 'art', 'testing'];
/** Files at the top of src that wire the layers together and may import anything. */
const HUB_FILES = ['game.ts', 'main.ts', 'intent.ts', 'strings.ts'];

const RULE = 'no-restricted-imports';
/** A test lints dozens of probes through the real config. On a busy machine that outlasts vitest's
 * default 5 s, and a timeout would be a flake, not a finding. */
const LINT_TIMEOUT = 60_000;
const root = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

beforeAll(async () => {
  // Loading the config and the TypeScript parser is the slow part; do it once, up front.
  await eslint.lintText('export {};\n', { filePath: 'src/engine/warmup.ts' });
}, 60_000);

/** The `no-restricted-imports` reports for `code` as if it lived at `filePath`. */
async function restrictions(filePath: string, code: string) {
  expect(await eslint.isPathIgnored(filePath), `${filePath} is ignored by the config`).toBe(false);
  const results = await eslint.lintText(code, { filePath });
  expect(results, `${filePath} was not linted`).toHaveLength(1);
  const { messages } = results[0];
  expect(
    messages.filter((m) => m.fatal),
    `${filePath} does not parse: ${code}`,
  ).toEqual([]);
  return messages.filter((m) => m.ruleId === RULE);
}

/** Every way of pulling `spec` in or re-exporting from it. */
const forms = (spec: string): string[] => [
  `import { x } from '${spec}';\nexport const y = x;`,
  `import x from '${spec}';\nexport const y = x;`,
  `import * as x from '${spec}';\nexport const y = x;`,
  `import type { X } from '${spec}';\nexport type Y = X;`,
  `import { type X } from '${spec}';\nexport type Y = X;`,
  `import '${spec}';`,
  `export { x } from '${spec}';`,
  `export type { X } from '${spec}';`,
  `export * from '${spec}';`,
  `export * as x from '${spec}';`,
];

/** The probes in `probes` that `filePath` is (or is not) told off for. */
async function flagged(filePath: string, probes: string[], want: boolean) {
  const odd: string[] = [];
  for (const code of probes) {
    const reports = await restrictions(filePath, code);
    if (reports.length > 0 !== want) odd.push(code);
  }
  return odd;
}

const UI_ONE = '../ui/minimap';
const EDITOR_ONE = '../editor/editor';

describe('the layers below the UI do not import it', { timeout: LINT_TIMEOUT }, () => {
  it.each(LOWER_AREAS)(
    'src/%s rejects the UI and the editor in every import form',
    async (area) => {
      const probes = [UI_ONE, EDITOR_ONE].flatMap(forms);
      const missed = await flagged(`src/${area}/probe.ts`, probes, true);
      expect(missed, 'these were not reported').toEqual([]);
    },
  );

  it.each(LOWER_AREAS)('src/%s rejects the UI directory itself and a deeper file', async (area) => {
    const bare = ['../ui', '../editor', '../ui/', '../editor/'].map((s) => forms(s)[0]);
    expect(await flagged(`src/${area}/probe.ts`, bare, true)).toEqual([]);
    for (const [depth, up] of [
      [2, '../../'],
      [3, '../../../'],
    ] as const) {
      const file = `src/${area}/${'sub/'.repeat(depth - 1)}probe.ts`;
      const probes = ['ui/minimap', 'editor/editor', 'ui'].flatMap((s) => forms(up + s));
      expect(await flagged(file, probes, true), `${depth} levels down`).toEqual([]);
    }
  });

  it.each(LOWER_AREAS)('src/%s says why', async (area) => {
    const [report] = await restrictions(`src/${area}/probe.ts`, forms(UI_ONE)[0]);
    expect(report.severity).toBe(2);
    expect(report.message).toMatch(/do not depend on the UI/);
    expect(report.message).toMatch(/pass the value in|move the shared code down/i);
  });

  // A case-insensitive disk (macOS, Windows) resolves `../UI/minimap` to src/ui, so the rule must
  // not be case-sensitive. CI runs on Linux, where it would not resolve at all.
  it.each(LOWER_AREAS)('src/%s rejects a mis-cased ui or editor folder', async (area) => {
    const probes = ['../UI/minimap', '../Editor/editor', '../Ui'].flatMap(forms);
    expect(await flagged(`src/${area}/probe.ts`, probes, true)).toEqual([]);
  });

  it.each(LOWER_AREAS)('src/%s may import everything that is not the UI', async (area) => {
    const siblings = [
      '../world/uiThing',
      '../world/editorial',
      '../world/ui-kit',
      '../world/editor_state',
      './uiHelpers',
      './editors',
    ];
    const lower = LOWER_AREAS.flatMap((other) => [`../${other}/rules`, `../${other}`]);
    const probes = [...siblings, ...lower, './sibling', 'pixi.js'].flatMap(forms);
    expect(await flagged(`src/${area}/probe.ts`, probes, false)).toEqual([]);
    const deeper = ['../../world/uiThing', '../../sim/rules'].flatMap(forms);
    expect(await flagged(`src/${area}/sub/probe.ts`, deeper, false)).toEqual([]);
  });

  it.each(LOWER_AREAS)('src/%s tests may cross the boundary', async (area) => {
    const probes = [UI_ONE, EDITOR_ONE].flatMap(forms);
    expect(await flagged(`src/${area}/probe.test.ts`, probes, false)).toEqual([]);
    expect(await flagged(`src/${area}/sub/probe.test.ts`, probes, false)).toEqual([]);
  });
});

describe('the rest of src is free to import the UI', { timeout: LINT_TIMEOUT }, () => {
  it.each(FREE_AREAS)('src/%s is not restricted', async (area) => {
    const probes = ['../ui/minimap', '../editor/editor', '../render/overviewRenderer'].flatMap(
      forms,
    );
    expect(await flagged(`src/${area}/probe.ts`, probes, false)).toEqual([]);
  });

  it.each(HUB_FILES)('src/%s is not restricted', async (file) => {
    const probes = ['./ui/dom', './editor/editor', './render/overviewRenderer'].flatMap(forms);
    expect(await flagged(`src/${file}`, probes, false)).toEqual([]);
  });
});

describe('the area lists', () => {
  it('name every directory under src, so a new area is a decision and not an accident', () => {
    const dirs = readdirSync(new URL('../', import.meta.url), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(
      dirs,
      'a new directory under src: add it to LOWER_AREAS (and eslint.config.js) or to FREE_AREAS',
    ).toEqual([...LOWER_AREAS, ...FREE_AREAS].sort());
  });

  it('keep the lower and the free areas apart', () => {
    expect(LOWER_AREAS.filter((a) => FREE_AREAS.includes(a))).toEqual([]);
  });
});

describe('only *.test.ts is exempt', { timeout: LINT_TIMEOUT }, () => {
  it.each([
    'test.ts',
    'latest.ts',
    'probe.tests.ts',
    'probe.testing.ts',
    'probe.spec.ts',
    'test/probe.ts',
    '__tests__/probe.ts',
  ])('src/sim/%s is shipped code and is restricted', async (name) => {
    const probes = [forms(UI_ONE)[0], forms(EDITOR_ONE)[0]];
    expect(await flagged(`src/sim/${name}`, probes, true)).toEqual([]);
  });
});

// The rule reads a specifier; what matters is where it lands. The checks below hold the rule to
// that, against a plain path resolution that knows nothing about the rule's pattern.

/** A made-up repository root, so a specifier resolves without the disk. */
const REPO = '/repo';

/** Where `spec`, written in a file of `dir` (a path from the repo root), points; null for a package. */
function landing(dir: string, spec: string): string | null {
  if (spec.startsWith('.')) return posix.resolve(REPO, dir, spec);
  if (spec.startsWith('/')) return posix.join(REPO, spec); // Vite reads a leading slash from the root
  return null;
}

/** Whether `spec`, written in a file of `dir`, lands in src/ui or src/editor. */
function reachesUi(dir: string, spec: string): boolean {
  const to = landing(dir, spec);
  return (
    to !== null &&
    ['ui', 'editor'].some((d) => to === `${REPO}/src/${d}` || to.startsWith(`${REPO}/src/${d}/`))
  );
}

/** The shortest few of `xs`: the smallest cases of a failure, not a thousand of them. */
const smallest = (xs: string[]) =>
  [...xs].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 5);

/**
 * Every relative specifier of up to three segments after a leading `./` or `../`, with and without
 * a file at the end. `src` and `world` are in the alphabet so a path can leave src and come back
 * in, or detour through a neighbour; `uiThing` is a name that only starts like `ui`.
 */
const SEGMENTS = ['..', '.', 'ui', 'editor', 'world', 'src', 'uiThing'];
const WALKS: string[] = (() => {
  const heads: string[] = [];
  const extend = (head: string, left: number): void => {
    heads.push(head);
    if (left > 0) for (const s of SEGMENTS) extend(`${head}/${s}`, left - 1);
  };
  for (const lead of ['.', '..']) extend(lead, 3);
  return heads.flatMap((h) => [h, `${h}/minimap`]);
})();

describe('the rule agrees with where an import lands', { timeout: LINT_TIMEOUT }, () => {
  // The config glob is the same at every depth and the depth is what moves a specifier's landing
  // place, so the areas take depths 1 to 3 in turn.
  const cases = LOWER_AREAS.map((area, i) => ({ area, dir: `src/${area}${'/sub'.repeat(i % 3)}` }));

  it('has walks that land in the UI and walks that do not', () => {
    for (const { dir } of cases) {
      const landed = WALKS.filter((spec) => reachesUi(dir, spec)).length;
      // Three folders down, only `../../../ui` and `../../../editor` (with a file or without)
      // fit in three segments; nearer the top there are plenty more, detours included.
      expect(landed, `from ${dir}`).toBeGreaterThanOrEqual(4);
      expect(WALKS.length - landed, `from ${dir}`).toBeGreaterThan(1000);
    }
  });

  it.each(cases)('from $dir, every walk into src/ui or src/editor is reported', async ({ dir }) => {
    const code = WALKS.map((spec) => `import '${spec}';`).join('\n');
    const [result] = await eslint.lintText(code, { filePath: `${dir}/probe.ts` });
    expect(
      result.messages.filter((m) => m.fatal),
      'the walks do not parse',
    ).toEqual([]);
    const reported = new Set(result.messages.filter((m) => m.ruleId === RULE).map((m) => m.line));
    const holes = WALKS.filter((spec, i) => reachesUi(dir, spec) && !reported.has(i + 1));
    expect(smallest(holes), `from ${dir}, ${holes.length} walks land in the UI unreported`).toEqual(
      [],
    );
    // Reporting more than src/ui and src/editor themselves is fine (a src/world/ui folder would be
    // told off too), but only for a specifier that names a ui or editor folder: never a lookalike.
    const named = (spec: string) => spec.split('/').some((s) => s === 'ui' || s === 'editor');
    const stray = WALKS.filter((spec, i) => reported.has(i + 1) && !named(spec));
    expect(smallest(stray), `from ${dir}, ${stray.length} walks reported by name alone`).toEqual(
      [],
    );
  });
});

// The tree as it stands, read without ESLint.

/** The files under `dir` (a path from the repo root), as paths from the repo root. */
function walk(dir: string): string[] {
  return readdirSync(root + dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
}

/** The source files of the lower areas that are not tests: the shipped code the boundary is for. */
const shipped = (): string[] =>
  LOWER_AREAS.flatMap((area) => walk(`src/${area}`)).filter(
    (f) => /\.[cm]?[jt]sx?$/.test(f) && !f.endsWith('.test.ts'),
  );

/**
 * What `code` pulls in: the string of every static import and re-export, `import x = require()`,
 * `import()`, `require()`, `import('x')` type and `import.meta.glob()` (its directory part). A
 * null stands for a computed specifier, which nothing can check.
 */
function pullsIn(code: string): (string | null)[] {
  const file = ts.createSourceFile('probe.ts', code, ts.ScriptTarget.ES2022, true);
  const found: (string | null)[] = [];
  const literal = (n: ts.Node | undefined) => (n && ts.isStringLiteralLike(n) ? n.text : null);
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
      found.push(literal(n.moduleSpecifier));
    } else if (ts.isExternalModuleReference(n)) {
      found.push(literal(n.expression));
    } else if (ts.isImportTypeNode(n)) {
      found.push(ts.isLiteralTypeNode(n.argument) ? literal(n.argument.literal) : null);
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require')
      ) {
        found.push(literal(n.arguments[0]));
      } else if (/^import\.meta\.glob(?:Eager)?$/.test(callee.getText(file))) {
        const arg = n.arguments[0];
        const patterns = arg && ts.isArrayLiteralExpression(arg) ? arg.elements : [arg];
        for (const p of patterns.map(literal)) found.push(p?.replace(/[*?[{(!].*$/s, '') ?? null);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

/** What `code`, written in a file of `dir`, pulls in from src/ui or src/editor, or cannot be told. */
const reaches = (dir: string, code: string): string[] =>
  pullsIn(code)
    .filter((spec) => spec === null || reachesUi(dir, spec))
    .map((spec) => spec ?? '<computed specifier>');

/** The directives in `code` that switch this rule off for a line or a file: by name or wholesale. */
function suppressions(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(
    /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?(?![\w-])[^\n]*/g,
  )) {
    const names = m[0]
      .replace(/^[^]*?eslint-disable(?:-next-line|-line)?/, '')
      .split('--')[0]
      .replace(/\*\/\s*$/, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0 || names.includes(RULE)) found.push(m[0].trim());
  }
  for (const m of code.matchAll(/\/\*\s*eslint\s[^*]*no-restricted-imports[^\n]*/g)) {
    found.push(m[0].trim());
  }
  return found;
}

describe('the tree as it stands', { timeout: LINT_TIMEOUT }, () => {
  it('has shipped code in every lower area to check', () => {
    const files = shipped();
    for (const area of LOWER_AREAS) {
      expect(files.filter((f) => f.startsWith(`src/${area}/`)).length, area).toBeGreaterThan(0);
    }
  });

  it('the scan sees every way of pulling a module in', () => {
    const seen = [
      ...forms('../ui/minimap'),
      "const a = await import('../ui/a');",
      "const b = require('../ui/b');",
      "import c = require('../ui/c');",
      "type D = import('../ui/d').D;",
      "const e = import.meta.glob('../ui/*.ts');",
      "const f = import.meta.glob(['../world/*.ts', '../editor/**/*.ts']);",
      "const g = import('/src/ui/g');",
      "const h = import('../world/../editor/h');",
      'const i = import(name);',
    ];
    for (const code of seen) expect(reaches('src/sim', code), code).toHaveLength(1);
    const unseen = [
      ...forms('../world/uiThing'),
      ...forms('pixi.js'),
      "const a = await import('../world/editorial');",
      "const b = require('pixi.js');",
      "const c = import.meta.glob('./*.json');",
      "type D = import('./sibling').D;",
    ];
    for (const code of unseen) expect(reaches('src/sim', code), code).toEqual([]);
    expect(reaches('src/sim/sub', "import x from '../ui/x';")).toEqual([]);
    expect(reaches('src/sim/sub', "import x from '../../ui/x';")).toHaveLength(1);
  });

  it('no shipped file under the lower areas reaches src/ui or src/editor', () => {
    const files = shipped();
    let scanned = 0;
    const reached: string[] = [];
    for (const file of files) {
      const code = readFileSync(root + file, 'utf8');
      scanned += pullsIn(code).length;
      reached.push(...reaches(posix.dirname(file), code).map((spec) => `${file}: ${spec}`));
    }
    expect(scanned, 'the scan found next to nothing to look at').toBeGreaterThan(200);
    expect(
      reached,
      'shipped code that depends on the UI, or imports what cannot be checked',
    ).toEqual([]);
  });

  it('every shipped file under the lower areas is under the rule at error level', async () => {
    const uncovered: string[] = [];
    for (const file of shipped()) {
      const setting = (await eslint.calculateConfigForFile(file))?.rules?.[RULE];
      const severity = Array.isArray(setting) ? setting[0] : setting;
      if (severity !== 2 && severity !== 'error') uncovered.push(file);
    }
    expect(uncovered, 'files the import rule does not apply to').toEqual([]);
  });

  it('the suppression scan sees what switches the rule off', () => {
    const seen = [
      '/* eslint-disable */',
      '// eslint-disable-next-line',
      '/* eslint-disable no-restricted-imports */',
      '// eslint-disable-next-line no-restricted-imports -- the hub needs it',
      '/* eslint-disable-next-line @typescript-eslint/no-explicit-any, no-restricted-imports */',
      '// eslint-disable-line no-restricted-imports',
      '/* eslint no-restricted-imports: off */',
    ];
    for (const code of seen) expect(suppressions(`const x = 1; ${code}\n`), code).toHaveLength(1);
    const unseen = [
      '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
      '/* eslint-disable no-console, no-empty */',
      '// eslint-disable-next-line no-restricted-globals -- not this rule',
      '// a comment that says eslint is fine',
    ];
    for (const code of unseen) expect(suppressions(`${code}\n`), code).toEqual([]);
  });

  it('no shipped file under the lower areas suppresses the rule', () => {
    const found = shipped().flatMap((file) =>
      suppressions(readFileSync(root + file, 'utf8')).map((d) => `${file}: ${d}`),
    );
    expect(found).toEqual([]);
  });
});
