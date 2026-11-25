import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import checker from 'vite-plugin-checker';
import { trafficDiagnostics } from './tools/traffic-dev';

// The atlas groups that ship a file pair: src/engine/atlas.ts warns when one of them falls back to
// its generator, and stays quiet for a group that has no file. Read when the server or build starts.
const atlasFiles = readdirSync(new URL('./public/assets', import.meta.url))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length));

/**
 * The source version the atlas cache keys generated groups by (`src/engine/atlasCache.ts`): a hash
 * of every file under `src`, path and bytes, so a change to a generator, the packer, the palette or
 * the shipped content makes every stored group a miss. Only a build has one. The dev server's is
 * null, which turns the cache off there: its source changes under it while it runs.
 */
function atlasSourceVersion(): Plugin {
  const hashSource = () => {
    const root = fileURLToPath(new URL('./src', import.meta.url));
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(root, `${e.parentPath}${sep}${e.name}`).split(sep).join('/'))
      .sort();
    const hash = createHash('sha256');
    for (const f of files)
      hash
        .update(`${f}\n`)
        .update(readFileSync(`${root}/${f}`))
        .update('\n');
    return hash.digest('hex').slice(0, 16);
  };
  return {
    name: 'atlas-source-version',
    config: (_, { command }) => ({
      define: {
        __ATLAS_SOURCE_VERSION__: command === 'build' ? JSON.stringify(hashSource()) : 'null',
      },
    }),
  };
}

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022', sourcemap: true },
  define: { __ATLAS_FILES__: JSON.stringify(atlasFiles) },
  plugins: [
    trafficDiagnostics(),
    atlasSourceVersion(),
    // Type errors reach the browser as an overlay while the dev server runs, instead of waiting
    // for the next `npm run build`. The build runs tsc itself, so the checker stays out of it.
    checker({ typescript: true, enableBuild: false }),
  ],
});
