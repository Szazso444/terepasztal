import fs from 'node:fs';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
const candidate = 'G:/DEV/Terepasztal/poc/rocket-original-v1';
const dir = new URL('./candidate/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const meta = JSON.parse(fs.readFileSync(candidate + '/render-metadata.json'));
const entries = Object.entries(meta.frames),
  size = 384,
  cols = 5;
assert.equal(entries.length, 25);
const atlas = new PNG({ width: cols * size, height: Math.ceil(entries.length / cols) * size });
const frames = {};
const alphaChecks = [];
for (const [i, [f, fr]] of entries.entries()) {
  const png = PNG.sync.read(fs.readFileSync(candidate + '/' + fr.file));
  assert.equal(png.width, size);
  assert.equal(png.height, size);
  let visible = 0,
    border = 0;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const a = png.data[(py * size + px) * 4 + 3];
      if (a) {
        visible++;
        if (px === 0 || py === 0 || px === size - 1 || py === size - 1) border++;
      }
    }
  assert(visible > 0, `Facing ${f} is empty`);
  assert.equal(border, 0, `Facing ${f} clips the canvas`);
  assert(
    fr.ax >= 0 && fr.ax <= size && fr.ay >= 0 && fr.ay <= size,
    `Facing ${f} has an invalid anchor`,
  );
  alphaChecks.push({
    facing: Number(f),
    nonempty: true,
    borderAlphaPixels: border,
    anchor: [fr.ax, fr.ay],
  });
  const x = (i % cols) * size,
    y = Math.floor(i / cols) * size;
  PNG.bitblt(png, atlas, 0, 0, size, size, x, y);
  frames[`rolling/loco_steam_early_small_yellow_body_f${f}`] = {
    x,
    y,
    w: size,
    h: size,
    ax: fr.ax,
    ay: fr.ay,
  };
}
fs.writeFileSync(new URL('rolling.png', dir), PNG.sync.write(atlas));
fs.writeFileSync(
  new URL('rolling.json', dir),
  JSON.stringify({ resolution: 4, partial: true, frames }, null, 2),
);
fs.writeFileSync(
  new URL('atlas-checks.json', dir),
  JSON.stringify({ frames: 25, resolution: 4, alphaChecks }, null, 2),
);
console.log('Prepared isolated 25-frame candidate atlas.');
