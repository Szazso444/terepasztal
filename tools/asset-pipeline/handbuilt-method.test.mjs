import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The hand-built method (blender_runner.py, handbuilt/, painted/) is Python. npm test runs its
// Blender-free unit tests; the Blender checks are test_blender_builds.py, run by hand (AGENTS.md).
const dir = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

function unittest(cwd, module) {
  const run = spawnSync(python, ['-m', 'unittest', module, '-v'], { cwd, encoding: 'utf8' });
  if (run.error) throw run.error;
  const skipped = new Set([...run.stderr.matchAll(/skipped '([^']+)'/g)].map((m) => m[1]));
  if (skipped.size) console.warn(`${module}: skipped: ${[...skipped].join('; ')}`);
  expect(run.status, run.stderr.slice(-4000)).toBe(0);
}

describe('hand-built method, Python tests without Blender', () => {
  it('runs every Blender step on a Blender 5.2.x executable or the bpy 5.2.x module', () => {
    unittest(dir, 'test_blender_runner');
  }, 60_000);

  it('keeps recipes locked to their pictures, inside their projects and the same on every checkout', () => {
    unittest(join(dir, 'handbuilt'), 'test_recipe');
  }, 60_000);

  it('keeps renders locked to their models, atlas pages bounded and installs to owned keys', () => {
    unittest(join(dir, 'painted'), 'test_pipeline');
  }, 60_000);
});

// What the method ships: the pipeline and the two sources it was brought in with.
const SHIPPED = [
  'tools/asset-pipeline',
  'assets/source/c50-handbuilt-2026-10-07',
  'assets/source/c50-regenerated-2026-10-07',
  'assets/source/sw1-picture-v4-2026-10-08',
];
const TEXT = new Set(['.py', '.json', '.md', '.mjs', '.toml', '.csv', '.txt']);
const DRIVE_PATH = /[A-Z]:[/\\]/;

describe('hand-built method, portable sources', () => {
  it('ships no absolute Windows path, except in the history section of a README', () => {
    const listed = spawnSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...SHIPPED],
      { cwd: repo, encoding: 'utf8' },
    );
    expect(listed.status, listed.stderr).toBe(0);
    const found = [];
    for (const file of listed.stdout.split('\n').filter(Boolean)) {
      if (!TEXT.has(extname(file)) && basename(file) !== '.gitignore') continue;
      let history = false;
      readFileSync(join(repo, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // A README keeps its history from the author's PC last, under a "History" heading.
          if (file.endsWith('.md') && /^#+ .*History/.test(line)) history = true;
          if (!history && DRIVE_PATH.test(line.replace(/https?:\/\/\S+/g, ''))) {
            found.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(found).toEqual([]);
  });
});
