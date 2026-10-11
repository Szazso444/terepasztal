// Second probe: the remove tool over a platform that carries rail, Delete, Escape, and a
// press-drag-release with the bridge tool. Run: node scratchpad/bridges/input-map-2.mjs
import { launch } from '../runtime.mjs';
const out = 'scratchpad/bridges/input-map/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/input-map.html');
await page.waitForFunction(() => window.qa?.ready, null, { timeout: 180000 });
const frames = (n = 6) => page.waitForTimeout(n * 40);
const log = (label, v) => console.log(label.padEnd(50), JSON.stringify(v));
const at = (x, y) => page.evaluate(([x, y]) => qa.screen(x, y, 0), [x, y]);
const brief = async (x, y) => {
  const s = await page.evaluate(([x, y]) => qa.state(x, y), [x, y]);
  return {
    tool: s.tool.kind + (s.tool.defId ? ':' + s.tool.defId : ''),
    status: s.status,
    bridge: s.bridge,
    track: s.track,
    stock: [s.wood, s.stone, s.iron].join('/'),
  };
};
const centre = (x, y, z = 2) => page.evaluate(([x, y, z]) => qa.centre(x, y, z), [x, y, z]);
const move = async (x, y) => {
  const p = await at(x, y);
  await page.mouse.move(p.x, p.y);
  await frames();
  return p;
};
const tool = async (t) => {
  await page.evaluate((t) => game.toolbar.select(t), t);
  await frames();
};
const { RIVER, BARE } = await page.evaluate(() => ({ RIVER: qa.RIVER, BARE: qa.BARE }));
const R = { x: RIVER.x0 + 4, y: RIVER.y };

// ---- remove tool over a platform with rail: what it says and what it does
await centre(R.x, R.y);
await tool({ kind: 'remove' });
await move(R.x, R.y);
log('remove tool, hover platform WITH rail', await brief(R.x, R.y));
await page.mouse.click(...Object.values(await at(R.x, R.y)));
await frames();
log('remove tool, LEFT click it (1st)', await brief(R.x, R.y));
await page.mouse.click(...Object.values(await at(R.x, R.y)));
await frames();
log('remove tool, LEFT click it (2nd)', await brief(R.x, R.y));

// ---- Delete and Escape with the bridge tool
await centre(BARE.land.x, BARE.land.y);
await tool({ kind: 'building', defId: 'bridge_stone' });
await move(BARE.land.x, BARE.land.y);
log('bridge tool, hover placed platform', await brief(BARE.land.x, BARE.land.y));
await page.keyboard.press('Delete');
await frames();
log('bridge tool, Delete over placed platform', await brief(BARE.land.x, BARE.land.y));
await page.keyboard.press('Escape');
await frames();
log('bridge tool, Escape', await brief(BARE.land.x, BARE.land.y));

// ---- press on one empty tile, drag to another, release: which tile gets the platform?
await tool({ kind: 'building', defId: 'bridge_wood' });
const A = { x: BARE.land.x - 2, y: BARE.land.y },
  B = { x: BARE.land.x + 2, y: BARE.land.y };
const pa = await at(A.x, A.y),
  pb = await at(B.x, B.y);
await page.mouse.move(pa.x, pa.y);
await frames();
await page.mouse.down();
await page.mouse.move(pb.x, pb.y, { steps: 8 });
await frames();
await page.mouse.up();
await frames();
log('bridge tool, press A drag to B release', {
  A: (await brief(A.x, A.y)).bridge,
  between: (await brief(BARE.land.x, BARE.land.y)).bridge,
  B: (await brief(B.x, B.y)).bridge,
  stock: (await brief(B.x, B.y)).stock,
});
// two quick clicks without waiting a frame between them
await page.mouse.move(pa.x, pa.y);
await frames();
await page.mouse.click(pa.x, pa.y, { clickCount: 1, delay: 0 });
await page.mouse.click(pa.x, pa.y, { clickCount: 2, delay: 0 });
await frames();
log('bridge tool, double click empty tile A', await brief(A.x, A.y));
await page.screenshot({ path: `${out}07-bridge-tool-ghost-over-empty.png` });
// hover an empty tile next to it to see the placement ghost
await move(A.x - 2, A.y + 1);
await frames(10);
await page.screenshot({ path: `${out}08-bridge-tool-ghost-empty-tile.png` });
log('bridge tool, hover empty grass', await brief(A.x - 2, A.y + 1));
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
