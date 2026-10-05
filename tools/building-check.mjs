/** Check building pictures: background, view, size, and where the building stands.
 *
 *   node tools/building-check.mjs <file> [<file> ...]
 *   node tools/building-check.mjs --family depot
 *   node tools/building-check.mjs --all
 *
 * One line per picture; assets/source/buildings-v2/report.json keeps the results. Exit code 1 when
 * a picture fails. A picture need not match its guide to the pixel: image generators fill the
 * canvas and pick its size themselves. The check measures where the building stands instead
 * (building-fit.mjs) and records it, and fails only what a new attempt can put right. The camera
 * is one of those: a picture seen from higher or lower than the game's camera, or turned, fails,
 * with the words to ask the generator for next time. The check cannot see what the building is:
 * whether the front is on the right wall and the style is right is for eyes to judge, on the
 * review sheets.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROOT, loadInventory, pictures, wallBase } from './building-kit.mjs';
import { FIT, cameraOff, fitPicture } from './building-fit.mjs';

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
/** A wall foot this close to the game's slope is said to be right. */
const NEAR = 0.03;

/**
 * A camera that is off, in words. `line` is for the record. `say` is for the generator's next
 * attempt at the picture: the wall feet as they are, the cause, the cure. `was` is for a picture
 * that is painted again later from its straightened earlier self: there it says what was wrong
 * and asks for nothing, since a camera moved away from the reference would be wrong again.
 */
function cameraWords(fit, off) {
  const shown =
    'The reference shows it put right: paint it as the reference and the block-out are seen.';
  if (off.by === null) {
    const side = SIDES[off.foot];
    const game = off.foot ? -0.5 : 0.5;
    const how = Math.abs(off.slope) > 0.5 ? 'steep' : 'flat';
    return {
      line: `camera off: the ${side} wall's foot slopes ${off.slope.toFixed(2)} where the game's slopes ${game.toFixed(2)}`,
      say: `The ${side} wall's foot runs too ${how}: it must run parallel to the plinth's ${side} edge, two pixels across for one down.`,
      was: `Its ${side} wall's foot ran too ${how}. ${shown}`,
    };
  }
  const parts = [],
    say = [],
    was = [];
  if (Math.abs(off.elevation) > FIT.camera) {
    const low = off.elevation < 0;
    const seen = fit.camera.elevation.toFixed(1);
    parts.push(`it looks down from ${seen}° where the game looks down from 30°`);
    say.push(
      low
        ? 'The camera is too low, so too little of the roof shows: look down on the building more steeply.'
        : 'The camera is too high, so too much of the roof shows: look down on the building less steeply.',
    );
    was.push(
      low
        ? 'from too low a camera, so too little of its roof showed'
        : 'from too high a camera, so too much of its roof showed',
    );
  }
  if (Math.abs(off.turn) > FIT.camera) {
    const to = SIDES[off.turn > 0 ? 1 : 0];
    parts.push(`the building is turned ${Math.abs(off.turn).toFixed(1)}° towards its ${to} wall`);
    say.push(
      `The building is turned, its ${to} wall facing the viewer too much: turn it back until both walls are seen equally from the side.`,
    );
    was.push(`turned, its ${to} wall facing the viewer too much`);
  }
  // the feet as they are in the picture: a low camera flattens both and a turn steepens one, so
  // what each fault does alone need not be what the picture shows
  const how = fit.measured.map((s) =>
    Math.abs(s) < 0.5 - NEAR ? 'flat' : Math.abs(s) > 0.5 + NEAR ? 'steep' : null,
  );
  let feet = '';
  if (how[0] && how[0] === how[1]) feet = `Both wall feet run too ${how[0]}.`;
  else if (how[0] && how[1])
    feet = `The ${SIDES[0]} wall's foot runs too ${how[0]} and the ${SIDES[1]} wall's too ${how[1]}.`;
  else if (how[0] || how[1]) {
    const i = how[0] ? 0 : 1;
    feet = `The ${SIDES[i]} wall's foot runs too ${how[i]}; the ${SIDES[1 - i]} wall's is right.`;
  }
  const wanted = "Both wall feet must run parallel to the plinth's edges, as the block-out's do.";
  const slopes = fit.measured.map((s) => s.toFixed(2)).join(' and ');
  return {
    line: `camera off by ${off.by.toFixed(1)}°: ${parts.join(' and ')} (the wall feet slope ${slopes}, the game's 0.50 and -0.50)`,
    say: [feet, ...say, wanted].filter(Boolean).join(' '),
    was: `It was painted ${was.join(', and ')}. ${shown}`,
  };
}

/**
 * Check one decoded picture of a footprint at a rotation. `problems` fail the picture; `notes`
 * are for the person who reviews it; `fit` is how it is laid onto its footprint. A camera that
 * is off fails the picture, and `camera` then holds how far off it is (`by`), what to say in the
 * next attempt (`say`) and what was wrong, for when it is painted again later (`was`). With
 * `camera: false` such a picture passes with a note instead, `camera` still given: it is the
 * closest of its attempts, kept for the user to judge.
 */
export function checkPicture(png, fpId, rot, { camera: wanted = true } = {}) {
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
  // both ground lines far from the game's: not the game's view at all, and never kept. One
  // alone, or both a little off, is a camera that is off: painted again, or kept as the closest.
  const far = (i) =>
    fit.sure[i] &&
    (Math.abs(fit.measured[i]) < LIMIT.slope[0] || Math.abs(fit.measured[i]) > LIMIT.slope[1]);
  const wrongView = far(0) && far(1);
  if (wrongView)
    fit.measured.forEach((s, i) =>
      problems.push(
        `not the game's view: the ${SIDES[i]} wall's ground line slopes ${s.toFixed(2)}, the game's ${(i ? -0.5 : 0.5).toFixed(2)}`,
      ),
    );
  const off = wrongView ? null : cameraOff(fit);
  let camera = null;
  if (off?.off) {
    const words = cameraWords(fit, off);
    camera = { by: off.by, say: words.say, was: words.was };
    // a slope outside what the fit uses is corrected only as far as that
    const partly = fit.sure.some((sure, i) => sure && fit.measured[i] !== fit.slopes[i]);
    if (wanted) problems.push(words.line);
    else
      notes.push(
        `${words.line}; kept, and corrected ${partly ? 'part of the way ' : ''}by the tools`,
      );
  }
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
  return { ok: problems.length === 0, problems, notes, fit, ...(camera ? { camera } : {}) };
}

/** Check a file on disk. */
export function checkFile(path, fpId, rot, options) {
  let png;
  try {
    png = PNG.sync.read(readFileSync(path));
  } catch (e) {
    return { ok: false, problems: [`not a readable PNG (${e.message})`] };
  }
  return checkPicture(png, fpId, rot, options);
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

/**
 * The pictures the queue records as kept with their camera off: each the closest of its attempts,
 * waiting for the user to judge. For them a camera that is off is a note, not a failure.
 */
function keptPictures() {
  const file = `${ROOT}/queue.json`;
  if (!existsSync(file)) return new Set();
  const entries = JSON.parse(readFileSync(file, 'utf8')).entries ?? [];
  return new Set(entries.filter((e) => e.kept).map((e) => e.id));
}

function main(args) {
  const inventory = loadInventory();
  const footprintOf = new Map(inventory.map((f) => [f.family, f.footprint]));
  const kept = keptPictures();
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
    const r = checkFile(file, footprintOf.get(p.family), p.rot, { camera: !kept.has(p.id) });
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
