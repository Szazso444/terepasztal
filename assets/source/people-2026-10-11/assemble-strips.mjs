import fs from 'node:fs';
import path from 'node:path';
import { root, read, write, json, saveJson, box, resample, place, PNG } from './pose-png.mjs';
const strip = process.argv[2],
  geometry = json('pose-geometry.json'),
  spec = geometry.strips[strip];
if (!spec) throw Error('Name one of the nine redo strips');
const prompts = json('prompts.json'),
  calls = prompts['redo-2026-10-11'] ?? [],
  paintings = [];
for (let k = 0; k < 4; k++) {
  const e = calls.findLast((e) => e.strip === strip && e.frame === k && e.accepted);
  if (!e?.accepted || (!e.measured.boxPass && !e.keptDespiteFailedMeasurements))
    throw Error('Frame ' + k + ' has no box-passing, visually accepted painting');
  const png = read(e.acceptedFile),
    s = png.width / 1024,
    factor = 360 / (1152 * s),
    b = box(png);
  paintings.push({
    e,
    png,
    s,
    factor,
    sourceAnchor: [512 * s, e.measured.soleRow],
    box: b,
    leftReach: (512 * s - b.x) * factor,
    rightReach: (b.x + b.width - 512 * s) * factor,
  });
}
const maxReach = Math.max(...paintings.flatMap((p) => [p.leftReach, p.rightReach]));
let columnWidth = spec.carry ? 256 : 192;
if (columnWidth === 192 && maxReach > 88) columnWidth = 256;
if (columnWidth === 256 && maxReach > 120) columnWidth = 320;
if (maxReach > columnWidth / 2 - 8)
  throw Error('Load would clip or lose its8px margin; repaint before assembly');
const canvas = new PNG({ width: columnWidth * 4, height: 512 }),
  frames = [];
for (let k = 0; k < 4; k++) {
  const p = paintings[k],
    anchor = [columnWidth / 2, 480];
  const frame = resample(p.png, columnWidth, 512, p.factor, p.sourceAnchor, anchor);
  place(canvas, frame, k * columnWidth, 0);
  const b = box(frame);
  if (b.x < 1 || b.x + b.width >= columnWidth || b.y < 1 || b.y + b.height >= 512)
    throw Error('Rendered figure clipped');
  frames.push({
    frame: k,
    pose: p.e.acceptedFile,
    returned: [p.png.width, p.png.height],
    uniformScale: p.factor,
    normalizedScale: 360 / 1152,
    sourceAnchor: p.sourceAnchor,
    soleRow: p.e.measured.soleRow,
    anchor: [columnWidth * k + columnWidth / 2, 480],
    leftReach: p.leftReach,
    rightReach: p.rightReach,
    bounds: b,
  });
}
const backup = 'raw/' + strip + '-attempt-1.png';
if (!fs.existsSync(path.join(root, backup))) {
  fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
  fs.copyFileSync(path.join(root, strip + '.png'), path.join(root, backup));
}
write(strip + '.png', canvas);
prompts.redoStrips ??= {};
prompts.redoStrips[strip] = {
  canvas: [canvas.width, 512],
  columns: 4,
  columnWidth,
  anchors: frames.map((f) => f.anchor),
  uniformScaling: true,
  scaleFormula: '360 / (1152 * returnedWidth / 1024)',
  resampling: 'premultiplied-alpha area averaging',
  maxReach,
  frames,
  visualCycleReview: 'pending',
};
saveJson('prompts.json', prompts);
const tinySheet = new PNG({ width: 256, height: 32 });
for (let k = 0; k < 4; k++) {
  const frame = new PNG({ width: columnWidth, height: 512 });
  for (let y = 0; y < 512; y++)
    canvas.data.copy(
      frame.data,
      y * columnWidth * 4,
      (y * canvas.width + k * columnWidth) * 4,
      (y * canvas.width + (k + 1) * columnWidth) * 4,
    );
  const tiny = resample(frame, 64, 32, 9 / 360, [columnWidth / 2, 480], [32, 25], {cleanAlpha:false});
  write('checks/' + strip + '-f' + k + '-9px.png', tiny);
  place(tinySheet, tiny, k * 64, 0);
}
write('checks/' + strip + '-9px.png', tinySheet);
const enlarged=new PNG({width:1536,height:192});
for(let y=0;y<192;y++)for(let x=0;x<1536;x++){
 const src=(Math.floor(y/6)*256+Math.floor(x/6))*4,dst=(y*1536+x)*4;
 tinySheet.data.copy(enlarged.data,dst,src,src+4);
}
write('checks/'+strip+'-9px-6x.png',enlarged);
const medium=new PNG({width:256,height:64});
for(let k=0;k<4;k++) {
 const frame=paintings[k];
 // Portrait alpha is cleaned once; direct area integration preserves tiny-frame antialiasing.
 place(medium,resample(frame.png,64,64,frame.factor*36/360,frame.sourceAnchor,[32,56]),k*64,0);
}
write('checks/'+strip+'-36px.png',medium);
const html =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>' +
  strip +
  '9px cycle check</title><style>body{background:#78804c;color:#e4d5b5;font:16px system-ui}canvas{image-rendering:pixelated}.zoom{width:512px;height:256px}</style><p>' +
  strip +
  ' · 9px native and8× magnification</p><canvas id="native" width="64" height="32"></canvas><canvas id="zoom" class="zoom" width="64" height="32"></canvas><p><button id="pause">Pause</button><span id="phase"></span></p><img src="' +
  strip +
  '-contact-overlay.png" alt="f0 over f2 at50percent opacity"><script>let paused=false,frame=0;const image=new Image();image.src="' +
  strip +
  '-9px.png";function draw(){for(const id of ["native","zoom"]){const c=document.getElementById(id).getContext("2d");c.clearRect(0,0,64,32);if(image.complete&&image.naturalWidth)c.drawImage(image,frame*64,0,64,32,0,0,64,32)}document.getElementById("phase").textContent=" f"+frame}document.getElementById("pause").onclick=()=>{paused=!paused};setInterval(()=>{if(!paused)frame=(frame+1)%4;draw()},240)</script></html>';
fs.mkdirSync(path.join(root, 'checks'), { recursive: true });
fs.writeFileSync(path.join(root, 'checks', strip + '-playback.html'), html);
console.log(JSON.stringify(prompts.redoStrips[strip]));
