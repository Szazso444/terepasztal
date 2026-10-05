// Demo: the depot pilot's four pictures in the running game, each turn of the depot in three
// looks from the same spot (today's picture, the new one with its camera corrected, the new one
// as it was drawn), with track through its gates. Then all four new views side by side.
//   BASE_URL=http://127.0.0.1:5186 node scratchpad/buildings/depot-shots.mjs
import { launch, openGame } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/buildings/out';
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
    const clear = (x, y) =>
      b.checkTrack(x, y, { kind: 'straight', cls: 'regular' }, 1).ok && !b.stationAt(x, y);
    const patch = (w, h) => {
      for (let r = 0; r < 40; r++)
        for (let oy = c.y - r; oy <= c.y + r; oy++)
          for (let ox = c.x - r - (w >> 1); ox <= c.x + r - (w >> 1); ox++) {
            let ok = true;
            for (let y = oy; y < oy + h && ok; y++)
              for (let x = ox; x < ox + w && ok; x++) ok = clear(x, y);
            if (ok) return { x: ox, y: oy };
          }
      return null;
    };
    const one = patch(14, 14);
    const row = patch(34, 14);
    const laid = [];
    let depots = [];
    const wipe = () => {
      for (const s of depots) b.removeStation(s);
      depots = [];
      for (const t of laid.splice(0)) b.removeTrack(t.x, t.y);
    };
    const put = (cx, cy, rot, look) => {
      b.free = true;
      const s = b.placeStation(cx, cy, 'depot', rot);
      if (!s) return null;
      s.name = `Depot [${look}]`;
      b.onStationChanged(s, false);
      depots.push(s);
      const lay = (x, y, r) => {
        if (b.placeTrack(x, y, { kind: 'straight', cls: 'regular' }, r)) laid.push({ x, y });
      };
      for (let i = 1; i <= 5; i++)
        for (const lane of [0, 1])
          if (rot % 2 === 0) {
            lay(cx - i, cy + lane, 1);
            lay(cx + 1 + i, cy + lane, 1);
          } else {
            lay(cx + lane, cy - i, 0);
            lay(cx + lane, cy + 1 + i, 0);
          }
      return { x: s.x, y: s.y };
    };
    window.demo = { wipe, put };
    for (const k of ['wood', 'stone', 'iron']) g.stock.amounts.set(k, 5000);
    return { one, row };
  });
  console.log(JSON.stringify(scene));
  if (!scene.one) throw new Error('no clear patch');
  const look = async (tx, ty, zoomIndex) =>
    page.evaluate(
      ([tx, ty, zi]) => {
        const g = window.game;
        g.camera.zoomIndex = zi;
        g.camera.zoom = g.camera.targetZoom;
        const p = g.world.surfacePoint(tx, ty);
        g.camera.centerOn(p.x, p.y);
        return { zoom: g.camera.zoom, steps: g.camera.zoomIndex };
      },
      [tx, ty, zoomIndex],
    );
  // the depot stands with its corner at (cx, cy); its middle is the corner shared by its four tiles
  const cx = scene.one.x + 6,
    cy = scene.one.y + 6;
  const report = { scene, shots: [] };
  for (let rot = 0; rot < 4; rot++)
    for (const lookName of ['old', 'new', 'raw']) {
      await page.evaluate(
        ([cx, cy, rot, lookName]) => {
          window.demo.wipe();
          return window.demo.put(cx, cy, rot, lookName);
        },
        [cx, cy, rot, lookName],
      );
      const z = await look(cx + 1, cy + 1, 4);
      await page.mouse.move(60, 200);
      await page.waitForTimeout(500);
      const file = `${out}/depot-r${rot}-${lookName}.png`;
      await page.screenshot({ path: file, clip: { x: 720 - 470, y: 500 - 360, width: 940, height: 640 } });
      report.shots.push({ file, rot, look: lookName, zoom: z.zoom });
    }
  // all four turns of the new picture side by side, at the normal zoom
  if (scene.row) {
    for (const lookName of ['new', 'raw', 'old']) {
      await page.evaluate(
        ([ox, oy, lookName]) => {
          window.demo.wipe();
          for (let rot = 0; rot < 4; rot++) window.demo.put(ox + 3 + rot * 8, oy + 6, rot, lookName);
        },
        [scene.row.x, scene.row.y, lookName],
      );
      const z = await look(scene.row.x + 17, scene.row.y + 7, 3);
      await page.waitForTimeout(500);
      const file = `${out}/depot-row-${lookName}.png`;
      await page.screenshot({ path: file, clip: { x: 0, y: 140, width: 1440, height: 720 } });
      report.shots.push({ file, look: lookName, zoom: z.zoom });
    }
  }
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(`${report.shots.length} shots`, JSON.stringify(report.shots.slice(0, 2)));
} finally {
  await browser.close();
}
