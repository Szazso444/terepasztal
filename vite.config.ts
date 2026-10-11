import { readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';
import { trafficDiagnostics } from './tools/traffic-dev';

// The atlas groups that ship a file pair: src/engine/atlas.ts warns when one of them falls back to
// its generator, and stays quiet for a group that has no file. Read when the server or build starts.
const atlasFiles = readdirSync(new URL('./public/assets', import.meta.url))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length));

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022', sourcemap: true },
  define: { __ATLAS_FILES__: JSON.stringify(atlasFiles) },
  plugins: [
    trafficDiagnostics(),
    // Type errors reach the browser as an overlay while the dev server runs, instead of waiting
    // for the next `npm run build`. The build runs tsc itself, so the checker stays out of it.
    checker({ typescript: true, enableBuild: false }),
  ],
});
