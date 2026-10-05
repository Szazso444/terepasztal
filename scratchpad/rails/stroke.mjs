// The Upgrade tool at a crossing: a stroke down a north-south line whose cursor wobbles one tile
// to the west just before the crossing, and the status line's warning about trains.
//   BASE_URL=http://127.0.0.1:5176 node scratchpad/rails/stroke.mjs
import { launch, openGame } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/rails/out/stroke';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  await page.mouse.move(720, 430);
  await page.waitForTimeout(300);
  const scene = await page.evaluate(() => {
    const g = window.game;
    const b = g.builder;
    b.free = true;
    const c = g.build.tileUnderMouse();
    const clear = (x, y) => b.checkTrack(x, y, { kind: 'straight', cls: 'regular' }, 1).ok;
    let origin = null;
    for (let r = 0; r < 30 && !origin; r++)
      for (let oy = c.y - r; oy <= c.y + r && !origin; oy++)
        for (let ox = c.x - r - 6; ox <= c.x + r - 6 && !origin; ox++) {
          let ok = true;
          for (let y = oy; y < oy + 13 && ok; y++)
            for (let x = ox; x < ox + 13 && ok; x++) ok = clear(x, y);
          if (ok) origin = { x: ox, y: oy };
        }
    if (!origin) return { error: 'no clear patch' };
    const cx = origin.x + 6,
      cy = origin.y + 6;
    for (let y = cy - 5; y <= cy + 5; y++)
      if (y !== cy) b.placeTrack(cx, y, { kind: 'straight', cls: 'regular' }, 0);
    for (let x = cx - 5; x <= cx + 5; x++)
      if (x !== cx) b.placeTrack(x, cy, { kind: 'straight', cls: 'regular' }, 1);
    b.placeTrack(cx, cy, { kind: 'crossing', cls: 'regular', cls2: 'regular' }, 0);
    b.free = false;
    for (const k of ['wood', 'stone', 'iron']) g.stock.amounts.set(k, 5000);
    return { cx, cy };
  });
  if (scene.error) throw new Error(scene.error);
  const screenOf = (x, y) =>
    page.evaluate(
      ([x, y]) => {
        const g = window.game;
        const p = g.world.surfacePoint(x, y);
        return g.camera.worldToScreen(p.x, p.y);
      },
      [x, y],
    );
  const state = () =>
    page.evaluate(
      ([s]) => {
        const t = window.game.builder.track;
        const w = (x, y) => {
          const p = t.get(x, y);
          if (!p) return '.';
          const c = (k) => (k === 'high_speed' ? 'H' : k === 'regular' ? 'W' : 'N');
          if (p.kind !== 'crossing') return `${p.kind[0]}:${c(p.cls)}`;
          const ns = p.links[0].some((d) => d === 0 || d === 2) ? 0 : 1;
          const cls = [p.cls, p.cls2 ?? p.cls];
          return `x:ns${c(cls[ns])}/ew${c(cls[1 - ns])}`;
        };
        const ns = [],
          ew = [];
        for (let y = s.cy - 5; y <= s.cy + 5; y++) ns.push(w(s.cx, y));
        for (let x = s.cx - 5; x <= s.cx + 5; x++) ew.push(w(x, s.cy));
        return { ns: ns.join(' '), ew: ew.join(' ') };
      },
      [scene],
    );
  const status = () => page.evaluate(() => document.querySelector('.tb-status')?.textContent ?? '');
  const centre = await screenOf(scene.cx, scene.cy);
  const clip = { x: Math.max(0, centre.x - 430), y: Math.max(0, centre.y - 280), width: 860, height: 560 };
  const report = { scene, steps: [] };
  const note = async (what) => report.steps.push({ what, ...(await state()), status: await status() });
  await note('laid');
  await page.screenshot({ path: `${out}/before.png`, clip });

  await page.keyboard.press('u');
  await page.waitForTimeout(150);
  // down the north-south line; one tile off to the west just before the crossing
  const path = [
    [scene.cx, scene.cy - 4],
    [scene.cx, scene.cy - 3],
    [scene.cx, scene.cy - 2],
    [scene.cx - 1, scene.cy - 1],
    [scene.cx, scene.cy],
    [scene.cx, scene.cy + 1],
    [scene.cx, scene.cy + 2],
    [scene.cx, scene.cy + 3],
  ];
  const first = await screenOf(...path[0]);
  await page.mouse.move(first.x, first.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  for (const [x, y] of path.slice(1)) {
    const p = await screenOf(x, y);
    // one jump per frame, as a fast hand moves: no tiles in between are seen
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(90);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
  await note('upgraded down the north-south line, wobbling west before the crossing');
  await page.screenshot({ path: `${out}/wobble.png`, clip });

  // the warning: trains without in-cab signalling cannot use the upgraded line
  await page.evaluate(() => {
    window.game.build.barredTrains = () => ({ barred: 2, total: 5 });
  });
  const far = await screenOf(scene.cx + 4, scene.cy);
  await page.mouse.move(far.x, far.y);
  await page.waitForTimeout(200);
  await note('upgrade tool over a wide straight, two of five trains without in-cab signalling');
  const off = await screenOf(scene.cx + 3, scene.cy + 3);
  await page.mouse.move(off.x, off.y);
  await page.waitForTimeout(200);
  await note('upgrade tool over empty ground');
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  for (const s of report.steps) console.log(`${s.what}\n  ns ${s.ns}\n  ew ${s.ew}\n  status: ${s.status}`);
} finally {
  await browser.close();
}
