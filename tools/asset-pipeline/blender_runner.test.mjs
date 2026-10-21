import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../src/engine/rng';
import { forAll, SEEDS, shrinkArray } from '../../src/testing/property';

// Properties of blender_runner.py, where every Blender step of the hand-built method finds its
// Blender: a 5.2.x executable (--blender) or the bpy 5.2.x module in this Python, nothing else.
// The module is Python: each property's cases run in one Python process, the oracles are here.
const dir = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const POSIX = process.platform !== 'win32';
const NO_FAKE_EXE = 'the fake Blender executable is a POSIX script';

/** Runs `code` with `input` as JSON on stdin; the code writes its answer to the file OUT, its first argument. */
function py(code, input) {
  const tmp = mkdtempSync(join(tmpdir(), 'runner-test-'));
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

/** The seeds' cases in one Python run; a case forAll asks for later (shrinking) runs alone. */
function batch(code, gen, seeds = SEEDS) {
  const cases = seeds.map((seed) => gen(new Rng(seed)));
  const results = py(code, cases);
  const known = new Map(cases.map((c, i) => [JSON.stringify(c), results[i]]));
  return (c) => {
    const key = JSON.stringify(c);
    if (!known.has(key)) known.set(key, py(code, [c])[0]);
    return known.get(key);
  };
}

// Python shared by the snippets: the cases, the module, fakes for bpy and a Blender executable.
const PRELUDE = `
import importlib.util, json, os, sys, tempfile, types
OUT = sys.argv[1]  # before a step under test can change sys.argv
from pathlib import Path
from unittest import mock
import blender_runner as runner
cases = json.loads(sys.stdin.buffer.read().decode('utf-8'))
def done(results):
    with open(OUT, 'w', encoding='utf-8') as out:
        json.dump(results, out)
def fake_bpy(numbers, label, build, resets=None):
    module = types.ModuleType('bpy')
    module.app = types.SimpleNamespace(version=tuple(numbers), version_string=label, build_hash=build.encode())
    reset = (lambda **_: resets.append(1)) if resets is not None else (lambda **_: None)
    module.ops = types.SimpleNamespace(wm=types.SimpleNamespace(read_factory_settings=reset))
    return module
def with_bpy(module):
    return [mock.patch.object(importlib.util, 'find_spec', return_value=object()),
            mock.patch.dict(sys.modules, {'bpy': module})]
FAKE_EXE = '''#!%s
import runpy, sys
if sys.argv[1:] == ['--version']:
    sys.stdout.buffer.write(%r)
    raise SystemExit(0)
args = sys.argv[1:]
script = args[args.index('--python') + 1]
sys.argv = [script] + args[args.index('--'):]
runpy.run_path(script, run_name='__main__')
'''
def fake_exe(folder, version_text):
    path = Path(folder) / 'blender'
    path.write_text(FAKE_EXE % (sys.executable, version_text.encode('utf-8')), encoding='utf-8')
    path.chmod(0o755)
    return path
def outcome(make):
    try:
        blender = make()
        return {'identity': blender.identity, 'numbers': list(blender.numbers), 'executable': blender.executable}
    except runner.BlenderUnavailable as error:
        return {'refusal': str(error)}
`;

// ---- Version gate -------------------------------------------------------------------------------

const RELEASES = [
  [5, 2],
  [5, 2],
  [5, 2],
  [4, 2],
  [5, 1],
  [5, 3],
  [6, 2],
  [2, 5],
  [5, 20],
  [15, 2],
  [3, 6],
];
const SUFFIXES = ['', ' LTS', ' Alpha', ' Beta', ' Release Candidate', ' LTS  '];
const NOISE = [
  'Read prefs: "userpref.blend"',
  'Color management: using fallback mode for management',
  'Warning: no GPU found',
  'Blender quit',
];
const HEX = [...'0123456789abcdef'];

/** A Blender release and the `blender --version` text it prints, as a case. */
function release(rng, { build = rng.chance(0.9) } = {}) {
  const [major, minor] = rng.pick(RELEASES);
  return {
    major,
    minor,
    patch: rng.pick([null, 0, 1, 2, 9, 13]),
    suffix: rng.pick(SUFFIXES),
    build: build ? Array.from({ length: 12 }, () => rng.pick(HEX)).join('') : null,
    noise: Array.from({ length: rng.int(0, 2) }, () => rng.pick(NOISE)),
    crlf: rng.chance(0.5),
  };
}

/** The release as its version line prints it, and as the runner must read it back (trimmed). */
const printed = (c) => `${c.major}.${c.minor}${c.patch === null ? '' : `.${c.patch}`}${c.suffix}`;
const label = (c) => printed(c).trimEnd();
const accepted = (c) => c.major === 5 && c.minor === 2;

function versionText(c) {
  const lines = [...c.noise, `Blender ${printed(c)}`];
  lines.push('\tbuild date: 2026-08-25');
  if (c.build) lines.push(`\tbuild hash: ${c.build}`);
  lines.push('\tbuild branch: blender-v5.2-release', '\tbuild platform: Linux');
  const newline = c.crlf ? '\r\n' : '\n';
  return lines.join(newline) + newline;
}

function* shrinkRelease(c) {
  if (c.noise.length) yield { ...c, noise: [] };
  if (c.crlf) yield { ...c, crlf: false };
  if (c.suffix !== '') yield { ...c, suffix: '' };
  if (c.patch !== null) yield { ...c, patch: null };
}

function expectRefusalNames(refusal, c) {
  expect(refusal, 'a refusal names the release it found').toContain(`is Blender ${label(c)};`);
  expect(refusal, 'and the release it needs').toContain('5.2.x');
  expect(refusal, 'and how to give it one').toContain('--blender');
}

describe('blender_runner: which Blender a step may run on', () => {
  it('reads any `blender --version` back to its release and build, and accepts exactly 5.2.x', () => {
    const run = batch(
      `${PRELUDE}
results = []
for c in cases:
    label, numbers, build = runner.parse_version(c['text'])
    try:
        runner.check_version(numbers, label, 'blender')
        refusal = None
    except runner.BlenderUnavailable as error:
        refusal = str(error)
    results.append({'label': label, 'numbers': list(numbers), 'build': build, 'refusal': refusal})
done(results)`,
      (rng) => withText(release(rng)),
    );
    forAll(
      (rng) => withText(release(rng)),
      (c) => {
        const r = run(c);
        expect(r.label).toBe(label(c));
        expect(r.numbers).toEqual([c.major, c.minor, c.patch ?? 0]);
        expect(r.build).toBe(c.build ?? 'unknown');
        if (accepted(c)) expect(r.refusal).toBeNull();
        else expectRefusalNames(r.refusal, c);
      },
      { shrink: (c) => [...shrinkRelease(c)].map(withText) },
    );
  }, 60_000);

  it.skipIf(!POSIX)(
    `resolves an executable and a bpy module of one release alike: refused unless 5.2.x, else one identity (skipped on Windows: ${NO_FAKE_EXE})`,
    () => {
      const gen = (rng) => withText(release(rng, { build: true }));
      const run = batch(
        `${PRELUDE}
results = []
for c in cases:
    with tempfile.TemporaryDirectory() as tmp:
        exe = fake_exe(tmp, c['text'])
        by_exe = outcome(lambda: runner.resolve(str(exe)))
    patches = with_bpy(fake_bpy(c['numbers'], c['label'], c['build']))
    with patches[0], patches[1]:
        by_module = outcome(lambda: runner.resolve(None))
    results.append({'exe': by_exe, 'module': by_module, 'path': str(exe)})
done(results)`,
        gen,
        SEEDS.slice(0, 40),
      );
      forAll(
        gen,
        (c) => {
          const { exe, module, path } = run(c);
          if (!accepted(c)) {
            expectRefusalNames(exe.refusal, c);
            expectRefusalNames(module.refusal, c);
            return;
          }
          const identity = `Blender ${label(c)} build ${c.build}`;
          expect(exe).toEqual({ identity, numbers: c.numbers, executable: path });
          expect(module).toEqual({ identity, numbers: c.numbers, executable: null });
        },
        { seeds: SEEDS.slice(0, 40), shrink: (c) => [...shrinkRelease(c)].map(withText) },
      );
    },
    120_000,
  );

  it("gives the author's Blender 5.2.1 executable and the cloud's bpy 5.2.1 the identity the render profiles lock", () => {
    // Recorded on the author's PC: painted inputs.json "blender" on the backup branch
    // (backup/c-users-zso-terepasztal-local-wip, e.g. drg01-picture-2026-10-09); the compiler
    // flag lines that follow are left out. The bpy values are those of `pip install bpy==5.2.1`.
    const pc = [
      'Blender 5.2.1 LTS',
      '\tbuild date: 2026-08-25',
      '\tbuild time: 02:38:20',
      '\tbuild commit date: 2026-08-24',
      '\tbuild commit time: 16:50',
      '\tbuild hash: 9e2066aef7ef',
      '\tbuild branch: blender-v5.2-release',
      '\tbuild platform: Windows',
      '\tbuild type: Release',
      '',
    ].join('\n');
    const [found] = py(
      `${PRELUDE}
c = cases[0]
label, numbers, build = runner.parse_version(c['pc'])
patches = with_bpy(fake_bpy([5, 2, 1], '5.2.1 LTS', '9e2066aef7ef'))
with patches[0], patches[1]:
    cloud = runner.resolve(None)
done([{'pc': runner.Blender(label, numbers, build, 'blender.exe').identity, 'cloud': cloud.identity}])`,
      [{ pc }],
    );
    const identity = 'Blender 5.2.1 LTS build 9e2066aef7ef';
    expect(found).toEqual({ pc: identity, cloud: identity });
    const profiles = join(dir, 'painted/profiles');
    const files = readdirSync(profiles).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const p = JSON.parse(readFileSync(join(profiles, file), 'utf8'));
      expect(`Blender ${p.blender_version} build ${p.blender_build}`, file).toBe(identity);
    }
  }, 60_000);
});

/** The case with the text the generated Blender prints and the bpy values of that release. */
function withText(c) {
  const { major, minor, patch, suffix, build, noise, crlf } = c;
  const release = { major, minor, patch, suffix, build, noise, crlf };
  return {
    ...release,
    text: versionText(release),
    label: label(release),
    numbers: [release.major, release.minor, release.patch ?? 0],
  };
}

// ---- Running a step -----------------------------------------------------------------------------

// A step that writes what it saw, prints a marker through Python and through the C-level stdout,
// then ends as its third argument says.
const STEP = `import json, os, sys
args = sys.argv[sys.argv.index('--') + 1:]
with open(args[0], 'w', encoding='utf-8') as seen:
    json.dump(sys.argv, seen)
print('python output', args[1], flush=True)
os.write(1, ('fd output ' + args[1] + chr(10)).encode())
end = args[2]
if end == 'raise':
    raise RuntimeError('step failed ' + args[1])
if end == 'exit0':
    sys.exit(0)
if end == 'exitNone':
    sys.exit()
if end == 'exit1':
    sys.exit(1)
if end == 'exitMessage':
    sys.exit('stopped ' + args[1])
`;
const ENDS = ['ok', 'ok', 'exit0', 'exitNone', 'raise', 'exit1', 'exitMessage'];
const FAILS = new Set(['raise', 'exit1', 'exitMessage']);

describe('blender_runner: running a step', () => {
  it('leaves this process as it found it after any sequence of in-process steps, failed or not', () => {
    // A step fails exactly when it raises or exits non-zero. After every step sys.argv and the
    // stdout and stderr descriptors are the caller's again, every step began with one factory
    // reset, the script saw `<script> -- <args>`, and its log holds its own output, both Python's
    // and the C-level descriptor's, and nothing of an earlier step.
    const gen = (rng) =>
      Array.from({ length: rng.int(1, 5) }, () => ({ end: rng.pick(ENDS), log: rng.chance(0.7) }));
    const run = batch(
      `${PRELUDE}
STEP = ${JSON.stringify(STEP)}
def fds():
    return [[os.fstat(fd).st_dev, os.fstat(fd).st_ino] for fd in (1, 2)]
results = []
for steps in cases:
    resets, observed = [], []
    patches = with_bpy(fake_bpy([5, 2, 1], '5.2.1 LTS', '9e2066aef7ef', resets))
    with tempfile.TemporaryDirectory() as tmp, patches[0], patches[1]:
        root = Path(tmp).resolve()
        (root / 'step.py').write_text(STEP, encoding='utf-8')
        blender = runner.resolve(None)
        argv, before = list(sys.argv), fds()
        for index, step in enumerate(steps):
            log = root / 'step.log' if step['log'] else None
            try:
                blender.run(root / 'step.py', [root / 'seen.json', f'step-{index}', step['end']], log=log)
                failed = None
            except runner.BlenderStepFailed as error:
                failed = str(error)
            observed.append({
                'failed': failed, 'argv': sys.argv == argv, 'fds': fds() == before, 'resets': len(resets),
                'seen': json.loads((root / 'seen.json').read_text(encoding='utf-8')),
                'script': str(root / 'step.py'), 'seenPath': str(root / 'seen.json'),
                'logPath': str(log) if log else None,
                'log': log.read_text(encoding='utf-8') if log else None})
    results.append(observed)
done(results)`,
      gen,
    );
    forAll(
      gen,
      (steps) => {
        const observed = run(steps);
        steps.forEach((step, i) => {
          const o = observed[i];
          const marker = `step-${i}`;
          const where = `${marker} (${step.end}, log ${step.log})`;
          expect(o.failed !== null, `${where} failed`).toBe(FAILS.has(step.end));
          if (o.failed !== null) {
            expect(o.failed, where).toContain('step.py failed');
            if (step.log) expect(o.failed, where).toContain(o.logPath);
          }
          expect(o.argv, `${where}: sys.argv restored`).toBe(true);
          expect(o.fds, `${where}: stdout and stderr restored`).toBe(true);
          expect(o.resets, `${where}: one factory reset per step`).toBe(i + 1);
          expect(o.seen, where).toEqual([o.script, '--', o.seenPath, marker, step.end]);
          if (!step.log) return;
          expect(o.log, where).toContain(`python output ${marker}`);
          expect(o.log, where).toContain(`fd output ${marker}`);
          if (FAILS.has(step.end)) expect(o.log, where).toContain('Traceback');
          for (let j = 0; j < i; j++) expect(o.log, `${where} log`).not.toContain(`step-${j}`);
        });
      },
      { shrink: (steps) => shrinkArray(steps) },
    );
  }, 120_000);

  it.skipIf(!POSIX)(
    `runs a step alike on an executable and on the bpy module: the same arguments, the same failure (skipped on Windows: ${NO_FAKE_EXE})`,
    () => {
      const ARGS = [
        '',
        'x',
        'two words',
        '--',
        '-b',
        'é',
        "it's",
        '"q"',
        '--out',
        'a/b',
        '\\',
        '*',
      ];
      const gen = (rng) => ({
        end: rng.pick(ENDS),
        args: Array.from({ length: rng.int(0, 3) }, () => rng.pick(ARGS)),
      });
      const seeds = SEEDS.slice(0, 24);
      const run = batch(
        `${PRELUDE}
STEP = '''import json, sys
args = sys.argv[sys.argv.index('--') + 1:]
with open(args[0], 'w', encoding='utf-8') as seen:
    json.dump(args[2:], seen)
end = args[1]
if end == 'raise':
    raise RuntimeError('step failed')
if end in ('exit0', 'exitNone'):
    sys.exit(0 if end == 'exit0' else None)
if end in ('exit1', 'exitMessage'):
    sys.exit(1 if end == 'exit1' else 'stopped')
'''
results = []
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / 'step.py').write_text(STEP, encoding='utf-8')
    exe = runner.resolve(str(fake_exe(tmp, 'Blender 5.2.1 LTS\\n\\tbuild hash: 9e2066aef7ef\\n')))
    patches = with_bpy(fake_bpy([5, 2, 1], '5.2.1 LTS', '9e2066aef7ef'))
    with patches[0], patches[1]:
        module = runner.resolve(None)
        for c in cases:
            seen = {}
            for name, blender in [('exe', exe), ('module', module)]:
                try:
                    blender.run(root / 'step.py', [root / 'seen.json', c['end'], *c['args']], log=root / 'step.log')
                    failed = False
                except runner.BlenderStepFailed:
                    failed = True
                seen[name] = {'failed': failed, 'args': json.loads((root / 'seen.json').read_text(encoding='utf-8'))}
            results.append(seen)
done(results)`,
        gen,
        seeds,
      );
      forAll(
        gen,
        (c) => {
          const expected = { failed: FAILS.has(c.end), args: c.args };
          expect(run(c)).toEqual({ exe: expected, module: expected });
        },
        { seeds, shrink: (c) => [...shrinkArray(c.args)].map((args) => ({ ...c, args })) },
      );
    },
    120_000,
  );
});
