import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Was the module at `metaUrl` (its `import.meta.url`) started as the command, as in
 * `node tools/building-queue.mjs`, or only imported?
 *
 * It was when `metaUrl` is the address node gives the command: the script's path with its links
 * resolved. Node resolves links in a module's address but leaves the command line as it was
 * typed, so in a checkout reached through a junction or a symlink (started from PowerShell or
 * cmd, where the working directory stays the link's path) the two differ as text, and a tool
 * that compared them so ran nothing and said nothing.
 *
 * The addresses are compared as they stand, not folded to one spelling: where the command's name
 * was typed in another case and a module imports it back under its own, node holds a second copy
 * of the module, and that copy is not the command.
 */
export function isMain(metaUrl, script = process.argv[1]) {
  if (!script) return false;
  const typed = resolve(script);
  let real = typed;
  try {
    real = realpathSync(typed);
  } catch {
    // the path names nothing on disk: only what was typed is left to compare
  }
  // the second is the command's address under --preserve-symlinks-main
  return metaUrl === pathToFileURL(real).href || metaUrl === pathToFileURL(typed).href;
}
