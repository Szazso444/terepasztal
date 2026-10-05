/** Review sheets of the building pictures: one sheet per family and an index page.
 *
 *   node tools/building-sheets.mjs                  every family
 *   node tools/building-sheets.mjs --family depot   one family (the index is rebuilt too)
 *
 * A sheet has a row per age and a column per view (r0 to r3). Each cell is the picture on grass,
 * laid onto its footprint the way the game will lay it (building-fit.mjs), at a quarter of the
 * footprint's canvas. So a picture that is too large, off centre or a little off the game's camera
 * in its file shows here as it will stand in the game. A picture that is not made yet leaves its
 * cell empty.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  AGES,
  FOOTPRINTS,
  ROOT,
  diamond,
  loadInventory,
  pictureFile,
  wallBase,
} from './building-kit.mjs';
import { fillPoly, strokePoly } from './building-guides.mjs';
import { FIT, cameraOff, fitGroup, normalisePicture } from './building-fit.mjs';
import { buildQueue, loadFamilies, progress, readQueue } from './building-queue.mjs';
import { readReport } from './building-check.mjs';

export const SHEET = {
  grass: [124, 143, 60],
  footprint: [98, 116, 48],
  shrink: 4,
  /** on the angles sheet: the footprint's edge, and the line the walls' feet should stand on */
  outline: [255, 255, 255],
  walls: [255, 60, 200],
};

export function sheetFile(family) {
  return `${ROOT}/review/${family}.png`;
}
/** The same sheet at twice the size with the footprint and the wall lines drawn over each picture. */
export function anglesFile(family) {
  return `${ROOT}/review/${family}-angles.png`;
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

function main(args) {
  const inventory = loadInventory();
  const families = loadFamilies();
  const only = args[0] === '--family' ? args[1] : null;
  const load = (file) => (existsSync(file) ? PNG.sync.read(readFileSync(file)) : null);
  const problem = (file, why) => console.log(`left out  ${file}: ${why}`);
  let n = 0;
  for (const f of inventory) {
    if (only && f.family !== only) continue;
    const file = sheetFile(f.family);
    mkdirSync(dirname(file), { recursive: true });
    const size = families.families[f.family]?.size ?? 1;
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
