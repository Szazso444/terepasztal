import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain } from './is-main.mjs';

/**
 * A folder with a script in it, and the same folder reached through a link: a junction on
 * Windows, a symlink elsewhere. The link points at a folder of its own under the temp directory,
 * never at the repository, so that nothing is at stake if it is left behind.
 */
function linked(source = 'export {};\n') {
  const base = mkdtempSync(join(tmpdir(), 'is-main-'));
  const real = join(base, 'real');
  mkdirSync(real);
  writeFileSync(join(real, 'tool.mjs'), source);
  writeFileSync(join(real, 'other.mjs'), source);
  const link = join(base, 'link');
  symlinkSync(real, link, 'junction');
  return { real, link };
}

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
});

describe('a tool on the command line', () => {
  const helper = pathToFileURL(resolve('tools/is-main.mjs')).href;
  const probe = `import { isMain } from ${JSON.stringify(helper)};\nif (isMain(import.meta.url)) console.log('ran');\n`;
  const run = (script, cwd) => execFileSync(process.execPath, [script], { cwd, encoding: 'utf8' });

  it('runs when it is started from its own folder', () => {
    const { real } = linked(probe);
    expect(run('tool.mjs', real)).toBe('ran\n');
  });

  it('runs when its folder is reached through a link, as a checkout moved behind a junction is', () => {
    // started from PowerShell or cmd the working directory stays the link's path; a tool that
    // compared the two addresses as text ran nothing there, and said nothing
    const { link } = linked(probe);
    expect(run('tool.mjs', link)).toBe('ran\n');
    expect(run(join(link, 'tool.mjs'), tmpdir())).toBe('ran\n');
  });
});

describe('the tools', () => {
  it('leave it to isMain whether they were started as the command', () => {
    // comparing process.argv[1] with the module's own address by hand is what broke through a link
    const byHand =
      /process\.argv\[1\]\s*===|===\s*(?:pathToFileURL\()?(?:resolve\()?process\.argv\[1\]/;
    const tools = readdirSync('tools').filter(
      (f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'is-main.mjs',
    );
    expect(tools.length).toBeGreaterThan(5);
    const offenders = tools.filter((f) => byHand.test(readFileSync(join('tools', f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
