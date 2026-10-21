/**
 * The waterside tree set of #460, assets/source/waterside-trees-2026-10-16: what its scripts claim
 * of the files they recorded. Vitest collects tests from tools/ and src/ only, so the set's tests
 * live here.
 *
 * check-tree.mjs measures a painting, writes its look (checks/<name>-look.png: the tree packed and
 * drawn beside the props atlas's oak) and, with --record, its trees.json entry. It writes beside
 * itself and reads the atlas three folders up, so the tests run a verbatim copy of it in a folder
 * of their own under the temp directory, never in the repository. The copy reaches the repository's
 * tools and pngjs through one-line modules that import them by absolute address; there are no links,
 * so nothing is at stake if the folder is left behind.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { EYE_FEET } from '../assets/source/waterside-trees-2026-10-16/record-eye-feet.mjs';

const SET_DIR = 'assets/source/waterside-trees-2026-10-16';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SET = join(ROOT, SET_DIR);
const RECORD = `node ${SET_DIR}/record-eye-feet.mjs`;
const run = promisify(execFile);

const trees = JSON.parse(readFileSync(join(SET, 'trees.json'), 'utf8'));
const { attempts } = JSON.parse(readFileSync(join(SET, 'prompts.json'), 'utf8'));

let box;
/** File name -> what check-tree.mjs printed for it in the sandbox, and the look it wrote. */
const made = new Map();

/**
 * A folder laid out like the repository around check-tree.mjs: the script copied as it is, a
 * module in tools/ for each tool it imports that re-exports the repository's, pngjs the same way,
 * and the shipped props atlas the look draws its oak from.
 */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'waterside-trees-'));
  const source = readFileSync(join(SET, 'check-tree.mjs'), 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  mkdirSync(join(dir, SET_DIR), { recursive: true });
  mkdirSync(join(dir, 'tools'));
  for (const spec of imports) {
    if (spec.startsWith('node:')) continue;
    const tool = /^\.\.\/\.\.\/\.\.\/tools\/([\w-]+\.mjs)$/.exec(spec);
    if (tool) {
      const real = pathToFileURL(join(ROOT, 'tools', tool[1])).href;
      writeFileSync(join(dir, 'tools', tool[1]), `export * from '${real}';\n`);
    } else if (spec === 'pngjs') {
      const real = pathToFileURL(createRequire(import.meta.url).resolve('pngjs')).href;
      mkdirSync(join(dir, 'node_modules/pngjs'), { recursive: true });
      writeFileSync(
        join(dir, 'node_modules/pngjs/package.json'),
        JSON.stringify({ name: 'pngjs', type: 'module', exports: './index.js' }),
      );
      writeFileSync(
        join(dir, 'node_modules/pngjs/index.js'),
        `import pngjs from '${real}';\nexport const PNG = pngjs.PNG;\nexport default pngjs;\n`,
      );
    } else throw new Error(`check-tree.mjs imports ${spec}: teach the sandbox about it`);
  }
  writeFileSync(join(dir, SET_DIR, 'check-tree.mjs'), source);
  mkdirSync(join(dir, 'public/assets'), { recursive: true });
  for (const f of ['props.png', 'props.json'])
    copyFileSync(join(ROOT, 'public/assets', f), join(dir, 'public/assets', f));
  return dir;
}

/** check-tree.mjs on one painting as it was recorded: its kind, height and, if not automatic, foot. */
async function check(file) {
  const r = trees[file];
  const args = [join(SET, file), '--kind', r.kind, '--height', String(r.height)];
  if (JSON.stringify(r.foot) !== JSON.stringify(r.footAuto)) args.push('--foot', r.foot.join(','));
  const { stdout } = await run(process.execPath, [join(box, SET_DIR, 'check-tree.mjs'), ...args], {
    cwd: box,
    encoding: 'utf8',
  });
  const result = JSON.parse(stdout.trim().split('\n').pop());
  made.set(file, { result, look: PNG.sync.read(readFileSync(join(box, SET_DIR, result.look))) });
}

/** How many pixels of `a` and `b` differ, and the box they lie in; null when the sizes differ. */
function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return null;
  let changed = 0;
  const where = [Infinity, Infinity, -1, -1];
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data.readUInt32BE(i) === b.data.readUInt32BE(i)) continue;
    changed++;
    const x = (i / 4) % a.width;
    const y = Math.floor(i / 4 / a.width);
    where[0] = Math.min(where[0], x);
    where[1] = Math.min(where[1], y);
    where[2] = Math.max(where[2], x);
    where[3] = Math.max(where[3], y);
  }
  return { changed, box: changed ? where : [] };
}

// slow: six check-tree.mjs runs, each decoding and packing a 1254 px painting, about a second each
beforeAll(async () => {
  box = sandbox();
  await Promise.all(Object.keys(trees).map(check));
}, 60_000);
afterAll(() => rmSync(box, { recursive: true, force: true }));

describe('the waterside tree set', () => {
  it('records the six selected paintings, each in trees.json and in a selected attempt', () => {
    const selected = attempts.filter((a) => a.selected).map((a) => a.file);
    expect(Object.keys(trees).sort()).toEqual([...selected].sort());
    expect(selected).toHaveLength(6);
  });
  it('records each painting as check-tree.mjs measures it at its recorded foot', () => {
    for (const file of Object.keys(trees))
      expect(
        made.get(file).result,
        `${file}: trees.json is not what check-tree.mjs measures; measure it again with --record`,
      ).toEqual(trees[file]);
  });
  it('stands each eye-foot record on the foot the review read, the automatic one kept apart', () => {
    for (const eye of EYE_FEET) {
      const r = trees[eye.file];
      expect([r.kind, r.height, r.foot], eye.file).toEqual([eye.kind, eye.height, eye.foot]);
      const chosen = attempts.filter((a) => a.file === eye.file && a.selected);
      expect(chosen, eye.file).toHaveLength(1);
      const m = chosen[0].measured;
      // the selected attempt carries the record as measured, and says whose foot it is
      for (const [key, value] of Object.entries(r))
        expect(m[key], `${eye.file} ${key}`).toEqual(value);
      expect([m.footReadByEye, m.footReason], eye.file).toEqual([true, eye.reason]);
      // what it replaced is the automatic measurement, never an earlier run's eye measurement
      expect(m.automaticMeasurement.foot, eye.file).toEqual(r.footAuto);
      expect(m.automaticMeasurement.footAuto, eye.file).toEqual(r.footAuto);
    }
  });
  it('draws each eye-foot look as record-eye-feet.mjs draws it now: a second run changes nothing', () => {
    for (const eye of EYE_FEET) {
      const r = trees[eye.file];
      const committed = PNG.sync.read(readFileSync(join(SET, r.look)));
      expect(
        pixelDiff(made.get(eye.file).look, committed),
        `${r.look} is not what check-tree.mjs draws at the shipped props atlas; run ${RECORD}`,
      ).toEqual({ changed: 0, box: [] });
    }
  });
});
