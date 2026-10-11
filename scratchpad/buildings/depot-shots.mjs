// Demo: the depot's pictures in the running game, from one spot, with track through its gates.
// Sets: `sizes` (as drawn, five sizes, rails under the hall), `looks` (as drawn and corrected at
// the chosen size, with and without rails), `ages` (the six levels).
//   BASE_URL=http://127.0.0.1:5186 node scratchpad/buildings/depot-shots.mjs [size]
import { launch, openGame } from '../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/buildings/out';
const chosen = Number(process.argv[2] ?? 1.15);
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
    const wipe = () => {
      for (const s of depots) b.removeStation(s);
      depots = [];
      for (const t of laid.splice(0)) b.removeTrack(t.x, t.y);
    };
    const put = (cx, cy, rot, o) => {
      b.free = true;
      g.depotLook = o.look;
      g.depotSize = o.size;
      g.depotAge = o.age;
      g.depotRails = o.rails;
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
      return { x: s.x, y: s.y };
    };
    window.demo = { wipe, put };
    for (const k of ['wood', 'stone', 'iron']) g.stock.amounts.set(k, 5000);
    return { one };
  });
  if (!scene.one) throw new Error('no clear patch');
  const cx = scene.one.x + 6,
    cy = scene.one.y + 6;
  const look = (zoomIndex) =>
    page.evaluate(
      ([tx, ty, zi]) => {
        const g = window.game;
        g.camera.zoomIndex = zi;
        g.camera.zoom = g.camera.targetZoom;
        const p = g.world.surfacePoint(tx, ty);
        g.camera.centerOn(p.x, p.y);
        return g.camera.zoom;
      },
      [cx + 1, cy + 1, zoomIndex],
    );
  const report = { chosen, shots: [] };
  const shot = async (name, rot, o, zoomIndex, clip) => {
    await page.evaluate(
      ([cx, cy, rot, o]) => {
        window.demo.wipe();
        return window.demo.put(cx, cy, rot, o);
      },
      [cx, cy, rot, o],
    );
    const zoom = await look(zoomIndex);
    await page.mouse.move(60, 200);
    await page.waitForTimeout(450);
    const file = `${out}/${name}.png`;
    await page.screenshot({ path: file, clip });
    report.shots.push({ file, rot, ...o, zoom });
  };
  const wide = { x: 720 - 470, y: 500 - 360, width: 940, height: 640 };
  const close = { x: 720 - 400, y: 500 - 330, width: 800, height: 560 };
  // 1. how large: as drawn, the gates towards the viewer on either side, rails under the hall
  for (const rot of [0, 3])
    for (const size of [1, 1.08, 1.15, 1.22, 1.3])
      await shot(`size-r${rot}-${Math.round(size * 100)}`, rot, { look: 'raw', size, age: 0, rails: true }, 5, close);
  // 2. the looks at the chosen size, every turn; and the flat tiles there were before
  for (let rot = 0; rot < 4; rot++) {
    await shot(`look-r${rot}-raw`, rot, { look: 'raw', size: chosen, age: 0, rails: true }, 4, wide);
    await shot(`look-r${rot}-new`, rot, { look: 'new', size: chosen, age: 0, rails: true }, 4, wide);
    await shot(`look-r${rot}-raw-flat`, rot, { look: 'raw', size: 1, age: 0, rails: false }, 4, wide);
  }
  // 3. the six levels, as drawn, at the chosen size
  for (let age = 0; age < 6; age++)
    for (const rot of [0, 1])
      await shot(`age-a${age}-r${rot}`, rot, { look: 'raw', size: chosen, age, rails: true }, 4, wide);
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(`${report.shots.length} shots`);
} finally {
  await browser.close();
}
