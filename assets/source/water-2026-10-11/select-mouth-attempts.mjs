import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Selection copies bytes only. No painting is processed or overwritten in raw/.
const root = path.dirname(fileURLToPath(import.meta.url));
const review = path.join(root, 'review', 'mouths-centred');
const ranges = { ne: [3, 4, 5], se: [3, 4, 5], sw: [3, 4, 5], nw: [4, 5, 6] };
const updates = [],
  selected = [];
for (const [edge, attempts] of Object.entries(ranges)) {
  const records = attempts.map((k) => {
    const id = `river-mouth-${edge}-attempt-${k}`;
    const entry = JSON.parse(fs.readFileSync(path.join(review, `${id}-record.json`), 'utf8'));
    if (entry.id !== id || (!entry.measured && !entry.error))
      throw new Error(`Incomplete call: ${id}`);
    if (entry.file !== null && entry.file !== `raw/${id}.png`)
      throw new Error(`Invalid raw path: ${id}`);
    return entry;
  });
  const candidates = records.filter((e) => e.file && e.measured);
  if (!candidates.length) throw new Error(`No returned picture for ${edge}`);
  const passes = candidates.filter((e) => e.measured.passed);
  const pool = passes.length ? passes : candidates;
  const chosen = [...pool].sort(
    (a, b) => (b.measured.overlap.iou ?? -1) - (a.measured.overlap.iou ?? -1),
  )[0];
  for (const entry of records) {
    entry.selected = entry.id === chosen.id;
    fs.writeFileSync(
      path.join(review, `${entry.id}-record.json`),
      JSON.stringify(entry, null, 2) + '\n',
    );
    updates.push(entry);
  }
  const destination = `river-mouth-${edge}.png`;
  fs.copyFileSync(path.join(root, chosen.file), path.join(root, destination));
  if (
    !fs
      .readFileSync(path.join(root, chosen.file))
      .equals(fs.readFileSync(path.join(root, destination)))
  ) {
    throw new Error(`Copy mismatch: ${destination}`);
  }
  selected.push({
    edge,
    id: chosen.id,
    file: destination,
    raw: chosen.file,
    calls: records.length,
    returnedPaintings: candidates.length,
    reason: passes.length
      ? 'passes all measured tests'
      : 'highest IoU after the three-call allowance',
    measured: chosen.measured,
  });
}
for (const journal of ['prompts.json', 'river-prompts-additions.json']) {
  const file = path.join(root, journal);
  const entries = new Map(JSON.parse(fs.readFileSync(file, 'utf8')).map((e) => [e.id, e]));
  for (const entry of updates) entries.set(entry.id, entry);
  fs.writeFileSync(file, JSON.stringify([...entries.values()], null, 2) + '\n');
}
fs.writeFileSync(path.join(review, 'selection.json'), JSON.stringify(selected, null, 2) + '\n');
console.log(
  JSON.stringify(
    selected.map((e) => ({
      edge: e.edge,
      id: e.id,
      iou: e.measured.overlap.iou,
      passed: e.measured.passed,
      box: e.measured.box.pass,
      widths: e.measured.channels.map((c) => c.waterWidth),
      offsets: e.measured.channels.map((c) => c.centreOffset),
      failures: e.measured.failures,
    })),
    null,
    2,
  ),
);
