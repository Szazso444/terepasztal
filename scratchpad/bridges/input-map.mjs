// Drives the real mouse over scratchpad/bridges/input-map.html and records what each click does
// today around bridge platforms. Run: node scratchpad/bridges/input-map.mjs
import { launch } from '../runtime.mjs';
const out = 'scratchpad/bridges/input-map/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/input-map.html');
await page.waitForFunction(() => window.qa?.ready, null, { timeout: 180000 });
const frames = (n = 6) => page.waitForTimeout(n * 40);
const log = (label, v) => console.log(label.padEnd(46), JSON.stringify(v));
const at = (x, y, lift = 0) => page.evaluate(([x, y, lift]) => qa.screen(x, y, lift), [x, y, lift]);
const state = (x, y) => page.evaluate(([x, y]) => qa.state(x, y), [x, y]);
const move = async (x, y, lift = 0) => {
  await page.evaluate(([x, y]) => qa.centre(x, y, 2), [x, y]);
  const p = await at(x, y, lift);
  await page.mouse.move(p.x, p.y);
  await frames();
  return p;
};
const click = async (x, y, button = 'left', lift = 0) => {
  const p = await move(x, y, lift);
  await page.mouse.click(p.x, p.y, { button });
  await frames();
};
const tool = async (t) => {
  await page.evaluate((t) => game.toolbar.select(t), t);
  await frames();
};
const shot = async (name) => {
  await frames(10);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log('SHOT', name);
};
const { VALLEY, RIVER, BARE } = await page.evaluate(() => ({
  VALLEY: qa.VALLEY,
  RIVER: qa.RIVER,
  BARE: qa.BARE,
}));
const V = { x: VALLEY.x0 + 8, y: VALLEY.y }; // dip tile, ground 0, deck 2
const R = { x: RIVER.x0 + 4, y: RIVER.y }; // water tile with platform and rail
log('valley levels', await page.evaluate(() => qa.levels(qa.VALLEY.x0, qa.VALLEY.y, 17)));
log(
  'valley deck lift px (tiles 7,8,9)',
  await page.evaluate(() => [7, 8, 9].map((i) => qa.deckLift(qa.VALLEY.x0 + i, qa.VALLEY.y))),
);

// ---- 1. overview shots
await page.evaluate(([x, y]) => qa.centre(x, y, 2), [V.x, V.y]);
await page.mouse.move(700, 300);
await shot('01-valley');
await page.evaluate(([x, y]) => qa.centre(x, y + 4, 1.5), [R.x, R.y]);
await page.mouse.move(700, 200);
await shot('02-river-and-bare');

// ---- 2. picking: where does the pointer land when it aims at the visible deck?
await page.evaluate(([x, y]) => qa.centre(x, y, 2), [V.x, V.y]);
for (const i of [7, 8, 9]) {
  const x = VALLEY.x0 + i;
  const lift = await page.evaluate(([x, y]) => qa.deckLift(x, y), [x, V.y]);
  await move(x, V.y, 0);
  const ground = (await state(x, V.y)).hover;
  await move(x, V.y, lift);
  const deck = (await state(x, V.y)).hover;
  log(`pick valley tile ${x},${V.y} lift ${lift.toFixed(1)}`, { aimGround: ground, aimDeck: deck });
}
for (const levels of [1, 2, 3, 4]) {
  const lift = levels * 9.797958971132713;
  await move(BARE.land.x, BARE.land.y, lift);
  log(`pick flat tile ${BARE.land.x},${BARE.land.y} aiming ${levels} level(s) up`, (await state(0, 0)).hover);
}
await move(V.x, V.y, await page.evaluate(([x, y]) => qa.deckLift(x, y), [V.x, V.y]));
await shot('03-valley-pointer-on-deck-no-tool');

// ---- 3. no tool: hover and left click on a bridge tile
await tool({ kind: 'none' });
await move(V.x, V.y);
log('no tool, hover valley bridge (ground aim)', await state(V.x, V.y));
await click(V.x, V.y);
log('no tool, LEFT click valley bridge', await state(V.x, V.y));
await shot('04-no-tool-left-click-bridge');
await page.evaluate(() => game.build.selectBuilding(null));
await page.evaluate(([x, y]) => qa.centre(x, y + 2, 2), [R.x, R.y]);
await move(R.x, R.y);
log('no tool, hover river bridge', await state(R.x, R.y));
await move(BARE.land.x, BARE.land.y);
log('no tool, hover bare land platform', await state(BARE.land.x, BARE.land.y));

// ---- 4. bridge tool: left click on placed platforms
await tool({ kind: 'building', defId: 'bridge_stone' });
log('tool after select', (await state(0, 0)).tool);
await move(BARE.land.x, BARE.land.y);
log('bridge tool, hover bare land platform', await state(BARE.land.x, BARE.land.y));
await shot('05-bridge-tool-hover-placed-platform');
await click(BARE.land.x, BARE.land.y);
log('bridge tool, LEFT click bare land platform', await state(BARE.land.x, BARE.land.y));
await move(R.x, R.y);
log('bridge tool, hover river platform with rail', await state(R.x, R.y));
await click(R.x, R.y);
log('bridge tool, LEFT click river platform w/ rail', await state(R.x, R.y));
// an empty tile: hover text and placement
await move(BARE.land.x + 2, BARE.land.y);
log('bridge tool, hover empty grass', await state(BARE.land.x + 2, BARE.land.y));
await click(BARE.land.x + 2, BARE.land.y);
log('bridge tool, LEFT click empty grass', await state(BARE.land.x + 2, BARE.land.y));
await click(BARE.land.x + 2, BARE.land.y);
log('bridge tool, second LEFT click same tile', await state(BARE.land.x + 2, BARE.land.y));

// ---- 5. bridge tool: right click
await click(BARE.land.x + 2, BARE.land.y, 'right');
log('bridge tool, RIGHT click platform (no rail)', await state(BARE.land.x + 2, BARE.land.y));
await click(R.x, R.y, 'right');
log('bridge tool, RIGHT click platform with rail', await state(R.x, R.y));
await click(R.x, R.y, 'right');
log('bridge tool, RIGHT click same tile again', await state(R.x, R.y));
await click(BARE.land.x + 4, BARE.land.y + 2, 'right');
log('bridge tool, RIGHT click empty grass', await state(BARE.land.x + 4, BARE.land.y + 2));

// ---- 6. right drag does not pan; middle drag does
const cam0 = await page.evaluate(() => ({ x: game.camera.x, y: game.camera.y }));
await page.mouse.move(700, 500);
await page.mouse.down({ button: 'right' });
await page.mouse.move(820, 560, { steps: 6 });
await page.mouse.up({ button: 'right' });
await frames();
const cam1 = await page.evaluate(() => ({ x: game.camera.x, y: game.camera.y }));
await page.mouse.down({ button: 'middle' });
await page.mouse.move(700, 500, { steps: 6 });
await page.mouse.up({ button: 'middle' });
await frames();
const cam2 = await page.evaluate(() => ({ x: game.camera.x, y: game.camera.y }));
log('camera: start / after right drag / after middle drag', [cam0, cam1, cam2]);

// ---- 7. no tool: right click on a bridge with rail, then on the bare platform
await page.evaluate(([x, y]) => qa.centre(x, y + 2, 2), [R.x, R.y]);
await tool({ kind: 'none' });
await click(R.x + 1, R.y, 'right');
log('no tool, RIGHT click platform with rail', await state(R.x + 1, R.y));
await click(BARE.water.x, BARE.water.y, 'right');
log('no tool, RIGHT click bare water platform', await state(BARE.water.x, BARE.water.y));

// ---- 8. track tool over a bridge tile: left click lays rail, right click removes it
await tool({ kind: 'track', item: { kind: 'straight', cls: 'regular', cls2: 'regular' } });
await move(BARE.land.x, BARE.land.y);
log('straight tool, hover bare land platform', await state(BARE.land.x, BARE.land.y));
await click(BARE.land.x, BARE.land.y);
log('straight tool, LEFT click bare land platform', await state(BARE.land.x, BARE.land.y));
await click(BARE.land.x, BARE.land.y, 'right');
log('straight tool, RIGHT click it', await state(BARE.land.x, BARE.land.y));

// ---- 9. remove tool
await tool({ kind: 'remove' });
await move(BARE.land.x, BARE.land.y);
log('remove tool, hover bare land platform', await state(BARE.land.x, BARE.land.y));
await click(BARE.land.x, BARE.land.y);
log('remove tool, LEFT click bare land platform', await state(BARE.land.x, BARE.land.y));
await shot('06-end');
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
