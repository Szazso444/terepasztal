// The procedural structures generator against docs/art-direction/frame-inventory.json: taking the
// bridge frames out of it must not move any other frame's size or anchor.
import { launch } from '../runtime.mjs';
import { readFileSync } from 'node:fs';
const inventory = JSON.parse(readFileSync('docs/art-direction/frame-inventory.json', 'utf8'));
const browser = await launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/decks.html');
await page.waitForFunction(() => window.qa, null, { timeout: 240000 });
const frames = await page.evaluate(async () => {
  const { generateStructuresAtlas } = await import('/src/art/structures.ts');
  return generateStructuresAtlas().frames;
});
await browser.close();
const was = new Map(inventory.filter((e) => e.group === 'structures').map((e) => [e.key, e]));
let same = 0;
const moved = [],
  gone = [],
  come = [];
for (const [key, f] of Object.entries(frames)) {
  const a = was.get(key);
  if (!a) come.push(key);
  else if (a.width === f.w && a.height === f.h && a.anchorX === f.ax && a.anchorY === f.ay) same++;
  else moved.push(`${key} ${a.width}x${a.height}@${a.anchorX},${a.anchorY} -> ${f.w}x${f.h}@${f.ax},${f.ay}`);
}
for (const key of was.keys()) if (!frames[key]) gone.push(key);
const fam = (list) => [...new Set(list.map((k) => k.replace(/[0-9]+/g, '#')))];
console.log('generator frames', Object.keys(frames).length, '· unchanged', same, '· moved', moved.length, moved.slice(0, 10));
console.log('no longer generated:', gone.length, fam(gone));
console.log('new in the generator:', come.length, fam(come));
