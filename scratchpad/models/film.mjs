// Scratch: a short film of one engine rolling (wheels turning, trucks following the rail).
//   node scratchpad/models/film.mjs <id> <name> [zoom=5] [frames=48] [ticks=2] [lead=6] [W=720] [H=440] [part=0]
// writes out/film/<name>-<nnn>.png (cropped frames) and prints what the train did.
import { launch } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const [id, name = id, zoom = '5', frames = '48', ticks = '2', lead = '6', W = '720', H = '440', part = '0'] = process.argv.slice(2);
const out = 'scratchpad/models/out/film';
mkdirSync(out, { recursive: true });
const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:5182/scratchpad/models/?rows=');
await p.waitForFunction(() => typeof window.qa?.start === 'function', null, { timeout: 240000 });
// the pointer away from the train: a hovered train lights up its route
await p.mouse.move(8, 990);
console.log(JSON.stringify(await p.evaluate(([id, lead]) => qa.start(id, undefined, lead), [id, +lead])));
await p.evaluate(([z, pt]) => qa.roll(0, z, pt), [+zoom, +part]);
await p.evaluate(() => qa.settle());
const log = [];
for (let n = 0; n < +frames; n++) {
  log.push(await p.evaluate(([t, z, pt]) => qa.roll(t, z, pt), [+ticks, +zoom, +part]));
  if (n % 8 === 0) await p.evaluate(() => qa.settle(1500));
  await p.screenshot({ path: `${out}/${name}-${String(n).padStart(3, '0')}.png`, clip: { x: 720 - W / 2, y: 500 - H / 2, width: +W, height: +H } });
}
console.log(JSON.stringify([log[0], log[log.length - 1]]), errs.length ? errs : 'no errors');
await b.close();
