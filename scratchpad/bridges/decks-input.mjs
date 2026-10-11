// Drives the real mouse over scratchpad/bridges/decks-input.html: the bridge tool is picked from
// the toolbar, a platform is placed, clicked up and right-clicked down, and the builder state and
// status line are logged after every event.
//   node scratchpad/bridges/decks-input.mjs [label=after]
// Writes renders-<label>/input-*.png and renders-<label>/input-log.json.
import { launch } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [label = 'after'] = process.argv.slice(2);
const out = `scratchpad/bridges/renders-${label}/`;
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto('http://127.0.0.1:5183/scratchpad/bridges/decks-input.html');
await page.waitForFunction(() => window.qa?.ready, null, { timeout: 240000 });
const STEP = await page.evaluate(() => qa.step);
const frames = (n = 5) => page.waitForTimeout(n * 40);
const records = [];
const failures = [];
const state = (x, y) => page.evaluate(([x, y]) => qa.state(x, y), [x, y]);
/** Log the state of a tile after an event, and what the event was expected to leave behind. */
async function note(event, x, y, expect = {}) {
  await frames();
  const s = await state(x, y);
  const got = {
    deck: s.platform ? s.platform.deck : null,
    height: s.platform ? s.platform.height : null,
    track: s.track,
    status: s.status,
    hover: s.hover.join(','),
    tool: s.tool,
    selected: s.selected ? s.selected.join(',') : null,
  };
  const bad = Object.entries(expect).filter(([k, v]) =>
    v instanceof RegExp ? !v.test(String(got[k])) : got[k] !== v,
  );
  records.push({ event, ...s, expected: Object.fromEntries(Object.entries(expect).map(([k, v]) => [k, String(v)])) });
  console.log(
    (bad.length ? 'FAIL ' : 'ok   ') + event.padEnd(58),
    `deck=${got.deck} height=${got.height} track=${got.track} hover=${got.hover} | ${got.status}`,
  );
  if (bad.length) failures.push({ event, bad: bad.map(([k, v]) => `${k}: got ${got[k]}, want ${v}`) });
  return s;
}
const at = (x, y, lift = 0) => page.evaluate(([x, y, lift]) => qa.screen(x, y, lift), [x, y, lift]);
const move = async (x, y, lift = 0) => {
  const p = await at(x, y, lift);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await frames();
  return p;
};
/** A click where the pointer is: no move, so a deck that rose keeps the same pixel under it. */
const click = async (button = 'left') => {
  await page.mouse.down({ button });
  await page.mouse.up({ button });
  await frames();
};
const shot = async (name) => {
  await frames(6);
  await page.screenshot({ path: `${out}input-${name}.png` });
  console.log('SHOT', `input-${name}`);
};
const lay = (x0, x1, y) =>
  page.evaluate(
    ([x0, x1, y]) => {
      const g = qa.g,
        was = g.builder.free;
      g.builder.free = true;
      const out = [];
      for (let x = x0; x <= x1; x++) out.push(g.builder.placeTrackKind(x, y, 'straight', 1));
      g.builder.free = was;
      return out;
    },
    [x0, x1, y],
  );

// ---- 1. pick the bridge tool from the toolbar with the mouse
await page.locator('#toolbar .tb-cat', { hasText: /^Track$/ }).click();
await frames();
await page.locator('#toolbar .tb-item', { hasText: 'Stone Bridge' }).hover();
await shot('01-toolbar-stone-bridge-card');
await page.locator('#toolbar .tb-item', { hasText: 'Wooden Bridge' }).hover();
await shot('02-toolbar-wooden-bridge-card');
await page.locator('#toolbar .tb-item', { hasText: 'Stone Bridge' }).click();
const P = { x: 44, y: 44 };
await move(P.x, P.y);
await note('bridge tool picked, pointer on empty grass', P.x, P.y, { tool: 'bridge_stone', deck: null, status: /^Cost 35 stone/ });
await shot('03-ghost-on-empty-tile');

// ---- 2. place, then click three times: one height per click
await click();
await note('left click: platform placed', P.x, P.y, { deck: 'automatic', height: 0, status: /^Deck height 0 \(on the ground, automatic/ });
for (const h of [1, 2, 3]) {
  await click();
  await note(`left click ${h}: raised`, P.x, P.y, { deck: h, height: h, hover: '44,44', status: new RegExp(`^Deck height ${h} \\(${h} above the ground\\)`) });
}
await shot('04-raised-three-times');
await click();
await note('left click 4: raised to the greatest height', P.x, P.y, { deck: 4, height: 4, status: /^Deck height 4 .*right-click: lower$/ });
await click();
await note('left click 5: refused, reason shown', P.x, P.y, { deck: 4, status: /^Cannot raise the deck: it stands at the greatest deck height/ });
await shot('05-refused-at-the-top');

// ---- 3. right-click down to the floor, and once more
for (const h of [3, 2, 1]) {
  await click('right');
  await note(`right click: lowered to ${h}`, P.x, P.y, { deck: h, height: h, hover: '44,44' });
}
await click('right');
await note('right click: lowered onto the ground', P.x, P.y, { deck: 'automatic', height: 0, hover: '44,44' });
await click('right');
await note('right click at the floor: says so, removes nothing', P.x, P.y, { deck: 'automatic', height: 0, status: /^Cannot lower the deck: it rests on the ground/ });
await shot('06-floor-click-does-not-remove');
await click('right');
await note('right click at the floor again: still nothing removed', P.x, P.y, { deck: 'automatic', height: 0 });

// ---- 4. leave and return: a fresh right click at the floor removes, as it always did
await move(P.x + 3, P.y + 2);
await move(P.x, P.y);
await note('pointer left and came back', P.x, P.y, { deck: 'automatic', status: /right-click: remove$/ });
await click('right');
await note('fresh right click at the floor: platform removed', P.x, P.y, { deck: null, tool: 'bridge_stone' });

// ---- 5. the same pointer, waiting instead of leaving
await click();
await click();
await click('right');
await click('right');
await note('placed, raised, lowered, floor click', P.x, P.y, { deck: 'automatic', status: /^Cannot lower the deck/ });
await page.waitForTimeout(2600);
await note('2.6 s later: the reason has gone, right click removes again', P.x, P.y, { deck: 'automatic', status: /right-click: remove$/ });
await click('right');
await note('right click after the wait: platform removed', P.x, P.y, { deck: null });

// ---- 6. the visible deck of a height-3 span is the tile that takes the click
const Q = { x: 47, y: 41 };
await move(Q.x, Q.y);
await click();
for (let i = 0; i < 3; i++) await click();
await note('second platform raised to 3', Q.x, Q.y, { deck: 3, height: 3 });
await move(Q.x + 3, Q.y + 3);
await move(Q.x, Q.y, 3 * STEP);
await note('pointer on the visible deck, three heights up', Q.x, Q.y, { hover: '47,41', status: /^Deck height 3/ });
await shot('07-pointer-on-raised-deck');
await click();
await note('left click on the visible deck: that platform rose', Q.x, Q.y, { deck: 4, height: 4, hover: '47,41' });
await click('right');
await click('right');
await note('two right clicks on it: lowered twice, still held', Q.x, Q.y, { deck: 2, height: 2, hover: '47,41' });
// A platform placed beside a deck set by hand continues at its height: so does the ghost.
await move(Q.x + 1, Q.y);
await note('pointer on the empty tile beside the height-2 platform', Q.x + 1, Q.y, { deck: null, status: /^Cost 35 stone/ });
await shot('07b-ghost-beside-a-set-deck');
await move(Q.x + 3, Q.y + 3);
// The deck at height 2 still covers the centre of the tile right behind it; two tiles back the
// pointer is on open grass again, where the deck top was drawn at height 4.
await move(Q.x - 1, Q.y - 1);
await note('pointer over the far corner of the span (the tile behind is under it)', Q.x, Q.y, { hover: '47,41', deck: 2 });
await move(Q.x - 2, Q.y - 2);
await note('pointer on the grass two tiles behind the lowered span', Q.x - 2, Q.y - 2, { hover: '45,39', deck: null });

// ---- 7. a bridge with rail: one tile per click, steps refused with their reason
const R = { x: 42, y: 48 };
for (const dx of [0, 1, 2]) {
  await move(R.x + dx, R.y);
  await click();
}
console.log('track laid', JSON.stringify(await lay(R.x - 2, R.x + 4, R.y)));
await move(R.x + 1, R.y);
await note('three platforms with rail, pointer on the middle one', R.x + 1, R.y, { deck: 'automatic', height: 0, track: 'straight', status: /automatic: it follows the rail laid over it/ });
await click();
await note('left click: the middle span rose', R.x + 1, R.y, { deck: 1, height: 1 });
await note('  ... the span beside it stayed (now set at its height)', R.x, R.y, { deck: 0, height: 0 });
await click();
await note('left click again: too steep, refused with the reason', R.x + 1, R.y, { deck: 1, status: /^Cannot raise the deck: the rail beside it would be too steep/ });
await shot('08-step-refused');
await page.waitForTimeout(2600);
await note('2.6 s later: the readout is back', R.x + 1, R.y, { deck: 1, status: /^Deck height 1 \(1 above the ground\)/ });
await click('right');
await note('right click: lowered back', R.x + 1, R.y, { deck: 0, height: 0, track: 'straight' });
await click('right');
await note('right click at the floor: rail and platform stay', R.x + 1, R.y, { deck: 0, track: 'straight', status: /^Cannot lower the deck/ });

// ---- 8. over water
const W = await page.evaluate(() => qa.POND);
await page.evaluate(([x, y]) => qa.centre(x - 2, y, 2), [W.x, W.y]);
await frames();
await move(W.x, W.y);
await note('pointer on a water tile of the pond', W.x, W.y, { deck: null, status: /^Cost 35 stone/ });
await shot('08b-ghost-over-water');
await click();
await note('platform placed on the pond', W.x, W.y, { deck: 'automatic', height: 0, status: /^Deck height 0 \(at the waterline, automatic/ });
await click();
await click();
await note('two clicks: two heights above the water', W.x, W.y, { deck: 2, height: 2, status: /^Deck height 2 \(2 above the water\)/ });
await shot('09-raised-over-water');
await click('right');
await click('right');
await note('two right clicks: back at the waterline', W.x, W.y, { deck: 'automatic', height: 0 });
await click('right');
await note('right click at the waterline: says so', W.x, W.y, { deck: 'automatic', status: /^Cannot lower the deck: it lies at the waterline/ });

// ---- 9. a view change lets go of the held platform
await click();
await note('raised again', W.x, W.y, { deck: 1 });
await page.mouse.wheel(0, 120);
await frames(20);
const afterZoom = await page.evaluate(() => ({ held: qa.g.build.deckHeld(), zoom: qa.g.camera.zoom }));
console.log('after zooming out: held =', JSON.stringify(afterZoom.held), 'zoom', afterZoom.zoom);
if (afterZoom.held) failures.push({ event: 'zoom lets go of the held platform', bad: ['still held'] });
await page.mouse.wheel(0, -120);
await frames(20);

// ---- 10. every other tool keeps its meaning
await page.evaluate(([x, y]) => qa.centre(x, y - 4, 2), [R.x + 1, R.y]);
await frames();
await page.locator('#toolbar .tb-item', { hasText: 'Wooden Bridge' }).click();
await move(R.x + 1, R.y);
await click();
await note('wooden bridge tool on a stone platform: it raises too', R.x + 1, R.y, { deck: 1, tool: 'bridge_wood' });
await click('right');
await page.locator('#toolbar .tb-item', { hasText: /^1?Straight/ }).first().click();
await move(R.x + 1, R.y);
await note('straight track tool over the platform', R.x + 1, R.y, { tool: 'track', deck: 0 });
await click('right');
await note('track tool, right click on a railed platform: the rail goes', R.x + 1, R.y, { track: null, deck: 0 });
await click('right');
await note('track tool, right click again: the platform goes', R.x + 1, R.y, { deck: null });
await page.keyboard.press('Escape');
await frames();
await move(R.x, R.y);
await note('no tool: hover a platform', R.x, R.y, { tool: 'none', deck: 0 });
await shot('10-no-tool-tooltip');
await click();
await note('no tool, left click: the platform is selected (panel opens)', R.x, R.y, { selected: `${R.x},${R.y}`, deck: 0 });
await shot('11-building-panel');
await click('right');
await note('no tool, right click on a railed platform: the rail goes', R.x, R.y, { track: null, deck: 0 });

console.log(failures.length ? `FAILURES ${JSON.stringify(failures, null, 1)}` : 'ALL EXPECTATIONS MET');
console.log('page errors', JSON.stringify(errors));
writeFileSync(`${out}input-log.json`, JSON.stringify({ records, failures, errors }, null, 1));
await browser.close();
