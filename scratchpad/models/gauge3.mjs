// Scratch: engines side by side for the gauge preview (three levels: the game's 39 % over scale, 20 %
// over, true to scale).
//   node scratchpad/models/gauge3.mjs <name> [halfGaugeTiles|-] [rows=drg01,...] [ids=21,...] [zoom=4]
// writes out/<name>.png; with a half gauge the track is drawn with its rails that far from the centre
// line (the engines must have been rendered for it and packed into the atlas first).
import { launch } from '../runtime.mjs';
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [
  name = 'gauge-39',
  gauge = '-',
  rows = 'drg01,black_five,flying_scotsman,taurus,sd40',
  ids = '21,18,23,29,37',
  zoom = '4',
] = process.argv.slice(2);
const W = 2200, H = 1300;
const b = await launch();
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const q = `rows=${rows}&ids=${ids}&zoom=${zoom}&gap=2${gauge !== '-' ? `&gauge=${gauge}` : ''}`;
await p.goto(`http://127.0.0.1:5182/scratchpad/models/?${q}`);
await p.waitForFunction(() => typeof window.qa?.shot === 'function', null, { timeout: 240000 });
const { box } = await p.evaluate(() => qa.shot());
await p.evaluate(() => qa.settle());
const shot = PNG.sync.read(await p.screenshot());
const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
const x1 = Math.min(W - 1, Math.ceil(box.x1)), y1 = Math.min(H - 1, Math.ceil(box.y1));
const crop = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 });
PNG.bitblt(shot, crop, x0, y0, crop.width, crop.height, 0, 0);
writeFileSync(`scratchpad/models/out/${name}.png`, PNG.sync.write(crop));
console.log(name, crop.width, crop.height, errs.length ? errs : 'no errors');
await b.close();
