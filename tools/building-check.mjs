/** Check building pictures against the conventions: canvas, background, footprint, size.
 *
 *   node tools/building-check.mjs <file> [<file> ...]
 *   node tools/building-check.mjs --family depot
 *   node tools/building-check.mjs --all
 *
 * One line per picture; assets/source/buildings-v2/report.json keeps the results. Exit code 1 when
 * a picture fails. The check knows where a building must stand, not what it must look like: whether
 * the front is on the right wall and the style is right is for eyes to judge, on the review sheets.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROOT, diamond, loadInventory, pictures } from './building-kit.mjs';

export const REPORT_FILE = `${ROOT}/report.json`;

/** Canvas px. */
const LIMIT = {
  /** the lowest pixel may sit this far above the footprint's near corner (walls set in a little) */
  above: 48,
  /** ... and this far below it */
  below: 12,
  /** the building's middle may be this far to the side of the footprint's */
  aside: 40,
  /** roofs and cranes may overhang the footprint's left and right corners by this much */
  overhang: 48,
  /** the canvas edge stays empty for this many pixels */
  edge: 2,
  /** and the top of the canvas for this many */
  headroom: 16,
};

/** Which picture a file is, from its name: `<family>-a<age>-r<rot>.png`. */
export function pictureOf(path) {
  const m = /^(.+)-a(\d)-r(\d)\.png$/.exec(basename(path.replaceAll('\\', '/')));
  if (!m) return null;
  return { id: `${m[1]}-a${m[2]}-r${m[3]}`, family: m[1], age: Number(m[2]), rot: Number(m[3]) };
}

/** Check one decoded picture of a footprint at a rotation. */
export function checkPicture(png, fpId, rot) {
  const fp = FOOTPRINTS[fpId];
  const { width: W, height: H, data } = png;
  if (W !== fp.canvas[0] || H !== fp.canvas[1])
    return { ok: false, problems: [`canvas ${W}x${H}, expected ${fp.canvas[0]}x${fp.canvas[1]}`] };
  const alpha = (x, y) => data[(y * W + x) * 4 + 3];
  let empty = 0,
    present = 0,
    solid = 0,
    opaque = 0,
    grey = 0;
  let minX = W,
    maxX = -1,
    minY = H,
    maxY = -1;
  /** lowest opaque pixel of every column */
  const low = new Int32Array(W).fill(-1);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const a = data[o + 3];
      if (a <= 8) {
        empty++;
        continue;
      }
      present++;
      if (a >= 240) solid++;
      if (a <= 128) continue;
      opaque++;
      if (Math.abs(data[o] - data[o + 1]) <= 4 && Math.abs(data[o + 1] - data[o + 2]) <= 4) grey++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      low[x] = y;
    }
  if (!opaque) return { ok: false, problems: ['empty picture'] };

  const problems = [];
  const corner = (cx, cy) => {
    for (let y = cy; y < cy + 16; y++)
      for (let x = cx; x < cx + 16; x++) if (alpha(x, y) > 8) return false;
    return true;
  };
  const corners = corner(0, 0) && corner(W - 16, 0) && corner(0, H - 16) && corner(W - 16, H - 16);
  if (empty < 0.25 * W * H || !corners) problems.push('background is not transparent');
  if (grey >= 0.9 * opaque) problems.push('still grey: not painted');

  if (minY < LIMIT.edge) problems.push('touches the top edge');
  if (minX < LIMIT.edge) problems.push('touches the left edge');
  if (maxX >= W - LIMIT.edge) problems.push('touches the right edge');
  if (maxY >= H - LIMIT.edge) problems.push('touches the bottom edge');

  const d = diamond(fp, rot);
  const up = Math.round(d.s[1] - maxY);
  if (up > LIMIT.above) problems.push(`base is ${up} px above the footprint`);
  if (up < -LIMIT.below) problems.push(`base is ${-up} px below the footprint`);
  const side = Math.round((minX + maxX) / 2 - (d.w[0] + d.e[0]) / 2);
  if (side > LIMIT.aside) problems.push(`base is ${side} px right of the footprint`);
  if (side < -LIMIT.aside) problems.push(`base is ${-side} px left of the footprint`);

  // at ground level the building stays inside the footprint's two near edges
  if (minX < d.w[0] - LIMIT.overhang) problems.push('reaches outside the footprint at the left');
  if (maxX > d.e[0] + LIMIT.overhang) problems.push('reaches outside the footprint at the right');
  const edge = (x) =>
    x <= d.s[0]
      ? d.w[1] + ((x - d.w[0]) * (d.s[1] - d.w[1])) / (d.s[0] - d.w[0])
      : d.s[1] + ((x - d.s[0]) * (d.e[1] - d.s[1])) / (d.e[0] - d.s[0]);
  for (let x = Math.max(minX, Math.ceil(d.w[0])); x <= Math.min(maxX, Math.floor(d.e[0])); x++)
    if (low[x] > edge(x) + LIMIT.below) {
      problems.push('reaches outside the footprint at the ground');
      break;
    }

  if (maxX - minX + 1 < 0.5 * (d.e[0] - d.w[0])) problems.push('too small');
  if (minY < LIMIT.headroom) problems.push('too tall for the canvas');
  if (solid < 0.5 * present) problems.push('mostly translucent');
  return { ok: problems.length === 0, problems };
}

/** Check a file on disk. */
export function checkFile(path, fpId, rot) {
  let png;
  try {
    png = PNG.sync.read(readFileSync(path));
  } catch (e) {
    return { ok: false, problems: [`not a readable PNG (${e.message})`] };
  }
  return checkPicture(png, fpId, rot);
}

/** The report: every picture checked so far, with new results laid over an earlier report. */
export function summarise(results, previous = null) {
  const all = { ...(previous?.pictures ?? {}), ...results };
  const list = Object.values(all);
  return { checked: list.length, failed: list.filter((r) => !r.ok).length, pictures: all };
}

function main(args) {
  const inventory = loadInventory();
  const footprintOf = new Map(inventory.map((f) => [f.family, f.footprint]));
  let files;
  let skipMissing = true;
  if (args[0] === '--all') files = pictures(inventory).map((p) => p.file);
  else if (args[0] === '--family')
    files = pictures(inventory)
      .filter((p) => p.family === args[1])
      .map((p) => p.file);
  else {
    files = args;
    skipMissing = false;
  }
  if (!files.length) {
    console.error('nothing to check; give files, --family <name> or --all');
    return 1;
  }
  const results = {};
  let missing = 0;
  for (const file of files) {
    const p = pictureOf(file);
    if (!p || !footprintOf.has(p.family)) {
      console.log(`FAIL  ${file}: not a building picture's name (<family>-a<age>-r<rot>.png)`);
      results[file] = { ok: false, problems: ['not a building picture'] };
      continue;
    }
    if (!existsSync(file)) {
      if (skipMissing) missing++;
      else {
        console.log(`FAIL  ${p.id}: no such file`);
        results[p.id] = { ok: false, problems: ['no such file'] };
      }
      continue;
    }
    const r = checkFile(file, footprintOf.get(p.family), p.rot);
    results[p.id] = r;
    console.log(r.ok ? `ok    ${p.id}` : `FAIL  ${p.id}: ${r.problems.join('; ')}`);
  }
  const previous = existsSync(REPORT_FILE) ? JSON.parse(readFileSync(REPORT_FILE, 'utf8')) : null;
  const report = summarise(results, args[0] === '--all' ? null : previous);
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
  const failed = Object.values(results).filter((r) => !r.ok).length;
  console.log(
    `${Object.keys(results).length} checked, ${failed} failed` +
      (missing ? `, ${missing} not made yet` : ''),
  );
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
