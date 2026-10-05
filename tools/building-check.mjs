/** Check building pictures: background, view, size, and where the building stands.
 *
 *   node tools/building-check.mjs <file> [<file> ...]
 *   node tools/building-check.mjs --family depot
 *   node tools/building-check.mjs --all
 *
 * One line per picture; assets/source/buildings-v2/report.json keeps the results. Exit code 1 when
 * a picture fails. A picture need not match its guide to the pixel: image generators fill the
 * canvas and pick its size themselves. The check measures where the building stands instead
 * (building-fit.mjs) and records it, and fails only what a new attempt can put right. It cannot
 * see what the building is: whether the front is on the right wall and the style is right is for
 * eyes to judge, on the review sheets.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROOT, loadInventory, pictures, wallBase } from './building-kit.mjs';
import { FIT, fitPicture } from './building-fit.mjs';

export const REPORT_FILE = `${ROOT}/report.json`;

const LIMIT = {
  /** the shortest side of a picture, px */
  side: 768,
  /** the picture's edge stays empty for this many pixels */
  edge: 2,
  /** picture px the building needs per game px: the density of the game's atlas */
  density: 4,
  /** a trusted ground line outside these slopes is not the game's view (the game's is 0.5) */
  slope: [0.25, 0.8],
  /** share of the building's columns that may end on one level line */
  level: 0.5,
  /** translucent pixels, as a share of the solid ones: more is a shadow or a glow */
  haze: 0.08,
};

/** Which picture a file is, from its name: `<family>-a<age>-r<rot>.png`. */
export function pictureOf(path) {
  const m = /^(.+)-a(\d)-r(\d)\.png$/.exec(basename(path.replaceAll('\\', '/')));
  if (!m) return null;
  return { id: `${m[1]}-a${m[2]}-r${m[3]}`, family: m[1], age: Number(m[2]), rot: Number(m[3]) };
}

const SIDES = ['lower-left', 'lower-right'];

/**
 * Check one decoded picture of a footprint at a rotation. `problems` fail the picture; `notes`
 * are for the person who reviews it; `fit` is how it is laid onto its footprint.
 */
export function checkPicture(png, fpId, rot) {
  const fp = FOOTPRINTS[fpId];
  const { width: W, height: H, data } = png;
  if (Math.min(W, H) < LIMIT.side)
    return {
      ok: false,
      problems: [`picture is ${W}x${H}; its short side must be at least ${LIMIT.side} px`],
    };
  let empty = 0,
    present = 0,
    solid = 0,
    opaque = 0,
    grey = 0;
  let minX = W,
    maxX = -1,
    minY = H,
    maxY = -1;
  /** lowest building pixel of every column */
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
      if (a <= FIT.alpha) continue;
      opaque++;
      if (Math.abs(data[o] - data[o + 1]) <= 4 && Math.abs(data[o + 1] - data[o + 2]) <= 4) grey++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      low[x] = y;
    }
  if (!opaque) return { ok: false, problems: ['empty picture'] };

  const corner = (cx, cy) => {
    for (let y = cy; y < cy + 16; y++)
      for (let x = cx; x < cx + 16; x++) if (data[(y * W + x) * 4 + 3] > 8) return false;
    return true;
  };
  const corners = corner(0, 0) && corner(W - 16, 0) && corner(0, H - 16) && corner(W - 16, H - 16);
  // nothing else can be measured on a picture with a background
  if (empty < 0.25 * W * H || !corners)
    return { ok: false, problems: ['background is not transparent'] };

  const problems = [];
  const notes = [];
  if (grey >= 0.9 * opaque) problems.push('still grey: not painted');
  if (minY < LIMIT.edge) problems.push('touches the top edge');
  if (minX < LIMIT.edge) problems.push('touches the left edge');
  if (maxX >= W - LIMIT.edge) problems.push('touches the right edge');
  if (maxY >= H - LIMIT.edge) problems.push('touches the bottom edge');
  if (solid < 0.5 * present) problems.push('mostly translucent');
  else if (present - opaque > LIMIT.haze * opaque)
    problems.push(
      `a translucent shadow or glow surrounds the building (${Math.round(
        (100 * (present - opaque)) / opaque,
      )} % of its size)`,
    );

  // seen from the front, a building's foot is one level line; in the game's view it is a corner
  const tol = Math.max(3, Math.round((maxX - minX) * 0.006));
  let level = 0;
  for (let x = minX; x <= maxX; x++) if (low[x] >= maxY - tol) level++;
  if (level > LIMIT.level * (maxX - minX + 1)) {
    problems.push(
      "not the game's view: the building's foot is a level line, as if seen from the front",
    );
    return { ok: false, problems };
  }

  const fit = fitPicture(png, fpId, rot);
  if (!fit) {
    problems.push('no building found in the picture');
    return { ok: false, problems };
  }
  // both ground lines far from the game's: a wrong camera. One alone is more often clutter at
  // the foot of that wall than a camera, so it is left to the reviewer.
  const far = (i) =>
    fit.sure[i] &&
    (Math.abs(fit.measured[i]) < LIMIT.slope[0] || Math.abs(fit.measured[i]) > LIMIT.slope[1]);
  const wrongView = far(0) && far(1);
  fit.sure.forEach((sure, i) => {
    if (!sure) return;
    const s = fit.measured[i].toFixed(2);
    if (wrongView)
      problems.push(
        `not the game's view: the ${SIDES[i]} wall's ground line slopes ${s}, the game's ${(i ? -0.5 : 0.5).toFixed(2)}`,
      );
    else if (fit.measured[i] !== fit.slopes[i])
      notes.push(`camera corrected only part of the way: the ${SIDES[i]} ground line slopes ${s}`);
  });
  const base = wallBase(fp, rot);
  const foot = fit.base.e[0] - fit.base.w[0];
  const needed = Math.ceil(((base.e[0] - base.w[0]) / fp.scale) * LIMIT.density);
  if (foot < needed)
    problems.push(
      `too small in the picture: its foot is ${Math.round(foot)} px wide, at least ${needed} px are needed`,
    );
  if (fit.method === 'outline')
    notes.push('placed by its outline: no straight wall base was found');
  if (fit.box.top < 0)
    notes.push(`taller than its canvas by ${Math.round(-fit.box.top)} px once on its footprint`);
  return { ok: problems.length === 0, problems, notes, fit };
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

export function readReport(root = '.') {
  const file = `${root}/${REPORT_FILE}`;
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** Add results to the report on disk; `fresh` starts it anew. */
export function writeReport(results, fresh = false) {
  const report = summarise(results, fresh ? null : readReport());
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
  return report;
}

/** One line for a checked picture. */
export function resultLine(id, r) {
  if (!r.ok) return `FAIL  ${id}: ${r.problems.join('; ')}`;
  return `ok    ${id}${r.notes?.length ? `  (${r.notes.join('; ')})` : ''}`;
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
  let missing = 0,
    strangers = 0;
  for (const file of files) {
    const p = pictureOf(file);
    if (!p || !footprintOf.has(p.family)) {
      // not a picture of the list: said, but kept out of the report
      console.log(`FAIL  ${file}: not a building picture's name (<family>-a<age>-r<rot>.png)`);
      strangers++;
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
    console.log(resultLine(p.id, r));
  }
  writeReport(results, args[0] === '--all');
  const failed = Object.values(results).filter((r) => !r.ok).length + strangers;
  console.log(
    `${Object.keys(results).length + strangers} checked, ${failed} failed` +
      (missing ? `, ${missing} not made yet` : ''),
  );
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
