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
import { openingsOf, portalWall } from './building-guides.mjs';

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
  /**
   * a depot's portals are in the wrong wall when that wall's foot is dark over this share of it,
   * and this many times as dark as the wall they belong in
   */
  portal: { share: 0.25, times: 1.5 },
  /** a pixel darker than this is an opening: a hall's inside, an open door, a window */
  dark: 70,
  /**
   * a portal is closed to the ground when more than this share of the ground just inside it is
   * painted, in the most open of three windows across its middle. Measured on the first depot:
   * the pictures whose rails did not show had 0.66 to 1 in every portal, the others at most 0.34
   * in any
   */
  floor: 0.5,
};

/** Which picture a file is, from its name: `<family>-a<age>-r<rot>.png`. */
export function pictureOf(path) {
  const m = /^(.+)-a(\d)-r(\d)\.png$/.exec(basename(path.replaceAll('\\', '/')));
  if (!m) return null;
  return { id: `${m[1]}-a${m[2]}-r${m[3]}`, family: m[1], age: Number(m[2]), rot: Number(m[3]) };
}

const SIDES = ['lower-left', 'lower-right'];
/**
 * How much of the lower part of a wall is dark, from the wall's foot (`from` to `to`, picture px)
 * `up` px high: open portals with the hall behind them make a wall far darker than brick or stone.
 */
/**
 * Where a wall's portals are along its foot, as shares of its length: for each opening three
 * windows across its middle, clear of the door posts. A portal is seldom painted just where the
 * block-out has it, and a round one is narrow at the ground: the most open window speaks for
 * it. `wall` is 0 for the lower-left wall, 1 for the lower-right.
 */
function portalWindows(fpId, rot, wall) {
  const base = wallBase(FOOTPRINTS[fpId], rot);
  const [from, to] = wall === 0 ? [base.w, base.s] : [base.s, base.e];
  return openingsOf(fpId, rot)
    .filter((o) => o.kind === 'side' && o.wall === wall)
    .map((o) => {
      const [a, b] = [o.pts[0], o.pts[1]]
        .map((p) => (p[0] - from[0]) / (to[0] - from[0]))
        .sort((x, y) => x - y);
      return [0.2, 0.4, 0.6].map((t) => [a + (b - a) * t, a + (b - a) * (t + 0.2)]);
    });
}

/**
 * How much of the ground just inside a portal is painted: the share of opaque pixels in a low
 * band above the wall's foot, from share `a` to share `b` of the wall. The game lays its rails
 * there, under the picture, so a floor or an apron painted in the portal hides them.
 */
function groundShare(png, from, to, up, a, b) {
  const steps = Math.round(Math.abs(to[0] - from[0]));
  let seen = 0,
    painted = 0;
  for (let i = Math.round(steps * a); i <= steps * b; i++) {
    const x = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
    const foot = from[1] + ((to[1] - from[1]) * i) / steps;
    for (let h = Math.round(up * 0.08); h < up * 0.3; h++) {
      const y = Math.round(foot - h);
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      seen++;
      if (png.data[(y * png.width + x) * 4 + 3] > FIT.alpha) painted++;
    }
  }
  return seen ? painted / seen : 0;
}

function darkShare(png, from, to, up) {
  const steps = Math.round(Math.abs(to[0] - from[0]));
  let seen = 0,
    dark = 0;
  // the middle of the wall, clear of its corners and of the ground line
  for (let i = Math.round(steps * 0.12); i <= steps * 0.88; i++) {
    const x = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
    const foot = from[1] + ((to[1] - from[1]) * i) / steps;
    for (let h = Math.round(up * 0.15); h < up; h++) {
      const y = Math.round(foot - h);
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const o = (y * png.width + x) * 4;
      if (png.data[o + 3] <= FIT.alpha) continue;
      seen++;
      const light = 0.299 * png.data[o] + 0.587 * png.data[o + 1] + 0.114 * png.data[o + 2];
      if (light < LIMIT.dark) dark++;
    }
  }
  return seen ? dark / seen : 0;
}

/**
 * A camera that is off, in words. `line` is for the record. `was` is for the prompt of the next
 * attempt, which is painted from this picture straightened: it says what was wrong and asks for
 * nothing. Told to look down more steeply, a generator overshoots, and the camera swings from
 * too low to too high and back.
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
      was: `Its ${side} wall's foot ran too ${how}. ${shown}`,
    };
  }
  const parts = [],
    was = [];
  if (Math.abs(off.elevation) > FIT.camera) {
    const seen = fit.camera.elevation.toFixed(1);
    parts.push(`it looks down from ${seen}° where the game looks down from 30°`);
    was.push(
      off.elevation < 0
        ? 'from too low a camera, so too little of its roof showed'
        : 'from too high a camera, so too much of its roof showed',
    );
  }
  if (Math.abs(off.turn) > FIT.camera) {
    const to = SIDES[off.turn > 0 ? 1 : 0];
    parts.push(`the building is turned ${Math.abs(off.turn).toFixed(1)}° towards its ${to} wall`);
    was.push(`turned, its ${to} wall facing the viewer too much`);
  }
  const slopes = fit.measured.map((s) => s.toFixed(2)).join(' and ');
  return {
    line: `camera off by ${off.by.toFixed(1)}°: ${parts.join(' and ')} (the wall feet slope ${slopes}, the game's 0.50 and -0.50)`,
    was: `It was painted ${was.join(', and ')}. ${shown}`,
  };
}

/**
 * Check one decoded picture of a footprint at a rotation. `problems` fail the picture; `notes`
 * are for the person who reviews it; `fit` is how it is laid onto its footprint. A camera that
 * is off fails the picture, and `camera` then holds how far off it is (`by`) and what was wrong
 * with it (`was`), for the prompt when it is painted again. With `camera: false` such a picture
 * passes with a note instead, `camera` still given: it is the closest of its attempts, kept for
 * the user to judge.
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
    camera = { by: off.by, was: words.was };
    // a slope outside what the fit uses is corrected only as far as that
    const partly = fit.sure.some((sure, i) => sure && fit.measured[i] !== fit.slopes[i]);
    if (wanted) problems.push(words.line);
    else
      notes.push(
        `${words.line}; kept, and corrected ${partly ? 'part of the way ' : ''}by the tools`,
      );
  }
  // a depot's portals: in the wall the guide has them in. The check cannot read a building, but
  // an end wall with two open portals is far darker at its foot than a front or a back wall, and
  // a view of the wrong rotation has that dark wall on the other side.
  const portals = portalWall(fpId, rot);
  if (portals !== null) {
    const up = (fit.base.e[0] - fit.base.w[0]) * 0.16;
    const dark = [
      darkShare(png, fit.base.w, fit.base.s, up),
      darkShare(png, fit.base.s, fit.base.e, up),
    ];
    const other = 1 - portals;
    if (dark[other] > LIMIT.portal.share && dark[other] > LIMIT.portal.times * dark[portals])
      problems.push(
        `the portals are in the ${SIDES[other]} wall; they belong in the ${SIDES[portals]} wall, where the block-out has them`,
      );
    else {
      // the ground inside the portals: the game lays its rails through each of them, under the
      // picture
      const [from, to] = portals === 0 ? [fit.base.w, fit.base.s] : [fit.base.s, fit.base.e];
      const painted = portalWindows(fpId, rot, portals).map((windows) =>
        Math.min(...windows.map(([a, b]) => groundShare(png, from, to, up, a, b))),
      );
      if (painted.some((share) => share > LIMIT.floor))
        problems.push(
          'the portals are not open to the ground: floor or wall is painted where the rails run in. Leave the ground inside each portal empty (transparent) from the foot of the wall upwards',
        );
    }
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
