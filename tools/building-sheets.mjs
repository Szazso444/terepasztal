/** Review sheets of the building pictures: one sheet per family and an index page.
 *
 *   node tools/building-sheets.mjs                  every family
 *   node tools/building-sheets.mjs --family depot   one family (the index is rebuilt too)
 *   node tools/building-sheets.mjs --picture <file> [<file> ...]   one picture for the eye
 *
 * A sheet has a row per age and a column per view (r0 to r3). Each cell is the picture on grass,
 * laid onto its footprint the way the game will lay it (building-fit.mjs), at a quarter of the
 * footprint's canvas. So a picture that is too large, off centre or a little off the game's camera
 * in its file shows here as it will stand in the game. A picture that is not made yet leaves its
 * cell empty.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { PNG } from 'pngjs';
import { isMain } from './is-main.mjs';
import {
  AGES,
  FOOTPRINTS,
  ROOT,
  diamond,
  footprintTiles,
  loadInventory,
  pictureFile,
  project,
  wallBase,
} from './building-kit.mjs';
import { blockOf, fillPoly, openingsOf, strokePoly } from './building-guides.mjs';
import { FIT, cameraOff, fitGroup, fitPicture, normalisePicture } from './building-fit.mjs';
import { buildQueue, loadFamilies, progress, readQueue } from './building-queue.mjs';
import { readReport } from './building-check.mjs';

export const SHEET = {
  grass: [124, 143, 60],
  footprint: [98, 116, 48],
  shrink: 4,
  /** on the angles sheet: the footprint's edge, and the line the walls' feet should stand on */
  outline: [255, 255, 255],
  walls: [255, 60, 200],
  /** on a picture laid out for the eye: where the guide has the door and a depot's portals */
  openings: [255, 214, 64],
  /** on a depot laid out for the eye: the game's track through the portals, its bed and its rails */
  bed: [116, 106, 88],
  rail: [58, 54, 50],
};

/**
 * The game's track under a depot, in tiles from its middle line: where its rails run, and how
 * far it reaches to either side. The depot stands on regular track, which shows as wide as its
 * ballast (a high-speed line's is a little wider); the narrow depot on narrow gauge, which has
 * none and shows as wide as its sleepers (src/art/trackIllustrated.ts; a test holds these to
 * it).
 */
export const TRACK = {
  t2x2: { rail: 0.16, bed: 0.29 },
  t1x2: { rail: 0.08, bed: 0.14 },
};

export function sheetFile(family) {
  return `${ROOT}/review/${family}.png`;
}
/** The same sheet at twice the size with the footprint and the wall lines drawn over each picture. */
export function anglesFile(family) {
  return `${ROOT}/review/${family}-angles.png`;
}

/**
 * Which picture a file shows, from its name: in any folder, any attempt (`-2`), set aside
 * (`.rejected`) or kept from before (`.before`). Null for another file.
 */
export function lookedAt(path) {
  const name = basename(path.replaceAll('\\', '/'));
  const m = /^(.+)-a(\d)-r(\d)(?:-\d+)?(?:\.(?:before|rejected)(?:\.\d+)?)?\.png$/.exec(name);
  return m ? { family: m[1], age: Number(m[2]), rot: Number(m[3]) } : null;
}

/** Where a picture is shown for the eye: under its own name, so attempts can be told apart. */
export function lookFile(path) {
  return `${ROOT}/.look/${basename(path.replaceAll('\\', '/'))}`;
}

/** Lay a picture the size of a cell into the sheet at (ox, oy), over what is there. */
function paste(sheet, pic, ox, oy) {
  for (let y = 0; y < pic.height; y++)
    for (let x = 0; x < pic.width; x++) {
      const o = (y * pic.width + x) * 4;
      const cover = pic.data[o + 3] / 255;
      if (!cover) continue;
      const t = ((oy + y) * sheet.width + ox + x) * 4;
      for (let c = 0; c < 3; c++)
        sheet.data[t + c] = Math.round(pic.data[o + c] * cover + sheet.data[t + c] * (1 - cover));
    }
}

/**
 * One family's sheet. `load(file)` returns the picture as a PNG, or null when it is not made; a
 * picture that cannot be read or holds no building leaves its cell empty and is told to `problem`.
 * With `outlines` the footprint's edge and the line of the walls' feet are drawn over each picture:
 * a wall whose foot leaves its line was painted at another angle than the game's. The views of one
 * age are brought to one size (`fitGroup`), and `size` is how large the family stands on its tile.
 */
export function drawSheet(
  f,
  load,
  problem = () => {},
  { outlines = false, shrink = SHEET.shrink, size = 1 } = {},
) {
  const fp = FOOTPRINTS[f.footprint];
  const k = shrink;
  const cw = fp.canvas[0] / k,
    ch = fp.canvas[1] / k;
  const sheet = new PNG({ width: cw * 4, height: ch * f.ages });
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = SHEET.grass[0];
    sheet.data[i + 1] = SHEET.grass[1];
    sheet.data[i + 2] = SHEET.grass[2];
    sheet.data[i + 3] = 255;
  }
  for (let row = 0; row < f.ages; row++) {
    const pics = [0, 1, 2, 3].map((rot) => {
      const file = pictureFile(f.family, f.firstAge + row, rot);
      try {
        return load(file);
      } catch (e) {
        problem(file, e.message);
        return null;
      }
    });
    const fits = fitGroup(pics, f.footprint, { size });
    for (let rot = 0; rot < 4; rot++) {
      const ox = rot * cw,
        oy = row * ch;
      const d = diamond(fp, rot);
      const at = ([x, y]) => [ox + x / k, oy + y / k];
      fillPoly(sheet, [d.n, d.e, d.s, d.w].map(at), SHEET.footprint);
      if (!pics[rot]) continue;
      if (!fits[rot]) {
        problem(pictureFile(f.family, f.firstAge + row, rot), 'no building in the picture');
        continue;
      }
      paste(sheet, normalisePicture(pics[rot], fits[rot], f.footprint, k), ox, oy);
      if (!outlines) continue;
      const b = wallBase(fp, rot);
      strokePoly(sheet, [d.n, d.e, d.s, d.w].map(at), SHEET.outline, 1.5);
      strokePoly(sheet, [b.n, b.e, b.s, b.w].map(at), SHEET.walls, 1.5);
    }
  }
  return sheet;
}

/**
 * The game's track under a depot, drawn on the ground of a look picture before the building is
 * laid on it: one track through each pair of portals, square to the portal wall and a little
 * beyond the footprint at both ends. Where the ground inside a portal is left open the rails
 * are seen to run in; a floor or an apron painted there hides them, as it does in the game.
 * The track is the game's own, through the middle of the footprint's tiles: it does not grow
 * with a family that stands larger than its footprint.
 */
function drawTracks(look, fp, fpId, rot, at) {
  const { w, h } = footprintTiles(fp, rot);
  const z0 = blockOf(fpId, rot).z0;
  for (const o of openingsOf(fpId, rot)) {
    if (o.kind !== 'side') continue;
    // the middle of the opening's foot, back in tiles (the guide has it on the plinth)
    const mx = (o.pts[0][0] + o.pts[1][0]) / 2,
      my = (o.pts[0][1] + o.pts[1][1]) / 2;
    const u = (mx - fp.centre[0]) / (fp.scale * 32),
      v = ((my - fp.centre[1]) / fp.scale + z0) / 16;
    const x = (u + v) / 2,
      y = (v - u) / 2;
    // wall 0 runs along x, so its track runs along y; wall 1 the other way
    const reach = (o.wall === 0 ? h : w) / 2 + 0.9;
    const strip = (off, half, rgb) => {
      const tiles =
        o.wall === 0
          ? [
              [x + off - half, -reach],
              [x + off + half, -reach],
              [x + off + half, reach],
              [x + off - half, reach],
            ]
          : [
              [-reach, y + off - half],
              [reach, y + off - half],
              [reach, y + off + half],
              [-reach, y + off + half],
            ];
      fillPoly(
        look,
        tiles.map(([tx, ty]) => at(project(fp, tx, ty, 0))),
        rgb,
      );
    };
    const track = TRACK[fpId];
    strip(0, track.bed, SHEET.bed);
    strip(-track.rail, 0.02, SHEET.rail);
    strip(track.rail, 0.02, SHEET.rail);
  }
}

/**
 * One picture for the eye: on grass, laid onto its footprint as it was painted, with the
 * footprint's edge, the line the walls' feet should stand on and the frames of the guide's
 * openings (the front door, a depot's portals) drawn over it. The camera is not corrected here,
 * so a foot that leaves its line shows, and so does a door or a portal in the wrong wall.
 * `size` is how large the game draws the family on its footprint (a depot 1.3 times): the
 * building and its lines are that much larger, on a canvas that much larger so that nothing is
 * cut off, while the footprint and a depot's track keep the game's size. So the rails are where
 * the game has them. The result is opaque: a viewer that ignores transparency shows the colour
 * stored under a picture's transparent pixels as a glow round the building, which is not in the
 * picture. Null when the picture holds no building.
 */
export function drawLook(png, fpId, rot, { shrink = 2, size = 1 } = {}) {
  const fp = FOOTPRINTS[fpId];
  const fit = fitPicture(png, fpId, rot, { rectify: false });
  if (!fit) return null;
  const k = shrink;
  // the footprint's canvas shrunk less is the same picture, larger
  const pic = normalisePicture(png, fit, fpId, k / size);
  const look = new PNG({ width: pic.width, height: pic.height });
  for (let i = 0; i < look.data.length; i += 4) {
    look.data[i] = SHEET.grass[0];
    look.data[i + 1] = SHEET.grass[1];
    look.data[i + 2] = SHEET.grass[2];
    look.data[i + 3] = 255;
  }
  const d = diamond(fp, rot),
    b = wallBase(fp, rot);
  // the ground keeps its size about the footprint's centre; the building's lines grow with it
  const centre = [(fp.centre[0] * size) / k, (fp.centre[1] * size) / k];
  const ground = ([x, y]) => [
    centre[0] + (x - fp.centre[0]) / k,
    centre[1] + (y - fp.centre[1]) / k,
  ];
  const built = ([x, y]) => [(x * size) / k, (y * size) / k];
  fillPoly(look, [d.n, d.e, d.s, d.w].map(ground), SHEET.footprint);
  drawTracks(look, fp, fpId, rot, ground);
  paste(look, pic, 0, 0);
  strokePoly(look, [d.n, d.e, d.s, d.w].map(ground), SHEET.outline, 1.5);
  strokePoly(look, [b.n, b.e, b.s, b.w].map(built), SHEET.walls, 1.5);
  for (const o of openingsOf(fpId, rot)) strokePoly(look, o.pts.map(built), SHEET.openings, 1.5);
  return look;
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/**
 * The index page: every family with its sheet, what was made, what failed and what the check
 * noted for the reviewer. `rows` is the progress per family (building-queue.mjs).
 */
export function indexHtml(inventory, queue, report, rows) {
  const byFamily = new Map(rows.map((r) => [r.family, r]));
  const sections = inventory.map((f) => {
    const p = byFamily.get(f.family);
    const ages = AGES.slice(f.firstAge, f.firstAge + f.ages)
      .map((a) => a.name)
      .join(', ');
    const mine = queue.entries
      .filter((e) => e.family === f.family)
      .map((e) => ({ e, check: report?.pictures?.[e.id] }));
    // put back for its camera: not a failure, it is being painted again
    const again = ({ e }) => e.status === 'pending' && e.repaint;
    const repainted = mine
      .filter(again)
      .map(
        ({ e, check }) =>
          `<li class="note"><code>${esc(e.id)}</code> to paint again${
            check && !check.ok ? `: ${esc(check.problems.join('; '))}` : ''
          }</li>`,
      );
    const failed = mine
      .filter((m) => !again(m) && (m.e.status === 'rejected' || (m.check && !m.check.ok)))
      .map(
        ({ e, check }) =>
          `<li><code>${esc(e.id)}</code> ${esc(e.status)}${
            check && !check.ok ? `: ${esc(check.problems.join('; '))}` : ''
          }${e.note ? ` <em>(${esc(e.note)})</em>` : ''}</li>`,
      );
    const noted = mine
      .filter(({ e, check }) => e.status !== 'rejected' && check?.ok && check.notes?.length)
      .map(
        ({ e, check }) =>
          `<li class="note"><code>${esc(e.id)}</code>: ${esc(check.notes.join('; '))}</li>`,
      );
    // the ground lines as measured: the game's slope 0.50 and -0.50
    const angle = (e) => {
      const fit = report?.pictures?.[e.id]?.fit;
      if (!fit) return '<td class="none">-</td>';
      if (fit.method !== 'base') return '<td class="outline">by its outline</td>';
      // far: further than the tools correct; off: a camera the check refuses
      const far = fit.measured.some(
        (s) => Math.abs(s) < FIT.slope[0] || Math.abs(s) > FIT.slope[1],
      );
      const mark = far ? 'far' : cameraOff(fit)?.off ? 'off' : '';
      return `<td class="${mark}">${fit.measured[0].toFixed(2)} / ${fit.measured[1].toFixed(2)}</td>`;
    };
    const rows = [];
    for (let n = 0; n < f.ages; n++) {
      const age = AGES[f.firstAge + n];
      const views = mine.filter(({ e }) => e.age === age.index);
      // how large each view came back, by the root of the area it covers once on its footprint
      const sizes = views
        .map(({ check }) => check?.fit)
        .filter((fit) => fit?.area)
        .map((fit) => Math.sqrt(fit.area * fit.vertical) * fit.scale);
      const apart = sizes.length > 1 ? Math.max(...sizes) / Math.min(...sizes) : 1;
      const spread =
        sizes.length > 1
          ? `<td class="${apart > 1.15 ? 'off' : ''}">x${apart.toFixed(2)}</td>`
          : '<td class="none">-</td>';
      rows.push(
        `<tr><th>${esc(age.name)}</th>${views.map(({ e }) => angle(e)).join('')}${spread}</tr>`,
      );
    }
    const counts =
      `${p.made} of ${p.total} made` +
      (p.approved ? `, ${p.approved} approved` : '') +
      (p.kept ? `, ${p.kept} kept with the camera off` : '') +
      (p.repaint ? `, ${p.repaint} to paint again` : '') +
      (p.rejected ? `, ${p.rejected} rejected` : '') +
      (p.behind ? `, ${p.behind} not made (built on a picture that failed)` : '');
    return `<section id="${esc(f.family)}">
  <h2>${esc(f.name)} <small>${esc(f.family)}</small></h2>
  <p>${counts}. Rows: ${esc(ages)}. Columns: r0 (front lower left), r1, r2, r3 (front lower right).</p>
  <img src="${esc(f.family)}.png" alt="${esc(f.name)}: every age and view" loading="lazy" />
  <p><a href="${esc(f.family)}-angles.png">The same sheet with the footprint and the wall lines drawn in</a>. Ground lines as measured, lower left / lower right (the game's are 0.50 / -0.50), marked where the camera is further than ${FIT.camera}° from the game's:</p>
  <table><tr><th></th><th>r0</th><th>r1</th><th>r2</th><th>r3</th><th>sizes apart</th></tr>${rows.join('')}</table>
  ${
    failed.length || repainted.length || noted.length
      ? `<ul>${failed.join('')}${repainted.join('')}${noted.join('')}</ul>`
      : ''
  }
</section>`;
  });
  const total = queue.entries.length;
  const made = rows.reduce((n, r) => n + r.made, 0);
  const gates = queue.gates
    .map((g) => `"${esc(g.family)}": ${g.approved ? 'approved' : 'waiting for approval'}`)
    .join('; ');
  return `<!doctype html>
<meta charset="utf-8" />
<title>Building pictures</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 24px; background: #1c211d; color: #e2e8e0; }
  h1, h2 { margin: 0 0 4px; }
  small { font-weight: 400; color: #9ba79f; }
  section { margin: 28px 0; }
  img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
  li { color: #e37a66; }
  li.note { color: #d7a94d; }
  a { color: #6cbf97; }
  table { border-collapse: collapse; margin: 6px 0; font-size: 13px; }
  th, td { padding: 2px 12px 2px 0; text-align: left; font-weight: 400; color: #9ba79f; }
  td.off { color: #d7a94d; }
  td.far { color: #e37a66; }
  code { color: inherit; }
</style>
<h1>Building pictures</h1>
<p>${made} of ${total} made. Each picture is shown laid onto its footprint, as the game will lay it. Gates: ${gates}.</p>
${sections.join('\n')}
`;
}

/** How large the game draws a family on its footprint: 1 unless families.json says otherwise. */
export function sizeOf(families, family) {
  return families.families[family]?.size ?? 1;
}

/**
 * Write one picture for the eye, at the size the game draws its family. Answers with the `file`
 * written, or `why` there is none.
 */
export function showPicture(file, inventory, families = loadFamilies()) {
  const p = lookedAt(file);
  const f = p && inventory.find((x) => x.family === p.family);
  if (!f) return { why: "not a building picture's name" };
  if (!existsSync(file)) return { why: 'no such file' };
  let shown;
  try {
    shown = drawLook(PNG.sync.read(readFileSync(file)), f.footprint, p.rot, {
      size: sizeOf(families, f.family),
    });
  } catch (e) {
    return { why: e.message };
  }
  if (!shown) return { why: 'no building in the picture' };
  const out = lookFile(file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, PNG.sync.write(shown));
  return { file: out };
}

/** Write the pictures named for the eye; one line each, the file written or why not. */
function look(files, inventory) {
  if (!files.length) {
    console.error('give the picture files to look at');
    return 1;
  }
  let bad = 0;
  for (const file of files) {
    const shown = showPicture(file, inventory);
    if (shown.file) console.log(shown.file);
    else {
      console.log(`left out  ${file}: ${shown.why}`);
      bad++;
    }
  }
  return bad ? 1 : 0;
}

function main(args) {
  const inventory = loadInventory();
  if (args[0] === '--picture') return look(args.slice(1), inventory);
  const families = loadFamilies();
  const only = args[0] === '--family' ? args[1] : null;
  const load = (file) => (existsSync(file) ? PNG.sync.read(readFileSync(file)) : null);
  const problem = (file, why) => console.log(`left out  ${file}: ${why}`);
  let n = 0;
  for (const f of inventory) {
    if (only && f.family !== only) continue;
    const file = sheetFile(f.family);
    mkdirSync(dirname(file), { recursive: true });
    const size = sizeOf(families, f.family);
    writeFileSync(file, PNG.sync.write(drawSheet(f, load, problem, { size })));
    const lined = drawSheet(f, load, undefined, { outlines: true, shrink: 2, size });
    writeFileSync(anglesFile(f.family), PNG.sync.write(lined));
    n++;
  }
  if (only && !n) {
    console.error(`no family is called "${only}"`);
    return 1;
  }
  const queue = buildQueue(inventory, families, readQueue());
  const rows = progress(queue, inventory, families);
  writeFileSync(`${ROOT}/review/index.html`, indexHtml(inventory, queue, readReport(), rows));
  console.log(`${n} sheet${n === 1 ? '' : 's'} and the index in ${ROOT}/review`);
  return 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
