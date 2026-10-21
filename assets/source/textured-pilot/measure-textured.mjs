import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { pictureOf } from '../../../tools/building-check.mjs';

const ROOT = 'assets/source/textured-pilot';
export function png(path) {
  return PNG.sync.read(readFileSync(path));
}
function maskOf(p) {
  return Uint8Array.from({ length: p.width * p.height }, (_, i) =>
    p.data[i * 4 + 3] > 128 ? 1 : 0,
  );
}
function bounds(m, w, h) {
  let l = w,
    t = h,
    r = -1,
    b = -1,
    area = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x]) {
        l = Math.min(l, x);
        r = Math.max(r, x);
        t = Math.min(t, y);
        b = Math.max(b, y);
        area++;
      }
  return {
    box: [l, t, r, b],
    area,
    width: r - l + 1,
    height: b - t + 1,
    overallRatio: (b - t + 1) / (r - l + 1),
  };
}
function fill(m, w, h) {
  const seen = new Uint8Array(m.length),
    q = new Int32Array(m.length);
  let n = 0,
    k = 0;
  const add = (i) => {
    if (!m[i] && !seen[i]) {
      seen[i] = 1;
      q[n++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  while (k < n) {
    const i = q[k++],
      x = i % w;
    if (x > 0) add(i - 1);
    if (x < w - 1) add(i + 1);
    if (i >= w) add(i - w);
    if (i < (h - 1) * w) add(i + w);
  }
  return Uint8Array.from(m, (v, i) => (v || !seen[i] ? 1 : 0));
}
function edt(m, w, h, value) {
  const d = new Float64Array(m.length),
    out = new Float64Array(m.length),
    max = Math.max(w, h),
    f = new Float64Array(max),
    z = new Float64Array(max + 1),
    v = new Int32Array(max),
    tmp = new Float64Array(max);
  function line(n) {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      tmp[q] = (q - v[k]) ** 2 + f[v[k]];
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = m[y * w + x] === value ? 0 : 1e12;
    line(h);
    for (let y = 0; y < h; y++) d[y * w + x] = tmp[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    line(w);
    for (let x = 0; x < w; x++) out[y * w + x] = tmp[x];
  }
  return out;
}
function opening(m, w, h, r) {
  const d = edt(m, w, h, 0),
    eroded = Uint8Array.from(m, (a, i) => (a && d[i] > r * r ? 1 : 0)),
    e = edt(eroded, w, h, 1);
  return Uint8Array.from(e, (a) => (a <= r * r ? 1 : 0));
}
function polygonMask(polys, w, h, s) {
  const m = new Uint8Array(w * h);
  if (typeof polys[0][0] === 'number') polys = [polys];
  for (const poly of polys) {
    for (let y = 0; y < h; y++) {
      let cross = [];
      const yy = (y + 0.5) / s;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j],
          b = poly[i];
        if (a[1] > yy !== b[1] > yy)
          cross.push((a[0] + ((yy - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) * s);
      }
      cross.sort((a, b) => a - b);
      for (let k = 0; k + 1 < cross.length; k += 2)
        for (
          let x = Math.max(0, Math.ceil(cross[k] - 0.5));
          x < Math.min(w, Math.ceil(cross[k + 1] - 0.5));
          x++
        )
          m[y * w + x] = 1;
    }
  }
  return m;
}
function boundary(m, w, h) {
  const a = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w])) a[i] = 1;
    }
  return a;
}
function fit(source, w, h, target, tw, th) {
  const sb = bounds(source, w, h),
    tb = bounds(target, tw, th);
  let best = { score: -1, f: 1, dx: 0, dy: 0 };
  function scorer(step) {
    const points = [];
    let ta = 0,
      sa = 0;
    for (let y = Math.floor(step / 2); y < th; y += step)
      for (let x = Math.floor(step / 2); x < tw; x += step)
        if (target[y * tw + x]) {
          points.push(x, y);
          ta++;
        }
    for (let y = Math.floor(step / 2); y < h; y += step)
      for (let x = Math.floor(step / 2); x < w; x += step) sa += source[y * w + x];
    return (f, dx, dy) => {
      let inter = 0;
      for (let i = 0; i < points.length; i += 2) {
        const x = Math.floor((points[i] - dx) / f),
          y = Math.floor((points[i + 1] - dy) / f);
        if (x >= 0 && y >= 0 && x < w && y < h) inter += source[y * w + x];
      }
      return inter / (ta + sa * f * f - inter);
    };
  }
  let score = scorer(6);
  const tryFit = (f, dx, dy) => {
    if (f < 0.85 - 1e-8 || f > 1.15 + 1e-8) return;
    const s = score(f, dx, dy);
    if (s > best.score) best = { score: s, f, dx, dy };
  };
  const scx = (sb.box[0] + sb.box[2]) / 2,
    scy = (sb.box[1] + sb.box[3]) / 2,
    tcx = (tb.box[0] + tb.box[2]) / 2,
    tcy = (tb.box[1] + tb.box[3]) / 2;
  for (let k = 0; k <= 30; k++) {
    const f = 0.85 + k * 0.01,
      dx = tcx - scx * f,
      dy = tcy - scy * f;
    for (let x = -36; x <= 36; x += 12)
      for (let y = -36; y <= 36; y += 12) tryFit(f, dx + x, dy + y);
  }
  for (const [fs, ds, step] of [
    [0.003, 3, 4],
    [0.001, 1, 2],
  ]) {
    score = scorer(step);
    const old = { ...best };
    best.score = -1;
    for (let k = -4; k <= 4; k++)
      for (let x = -3; x <= 3; x++)
        for (let y = -3; y <= 3; y++) tryFit(old.f + k * fs, old.dx + x * ds, old.dy + y * ds);
  }
  return best;
}
function compare(source, w, h, target, tw, th, f, dx, dy, s0) {
  const pad = 32,
    l = Math.floor(Math.min(0, dx)) - pad,
    t = Math.floor(Math.min(0, dy)) - pad,
    r = Math.ceil(Math.max(tw, dx + w * f)) + pad,
    b = Math.ceil(Math.max(th, dy + h * f)) + pad,
    W = r - l,
    H = b - t;
  const a = new Uint8Array(W * H),
    c = new Uint8Array(W * H);
  let union = 0,
    inter = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const xx = x + l,
        yy = y + t,
        sx = Math.floor((xx - dx) / f),
        sy = Math.floor((yy - dy) / f),
        ai = y * W + x;
      a[ai] = xx >= 0 && yy >= 0 && xx < tw && yy < th ? target[yy * tw + xx] : 0;
      c[ai] = sx >= 0 && sy >= 0 && sx < w && sy < h ? source[sy * w + sx] : 0;
      union += a[ai] || c[ai];
      inter += a[ai] && c[ai];
    }
  const ba = boundary(a, W, H),
    bc = boundary(c, W, H),
    da = edt(ba, W, H, 1),
    dc = edt(bc, W, H, 1),
    ac = [],
    ca = [];
  let worstPicture = { distance: -1 },
    worstRender = { distance: -1 };
  for (let i = 0; i < a.length; i++) {
    const point = [((i % W) + l) / s0, (Math.floor(i / W) + t) / s0];
    if (bc[i]) {
      const d = Math.sqrt(da[i]) / (s0 * f);
      ca.push(d);
      if (d > worstPicture.distance) worstPicture = { distance: d, point };
    }
    if (ba[i]) {
      const d = Math.sqrt(dc[i]) / (s0 * f);
      ac.push(d);
      if (d > worstRender.distance) worstRender = { distance: d, point };
    }
  }
  ac.sort((a, b) => a - b);
  ca.sort((a, b) => a - b);
  return {
    iou: inter / union,
    p95PictureToRender: ca[Math.ceil(0.95 * ca.length) - 1],
    p95RenderToPicture: ac[Math.ceil(0.95 * ac.length) - 1],
    maximum: Math.max(ca.at(-1), ac.at(-1)),
    boundarySamples: [ca.length, ac.length],
    worstPicture,
    worstRender,
  };
}
function reports(p) {
  let white = 0,
    amber = 0;
  for (let i = 0; i < p.data.length; i += 4)
    if (p.data[i + 3] > 128) {
      let r = p.data[i],
        g = p.data[i + 1],
        b = p.data[i + 2];
      if (r >= 236 && g >= 228 && b >= 208) white++;
      if (Math.hypot(r - 232, g - 170, b - 72) <= 12) amber++;
    }
  return { nearWhite: white, nearAmber: amber };
}
function wallMean(p, box) {
  if (!box) return null;
  let sum = 0,
    n = 0;
  for (let y = Math.max(0, Math.round(box[1])); y < Math.min(p.height, box[3]); y++)
    for (let x = Math.max(0, Math.round(box[0])); x < Math.min(p.width, box[2]); x++) {
      const i = (y * p.width + x) * 4;
      if (p.data[i + 3] > 128) {
        sum += 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
        n++;
      }
    }
  return n ? sum / n : null;
}
export function measure(file, job, view, eye = {}) {
  const j = JSON.parse(readFileSync(`../scaffolds-textured/${job}-r${view}.json`)),
    p = png(file),
    bare = png(`../scaffolds-textured/${job}-r${view}-bare.png`),
    original = png(`../originals-textured/${job}.png`),
    s0 = p.width / j.canvas[0];
  // pictureOf parses file names rather than reading alpha; this job's custom names return null.
  const nameMetadata = pictureOf(file),
    raw = maskOf(p),
    sb = bounds(raw, p.width, p.height),
    bb = bounds(maskOf(bare), bare.width, bare.height),
    source = opening(fill(raw, p.width, p.height), p.width, p.height, 2 * s0),
    tw = p.width,
    th = Math.round(j.canvas[1] * s0),
    target = polygonMask(j.outline_polygon_px, tw, th, s0);
  const best = fit(source, p.width, p.height, target, tw, th),
    initial = compare(source, p.width, p.height, target, tw, th, 1, 0, 0, s0),
    final = compare(source, p.width, p.height, target, tw, th, best.f, best.dx, best.dy, s0);
  const baseWidth = eye.baseWidth ?? null,
    renderBaseWidth = j.model_base_px.e[0] - j.model_base_px.w[0],
    wall = eye.wallRatio ?? null,
    renderWall = eye.renderWallRatio ?? null,
    wholeRelative = sb.overallRatio / bb.overallRatio - 1;
  return {
    file,
    job,
    view,
    returned: [p.width, p.height],
    s0,
    nameMetadata,
    opaque: sb,
    bareOpaque: bb,
    silhouette: {
      iouAtS0: initial.iou,
      f: best.f,
      dx: best.dx,
      dy: best.dy,
      bestIoU: final.iou,
      p95PictureToRender: final.p95PictureToRender,
      p95RenderToPicture: final.p95RenderToPicture,
      maximum: final.maximum,
      boundarySamples: final.boundarySamples,
      worstPicture: final.worstPicture,
      worstRender: final.worstRender,
      pass:
        final.iou >= 0.92 &&
        final.p95PictureToRender <= 16 &&
        final.p95RenderToPicture <= 16 &&
        final.maximum <= 32,
    },
    height: {
      wall,
      renderWall,
      wallRelativeDifference: wall !== null && renderWall ? wall / renderWall - 1 : null,
      overall: sb.overallRatio,
      renderOverall: bb.overallRatio,
      overallRelativeDifference: wholeRelative,
      wallPass: wall !== null && renderWall ? Math.abs(wall / renderWall - 1) <= 0.08 : null,
      overallPass: Math.abs(wholeRelative) <= 0.08,
    },
    base: {
      width: baseWidth,
      renderWidth: renderBaseWidth,
      heldWidthAtReturned: renderBaseWidth * s0,
      k: baseWidth ? (renderBaseWidth * s0) / baseWidth : null,
    },
    highlights: reports(p),
    originalHighlights: reports(original),
    wallLight: {
      left: wallMean(p, eye.leftBox),
      right: wallMean(p, eye.rightBox),
      boxes: [eye.leftBox ?? null, eye.rightBox ?? null],
    },
  };
}
export function prepare(job, view, attempt, renderReference, correction = '') {
  const src = readFileSync('G:/DEV/wt/codex-queue/codex-queue/prompts/TB1.md', 'utf8'),
    names = { warehouse: 'Warehouse', pump: 'Water pump', power_plant: 'Power plant' },
    name = names[job];
  const a = src.match(/PART A:\r?\n\r?\n"([\s\S]*?)"\r?\n\r?\nPART B/)[1],
    c = src.match(/PART C:\r?\n\r?\n"([\s\S]*?)"\r?\n\r?\nTHE MEASURING/)[1];
  const building = src
    .split(/\r?\n/)
    .find((l) => l.startsWith('- ' + name + ' (originals-textured/'))
    .split('): ')[1];
  const views = src
      .split(/\r?\n/)
      .find((l) => l.startsWith(name + '. r0:'))
      .slice(name.length + 2),
    line = views.match(new RegExp('r' + view + ': ([\\s\\S]*?)(?= r[0-3]:|$)'))[1];
  const refMatch = src.match(
    /References: the first is the textured render, the picture to paint over: ([\s\S]*?)\[r1, r2, r3 only: ([\s\S]*?)\]/,
  );
  const root = `${ROOT}/${job}`;
  mkdirSync(root + '/raw', { recursive: true });
  const file = root + '/prompts.json',
    data = existsSync(file)
      ? JSON.parse(readFileSync(file))
      : { job, renderReference: {}, attempts: [] };
  if (renderReference) data.renderReference['r' + view] = renderReference;
  const references = [
    `G:/DEV/wt/scaffolds-textured/${job}-r${view}-textured.png`,
    `G:/DEV/wt/originals-textured/${job}.png`,
  ];
  const r0 = data.attempts.some((a) => a.view === 0 && a.kept === true);
  if (view && r0) references.push(`G:/DEV/wt/codex-textured-pilot/${root}/${job}-r0.png`);
  let ref =
    'References: the first is the textured render, the picture to paint over: ' +
    refMatch[1].trim();
  if (view && r0) ref += ' ' + refMatch[2];
  const b = `View. The building is the ${name} in the view r${view}. ${building} r${view}: ${line} Every part the first picture shows stands where the first picture puts it: paint it as shown, and do not add what the first picture does not carry.\n\n${ref}`;
  let prompt = a + '\n\n' + b + '\n\n' + c;
  if (correction) prompt += '\n\nCorrection: ' + correction;
  const size = job === 'power_plant' ? '1536 x 1024' : '1024 x 1024';
  prompt += `\n\nOutput: ${size} pixels, real RGBA PNG, transparent background.`;
  const call = { building: job, view, attempt, prompt, references };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  writeFileSync(
    'G:/DEV/wt/codex-tmp/textured-pilot/pending-call.json',
    JSON.stringify(call, null, 2),
  );
  return call;
}
export function record(eye, eyeTests, kept, note = '') {
  const call = JSON.parse(readFileSync('G:/DEV/wt/codex-tmp/textured-pilot/pending-call.json')),
    job = call.building,
    view = call.view,
    attempt = call.attempt,
    root = `${ROOT}/${job}`,
    raw = `raw/${job}-r${view}-attempt-${attempt}.png`,
    data = JSON.parse(readFileSync(root + '/prompts.json'));
  if (data.attempts.some((a) => a.view === view && a.attempt === attempt))
    throw Error('Attempt already recorded; never overwrite');
  const m = measure(root + '/' + raw, job, view, eye);
  m.eye = eye;
  m.eyeTests = eyeTests;
  const allMachine = m.silhouette.pass && m.height.wallPass && m.height.overallPass;
  if (
    kept &&
    (!allMachine ||
      !eyeTests.sameBuilding ||
      !eyeTests.coherentPainting ||
      !eyeTests.light ||
      !eyeTests.noExtras)
  )
    throw Error('Cannot accept failed test');
  data.attempts.push({
    ...call,
    file: raw,
    returned: m.returned,
    measured: m,
    kept,
    note,
    sha256: createHash('sha256')
      .update(readFileSync(root + '/' + raw))
      .digest('hex'),
  });
  if (kept) {
    const out = `${root}/${job}-r${view}.png`;
    if (existsSync(out)) throw Error('Accepted file exists; no overwrite');
    copyFileSync(root + '/' + raw, out);
  }
  writeFileSync(root + '/prompts.json', JSON.stringify(data, null, 2) + '\n');
  return m;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [job, v, file, eyePath, outPath] = process.argv.slice(2);
  const eye = eyePath ? JSON.parse(readFileSync(eyePath)) : {};
  const result = measure(file, job, Number(v), eye);
  if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
