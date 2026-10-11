import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
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

describe('the layers below the UI do not import it', () => {
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

describe('the rest of src is free to import the UI', () => {
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
