/** Build high-resolution, partial atlas overrides from the approved source library.
 * node tools/illustrated-sprites.mjs [output directory]
 * Uses pngjs (existing dev dependency); no model call or runtime dependency.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { smoothPng } from './pixel-art.mjs';

const DENSITY = 4;
const SOURCE = 'assets/source/base-v1';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

/** Remove only the low-alpha glow; keep coverage at the object's antialiased edge. */
export function trimSource(input) {
  const p = new PNG({ width: input.width, height: input.height });
  input.data.copy(p.data);
  let left = p.width,
    top = p.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      const alpha = p.data[i + 3];
      // The source studies have a detached alpha 1–60 glow. A ramp avoids a hard binary cut.
      p.data[i + 3] = alpha <= 64 ? 0 : Math.round((255 * (alpha - 64)) / 191);
      if (!p.data[i + 3]) {
        p.data[i] = p.data[i + 1] = p.data[i + 2] = 0;
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  if (right < left) throw new Error('Source is empty after glow removal');
  const out = new PNG({ width: right - left + 1, height: bottom - top + 1 });
  for (let y = 0; y < out.height; y++)
    p.data.copy(
      out.data,
      y * out.width * 4,
      ((y + top) * p.width + left) * 4,
      ((y + top) * p.width + right + 1) * 4,
    );
  return out;
}

/** Exact area resampling in premultiplied alpha; preserve partial pixel coverage. */
export function resample(src, width, height) {
  const out = new PNG({ width, height });
  const sx = src.width / width,
    sy = src.height / height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let a = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let yy = Math.floor(y * sy); yy < Math.ceil((y + 1) * sy); yy++) {
        const wy = Math.min(yy + 1, (y + 1) * sy) - Math.max(yy, y * sy);
        for (let xx = Math.floor(x * sx); xx < Math.ceil((x + 1) * sx); xx++) {
          if (xx >= src.width || yy >= src.height) continue;
          const w = wy * (Math.min(xx + 1, (x + 1) * sx) - Math.max(xx, x * sx));
          const i = (yy * src.width + xx) * 4,
            alpha = (src.data[i + 3] / 255) * w;
          a += alpha;
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
        }
      }
      const i = (y * width + x) * 4;
      if (a > 0) {
        out.data[i] = Math.round(r / a);
        out.data[i + 1] = Math.round(g / a);
        out.data[i + 2] = Math.round(b / a);
        out.data[i + 3] = Math.round((255 * a) / (sx * sy));
      }
    }
  return out;
}

function samplePixel(src, x, y) {
  x = Math.max(0, Math.min(src.width - 1, x));
  y = Math.max(0, Math.min(src.height - 1, y));
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const result = [0, 0, 0, 0];
  for (const [xx, wx] of [
    [x0, 1 - (x - x0)],
    [Math.min(src.width - 1, x0 + 1), x - x0],
  ])
    for (const [yy, wy] of [
      [y0, 1 - (y - y0)],
      [Math.min(src.height - 1, y0 + 1), y - y0],
    ]) {
      const i = (yy * src.width + xx) * 4,
        a = (src.data[i + 3] / 255) * wx * wy;
      for (let c = 0; c < 3; c++) result[c] += src.data[i + c] * a;
      result[3] += a;
    }
  if (result[3]) for (let c = 0; c < 3; c++) result[c] /= result[3];
  result[3] *= 255;
  return result;
}

/** Rectify the two measured horizontal building axes to screen slopes +1/2 and -1/2.
 * Vertical edges stay vertical. This is a 2D camera correction, not invented back-face art.
 */
export function projectionMatrix(positiveSlope, negativeSlope) {
  if (!(positiveSlope > 0 && negativeSlope < 0)) throw new Error('Need two opposite ground axes');
  const vertical = 1 / (positiveSlope - negativeSlope);
  return { vertical, shear: (-(positiveSlope + negativeSlope) * vertical) / 2 };
}

export function rectifyProjection(src, positiveSlope, negativeSlope) {
  const { vertical, shear } = projectionMatrix(positiveSlope, negativeSlope);
  const offset = Math.min(0, shear * (src.width - 1));
  const out = new PNG({
    width: src.width,
    height: Math.ceil(vertical * src.height + Math.abs(shear) * src.width),
  });
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const sy = (y + offset - shear * x) / vertical;
      if (sy < 0 || sy > src.height - 1) continue;
      const c = samplePixel(src, x, sy),
        i = (y * out.width + x) * 4;
      for (let k = 0; k < 4; k++) out.data[i + k] = Math.round(c[k]);
    }
  return out;
}

/** Map the painted top face directly: retain tufts, stones and water highlights. */
export function groundTile(src, variant = 0, density = DENSITY) {
  const w = 64 * density,
    h = 32 * density,
    out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2),
        dy = (y + 0.5 - h / 2) / (h / 2);
      // Slightly overlap diagonal tile edges so linear filtering cannot reveal hairline gaps.
      if (Math.abs(dx) + Math.abs(dy) > 1 + 6 / h) continue;
      const u = Math.max(0, Math.min(1, (dx + dy + 1) / 2));
      const v = Math.max(0, Math.min(1, (dy - dx + 1) / 2));
      // Small interior variation leaves the boundary fixed. No folding or palette replacement.
      const inner = Math.sin(Math.PI * u) ** 2 * Math.sin(Math.PI * v) ** 2;
      const su = u + Math.sin(variant * 2.4) * 0.018 * inner;
      const sv = v + Math.cos(variant * 2.4) * 0.018 * inner;
      const c = samplePixel(
        src,
        src.width * (0.5 + (su - sv) * 0.475),
        src.height * (0.475 + (su + sv - 1) * 0.445),
      );
      const o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) out.data[o + k] = Math.round(c[k]);
      out.data[o + 3] = 255;
    }
  return out;
}

/** Dedupe repeated variant/level frames, then pack with extruded gutters for linear filtering. */
export function packFrames(frames, max = 4096) {
  const unique = new Map(),
    placed = [];
  for (const f of frames) {
    const hash = createHash('sha256')
      .update(`${f.png.width}x${f.png.height}:`)
      .update(f.png.data)
      .digest('hex');
    if (!unique.has(hash)) unique.set(hash, { png: f.png, hash });
    f.hash = hash;
  }
  const pad = 4;
  let x = pad,
    y = pad,
    row = 0,
    used = 1;
  for (const it of [...unique.values()].sort(
    (a, b) => b.png.height - a.png.height || a.hash.localeCompare(b.hash),
  )) {
    if (it.png.width + 2 * pad > max) throw new Error('Frame exceeds atlas width');
    if (x + it.png.width + pad > max) {
      x = pad;
      y += row + 2 * pad;
      row = 0;
    }
    it.x = x;
    it.y = y;
    placed.push(it);
    x += it.png.width + 2 * pad;
    row = Math.max(row, it.png.height);
    used = Math.max(used, x);
  }
  const height = y + row + pad;
  if (height > max) throw new Error(`Atlas ${height}px tall exceeds ${max}px; split the group`);
  const sheet = new PNG({ width: Math.min(max, used), height });
  for (const it of placed)
    for (let yy = -pad; yy < it.png.height + pad; yy++)
      for (let xx = -pad; xx < it.png.width + pad; xx++) {
        const sx = Math.max(0, Math.min(it.png.width - 1, xx)),
          sy = Math.max(0, Math.min(it.png.height - 1, yy));
        const i = (sy * it.png.width + sx) * 4,
          o = ((it.y + yy) * sheet.width + it.x + xx) * 4;
        it.png.data.copy(sheet.data, o, i, i + 4);
      }
  const definitions = {};
  for (const f of frames) {
    const it = unique.get(f.hash);
    definitions[f.key] = { x: it.x, y: it.y, w: f.png.width, h: f.png.height, ax: f.ax, ay: f.ay };
  }
  return { sheet, frames: definitions, unique: unique.size };
}

function targets(entry, inventory) {
  const [cat, ...parts] = entry.id.split('.');
  const name = parts.join('.');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern;
  if (cat === 'props') pattern = new RegExp(`^props/${escaped}_\\d+$`);
  if (cat === 'cargo') pattern = new RegExp(`^icons/${escaped}$`);
  if (
    cat === 'terrain' &&
    [
      'grass',
      'forest',
      'rock',
      'hillcut',
      'sand',
      'plains',
      'taiga',
      'swamp',
      'desert',
      'hill',
      'mountain',
    ].includes(name)
  )
    pattern = new RegExp(`^terrain/${name}_\\d+$`);
  if (cat === 'terrain' && name === 'water') pattern = /^terrain\/water_\d+_f\d+$/;
  if (cat === 'stations' && name !== 'depot' && !name.startsWith('full.'))
    pattern = new RegExp(`^structures/${escaped}_\\d+$`);
  if (cat === 'works' && !name.startsWith('bridge_'))
    pattern = new RegExp(`^structures/${name.replace(/^full\./, '')}(_lv\\d+)?$`);
  if (cat === 'decor' && name === 'townhouse') pattern = /^structures\/townhouse(_\d+|_s\d+)?$/;
  if (cat === 'decor' && ['water_tower', 'fuel_stop'].includes(name))
    pattern = new RegExp(`^structures/${name}$`);
  return pattern ? inventory.filter((f) => pattern.test(f.key)) : [];
}

const smoothedSources = new Map();
/** Ground sources smoothed once each, as tools/terrain-surfaces.mjs does for the painter. */
function smoothedGround(src, key) {
  if (!smoothedSources.has(key)) {
    const copy = new PNG({ width: src.width, height: src.height });
    src.data.copy(copy.data);
    smoothedSources.set(key, smoothPng(copy, 3));
  }
  return smoothedSources.get(key);
}

export function build(output = 'public/assets') {
  const inventory = readJson('docs/art-direction/frame-inventory.json');
  const coverage = readJson(join(SOURCE, 'coverage.json'));
  const groups = new Map(),
    claimed = new Set(),
    report = {
      resolution: DENSITY,
      sourceDirectory: SOURCE,
      converted: [],
      deferred: [],
      groups: {},
    };
  for (const entry of Object.values(coverage.categories).flat()) {
    const matches = targets(entry, inventory);
    if (!matches.length) {
      report.deferred.push({
        id: entry.id,
        reason:
          'Requires directional, layered, animated, semantic or connection-specific art; retain working procedural frames.',
      });
      continue;
    }
    const filename = entry.generated?.[0];
    if (!filename) throw new Error(`Missing source: ${entry.id}`);
    let src = trimSource(PNG.sync.read(readFileSync(join(SOURCE, filename))));
    const originalWidth = src.width;
    if (entry.id === 'decor.water_tower')
      src = trimSource(
        PNG.sync.read(readFileSync('assets/source/cozy-v3/water-tower-tall-v2.png')),
      );
    // Ground-axis slopes measured from the source contact sheet (wall bases/eaves, not roof pitches).
    const measured = {
      'stations.station': [0.31, -0.39],
      'decor.townhouse': [0.33, -0.38],
      'stations.town': [0.25, -0.49],
      'stations.warehouse': [0.26, -0.37],
      'stations.lumber': [0.29, -0.41],
      'stations.farm': [0.39, -0.28],
    };
    const projection =
      matches[0].group === 'structures' &&
      !['works.windmill', 'works.kiln', 'decor.water_tower'].includes(entry.id)
        ? (measured[entry.id] ?? [0.3, -0.38])
        : null;
    if (projection) src = rectifyProjection(src, ...projection);
    const cache = new Map(),
      names = [];
    for (const f of matches) {
      const variantSource = {
        'props.tree': 'tree-round-v2.png',
        'props.oak': 'tree-oak-v2.png',
        'props.spruce': 'tree-spruce-v2.png',
      }[entry.id];
      const variant = Number(f.key.match(/_(\d+)$/)?.[1] ?? 0);
      const frameSource =
        variantSource && variant > 0
          ? trimSource(PNG.sync.read(readFileSync(join('assets/source/cozy-v3', variantSource))))
          : src;
      if (claimed.has(f.key)) throw new Error(`Conflicting source assignment: ${f.key}`);
      claimed.add(f.key);
      const isGround = f.group === 'terrain' && !/^terrain\/(hill|mountain)_/.test(f.key);
      let png, ax, ay;
      if (isGround) {
        const water = f.key.match(/^terrain\/water_(\d+)_f(\d+)$/);
        const variant = water
          ? Number(water[1]) + Math.sin((Number(water[2]) * Math.PI) / 2) * 0.03
          : Number(f.key.match(/_(\d+)$/)[1]);
        // Fallback ground tiles match the smoothed painter surfaces.
        png = groundTile(smoothedGround(src, filename), variant);
        ax = 32 * DENSITY;
        ay = 16 * DENSITY;
      } else {
        // Preserve horizontal footprint, and allow the source's taller silhouette up to 1.35x.
        const scale =
          entry.id === 'decor.water_tower'
            ? // Tank diameter stays constant; the longer supporting piers increase height.
              f.width / Math.max(originalWidth, frameSource.width)
            : Math.min(
                f.width / frameSource.width,
                (f.height * (projection ? 1.8 : 1.35)) / frameSource.height,
              );
        const w = Math.max(1, Math.round(frameSource.width * scale * DENSITY));
        const h = Math.max(1, Math.round(frameSource.height * scale * DENSITY));
        const size = `${w}x${h}:${variantSource && variant > 0 ? variantSource : filename}`;
        if (!cache.has(size)) cache.set(size, resample(frameSource, w, h));
        png = cache.get(size);
        if (f.group === 'icons') {
          ax = w / 2;
          ay = h / 2;
        } else {
          ax = (w * f.anchorX) / f.width;
          ay = h - ((f.height - f.anchorY) * w) / f.width;
        }
        if (f.group !== 'icons') {
          // Approved station formula: screen width +20%, height and ground position unchanged.
          const wider = Math.round(png.width * 1.2);
          ax *= wider / png.width;
          png = resample(png, wider, png.height);
        }
        // Nature is pixel art; round its steps into the painted style of trains and buildings.
        if (f.group === 'props') png = smoothPng(png, 2);
      }
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push({ key: f.key, png, ax, ay });
      names.push(f.key);
    }
    report.converted.push({
      id: entry.id,
      source: filename,
      widthScale: matches[0].group === 'icons' || matches[0].group === 'terrain' ? 1 : 1.2,
      projection: projection
        ? {
            sourceSlopes: projection,
            ...projectionMatrix(...projection),
            estimated: !measured[entry.id],
          }
        : null,
      frames: names,
    });
  }
  mkdirSync(output, { recursive: true });
  for (const [name, frames] of groups) {
    const packed = packFrames(frames);
    writeFileSync(join(output, `${name}.png`), PNG.sync.write(packed.sheet));
    writeFileSync(
      join(output, `${name}.json`),
      JSON.stringify({ resolution: DENSITY, partial: true, frames: packed.frames }, null, 2) + '\n',
    );
    report.groups[name] = {
      frames: frames.length,
      uniqueImages: packed.unique,
      width: packed.sheet.width,
      height: packed.sheet.height,
    };
  }
  writeFileSync(join(output, 'illustrated-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      convertedSources: report.converted.length,
      deferredSources: report.deferred.length,
      groups: report.groups,
    }),
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  build(process.argv[2]);
