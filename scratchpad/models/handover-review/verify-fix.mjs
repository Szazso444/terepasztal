import { launch } from '../../runtime.mjs';
import { writeFileSync } from 'node:fs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
try {
  await p.goto('http://127.0.0.1:5182/scratchpad/models/?rows=');
  await p.waitForFunction(() => typeof window.qa?.start === 'function', null, { timeout: 240000 });
  const frames = await p.evaluate(() => {
    const atlas = qa.g.atlas;
    return Array.from({ length: 48 }, (_, f) => {
      const fr = atlas.get(`rolling/loco_c50_body_f${f}`);
      if (fr.texture.frame.width / fr.w !== 4 || fr.w > 65 || fr.h > 65) throw new Error('Bad sprite scale');
      return { f, w: fr.w, h: fr.h };
    });
  });
  for (const id of ['c50', 'black_five', 'drg01', 'daylight']) {
    await p.evaluate(async id => {
      qa.curve(id, 5, []);
      await qa.settle();
    }, id);
    await p.screenshot({ clip: { x: 250, y: 120, width: 1100, height: 750 },
      path: `scratchpad/models/handover-review/c50-fix/check-${id}.png` });
  }
  await p.evaluate(() => { qa.start('c50', [], 19); qa.roll(0, 6, 0, 1); });
  await p.screenshot({ clip: { x: 360, y: 210, width: 720, height: 480 },
    path: 'scratchpad/models/handover-review/c50-fix/check-night.png' });
  const layers = await p.evaluate(() => {
    const r = qa.g.trainRenderer;
    const visible = m => [...m.values()].filter(s => s.visible).length;
    return { wheels: visible(r.wheelLayers), windows: visible(r.windowLights) };
  });
  if (layers.wheels || layers.windows) throw new Error('Legacy C-50 overlays remain');
  writeFileSync('scratchpad/models/handover-review/c50-fix/verified.json', JSON.stringify({ frames, layers, errors }, null, 2));
  console.log(JSON.stringify({ headings: frames.length, layers, errors }));
  if (errors.length) throw new Error(JSON.stringify(errors));
} finally { await b.close(); }
