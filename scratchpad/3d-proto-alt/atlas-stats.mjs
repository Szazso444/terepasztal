import fs from 'node:fs';
const sets = ['rolling', 'rolling-now', 'rolling-A', 'rolling-B', 'structures', 'terrain', 'terrain-surfaces', 'props', 'bridges', 'icons'];
const pngDims = (p) => { const b = fs.readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20), b.length]; };
const res = {};
for (const s of sets) {
  const [w, h, bytes] = pngDims(`public/assets/${s}.png`);
  const j = JSON.parse(fs.readFileSync(`public/assets/${s}.json`, 'utf8'));
  const frames = Object.entries(j.frames);
  const area = frames.reduce((a, [, f]) => a + f.w * f.h, 0);
  console.log(s.padEnd(18), `${w}x${h}`, 'png', (bytes / 1048576).toFixed(2), 'MB', 'gpu RGBA8', (w * h * 4 / 1048576).toFixed(1), 'MB (+33% mips', (w * h * 4 * 4 / 3 / 1048576).toFixed(1), ') frames', frames.length, 'fill', (area / (w * h) * 100).toFixed(0) + '%', 'resolution', j.resolution, 'partial', j.partial);
  if (s.startsWith('rolling-')) {
    const per = {};
    for (const [k, f] of frames) {
      const m = k.match(/^rolling\/loco_(.+)_(engine|tender|body|cradle|frame|nose|centre)_f(\d+)$/);
      const id = m ? m[1] : k.replace(/_f\d+$/, '');
      const o = (per[id] ??= { n: 0, area: 0, maxW: 0, maxH: 0, parts: new Set() });
      o.n++; o.area += f.w * f.h; o.maxW = Math.max(o.maxW, f.w); o.maxH = Math.max(o.maxH, f.h); if (m) o.parts.add(m[2]);
    }
    res[s] = per;
    const ids = Object.keys(per);
    console.log('  ids', ids.length);
    for (const id of ids) console.log('   ', id.padEnd(28), 'frames', String(per[id].n).padStart(3), 'parts', [...per[id].parts].join('+').padEnd(14), 'area', (per[id].area / 1e6).toFixed(2), 'Mpx', 'max', per[id].maxW + 'x' + per[id].maxH);
  }
}
