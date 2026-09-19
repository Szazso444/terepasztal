// Runs the illustrated source studies in assets/source/base-v1 through the sprite pipeline:
// each PNG is cleaned of its glow halo, trimmed, scaled down into the pixel box of the runtime
// frame(s) it stands for, given that frame's ground anchor, and packed with tools/pack-atlas.mjs
// into a per-group override atlas. Frames the studies do not cover are carried over from a dump
// of the live atlas (scratchpad/dump-atlases.mjs), because an override replaces a whole group.
//
// usage: node scratchpad/import-base-sprites.mjs <baselineDumpDir> <outDir> [--work DIR]
//
// One study is one picture: the same image serves every variant, level, rotation and facing of
// its family. That is the honest output of the pipeline, not a finished asset; the report it
// writes lists what each study covered and what it could not.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';

const [baselineDir, outDir, ...rest] = process.argv.slice(2);
if (!baselineDir || !outDir) {
  console.error(
    'usage: node scratchpad/import-base-sprites.mjs <baselineDumpDir> <outDir> [--work DIR]',
  );
  process.exit(2);
}
let workDir = join(outDir, 'work');
for (let i = 0; i < rest.length; i++) if (rest[i] === '--work') workDir = rest[++i];

const SRC = 'assets/source/base-v1';
const ALPHA_CUT = 128; // the studies carry a soft glow of alpha 1..60 around a hard-edged object
const coverage = JSON.parse(readFileSync(join(SRC, 'coverage.json'), 'utf8'));
const locos = JSON.parse(readFileSync('src/data/locomotives.json', 'utf8'));
const wagons = JSON.parse(readFileSync('src/data/wagons.json', 'utf8'));

// ---- baseline atlases ------------------------------------------------------------------
const GROUPS = [
  'terrain',
  'props',
  'track',
  'structures',
  'rolling',
  'wagons',
  'fx',
  'icons',
  'people',
];
const base = {};
for (const g of GROUPS) {
  base[g] = {
    png: PNG.sync.read(readFileSync(join(baselineDir, `${g}.png`))),
    frames: JSON.parse(readFileSync(join(baselineDir, `${g}.json`), 'utf8')).frames,
  };
}
const groupOfKey = new Map();
for (const g of GROUPS) for (const k of Object.keys(base[g].frames)) groupOfKey.set(k, g);
const allKeys = [...groupOfKey.keys()];
const keysMatching = (re) => allKeys.filter((k) => re.test(k));

// ---- which runtime frames each study stands for ------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function targetsFor(id) {
  const [cat, ...restId] = id.split('.');
  const name = restId.join('.');
  switch (cat) {
    case 'props':
      return keysMatching(new RegExp(`^props/${esc(name)}(_v?\\d+)?$`));
    case 'terrain':
      if (name === 'city') return keysMatching(/^terrain\/city_\d+_\d+$/);
      if (name === 'cursor') return keysMatching(/^terrain\/(cursor|ghost_ok|ghost_bad|select)$/);
      return keysMatching(new RegExp(`^terrain/${esc(name)}(_\\d+)?(_f\\d+)?$`));
    case 'stations': {
      const n = name.replace(/^full\./, '');
      if (n === 'depot') return keysMatching(/^structures\/depot(_1|_r[01](_lv\d+)?)$/);
      return keysMatching(new RegExp(`^structures/${esc(n)}_\\d+$`));
    }
    case 'works': {
      const n = name.replace(/^full\./, '');
      if (n.startsWith('bridge_')) return keysMatching(new RegExp(`^structures/${esc(n)}$`));
      return keysMatching(new RegExp(`^structures/${esc(n)}(_lv\\d+)?$`));
    }
    case 'decor':
      if (name === 'signal') return keysMatching(/^structures\/signal(_green|_red)?$/);
      if (name === 'townhouse') return keysMatching(/^structures\/townhouse(_\d+|_s\d+)?$/);
      return keysMatching(new RegExp(`^structures/${esc(name)}$`));
    case 'loco': {
      const d = locos.find((l) => l.id === name);
      if (!d) return [];
      const part =
        d.plan === 'tender'
          ? 'engine'
          : d.plan === 'meyer'
            ? 'frame'
            : d.plan === 'garratt'
              ? 'cradle'
              : 'body';
      return keysMatching(
        new RegExp(`^rolling/loco_${esc(d.body)}_${esc(d.size)}_${esc(d.paint)}_${part}_f\\d+$`),
      );
    }
    case 'wagon': {
      const d = wagons.find((w) => w.id === name);
      if (!d) return [];
      return keysMatching(
        new RegExp(`^rolling/wagon_${esc(d.body)}_${esc(d.size)}_${esc(d.paint)}_f\\d+$`),
      );
    }
    case 'cargo':
      return keysMatching(new RegExp(`^icons/${esc(name)}$`));
    case 'track':
      return keysMatching(
        new RegExp(
          `^track/${esc(name)}_(regular|high_speed)(_(regular|high_speed))?_\\d+(_m\\d+)?$`,
        ),
      );
    case 'fx':
      return keysMatching(new RegExp(`^fx/${esc(name)}(_\\d+)?$`));
    case 'people':
      if (name === 'walker') return keysMatching(/^people\/walker_\d+_f\d+$/);
      return keysMatching(new RegExp(`^people/${esc(name)}_\\d+$`));
    default:
      return [];
  }
}

// ---- pixel work ---------------------------------------------------------------------------
function cleanAndTrim(png) {
  const { width, height, data } = png;
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < ALPHA_CUT) {
        data[i + 3] = 0;
        continue;
      }
      data[i + 3] = 255;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  const out = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 });
  for (let y = 0; y < out.height; y++)
    data.copy(
      out.data,
      y * out.width * 4,
      ((y + y0) * width + x0) * 4,
      ((y + y0) * width + x1 + 1) * 4,
    );
  return out;
}

/** Area-averaging downsample with premultiplied alpha, then hard alpha so nearest sampling stays crisp. */
function downsample(src, w, h) {
  const out = new PNG({ width: w, height: h });
  const sx = src.width / w,
    sy = src.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xa = Math.floor(x * sx),
        xb = Math.max(xa + 1, Math.floor((x + 1) * sx));
      const ya = Math.floor(y * sy),
        yb = Math.max(ya + 1, Math.floor((y + 1) * sy));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let yy = ya; yy < yb && yy < src.height; yy++)
        for (let xx = xa; xx < xb && xx < src.width; xx++) {
          const i = (yy * src.width + xx) * 4;
          const al = src.data[i + 3] / 255;
          r += src.data[i] * al;
          g += src.data[i + 1] * al;
          b += src.data[i + 2] * al;
          a += al;
          n++;
        }
      const o = (y * w + x) * 4;
      if (a / n < 0.5 || a === 0) {
        out.data[o + 3] = 0;
        continue;
      }
      out.data[o] = Math.round(r / a);
      out.data[o + 1] = Math.round(g / a);
      out.data[o + 2] = Math.round(b / a);
      out.data[o + 3] = 255;
    }
  return out;
}

function cropFrame(atlas, f) {
  const out = new PNG({ width: f.w, height: f.h });
  for (let y = 0; y < f.h; y++)
    atlas.data.copy(
      out.data,
      y * f.w * 4,
      ((f.y + y) * atlas.width + f.x) * 4,
      ((f.y + y) * atlas.width + f.x + f.w) * 4,
    );
  return out;
}

// ---- run ----------------------------------------------------------------------------------
if (existsSync(workDir)) rmSync(workDir, { recursive: true });
const replaced = new Map(); // key -> { png, ax, ay, id }
const report = { studies: [], unmapped: [], conflicts: [], groups: {} };
const entries = Object.values(coverage.categories).flat();
const cache = new Map();

for (const e of entries) {
  const file = e.generated[0];
  const targets = targetsFor(e.id);
  const rec = { id: e.id, source: file, frames: [], note: '' };
  if (!targets.length) {
    rec.note = 'no runtime frame carries this family under its own name';
    report.unmapped.push(rec);
    continue;
  }
  if (!cache.has(file)) cache.set(file, cleanAndTrim(PNG.sync.read(readFileSync(join(SRC, file)))));
  const src = cache.get(file);
  if (!src) {
    rec.note = 'fully transparent after the halo cut';
    report.unmapped.push(rec);
    continue;
  }
  const sizes = new Map();
  for (const key of targets) {
    if (replaced.has(key)) {
      report.conflicts.push({ key, kept: replaced.get(key).id, dropped: e.id });
      continue;
    }
    const g = groupOfKey.get(key);
    const f = base[g].frames[key];
    const s = Math.min(f.w / src.width, f.h / src.height);
    const w = Math.max(1, Math.round(src.width * s));
    const h = Math.max(1, Math.round(src.height * s));
    const sizeKey = `${w}x${h}`;
    if (!sizes.has(sizeKey)) sizes.set(sizeKey, downsample(src, w, h));
    replaced.set(key, {
      png: sizes.get(sizeKey),
      ax: Math.round((f.ax / f.w) * w),
      ay: Math.round((f.ay / f.h) * h),
      id: e.id,
    });
    rec.frames.push({ key, from: `${f.w}x${f.h}`, to: sizeKey });
  }
  rec.source_px = `${src.width}x${src.height}`;
  report.studies.push(rec);
}

mkdirSync(resolve(outDir), { recursive: true });
for (const g of GROUPS) {
  const prefix = g === 'wagons' ? 'rolling/' : `${g}/`;
  const dir = join(workDir, g);
  mkdirSync(dir, { recursive: true });
  const meta = { frames: {} };
  let n = 0;
  for (const [key, f] of Object.entries(base[g].frames)) {
    const r = replaced.get(key);
    const png = r ? r.png : cropFrame(base[g].png, f);
    const ax = r ? r.ax : f.ax;
    const ay = r ? r.ay : f.ay;
    if (r) n++;
    const name = key.slice(prefix.length);
    if (!key.startsWith(prefix)) throw new Error(`key ${key} outside prefix ${prefix}`);
    writeFileSync(join(dir, `${name}.png`), PNG.sync.write(png));
    meta.frames[key] = { ax, ay };
  }
  writeFileSync(join(dir, 'atlas.json'), JSON.stringify(meta));
  const log = execFileSync(
    'node',
    [
      'tools/pack-atlas.mjs',
      g,
      '--src',
      dir,
      '--out',
      outDir,
      '--prefix',
      prefix,
      '--max',
      '2048',
      '--no-trim',
    ],
    { encoding: 'utf8' },
  );
  report.groups[g] = {
    replaced: n,
    total: Object.keys(base[g].frames).length,
    packed: log.split('\n')[0],
  };
  console.log(log.split('\n')[0], `(${n} illustrated)`);
}
writeFileSync(join(outDir, 'import-report.json'), JSON.stringify(report, null, 2));
console.log(
  `studies mapped: ${report.studies.length}, unmapped: ${report.unmapped.length}, frames illustrated: ${replaced.size}, conflicts: ${report.conflicts.length}`,
);
