import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A path with its links resolved; a path that names nothing on disk stays as it is. */
function real(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * Was the module at `metaUrl` (its `import.meta.url`) started as the command, as in
 * `node tools/building-queue.mjs`, or only imported?
 *
 * The two are compared as real paths. Node resolves links in a module's own address but leaves
 * the command line as it was typed, so in a checkout reached through a junction or a symlink
 * (started from PowerShell or cmd, where the working directory stays the link's path) the two
 * differ as text, and a tool that compared them so ran nothing and said nothing.
 */
export function isMain(metaUrl, script = process.argv[1]) {
  return !!script && real(script) === real(fileURLToPath(metaUrl));
}
