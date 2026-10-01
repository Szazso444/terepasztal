// Bundle paint-harness.ts and run it: node scratchpad/perf/paint.mjs [node flags...]
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
await build({
  entryPoints: ['scratchpad/perf/paint-harness.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'node_modules/.cache/paint-harness.mjs',
  external: ['pngjs'],
  define: { 'import.meta.env.BASE_URL': '"/"' },
  logLevel: 'warning',
});
execFileSync('node', [...process.argv.slice(2), 'node_modules/.cache/paint-harness.mjs'], {
  stdio: 'inherit',
});
