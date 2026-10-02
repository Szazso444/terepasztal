/** Review sheets of the building pictures: one sheet per family and an index page.
 *
 *   node tools/building-sheets.mjs                  every family
 *   node tools/building-sheets.mjs --family depot   one family (the index is rebuilt too)
 *
 * A sheet has a row per age and a column per view (r0 to r3). Each cell is the picture at a
 * quarter of its size on grass, standing on its footprint, as it will in the game. A picture that
 * is not made yet leaves its cell empty.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { AGES, FOOTPRINTS, ROOT, diamond, loadInventory, pictureFile } from './building-kit.mjs';
import { fillPoly } from './building-guides.mjs';
import { buildQueue, loadFamilies, progress, readQueue } from './building-queue.mjs';
import { REPORT_FILE } from './building-check.mjs';

export const SHEET = { grass: [124, 143, 60], footprint: [98, 116, 48], shrink: 4 };

export function sheetFile(family) {
  return `${ROOT}/review/${family}.png`;
}

/** Lay a picture into the sheet at (ox, oy), averaged down by SHEET.shrink over what is there. */
function paste(sheet, pic, ox, oy) {
  const k = SHEET.shrink;
  for (let y = 0; y < Math.floor(pic.height / k); y++)
    for (let x = 0; x < Math.floor(pic.width / k); x++) {
      let a = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let j = 0; j < k; j++)
        for (let i = 0; i < k; i++) {
          const o = ((y * k + j) * pic.width + x * k + i) * 4;
          const pa = pic.data[o + 3];
          a += pa;
          r += pic.data[o] * pa;
          g += pic.data[o + 1] * pa;
          b += pic.data[o + 2] * pa;
        }
      if (!a) continue;
      const cover = a / (255 * k * k);
      const t = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data[t] = Math.round((r / a) * cover + sheet.data[t] * (1 - cover));
      sheet.data[t + 1] = Math.round((g / a) * cover + sheet.data[t + 1] * (1 - cover));
      sheet.data[t + 2] = Math.round((b / a) * cover + sheet.data[t + 2] * (1 - cover));
    }
}

/** One family's sheet. `load(file)` returns the picture as a PNG, or null when it is not made. */
export function drawSheet(f, load) {
  const fp = FOOTPRINTS[f.footprint];
  const k = SHEET.shrink;
  const cw = fp.canvas[0] / k,
    ch = fp.canvas[1] / k;
  const sheet = new PNG({ width: cw * 4, height: ch * f.ages });
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = SHEET.grass[0];
    sheet.data[i + 1] = SHEET.grass[1];
    sheet.data[i + 2] = SHEET.grass[2];
    sheet.data[i + 3] = 255;
  }
  for (let row = 0; row < f.ages; row++)
    for (let rot = 0; rot < 4; rot++) {
      const ox = rot * cw,
        oy = row * ch;
      const d = diamond(fp, rot);
      fillPoly(
        sheet,
        [d.n, d.e, d.s, d.w].map(([x, y]) => [ox + x / k, oy + y / k]),
        SHEET.footprint,
      );
      const pic = load(pictureFile(f.family, f.firstAge + row, rot));
      if (pic && pic.width === fp.canvas[0] && pic.height === fp.canvas[1])
        paste(sheet, pic, ox, oy);
    }
  return sheet;
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/** The index page: every family with its sheet, its progress and what the check found. */
export function indexHtml(inventory, queue, report) {
  const rows = new Map(progress(queue).map((r) => [r.family, r]));
  const sections = inventory.map((f) => {
    const p = rows.get(f.family);
    const done = p.total - p.pending;
    const ages = AGES.slice(f.firstAge, f.firstAge + f.ages)
      .map((a) => a.name)
      .join(', ');
    const failed = queue.entries
      .filter((e) => e.family === f.family)
      .map((e) => ({ e, check: report?.pictures?.[e.id] }))
      .filter(({ e, check }) => e.status === 'rejected' || (check && !check.ok))
      .map(
        ({ e, check }) =>
          `<li><code>${esc(e.id)}</code> ${esc(e.status)}${
            check && !check.ok ? `: ${esc(check.problems.join('; '))}` : ''
          }${e.note ? ` <em>(${esc(e.note)})</em>` : ''}</li>`,
      );
    return `<section id="${esc(f.family)}">
  <h2>${esc(f.name)} <small>${esc(f.family)}</small></h2>
  <p>${done} of ${p.total} made${p.approved ? `, ${p.approved} approved` : ''}${
    p.rejected ? `, ${p.rejected} rejected` : ''
  }. Rows: ${esc(ages)}. Columns: r0 (front lower left), r1, r2, r3 (front lower right).</p>
  <img src="${esc(f.family)}.png" alt="${esc(f.name)}: every age and view" loading="lazy" />
  ${failed.length ? `<ul>${failed.join('')}</ul>` : ''}
</section>`;
  });
  const total = queue.entries.length;
  const made = queue.entries.filter((e) => e.status !== 'pending').length;
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
  code { color: inherit; }
</style>
<h1>Building pictures</h1>
<p>${made} of ${total} made. Pilot "${esc(queue.pilot.family)}": ${
    queue.pilot.approved ? 'approved' : 'waiting for approval'
  }.</p>
${sections.join('\n')}
`;
}

function main(args) {
  const inventory = loadInventory();
  const only = args[0] === '--family' ? args[1] : null;
  const load = (file) => (existsSync(file) ? PNG.sync.read(readFileSync(file)) : null);
  let n = 0;
  for (const f of inventory) {
    if (only && f.family !== only) continue;
    const file = sheetFile(f.family);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, PNG.sync.write(drawSheet(f, load)));
    n++;
  }
  if (only && !n) {
    console.error(`no family is called "${only}"`);
    return 1;
  }
  const queue = buildQueue(inventory, loadFamilies(), readQueue());
  const report = existsSync(REPORT_FILE) ? JSON.parse(readFileSync(REPORT_FILE, 'utf8')) : null;
  writeFileSync(`${ROOT}/review/index.html`, indexHtml(inventory, queue, report));
  console.log(`${n} sheet${n === 1 ? '' : 's'} and the index in ${ROOT}/review`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
