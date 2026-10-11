// Bridge capacity upgrades (building level 2..4) draw the procedural reinforcement frames over
// whichever deck is in use. node scratchpad/bridges/upgrade.mjs <kit|proc>
import { launch } from '../runtime.mjs';
const [mode = 'kit'] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/index.html?axis=x${mode === 'proc' ? '&proc=1' : ''}`);
await page.waitForFunction(() => window.qa, null, { timeout: 180000 });
for (const id of ['W3-stone', 'W3-wood']) {
  const levels = await page.evaluate((id) => {
    const s = qa.sites.find((s) => s.id === id), g = qa.g, out = [];
    s.tiles.forEach((t, i) => {
      const b = g.builder.buildingAt(t.x, t.y);
      for (let k = 0; k <= i; k++) g.builder.upgradeBuilding(b);
      out.push(b.level);
    });
    g.render(1, 0);
    qa.view(s.cx, s.cy + 0.2, 8, `${qa.proc ? 'proc' : 'kit'} · ${id} · capacity upgrade levels ${out.join(', ')} · zoom 8`);
    return out;
  }, id);
  console.log(id, levels);
  await page.screenshot({ path: `scratchpad/bridges/renders/${mode}-x-detail-${id}-upgraded.png` });
}
await browser.close();
