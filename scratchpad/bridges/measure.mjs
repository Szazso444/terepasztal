// Measures every packed kit frame against the 2:1 tile it stands for (world px, relative to the
// frame's anchor): silhouette slopes, extents, and where the ends of each long edge fall.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const json = JSON.parse(readFileSync('public/assets/bridges.json', 'utf8'));
const png = PNG.sync.read(readFileSync('public/assets/bridges.png'));
const D = json.resolution;
const kit = JSON.parse(readFileSync('src/render/bridgeKit.json', 'utf8'));
const A = (x, y) => png.data[(y * png.width + x) * 4 + 3];
function fit(pts) {
  const n = pts.length,
    sx = pts.reduce((a, p) => a + p[0], 0) / n,
    sy = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0,
    sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - sx) ** 2;
    sxy += (x - sx) * (y - sy);
  }
  const m = sxy / sxx,
    b = sy - m * sx,
    rms = Math.sqrt(pts.reduce((a, [x, y]) => a + (y - (m * x + b)) ** 2, 0) / n);
  return { m, b, rms };
}
const out = {};
for (const [key, f] of Object.entries(json.frames)) {
  const name = key.split('/')[1];
  // per-column top and bottom opaque rows, in world px relative to the anchor
  const cols = [];
  for (let x = 0; x < f.w; x++) {
    let top = -1,
      bot = -1;
    for (let y = 0; y < f.h; y++)
      if (A(f.x + x, f.y + y) > 128) {
        if (top < 0) top = y;
        bot = y;
      }
    if (top >= 0) cols.push({ x: (x + 0.5 - f.ax) / D, top: (top - f.ay) / D, bot: (bot + 1 - f.ay) / D });
  }
  const left = cols[0].x,
    right = cols[cols.length - 1].x,
    topMost = Math.min(...cols.map((c) => c.top)),
    botMost = Math.max(...cols.map((c) => c.bot));
  const r = (v) => Math.round(v * 100) / 100;
  const o = { size: [f.w / D, f.h / D], x: [r(left), r(right)], y: [r(topMost), r(botMost)], kit: kit[name] };
  const seg = (a, b, side) => {
    const pts = cols.filter((c) => c.x >= a && c.x <= b).map((c) => [c.x, c[side]]);
    const l = fit(pts);
    return { slope: r(l.m), at: (x) => r(l.m * x + l.b), rms: r(l.rms) };
  };
  if (/deck|pad/.test(name)) {
    // bottom silhouette: two lower edges of the slab, each a tile edge + thickness
    const bl = seg(-28, -4, 'bot'),
      br = seg(4, 28, 'bot');
    o.bottomLeft = { slope: bl.slope, 'y@-32': bl.at(-32), 'y@0': bl.at(0), rms: bl.rms, ideal: 'slope 0.5, thickness at -32, 16+thickness at 0' };
    o.bottomRight = { slope: br.slope, 'y@0': br.at(0), 'y@32': br.at(32), rms: br.rms, ideal: 'slope -0.5' };
    o.endColumns = { left: [r(cols[1].top), r(cols[1].bot)], right: [r(cols[cols.length - 2].top), r(cols[cols.length - 2].bot)] };
    if (/pad/.test(name)) {
      const tl = seg(-28, -4, 'top'),
        tr = seg(4, 28, 'top');
      o.topLeft = { slope: tl.slope, 'y@-32': tl.at(-32), 'y@0': tl.at(0) };
      o.topRight = { slope: tr.slope, 'y@0': tr.at(0), 'y@32': tr.at(32) };
    }
  } else if (/-(rail|arch|truss|brace)-/.test(name)) {
    const xdir = name.endsWith('-x');
    // -x walls stand on the left->bottom edge (slope +0.5), -y walls on the bottom->right edge
    const a = xdir ? -28 : 4,
      b = xdir ? -4 : 28;
    const t = seg(a, b, 'top'),
      bo = seg(a, b, 'bot');
    const far = xdir ? -32 : 32;
    o.top = { slope: t.slope, [`y@${far}`]: t.at(far), 'y@0': t.at(0), rms: t.rms };
    o.bottom = { slope: bo.slope, [`y@${far}`]: bo.at(far), 'y@0': bo.at(0), rms: bo.rms, ideal: `slope ${xdir ? 0.5 : -0.5}, foot 0 at ${far}, 16 at 0 (minus what hangs)` };
  } else {
    o.widthPx = r(right - left);
  }
  out[name] = o;
}
console.log(JSON.stringify(out, null, 1));

// ---- joint steps: the same piece on the next tile along the span is offset (+-32, +16) px.
// A long edge drawn at slope m instead of 0.5 leaves a step of 16 - 32|m| px at every joint.
const steps = {};
for (const [key, f] of Object.entries(json.frames)) {
  const name = key.split('/')[1];
  if (!/-(x|y)$/.test(name)) continue;
  const xdir = name.endsWith('-x');
  const cols = [];
  for (let x = 0; x < f.w; x++) {
    let top = -1,
      bot = -1;
    for (let y = 0; y < f.h; y++)
      if (A(f.x + x, f.y + y) > 128) {
        if (top < 0) top = y;
        bot = y;
      }
    if (top >= 0) cols.push([(x + 0.5 - f.ax) / D, (top - f.ay) / D, (bot + 1 - f.ay) / D]);
  }
  const line = (a, b, i) => fit(cols.filter((c) => c[0] >= a && c[0] <= b).map((c) => [c[0], c[i]]));
  const r = (v) => Math.round(v * 100) / 100;
  const rec = {};
  if (/deck/.test(name)) {
    // far long edge: top vertex -> right vertex for x decks, left vertex -> top vertex for y decks
    const far = xdir ? line(4, 28, 1) : line(-28, -4, 1);
    // near long edge (the slab's lower face): left -> bottom for x, bottom -> right for y
    const near = xdir ? line(-28, -4, 2) : line(4, 28, 2);
    rec.farParapetTop = { slope: r(far.m), stepPx: r(16 - 32 * Math.abs(far.m)), rms: r(far.rms) };
    rec.nearSlabBottom = { slope: r(near.m), stepPx: r(16 - 32 * Math.abs(near.m)) };
  } else {
    const t = xdir ? line(-28, -4, 1) : line(4, 28, 1),
      b = xdir ? line(-28, -4, 2) : line(4, 28, 2);
    rec.top = { slope: r(t.m), stepPx: r(16 - 32 * Math.abs(t.m)) };
    rec.bottom = { slope: r(b.m), stepPx: r(16 - 32 * Math.abs(b.m)) };
  }
  steps[name] = rec;
}
console.error(JSON.stringify(steps, null, 1));
