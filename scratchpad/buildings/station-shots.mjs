// Demo: chosen pictures of a one-tile station in the running game, from one spot, with a
// straight track before its front.
//   BASE_URL=http://127.0.0.1:5186 node scratchpad/buildings/station-shots.mjs '<json list>'
// Each entry: { name, station, rot, look, age, level, zoomIndex }
import { launch, openGame } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const out = 'scratchpad/buildings/out';
const list = JSON.parse(process.argv[2]);
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  await page.mouse.move(720, 430);
  await page.waitForTimeout(300);
  const one = await page.evaluate(() => {
    const g = window.game;
    const b = g.builder;
    b.free = true;
    const c = g.build.tileUnderMouse();
    const clear = (x, y) =>
      b.checkTrack(x, y, { kind: 'straight', cls: 'regular' }, 1).ok && !b.stationAt(x, y);
    let one = null;
    for (let r = 0; r < 40 && !one; r++)
      for (let oy = c.y - r; oy <= c.y + r && !one; oy++)
        for (let ox = c.x - r - 7; ox <= c.x + r - 7 && !one; ox++) {
          let ok = true;
          for (let y = oy; y < oy + 14 && ok; y++)
            for (let x = ox; x < ox + 14 && ok; x++) ok = clear(x, y);
          if (ok) one = { x: ox, y: oy };
        }
    const laid = [];
    let stations = [];
    window.demo = {
      wipe() {
        for (const s of stations) b.removeStation(s);
        stations = [];
        for (const t of laid.splice(0)) b.removeTrack(t.x, t.y);
      },
      put(cx, cy, o) {
        b.free = true;
        Object.assign(g, { depotLook: o.look, depotAge: o.age });
        const lay = (x, y, r) => {
          if (b.placeTrack(x, y, { kind: 'straight', cls: 'regular' }, r)) laid.push({ x, y });
        };
        // the front faces S, W, N, E as the station turns: a track along it, one tile before it
        // (laid first: a station is built beside track)
        const [dx, dy] = [
          [0, 1],
          [-1, 0],
          [0, -1],
          [1, 0],
        ][o.rot % 4];
        for (let i = -5; i <= 5; i++)
          if (dx === 0) lay(cx + i, cy + dy, 1);
          else lay(cx + dx, cy + i, 0);
        const s = b.placeStation(cx, cy, o.station, o.rot);
        if (!s) return null;
        stations.push(s);
        // today's pictures go by the station's level
        for (let level = 1; level < (o.level ?? 1); level++) b.upgradeStation(s);
        return true;
      },
    };
    return one;
  });
  if (!one) throw new Error('no clear patch');
  const cx = one.x + 6,
    cy = one.y + 6;
  for (const o of list) {
    const ok = await page.evaluate(
      ([cx, cy, o]) => {
        window.demo.wipe();
        const placed = window.demo.put(cx, cy, o);
        const g = window.game;
        g.camera.zoomIndex = o.zoomIndex ?? 5;
        g.camera.zoom = g.camera.targetZoom;
        const p = g.world.surfacePoint(cx + 0.5, cy + 0.5);
        g.camera.centerOn(p.x, p.y);
        return placed;
      },
      [cx, cy, o],
    );
    await page.mouse.move(60, 200);
    await page.waitForTimeout(450);
    await page.screenshot({
      path: `${out}/${o.name}.png`,
      clip: { x: 720 - 400, y: 500 - 330, width: 800, height: 560 },
    });
    console.log(o.name, ok ? '' : 'NOT PLACED');
  }
} finally {
  await browser.close();
}
