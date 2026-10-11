// Scratch (resumed run): what bounds Pixi gives a Mesh whose aPosition has three components (model
// space in tiles), with and without an explicit boundsArea: the culler and hit tests read these.
import { launch } from '../runtime.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5177/scratchpad/3d-proto-integration/index.html?sprites=B&ladder=B');
await page.waitForFunction(() => typeof window.qa?.tests?.busy === 'function' && window.qa.settled(), null, { timeout: 180000, polling: 200 });
await page.evaluate(() => qa.frame(3.2, 3));
console.log(JSON.stringify(await page.evaluate(() => {
  qa.standin('mesh', 0, true);
  const m = qa.state.mesh;
  const b = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  const withArea = b(m.getBounds().rectangle);
  const local = b(m.getLocalBounds().rectangle);
  const keep = m.boundsArea;
  m.boundsArea = null;
  const geo = m.geometry.bounds;
  const without = b(m.getBounds().rectangle);
  const localWithout = b(m.getLocalBounds().rectangle);
  m.boundsArea = keep;
  const sprite = qa.g.trainRenderer.cars.get(qa.t.id)[0].parts[0];
  sprite.renderable = true;
  return { withArea, local, without, localWithout, geometryBounds: { minX: geo.minX, minY: geo.minY, maxX: geo.maxX, maxY: geo.maxY }, spriteBounds: b(sprite.getBounds().rectangle), batched: m.batched, renderPipeId: m.renderPipeId, roundPixels: m.roundPixels };
})));
await browser.close();
