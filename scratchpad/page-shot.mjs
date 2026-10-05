// Scratch: screenshots of the review page's sections for a look before publishing.
//   node scratchpad/page-shot.mjs [width] [dark]
import { launch } from './runtime.mjs';
import { mkdirSync } from 'node:fs';
const W = Number(process.argv[2] ?? 1280);
const dark = process.argv[3] === 'dark';
const out = 'scratchpad/page-check/shots';
mkdirSync(out, { recursive: true });
const b = await launch();
const p = await b.newPage({ viewport: { width: W, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
await p.goto('http://127.0.0.1:5182/scratchpad/page-check/index.html');
await p.waitForLoadState('networkidle');
await p.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); })));
const info = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }));
console.log(JSON.stringify(info));
for (const id of ['marks', 'lineups', 'motion', 'curves', 'turning', 'gauge', 'numbers', 'open']) {
  await p.evaluate((i) => document.getElementById(i).scrollIntoView(), id);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${id}-${W}${dark ? '-dark' : ''}.png` });
}
await p.evaluate(() => scrollTo(0, 0));
await p.screenshot({ path: `${out}/top-${W}${dark ? '-dark' : ''}.png` });
await b.close();
