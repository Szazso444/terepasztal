// Demo: chosen depot pictures in the running game, from one spot, with track through the gates.
//   BASE_URL=http://127.0.0.1:5186 node scratchpad/buildings/pick-shots.mjs '<json list>'
// Each entry: { name, rot, look, size, age, rails, zoomIndex }
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
    let depots = [];
    window.demo = {
      wipe() {
        for (const s of depots) b.removeStation(s);
        depots = [];
        for (const t of laid.splice(0)) b.removeTrack(t.x, t.y);
      },
      put(cx, cy, rot, o) {
        b.free = true;
        Object.assign(g, { depotLook: o.look, depotSize: o.size, depotAge: o.age, depotRails: o.rails ?? true });
        const s = b.placeStation(cx, cy, 'depot', rot);
        if (!s) return null;
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
        return true;
      },
    };
    return one;
  });
  if (!one) throw new Error('no clear patch');
  const cx = one.x + 6,
    cy = one.y + 6;
  for (const o of list) {
    await page.evaluate(
      ([cx, cy, o]) => {
        window.demo.wipe();
        window.demo.put(cx, cy, o.rot, o);
        const g = window.game;
        g.camera.zoomIndex = o.zoomIndex ?? 4;
        g.camera.zoom = g.camera.targetZoom;
        const p = g.world.surfacePoint(cx + 1, cy + 1);
        g.camera.centerOn(p.x, p.y);
      },
      [cx, cy, o],
    );
    await page.mouse.move(60, 200);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${o.name}.png`, clip: { x: 720 - 400, y: 500 - 330, width: 800, height: 560 } });
    console.log(o.name);
  }
} finally {
  await browser.close();
}
