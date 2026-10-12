import fs from 'node:fs';
import path from 'node:path';
import { root, read, write, json, saveJson, box, resample, place, PNG } from './pose-png.mjs';
const [strip, ...ids] = process.argv.slice(2),
  p = json('prompts.json');
if (ids.length !== 4) throw Error('Name four recorded call ids in frame order');
const entries = ids.map((id, k) => {
  const e = p['redo-2026-10-11'].findLast((e) => e.id === id && e.file);
  if (!e || e.strip !== strip || e.frame !== k) throw Error('Wrong frame in diagnostic selection');
  return e;
});
const images = entries.map((e) => read(e.file)),
  reaches = images.map((p) => {
    const s = p.width / 1024,
      b = box(p),
      f = 360 / (1152 * s);
    return Math.max((512 * s - b.x) * f, (b.x + b.width - 512 * s) * f);
  });
let cw = strip.endsWith('carry') ? 256 : 192;
if (cw === 192 && Math.max(...reaches) > 88) cw = 256;
if (cw === 256 && Math.max(...reaches) > 120) cw = 320;
const canvas = new PNG({ width: cw * 4, height: 512 }),
  small = new PNG({ width: 256, height: 32 }),
  normalized = [];
for (let k = 0; k < 4; k++) {
  const image = images[k],
    s = image.width / 1024;
  const frame = resample(image, cw, 512, 360 / (1152 * s), [512 * s, 1344 * s], [cw / 2, 480]);
  place(canvas, frame, k * cw, 0);
  const native = resample(frame, 64, 32, 9 / 360, [cw / 2, 480], [32, 25]);
  place(small, native, k * 64, 0);
  normalized.push(resample(image, 320, 480, 320 / image.width, [0, 0], [0, 0]));
}
const prefix = 'checks/' + strip + '-candidate';
write(prefix + '.png', canvas);
write(prefix + '-9px.png', small);
const overlay = new PNG({ width: 320, height: 480 });
for (let p = 0; p < overlay.data.length; p += 4) {
  const a = normalized[0].data[p + 3] / 510,
    b = normalized[2].data[p + 3] / 255,
    alpha = a + b * (1 - a);
  if (alpha) {
    for (let c = 0; c < 3; c++)
      overlay.data[p + c] = Math.round(
        (normalized[0].data[p + c] * a + normalized[2].data[p + c] * b * (1 - a)) / alpha,
      );
    overlay.data[p + 3] = Math.round(alpha * 255);
  }
}
write(prefix + '-contact-overlay.png', overlay);
const report = {
  status: 'DIAGNOSTIC ONLY, box tests failed; original production strip unchanged',
  strip,
  canvas: [cw * 4, 512],
  columnWidth: cw,
  uniformScale: 360 / 1152,
  anchors: entries.map((_, k) => [cw * k + cw / 2, 480]),
  frames: entries.map((e) => ({ id: e.id, file: e.file, measured: e.measured })),
};
saveJson(prefix + '.json', report);
const html =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>' +
  strip +
  ' diagnostic candidate</title><style>body{background:#78804c;color:#e4d5b5;font:16px system-ui}canvas{image-rendering:pixelated}.zoom{width:512px;height:256px}table{border-collapse:collapse}td,th{padding:6px;border:1px solid #e4d5b5}</style><h1>Diagnostic candidate — not accepted</h1><p>Uniform scale and body anchors. Original strip unchanged. Three frame boxes exceed the5percent requirement.</p><canvas id="native" width="64" height="32"></canvas><canvas id="zoom" class="zoom" width="64" height="32"></canvas><p><button id="pause">Pause</button><select id="phase"><option value="animate">Animate</option><option value="0">f0</option><option value="1">f1</option><option value="2">f2</option><option value="3">f3</option></select><span id="current"></span></p><table><tr><th>Frame</th><th>Width error</th><th>Height error</th><th>Box pass</th></tr>' +
  entries
    .map(
      (e) =>
        '<tr><td>f' +
        e.frame +
        '</td><td>' +
        ((e.measured.widthError ?? 0) * 100).toFixed(1) +
        '%</td><td>' +
        ((e.measured.heightError ?? 0) * 100).toFixed(1) +
        '%</td><td>' +
        e.measured.boxPass +
        '</td></tr>',
    )
    .join('') +
  '</table><p>f0 over f2 at50percent opacity:</p><img src="' +
  strip +
  '-candidate-contact-overlay.png"><script>let paused=false,frame=0;const image=new Image();image.src="' +
  strip +
  '-candidate-9px.png";function draw(){const value=document.getElementById("phase").value;const k=value==="animate"?frame:Number(value);for(const id of ["native","zoom"]){const c=document.getElementById(id).getContext("2d");c.clearRect(0,0,64,32);if(image.complete&&image.naturalWidth)c.drawImage(image,k*64,0,64,32,0,0,64,32)}document.getElementById("current").textContent=" f"+k}document.getElementById("pause").onclick=()=>{paused=!paused};document.getElementById("phase").onchange=draw;setInterval(()=>{if(!paused)frame=(frame+1)%4;draw()},240);</script></html>';
fs.writeFileSync(path.join(root, prefix + '.html'), html);
console.log(JSON.stringify(report));
