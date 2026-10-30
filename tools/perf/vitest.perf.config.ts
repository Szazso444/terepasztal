// The headless scale benchmark's own vitest config, so the regular `npm test` run never picks it
// up: `npx vitest run --config tools/perf/vitest.perf.config.ts`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['tools/perf/scale.perf.mjs'],
    environment: 'node',
    // one worker, and a collection the benchmark can force between its cases
    fileParallelism: false,
    execArgv: ['--expose-gc'],
    testTimeout: 0,
    // the tables are the output: the default reporter prints a passing test's console, while the
    // reporter vitest picks inside an AI agent's shell hides it
    reporters: ['default'],
  },
});
