// Scratch: runs only the experiments in this folder (the repo config includes src and tools only).
//   npx vitest run -c scratchpad/bridges/heights.vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['scratchpad/bridges/deckHeights.test.ts'], environment: 'node' },
});
