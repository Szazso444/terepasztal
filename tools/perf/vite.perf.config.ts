// The game's vite config for measuring: the base config, plus
// - `/__perf/<name>.mjs` served from tools/perf/page/ (the in-page harness), on the dev server and
//   on `vite preview`, so nothing for the measurement goes under src/ or public/;
// - the `Document-Policy: js-profiling` header, which the in-page JS Self-Profiling API needs.
// The build itself is the base config's: `npx vite build`, then
// `npx vite preview --config tools/perf/vite.perf.config.ts`. tools/perf/README.md has the rest.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mergeConfig, type Connect, type Plugin } from 'vite';
import base from '../../vite.config';

const PAGE = new URL('./page/', import.meta.url);

function perfPage(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    // the mount point is stripped: req.url is `/harness.mjs`; only plain names, no paths
    const m = /^\/([\w-]+\.mjs)(?:\?.*)?$/.exec(req.url ?? '');
    if (!m) return next();
    readFile(new URL(m[1], PAGE)).then(
      (body) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      },
      () => next(),
    );
  };
  return {
    name: 'terepasztal-perf-page',
    configureServer: (server) => void server.middlewares.use('/__perf', serve),
    configurePreviewServer: (server) => void server.middlewares.use('/__perf', serve),
  };
}

const headers = { 'Document-Policy': 'js-profiling' };

export default mergeConfig(base, {
  root: fileURLToPath(new URL('../..', import.meta.url)),
  server: { headers },
  preview: { headers },
  plugins: [perfPage()],
});
