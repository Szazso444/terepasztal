import { afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain } from './is-main.mjs';

const made = [];

/**
 * A folder with two scripts in it, and the same folder reached through a link: a junction on
 * Windows, a symlink elsewhere. The link points at a folder of its own under the temp directory,
 * never at the repository, so that nothing is at stake if it is left behind.
 */
function linked({ tool = 'export {};\n', other = 'export {};\n' } = {}) {
  // the temp directory may itself be reached through a link (macOS): start from its real path
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'is-main-')));
  const real = join(base, 'real');
  mkdirSync(real);
  writeFileSync(join(real, 'tool.mjs'), tool);
  writeFileSync(join(real, 'other.mjs'), other);
  const link = join(base, 'link');
  symlinkSync(real, link, 'junction');
  made.push({ base, link });
  return { real, link };
}

afterAll(() => {
  for (const { base, link } of made) {
    // the link first, as a link: a junction goes with rmdir, a symlink with unlink
    try {
      rmdirSync(link);
    } catch {
      try {
        unlinkSync(link);
      } catch {
        continue;
      }
    }
    rmSync(base, { recursive: true, force: true });
  }
});

describe('isMain', () => {
  it('knows the module that was started as the command', () => {
    const { real } = linked();
    const tool = join(real, 'tool.mjs');
    expect(isMain(pathToFileURL(tool).href, tool)).toBe(true);
  });

  it('says no for a module that was only imported by the command', () => {
    const { real } = linked();
    expect(isMain(pathToFileURL(join(real, 'other.mjs')).href, join(real, 'tool.mjs'))).toBe(false);
  });

  it('says no when node was started without a script', () => {
    const { real } = linked();
    expect(isMain(pathToFileURL(join(real, 'tool.mjs')).href, undefined)).toBe(false);
  });

  it('knows the command when its folder was reached through a link', () => {
    // node resolves links in a module's own address, but leaves the command line as it was typed
    const { real, link } = linked();
    expect(isMain(pathToFileURL(join(real, 'tool.mjs')).href, join(link, 'tool.mjs'))).toBe(true);
  });

  it('still says no for another file reached through the link', () => {
    const { real, link } = linked();
    expect(isMain(pathToFileURL(join(real, 'other.mjs')).href, join(link, 'tool.mjs'))).toBe(false);
  });

  it('says no for a command line that names nothing on disk', () => {
    const { real } = linked();
    expect(isMain(pathToFileURL(join(real, 'tool.mjs')).href, join(real, 'gone.mjs'))).toBe(false);
  });

  it('knows the command where node was told to keep the link in its address', () => {
    // --preserve-symlinks-main: the module's address is the path as it was typed
    const { link } = linked();
    const typed = join(link, 'tool.mjs');
    expect(isMain(pathToFileURL(typed).href, typed)).toBe(true);
  });
});

describe('a tool on the command line', () => {
  const helper = pathToFileURL(resolve('tools/is-main.mjs')).href;
  const probe = `import { isMain } from ${JSON.stringify(helper)};\nif (isMain(import.meta.url)) console.log('ran');\n`;
  const run = (script, cwd) => execFileSync(process.execPath, [script], { cwd, encoding: 'utf8' });

  it('runs when it is started from its own folder', () => {
    const { real } = linked({ tool: probe });
    expect(run('tool.mjs', real)).toBe('ran\n');
  });

  it('runs when its folder is reached through a link, as a checkout moved behind a junction is', () => {
    // started from PowerShell or cmd the working directory stays the link's path; a tool that
    // compared the two addresses as text ran nothing there, and said nothing
    const { link } = linked({ tool: probe });
    expect(run('tool.mjs', link)).toBe('ran\n');
    expect(run(join(link, 'tool.mjs'), tmpdir())).toBe('ran\n');
  });

  it('runs once where its name is typed in another case and it is imported back under its own', () => {
    // as the queue tool is by the sheet tool it loads: under the other spelling node holds a
    // second copy of the module, and that copy is not the command
    const { real } = linked({
      tool: `import './other.mjs';\n${probe}`,
      other: `import './tool.mjs';\n`,
    });
    // only where file names are matched whatever their case (Windows, macOS)
    if (!existsSync(join(real, 'TOOL.mjs'))) return;
    expect(run('TOOL.mjs', real)).toBe('ran\n');
  });
});

describe('the tools', () => {
  it('leave it to isMain whether they were started as the command', () => {
    // a tool that looks at process.argv[1] itself is a tool that can get this wrong again. The two
    // bridge tools ask only how the typed path ends, which a link does not change
    const allowed = ['is-main.mjs', 'bridge-kit.mjs', 'bridge-kit-guides.mjs'];
    const tools = readdirSync('tools', { recursive: true })
      .map((f) => String(f).replaceAll('\\', '/'))
      .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
      .filter((f) => !allowed.includes(f));
    expect(tools.length).toBeGreaterThan(5);
    const offenders = tools.filter((f) =>
      /process\s*\.\s*argv\s*\[\s*1\s*\]/.test(readFileSync(join('tools', f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
