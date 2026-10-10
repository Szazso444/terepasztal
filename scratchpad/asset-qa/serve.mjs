import { createServer } from 'vite';
const server = await createServer({
  configFile: false,
  root: 'C:/Users/Zso/terepasztal',
  server: { host: '127.0.0.1', port: 5190, strictPort: true },
  appType: 'mpa',
});
await server.listen();
console.log('Actual-game asset QA: http://127.0.0.1:5190/scratchpad/asset-qa/');
