// The Upgrade and Downgrade tools in a new game: a wide line with a crossing and a curve, upgraded
// by dragging along it, then partly downgraded. Writes frames and a report to scratchpad/rails/out/.
//   BASE_URL=http://127.0.0.1:5176 node scratchpad/rails/upgrade.mjs
import { launch, openGame } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/rails/out/upgrade';
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  await page.mouse.move(720, 430);
  await page.waitForTimeout(300);
  // a clear patch of ground near the middle of the view, and the line laid on it
  const scene = await page.evaluate(() => {
    const g = window.game;
    const b = g.builder;
    b.free = true;
    const c = g.build.tileUnderMouse();
    const clear = (x, y) => b.checkTrack(x, y, { kind: 'straight', cls: 'regular' }, 1).ok;
    let origin = null;
    for (let r = 0; r < 30 && !origin; r++)
      for (let oy = c.y - r; oy <= c.y + r && !origin; oy++)
        for (let ox = c.x - r - 8; ox <= c.x + r - 8 && !origin; ox++) {
          let ok = true;
          for (let y = oy; y < oy + 10 && ok; y++)
            for (let x = ox; x < ox + 16 && ok; x++) ok = clear(x, y);
          if (ok) origin = { x: ox, y: oy };
        }
    if (!origin) return { error: 'no clear patch' };
    const { x: ox, y: oy } = origin;
    const y0 = oy + 5;
    for (let x = ox + 1; x <= ox + 10; x++)
      b.placeTrack(x, y0, { kind: 'straight', cls: 'regular' }, 1);
    for (let y = oy + 2; y <= oy + 8; y++)
      b.placeTrack(ox + 5, y, { kind: 'straight', cls: 'regular' }, 0);
    b.placeTrack(ox + 5, y0, { kind: 'crossing', cls: 'regular', cls2: 'regular' }, 0);
    // a curve on the east end, then a short run north
    let curve = null;
    for (let rot = 0; rot < 4 && !curve; rot++)
      for (let ay = y0 - 2; ay <= y0 + 1 && !curve; ay++)
        for (let ax = ox + 11; ax <= ox + 12 && !curve; ax++) {
          if (!b.checkTrack(ax, ay, { kind: 'curve', cls: 'regular' }, rot).ok) continue;
          b.placeTrack(ax, ay, { kind: 'curve', cls: 'regular' }, rot);
          if (b.track.connected(ox + 10, y0, 1)) curve = { x: ax, y: ay, rot };
          else b.removeTrack(ax, ay);
        }
    const ends = [];
    if (curve)
      for (const t of b.track.unitTiles(curve.x, curve.y))
        for (const d of b.track.get(t.x, t.y).links.flat()) {
          const n = { x: t.x + [0, 1, 0, -1][d], y: t.y + [-1, 0, 1, 0][d], d };
          if (!b.track.has(n.x, n.y)) ends.push(n);
        }
    for (const e of ends)
      for (let i = 0; i < 3; i++)
        b.placeTrack(
          e.x + [0, 1, 0, -1][e.d] * i,
          e.y + [-1, 0, 1, 0][e.d] * i,
          { kind: 'straight', cls: 'regular' },
          e.d % 2 === 0 ? 0 : 1,
        );
    b.free = false;
    for (const k of ['wood', 'stone', 'iron']) g.stock.amounts.set(k, 5000);
    return { ox, oy, y0, curve, ends };
  });
  if (scene.error) throw new Error(scene.error);
  console.log(JSON.stringify(scene));
  const screenOf = (x, y) =>
    page.evaluate(
      ([x, y]) => {
        const g = window.game;
        const p = g.world.surfacePoint(x, y);
        return g.camera.worldToScreen(p.x, p.y);
      },
      [x, y],
    );
  const centre = await screenOf(scene.ox + 7, scene.y0);
  const clip = {
    x: Math.max(0, centre.x - 520),
    y: Math.max(0, centre.y - 300),
    width: 1040,
    height: 560,
  };
  const row = () =>
    page.evaluate(
      ([s]) => {
        const t = window.game.builder.track;
        const w = (x, y) => {
          const p = t.get(x, y);
          return p
            ? `${p.kind[0]}${p.kind === 'crossing' ? 'x' : ''}:${p.cls === 'high_speed' ? 'H' : p.cls === 'regular' ? 'W' : 'N'}${p.kind === 'crossing' ? (p.cls2 === 'high_speed' ? 'H' : 'W') : ''}`
            : '.';
        };
        const line = [];
        for (let x = s.ox + 1; x <= s.ox + 10; x++) line.push(w(x, s.y0));
        const curve = s.curve ? w(s.curve.x, s.curve.y) : '-';
        const tail = s.ends.map((e) => w(e.x, e.y));
        return `${line.join(' ')} | curve ${curve} | after ${tail.join(' ')}`;
      },
      [scene],
    );
  const status = () => page.evaluate(() => document.querySelector('.tb-status')?.textContent ?? '');
  let frame = 0;
  const shot = async () =>
    page.screenshot({ path: `${out}/f${String(frame++).padStart(3, '0')}.png`, clip });
  const report = { scene, steps: [] };
  const note = async (what) =>
    report.steps.push({ what, row: await row(), status: await status() });

  await note('laid');
  await shot();
  await page.keyboard.press('u');
  await page.waitForTimeout(150);
  const first = await screenOf(scene.ox + 1, scene.y0);
  await page.mouse.move(first.x, first.y);
  await page.waitForTimeout(150);
  await note('upgrade tool over the first straight');
  await page.mouse.down();
  const path = [];
  for (let x = scene.ox + 1; x <= scene.ox + 10; x++) path.push([x, scene.y0]);
  if (scene.curve) path.push([scene.curve.x, scene.curve.y]);
  for (const [x, y] of path) {
    const p = await screenOf(x, y);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(80);
    await shot();
  }
  await page.mouse.up();
  await note('upgraded by one stroke along the line and over the curve');
  await shot();
  // downgrade the first half again
  await page.keyboard.down('Shift');
  await page.keyboard.press('u');
  await page.keyboard.up('Shift');
  const back = await screenOf(scene.ox + 1, scene.y0);
  await page.mouse.move(back.x, back.y);
  await page.mouse.down();
  for (let x = scene.ox + 1; x <= scene.ox + 4; x++) {
    const p = await screenOf(x, scene.y0);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(80);
    await shot();
  }
  await page.mouse.up();
  await note('downgraded the first four tiles');
  await shot();
  report.money = await page.evaluate(() =>
    ['wood', 'stone', 'iron'].map((k) => `${k} ${window.game.stock.get(k)}`).join(', '),
  );
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  for (const s of report.steps) console.log(`${s.what}\n  ${s.row}\n  status: ${s.status}`);
  console.log(report.money, `${frame} frames`);
} finally {
  await browser.close();
}
