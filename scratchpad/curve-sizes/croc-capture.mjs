import { launch } from '../runtime.mjs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:5177/scratchpad/curve-sizes/?cls=high_speed&hsn=3&len=crocodile:3&ids=crocodile');
await p.waitForFunction(() => typeof window.qa?.show === 'function', null, { timeout: 180000 });
const r = await p.evaluate(() => qa.show(0, 'loco', 1.5));
await p.screenshot({ path: 'scratchpad/curve-sizes/ladder/crocodile-B3.png', clip: { x: 270, y: 170, width: 900, height: 620 } });
console.log(r.lengths.loco);
await b.close();
