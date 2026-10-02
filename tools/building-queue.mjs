/** The building work list: which pictures exist to make, how far each has got, and what to do next.
 *
 *   node tools/building-queue.mjs                 rebuild queue.json from the game's data
 *   node tools/building-queue.mjs next [--json]   the next picture to make, with its prompt
 *   node tools/building-queue.mjs show <id>       any picture, with its prompt
 *   node tools/building-queue.mjs set <id> <status> [--attempts n] [--note "text"]
 *   node tools/building-queue.mjs status          progress per family
 *   node tools/building-queue.mjs approve-pilot   the user has approved the pilot family
 *
 * The list comes from the game's data files (which buildings exist, their footprints and ages) and
 * from families.json (what each building is, in words). queue.json records only progress, so it
 * stays small; guides, references and prompts are worked out when asked for. A rebuild keeps what
 * was recorded: status, attempts, note, and the pilot's approval.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGES, FOOTPRINTS, ROOT, loadInventory, pictureFile, pictures } from './building-kit.mjs';
import { guideFile } from './building-guides.mjs';

export const STYLE_BOARD = 'docs/art-direction/images/03-theme-town-growth.png';
export const MOOD_EARLY = 'docs/art-direction/images/04-early-ages.png';
export const MOOD_LATE = 'docs/art-direction/images/05-future-ages.png';
export const QUEUE_FILE = `${ROOT}/queue.json`;
export const FAMILIES_FILE = `${ROOT}/families.json`;
export const STATUSES = ['pending', 'generated', 'approved', 'rejected'];
/** The family made first and shown to the user before any other. */
const PILOT = 'depot';

export function loadFamilies(root = '.') {
  return JSON.parse(readFileSync(join(root, FAMILIES_FILE), 'utf8'));
}

/** Every family of the game has a description with a line for each of its ages, and no other. */
function checkFamilies(inventory, families) {
  const known = new Set(inventory.map((f) => f.family));
  for (const name of Object.keys(families.families))
    if (!known.has(name))
      throw new Error(`families.json describes "${name}", which the game does not have`);
  for (const f of inventory) {
    const d = families.families[f.family];
    if (!d) throw new Error(`families.json has no description of "${f.family}" (${f.name})`);
    for (const key of ['what', 'keep', 'front'])
      if (!d[key]) throw new Error(`families.json: "${f.family}" has no "${key}"`);
    for (let n = 0; n < f.ages; n++) {
      const tag = AGES[f.firstAge + n].tag;
      if (!d.ages?.[tag])
        throw new Error(`families.json: "${f.family}" has no line for age ${tag}`);
    }
  }
}

/**
 * The work list. `previous` is an earlier list whose recorded progress is carried over.
 */
export function buildQueue(inventory, families, previous = null) {
  checkFamilies(inventory, families);
  const kept = new Map((previous?.entries ?? []).map((e) => [e.id, e]));
  const entries = pictures(inventory).map((p) => {
    const id = `${p.family}-a${p.age}-r${p.rot}`;
    const old = kept.get(id);
    if (old && !STATUSES.includes(old.status))
      throw new Error(
        `queue.json: ${id} has the status "${old.status}"; use ${STATUSES.join(', ')}`,
      );
    return {
      id,
      family: p.family,
      age: p.age,
      rot: p.rot,
      file: p.file,
      status: old?.status ?? 'pending',
      attempts: old?.attempts ?? 0,
      note: old?.note ?? '',
    };
  });
  return {
    schema: 1,
    guide: `${ROOT}/GUIDE.md`,
    pilot: { family: PILOT, approved: previous?.pilot?.approved === true },
    counts: { pictures: entries.length, families: inventory.length },
    entries,
  };
}

/** The pictures a new picture is made from, and the sentence that says what each is for. */
function referencesFor(f, age, rot, families) {
  const mood = age <= 2 ? MOOD_EARLY : MOOD_LATE;
  const text = families.references;
  if (rot > 0) return { files: [STYLE_BOARD, pictureFile(f.family, age, 0)], text: text.turn };
  if (age > f.firstAge)
    return {
      files: [STYLE_BOARD, pictureFile(f.family, age - 1, 0), mood],
      text: `${text.next} ${text.mood}`,
    };
  const base = families.families[f.family].base;
  if (base) return { files: [STYLE_BOARD, base, mood], text: `${text.base} ${text.mood}` };
  // no picture of its own in the game today: lean on the pilot's picture of the same age
  return {
    files: [STYLE_BOARD, pictureFile(PILOT, age, 0), mood],
    text: `${text.sibling} ${text.mood}`,
  };
}

/** Everything needed to make one picture: where to save it, what to edit, what to attach, the prompt. */
export function describeEntry(id, inventory, families) {
  const m = /^(.+)-a(\d)-r(\d)$/.exec(id);
  const f = m && inventory.find((x) => x.family === m[1]);
  const age = m ? Number(m[2]) : -1;
  const rot = m ? Number(m[3]) : -1;
  if (!f || age < f.firstAge || age >= f.firstAge + f.ages || rot > 3)
    throw new Error(`no picture is called ${id}`);
  const d = families.families[f.family];
  const a = AGES[age];
  const ref = referencesFor(f, age, rot, families);
  const position = f.upgradeable
    ? `${a.name} (model ${age - f.firstAge + 1} of ${f.ages} for this building)`
    : a.name;
  const prompt = [
    families.shared,
    `Building: ${f.name}. ${d.what}`,
    `Age: ${position}. ${families.ages[a.tag]}`,
    `This building in this age: ${d.ages[a.tag]}`,
    `Keep in every age: ${d.keep}.`,
    `Front: ${d.front}.`,
    `View r${rot}: ${families.views[`r${rot}`]}`,
    ref.text,
  ].join('\n\n');
  return {
    id,
    family: f.family,
    age,
    rot,
    file: pictureFile(f.family, age, rot),
    footprint: f.footprint,
    canvas: FOOTPRINTS[f.footprint].canvas,
    guide: guideFile(f.footprint, rot),
    references: ref.files,
    prompt,
  };
}

/**
 * What to do next: the first picture still to make whose references exist. A picture waits when the
 * picture it is turned or modernised from was never made. After the pilot family the work stops
 * until the user has approved it.
 */
export function nextEntry(queue, inventory, families, exists = existsSync) {
  const blocked = [];
  const workable = (e) => {
    if (e.status !== 'pending') return false;
    const refs = describeEntry(e.id, inventory, families).references;
    if (refs.every((f) => exists(f))) return true;
    blocked.push(e.id);
    return false;
  };
  const pilot = queue.entries.filter((e) => e.family === queue.pilot.family).find(workable);
  if (pilot) return { kind: 'picture', id: pilot.id, blocked };
  if (!queue.pilot.approved) return { kind: 'pilot', family: queue.pilot.family, blocked };
  const next = queue.entries.filter((e) => e.family !== queue.pilot.family).find(workable);
  // name every waiting picture, not only those before the one handed out
  for (const e of queue.entries) if (e !== next && !blocked.includes(e.id)) workable(e);
  return next ? { kind: 'picture', id: next.id, blocked } : { kind: 'done', blocked };
}

/** Record how a picture got on. Attempts count up by one unless a number is given. */
export function setStatus(queue, id, status, { attempts, note } = {}) {
  if (!STATUSES.includes(status))
    throw new Error(`"${status}" is not a status; use ${STATUSES.join(', ')}`);
  const e = queue.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no picture is called ${id}`);
  e.status = status;
  e.attempts = attempts ?? e.attempts + 1;
  e.note = note ?? '';
  return e;
}

/** Progress per family, for the status command and the review index. */
export function progress(queue) {
  const out = new Map();
  for (const e of queue.entries) {
    const row = out.get(e.family) ?? {
      family: e.family,
      total: 0,
      pending: 0,
      generated: 0,
      approved: 0,
      rejected: 0,
    };
    row.total++;
    row[e.status]++;
    out.set(e.family, row);
  }
  return [...out.values()];
}

export function readQueue(root = '.') {
  const file = join(root, QUEUE_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
function writeQueue(queue) {
  writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2) + '\n');
}

function printEntry(d, entry) {
  console.log(
    [
      `picture:    ${d.id}`,
      `save as:    ${d.file}`,
      `canvas:     ${d.canvas[0]} x ${d.canvas[1]} px, transparent background`,
      `edit this:  ${d.guide}`,
      'attach, in this order:',
      ...d.references.map((f, i) => `  ${i + 1}. ${f}`),
      `attempts so far: ${entry.attempts}${entry.note ? ` (${entry.note})` : ''}`,
      '',
      '----- prompt -----',
      d.prompt,
      '----- end of prompt -----',
    ].join('\n'),
  );
}

function main(args) {
  const [command, ...rest] = args;
  const inventory = loadInventory();
  const families = loadFamilies();
  const queue = buildQueue(inventory, families, readQueue());
  const option = (name) => {
    const i = rest.indexOf(name);
    return i < 0 ? undefined : rest[i + 1];
  };
  switch (command) {
    case undefined:
      writeQueue(queue);
      console.log(`${queue.counts.pictures} pictures, ${queue.counts.families} families`);
      return 0;
    case 'next': {
      const n = nextEntry(queue, inventory, families);
      if (rest.includes('--json')) {
        const d = n.kind === 'picture' ? describeEntry(n.id, inventory, families) : null;
        console.log(JSON.stringify({ ...n, picture: d }, null, 2));
      } else if (n.kind === 'picture') {
        printEntry(
          describeEntry(n.id, inventory, families),
          queue.entries.find((e) => e.id === n.id),
        );
      } else if (n.kind === 'pilot') {
        console.log(
          `PILOT GATE. Every picture of "${n.family}" has been tried. Stop here: build its review sheet, commit, and wait for the user to approve the pilot (node tools/building-queue.mjs approve-pilot).`,
        );
      } else console.log('DONE. No picture is left to make.');
      if (n.blocked.length && !rest.includes('--json'))
        console.log(`\nwaiting for a picture that was never made: ${n.blocked.join(', ')}`);
      // 0: a picture to make; 2: the pilot gate; 3: nothing left
      return n.kind === 'picture' ? 0 : n.kind === 'pilot' ? 2 : 3;
    }
    case 'show': {
      const d = describeEntry(rest[0], inventory, families);
      printEntry(
        d,
        queue.entries.find((e) => e.id === d.id),
      );
      return 0;
    }
    case 'set': {
      const attempts = option('--attempts');
      const e = setStatus(queue, rest[0], rest[1], {
        attempts: attempts === undefined ? undefined : Number(attempts),
        note: option('--note'),
      });
      writeQueue(queue);
      console.log(`${e.id}: ${e.status}, ${e.attempts} attempt${e.attempts === 1 ? '' : 's'}`);
      return 0;
    }
    case 'approve-pilot':
      queue.pilot.approved = true;
      writeQueue(queue);
      console.log(`pilot "${queue.pilot.family}" approved`);
      return 0;
    case 'status': {
      for (const r of progress(queue))
        console.log(
          `${r.family.padEnd(16)} ${String(r.total - r.pending).padStart(3)}/${String(r.total).padEnd(3)} done` +
            (r.rejected ? `, ${r.rejected} rejected` : ''),
        );
      console.log(
        `pilot "${queue.pilot.family}": ${queue.pilot.approved ? 'approved' : 'not approved yet'}`,
      );
      return 0;
    }
    default:
      console.error(`unknown command "${command}"; see the top of tools/building-queue.mjs`);
      return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
