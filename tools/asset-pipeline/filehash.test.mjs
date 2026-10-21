import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../src/engine/rng';
import { forAll, SEEDS, shrinkArray } from '../../src/testing/property';

// Properties of filehash.py, the hash behind every lock, receipt and manifest of the hand-built
// method: one hash for an input on the cloud's LF checkout and on the author's CRLF checkout.
// What a CRLF checkout holds is asked of git itself (core.autocrlf=true), not modelled here.
const dir = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(dir, '../..');
const SW1 = 'assets/source/sw1-picture-v4-2026-10-08';
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

/** Runs `code` with `input` as JSON on stdin; the code writes its answer to the file OUT, its first argument. */
function py(code, input) {
  const tmp = mkdtempSync(join(tmpdir(), 'filehash-test-'));
  const out = join(tmp, 'out.json');
  try {
    const run = spawnSync(python, ['-c', code, out], {
      cwd: dir,
      input: JSON.stringify(input),
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    if (run.error) throw run.error;
    if (run.status !== 0)
      throw new Error(`Python exited ${run.status}:\n${run.stderr.slice(-4000)}`);
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** filehash.digest of each file: a path, or a name and base64 bytes written to a fresh folder. */
const DIGEST = `
import base64, json, sys, tempfile
OUT = sys.argv[1]
from pathlib import Path
from filehash import TEXT, digest
cases = json.loads(sys.stdin.buffer.read().decode('utf-8'))
results = []
with tempfile.TemporaryDirectory() as tmp:
    for index, c in enumerate(cases):
        if c == 'TEXT':
            results.append(sorted(TEXT))
            continue
        if 'path' in c:
            results.append(digest(c['path']))
            continue
        folder = Path(tmp) / str(index)
        folder.mkdir()
        (folder / c['name']).write_bytes(base64.b64decode(c['data']))
        results.append(digest(folder / c['name']))
with open(OUT, 'w', encoding='utf-8') as out:
    json.dump(results, out)
`;
const digests = (cases) => py(DIGEST, cases);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** CRLF read as LF, the one change a CRLF checkout makes to a text file. */
function crlfAsLf(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out.push(bytes[i]);
  }
  return Buffer.from(out);
}

// Bytes the generated files are made of: line ends, a lone CR, NUL, UTF-8 and invalid UTF-8.
const ALPHABET = [
  'a',
  'z',
  ' ',
  '{',
  '"',
  '\n',
  '\n',
  '\r',
  '\r\n',
  '\t',
  'é',
  '\0',
  '\xff',
  '\x1b',
];
const bytesOf = (parts) =>
  Buffer.concat(parts.map((p) => Buffer.from(p, p === '\xff' ? 'latin1' : 'utf8')));
// Plain LF text, the files git converts on a CRLF checkout, for half the cases; anything for the rest.
const PLAIN = ALPHABET.filter((p) => !['\r', '\r\n', '\0', '\xff', '\x1b'].includes(p));
const content = (rng, size = 40) => {
  const alphabet = rng.chance(0.5) ? PLAIN : ALPHABET;
  return Array.from({ length: rng.int(0, size) }, () => rng.pick(alphabet));
};
const anyCase = (rng, suffix) =>
  [...suffix].map((ch) => (rng.chance(0.3) ? ch.toUpperCase() : ch)).join('');

/** Clones of a scratch repository holding `files` ({ path, bytes }) on an LF and a CRLF checkout. */
function checkouts(files, { normalise }) {
  const tmp = mkdtempSync(join(tmpdir(), 'filehash-git-'));
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const src = join(tmp, 'src');
  mkdirSync(src);
  git(src, 'init', '-q');
  for (const f of files) {
    mkdirSync(dirname(join(src, f.path)), { recursive: true });
    if (f.bytes) writeFileSync(join(src, f.path), f.bytes);
    else copyFileSync(join(REPO, f.path), join(src, f.path));
  }
  // normalise: commit as git does from either checkout (CRLF stored as LF); else the bytes as given.
  const eol = ['-c', `core.autocrlf=${normalise}`, '-c', 'core.safecrlf=false'];
  git(src, ...eol, 'add', '-A');
  git(
    src,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'x',
  );
  for (const [name, autocrlf] of [
    ['lf', 'false'],
    ['crlf', 'true'],
  ]) {
    git(tmp, 'clone', '-q', '-c', `core.autocrlf=${autocrlf}`, '-c', 'core.eol=lf', src, name);
  }
  return {
    at: (name, path) => join(tmp, name, path),
    bytes: (name, path) => readFileSync(join(tmp, name, path)),
    done: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

describe('filehash: one hash for an input on every checkout', () => {
  it('hashes a text input with CRLF read as LF and any other file as its bytes', () => {
    const [text] = digests(['TEXT']);
    expect(text).toEqual(expect.arrayContaining(['.py', '.json']));
    const isText = (name) => text.includes(extname(name).toLowerCase());
    const SUFFIXES = [...text, '.png', '.blend', '.glb', '.jpg', '.xlsx', '.pyc', '', '.json.png'];
    const gen = (rng) => ({ name: `f${anyCase(rng, rng.pick(SUFFIXES))}`, parts: content(rng) });
    const cases = SEEDS.map((seed) => gen(new Rng(seed)));
    const found = new Map(
      digests(cases.map((c) => ({ name: c.name, data: bytesOf(c.parts).toString('base64') }))).map(
        (d, i) => [JSON.stringify(cases[i]), d],
      ),
    );
    const digestOf = (c) => {
      const key = JSON.stringify(c);
      if (!found.has(key)) {
        found.set(key, digests([{ name: c.name, data: bytesOf(c.parts).toString('base64') }])[0]);
      }
      return found.get(key);
    };
    forAll(
      gen,
      (c) => {
        const bytes = bytesOf(c.parts);
        expect(digestOf(c)).toBe(sha256(isText(c.name) ? crlfAsLf(bytes) : bytes));
      },
      { shrink: (c) => [...shrinkArray(c.parts)].map((parts) => ({ ...c, parts })) },
    );
  }, 60_000);

  it('gives an input with a text suffix one hash on an LF and a CRLF checkout, whatever it holds', () => {
    const [text] = digests(['TEXT']);
    const gen = (rng) => ({ suffix: anyCase(rng, rng.pick(text)), parts: content(rng) });
    const run = (cases) => {
      const files = cases.map((c, i) => ({
        path: `case-${i}${c.suffix}`,
        bytes: bytesOf(c.parts),
      }));
      const repo = checkouts(files, { normalise: false });
      try {
        const both = digests(
          files.flatMap((f) => [
            { path: repo.at('lf', f.path) },
            { path: repo.at('crlf', f.path) },
          ]),
        );
        return files.map((f, i) => ({
          lf: both[2 * i],
          crlf: both[2 * i + 1],
          converted: !repo.bytes('lf', f.path).equals(repo.bytes('crlf', f.path)),
        }));
      } finally {
        repo.done();
      }
    };
    const cases = SEEDS.map((seed) => gen(new Rng(seed)));
    const results = run(cases);
    // The scratch checkout really is a CRLF one: git converted some of these files.
    expect(results.filter((r) => r.converted).length).toBeGreaterThan(25);
    const found = new Map(cases.map((c, i) => [JSON.stringify(c), results[i]]));
    forAll(
      gen,
      (c) => {
        const key = JSON.stringify(c);
        if (!found.has(key)) found.set(key, run([c])[0]);
        const r = found.get(key);
        expect(r.crlf, `${r.converted ? 'converted' : 'unchanged'} by the CRLF checkout`).toBe(
          r.lf,
        );
      },
      { shrink: (c) => [...shrinkArray(c.parts)].map((parts) => ({ ...c, parts })) },
    );
  }, 120_000);

  it('keeps every committed lock and manifest hash on a CRLF checkout of its inputs', () => {
    const files = lockedInputs();
    expect(files.length).toBeGreaterThan(15);
    const paths = [...new Set(files.map((f) => f.path))];
    const repo = checkouts(
      paths.map((path) => ({ path })),
      { normalise: true },
    );
    try {
      const both = digests(
        paths.flatMap((p) => [{ path: repo.at('lf', p) }, { path: repo.at('crlf', p) }]),
      );
      const lf = new Map(paths.map((p, i) => [p, both[2 * i]]));
      const crlf = new Map(paths.map((p, i) => [p, both[2 * i + 1]]));
      const converted = paths.filter((p) => !repo.bytes('lf', p).equals(repo.bytes('crlf', p)));
      // A real CRLF checkout: the SW1's text inputs changed bytes, its pictures did not.
      expect(converted).toContain(`${SW1}/project.json`);
      expect(converted).not.toContain(`${SW1}/references/01.png`);
      const wrong = files
        .filter(
          (f) =>
            crlf.get(f.path) !== lf.get(f.path) || (f.recorded && f.recorded !== lf.get(f.path)),
        )
        .map(
          (f) =>
            `${f.by}: ${f.path} lf ${lf.get(f.path)} crlf ${crlf.get(f.path)} recorded ${f.recorded}`,
        );
      expect(wrong).toEqual([]);
    } finally {
      repo.done();
    }
  }, 120_000);
});

/** Every file a committed lock or manifest of the method hashes, with the hash it records. */
function lockedInputs() {
  const read = (path) => JSON.parse(readFileSync(join(REPO, path), 'utf8'));
  const files = [];
  const pipeline = {
    'pipeline/run.py': 'tools/asset-pipeline/handbuilt/run.py',
    'pipeline/build_stage.py': 'tools/asset-pipeline/handbuilt/build_stage.py',
  };
  const lock = `${SW1}/recipe-lock.json`;
  for (const [name, recorded] of Object.entries(read(lock).inputs)) {
    files.push({ path: pipeline[name] ?? `${SW1}/${name}`, recorded, by: lock });
  }
  for (const manifest of [
    'tools/asset-pipeline/painted/manifests/c50.json',
    `${SW1}/model/candidate.json`,
  ]) {
    const spec = read(manifest);
    const at = (p) =>
      relative(REPO, resolve(REPO, dirname(manifest), p))
        .split(sep)
        .join('/');
    const add = (record, path) => files.push({ path: at(path), recorded: record, by: manifest });
    for (const part of spec.parts) {
      add(part.source_sha256, part.source);
      if (part.window_mask) add(part.window_mask.sha256, part.window_mask.path);
    }
    for (const picture of spec.reference.pictures) add(picture.sha256, picture.path);
    for (const key of ['observations', 'workbook']) {
      if (spec.reference[key]) add(spec.reference[key].sha256, spec.reference[key].path);
    }
  }
  // What painted/run.py's render cache key hashes besides the manifest; no hash is committed.
  for (const name of ['render.py', 'run.py', 'reference.py']) {
    files.push({ path: `tools/asset-pipeline/painted/${name}`, recorded: null, by: 'render key' });
  }
  files.push({ path: 'tools/pack-atlas.mjs', recorded: null, by: 'render key' });
  return files;
}
