import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022', sourcemap: true },
  plugins: [
    // Type errors reach the browser as an overlay while the dev server runs, instead of waiting
    // for the next `npm run build`. The build runs tsc itself, so the checker stays out of it.
    checker({ typescript: true, enableBuild: false }),
  ],
});
