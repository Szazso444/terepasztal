// The depot's pictures as the tools see them today: the camera of each, and what the list says of it.
//   node gate_measure.mjs <buildings-v2 folder> [family] [footprint] > gate-depot.json
import { readFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  cameraOff,
  fitPicture,
} from 'file:///C:/Users/Zso/terepasztal-buildings/tools/building-fit.mjs';

const root = process.argv[2];
const queue = JSON.parse(readFileSync(`${root}/queue.json`, 'utf8'));
const out = {};
for (const e of queue.entries.filter((x) => x.family === (process.argv[3] ?? 'depot'))) {
  const file = `${root}/${e.family}/${e.id}.png`;
  const row = { status: e.status, attempts: e.attempts, kept: e.kept ?? null, note: e.note };
  if (existsSync(file)) {
    const fit = fitPicture(PNG.sync.read(readFileSync(file)), process.argv[4] ?? 't2x2', e.rot);
    const off = fit && cameraOff(fit);
    row.camera = fit?.camera ?? null;
    row.by = off?.by ?? null;
    row.vertical = fit?.vertical ?? null;
    row.measured = fit?.measured ?? null;
  }
  out[e.id] = row;
}
console.log(JSON.stringify(out, null, 1));
