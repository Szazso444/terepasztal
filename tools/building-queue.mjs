/** The building work list: which pictures exist to make, how far each has got, and what to do next.
 *
 *   node tools/building-queue.mjs                 rebuild queue.json from the game's data
 *   node tools/building-queue.mjs next [--json]   the next picture to make, with its prompt
 *   node tools/building-queue.mjs show <id>       any picture, with its prompt
 *   node tools/building-queue.mjs set <id> <status> [--attempts n] [--note "text"]
 *   node tools/building-queue.mjs status          progress per family, gates, list against disk
 *   node tools/building-queue.mjs redo <id>       a picture and all built on it: to do again
 *   node tools/building-queue.mjs redo <family>   a family's rejected pictures: to do again
 *   node tools/building-queue.mjs approve-pilot [--all]   the user has approved the next gate
 *   node tools/building-queue.mjs accept <family>         the user accepts a family's losses
 *
 * The list comes from the game's data files (which buildings exist, their footprints and ages) and
 * from families.json (what each building is, in words). queue.json records only progress, so it
 * stays small; guides, references and prompts are worked out when asked for. A rebuild keeps what
 * was recorded: status, attempts, note, approvals.
 *
 * `next` answers with its exit code: 0 a picture to make, 2 a gate (the user reviews a family
 * before the work goes on), 3 nothing left, 4 a stop (too much of a family could not be made).
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGES, FOOTPRINTS, ROOT, loadInventory, pictureFile, pictures } from './building-kit.mjs';
import { guideFile } from './building-guides.mjs';
import { checkFile, resultLine, writeReport } from './building-check.mjs';

export const STYLE_BOARD = 'docs/art-direction/images/03-theme-town-growth.png';
export const MOOD_EARLY = 'docs/art-direction/images/04-early-ages.png';
export const MOOD_LATE = 'docs/art-direction/images/05-future-ages.png';
export const QUEUE_FILE = `${ROOT}/queue.json`;
export const FAMILIES_FILE = `${ROOT}/families.json`;
export const STATUSES = ['pending', 'generated', 'approved', 'rejected'];
/** The family made first; a building with no picture of its own today leans on its pictures. */
const PILOT = 'depot';
/**
 * The families shown to the user before the work goes on: the depot is the only two-by-two
 * building, the station the first of the one-tile ones.
 */
const GATES = [PILOT, 'station'];
/** A family that lost more than this share of its pictures stops the work. */
const LOSS = 0.25;

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
  const approved = (family) =>
    previous?.gates?.find((g) => g.family === family)?.approved === true ||
    // a list written when the depot was the only gate
    (previous?.pilot?.family === family && previous.pilot.approved === true);
  const families_ = new Set(inventory.map((f) => f.family));
  return {
    schema: 2,
    guide: `${ROOT}/GUIDE.md`,
    gates: GATES.map((family) => ({ family, approved: approved(family) })),
    accepted: (previous?.accepted ?? []).filter((f) => families_.has(f)),
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
    `Building: ${d.title ?? f.name}. ${d.what}`,
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

const isMade = (e) => e.status === 'generated' || e.status === 'approved';

/**
 * Where every picture stands: `made`, `rejected`, `lost` (recorded as made, its file gone),
 * `ready` (to make now), `later` (its turn has not come), `behind` (built on a picture that was
 * rejected or lost, so it cannot be made). A missing board or base picture is a fault of the set-up,
 * not of a picture, and is thrown by name.
 */
function standings(queue, inventory, families, exists) {
  const byFile = new Map(queue.entries.map((e) => [e.file, e]));
  const state = new Map();
  const of = (e) => {
    if (state.has(e.id)) return state.get(e.id);
    let s;
    if (e.status === 'rejected') s = 'rejected';
    else if (isMade(e)) s = exists(e.file) ? 'made' : 'lost';
    else {
      s = 'ready';
      for (const file of describeEntry(e.id, inventory, families).references) {
        const on = byFile.get(file);
        if (!on) {
          if (!exists(file)) throw new Error(`${e.id} needs ${file}, which is not there`);
          continue;
        }
        const t = of(on);
        if (t === 'rejected' || t === 'lost' || t === 'behind') {
          s = 'behind';
          break;
        }
        if (t !== 'made') s = 'later';
      }
    }
    state.set(e.id, s);
    return s;
  };
  for (const e of queue.entries) of(e);
  return state;
}

/** Progress per family, in the list's order. */
export function progress(queue, inventory, families, exists = existsSync) {
  const state = standings(queue, inventory, families, exists);
  const out = new Map();
  for (const e of queue.entries) {
    const row = out.get(e.family) ?? {
      family: e.family,
      total: 0,
      made: 0,
      approved: 0,
      rejected: 0,
      behind: 0,
      pending: 0,
    };
    const s = state.get(e.id);
    row.total++;
    if (s === 'made') row.made++;
    if (s === 'made' && e.status === 'approved') row.approved++;
    if (s === 'rejected') row.rejected++;
    // a picture whose file is gone was not made, and nothing can be built on it
    if (s === 'behind' || s === 'lost') row.behind++;
    if (s === 'ready' || s === 'later') row.pending++;
    out.set(e.family, row);
  }
  return [...out.values()];
}

/**
 * What to do next. Families are worked in the list's order, a family's pictures each as soon as
 * the picture it is turned or modernised from is made. A finished gate family waits for the user;
 * any other finished family that lost more than a quarter of its pictures stops the work until
 * the user accepts the loss or the pictures are put back with `redo`.
 */
export function nextEntry(queue, inventory, families, exists = existsSync) {
  const state = standings(queue, inventory, families, exists);
  const rows = progress(queue, inventory, families, exists);
  const pick = (ok) => queue.entries.filter((e) => ok(state.get(e.id))).map((e) => e.id);
  const facts = { behind: pick((s) => s === 'behind'), lost: pick((s) => s === 'lost') };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ready = queue.entries.find((e) => e.family === row.family && state.get(e.id) === 'ready');
    if (ready) {
      // the first picture of a family: say how the family before it ended
      const started = row.made + row.rejected > 0;
      return {
        kind: 'picture',
        id: ready.id,
        ...facts,
        finished: !started && i ? rows[i - 1] : null,
      };
    }
    const gate = queue.gates.find((g) => g.family === row.family);
    const counts = { family: row.family, total: row.total, made: row.made, rejected: row.rejected };
    if (gate && !gate.approved)
      return { kind: 'gate', ...counts, behind: row.behind, lost: facts.lost };
    const lostShare = (row.rejected + row.behind) / row.total;
    if (!gate && lostShare > LOSS && !queue.accepted.includes(row.family))
      return { kind: 'stop', ...counts, behind: row.behind, lost: facts.lost };
  }
  return { kind: 'done', ...facts };
}

function checkAttempts(attempts) {
  if (attempts !== undefined && !(Number.isInteger(attempts) && attempts >= 0))
    throw new Error('--attempts takes a whole number, for example --attempts 2');
}

/**
 * Record how a picture got on. A picture made or given up counts one attempt unless a number is
 * given; an approval counts none. A note stays until a new one is given or the picture is made.
 */
export function setStatus(queue, id, status, { attempts, note } = {}) {
  if (!STATUSES.includes(status))
    throw new Error(`"${status}" is not a status; use ${STATUSES.join(', ')}`);
  const e = queue.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no picture is called ${id}`);
  checkAttempts(attempts);
  const counts = status === 'generated' || status === 'rejected';
  e.attempts = attempts ?? e.attempts + (counts ? 1 : 0);
  e.note = note ?? (status === 'generated' || status === 'pending' ? '' : e.note);
  e.status = status;
  return e;
}

/** The files a command touches: is a file there, does a picture pass, move a picture aside. */
const DISK = {
  exists: existsSync,
  check: checkFile,
  setAside(file) {
    const to = file.replace(/\.png$/, '.rejected.png');
    rmSync(to, { force: true });
    renameSync(file, to);
  },
};

/**
 * Record a result with the disk in step: a picture counts as made only when its file is there and
 * passes the check, and a rejected picture's file is set aside so nothing is built on it.
 */
export function settle(queue, inventory, id, status, options = {}, disk = DISK) {
  const e = queue.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no picture is called ${id}`);
  if (!STATUSES.includes(status))
    throw new Error(`"${status}" is not a status; use ${STATUSES.join(', ')}`);
  checkAttempts(options.attempts);
  let check = null,
    aside = null;
  if (status === 'generated') {
    if (!disk.exists(e.file)) throw new Error(`not recorded: no such file ${e.file}`);
    const f = inventory.find((x) => x.family === e.family);
    check = disk.check(e.file, f.footprint, e.rot);
    if (!check.ok)
      throw new Error(
        `not recorded: ${check.problems.join('; ')}. Make ${id} again, or record it as rejected.`,
      );
  }
  if (status === 'approved' && !isMade(e))
    throw new Error(`${id} has not been made: only a picture that was made can be approved`);
  const entry = setStatus(queue, id, status, options);
  if (status === 'rejected' && disk.exists(e.file)) {
    disk.setAside(e.file);
    aside = e.file;
  }
  return { entry, check, aside };
}

/**
 * Put pictures back in the queue. A picture's id: that picture and every picture built on it, their
 * files set aside. A family's name: the family's rejected pictures.
 */
export function redo(queue, inventory, families, target, disk = DISK) {
  const reset = (e) => {
    if (disk.exists(e.file)) disk.setAside(e.file);
    Object.assign(e, { status: 'pending', attempts: 0, note: '' });
    return e.id;
  };
  if (queue.entries.some((e) => e.family === target))
    return queue.entries.filter((e) => e.family === target && e.status === 'rejected').map(reset);
  const first = queue.entries.find((e) => e.id === target);
  if (!first) throw new Error(`no picture or family is called ${target}`);
  const again = new Set([first.file]);
  // the list is in working order, so a picture always comes after the one it is built on
  return queue.entries
    .filter((e) => {
      const built =
        e === first ||
        describeEntry(e.id, inventory, families).references.some((file) => again.has(file));
      if (built) again.add(e.file);
      return built;
    })
    .map(reset);
}

/** The user has looked at a gate family: approve the first gate still closed, or all of them. */
export function approveGate(queue, all = false) {
  const open = queue.gates.filter((g) => !g.approved).slice(0, all ? undefined : 1);
  for (const g of open) g.approved = true;
  return open.map((g) => g.family);
}

/** The user accepts that a family lost pictures: the work goes on past it. */
export function accept(queue, family) {
  if (!queue.entries.some((e) => e.family === family))
    throw new Error(`no family is called ${family}`);
  if (!queue.accepted.includes(family)) queue.accepted.push(family);
}

/** Where the list and the disk disagree, one line each. */
export function mismatches(queue, exists = existsSync) {
  const out = [];
  for (const e of queue.entries) {
    const there = exists(e.file);
    if (isMade(e) && !there) out.push(`${e.id}: recorded as made, but its file is missing`);
    if (e.status === 'rejected' && there)
      out.push(`${e.id}: rejected, but its file is still on disk`);
    if (e.status === 'pending' && there) out.push(`${e.id}: on disk, but not recorded`);
  }
  return out;
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
      `ask for:    ${d.canvas[0]} x ${d.canvas[1]} px (the guide's size), transparent background`,
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

/** "20 of 24 made, 1 rejected, 3 not made (built on a picture that failed)" */
function tally(r) {
  return (
    `${r.made} of ${r.total} made` +
    (r.rejected ? `, ${r.rejected} rejected` : '') +
    (r.behind ? `, ${r.behind} not made (built on a picture that failed)` : '')
  );
}
const some = (ids, n = 6) =>
  ids.slice(0, n).join(', ') + (ids.length > n ? ` and ${ids.length - n} more` : '');

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
      const code = { picture: 0, gate: 2, done: 3, stop: 4 }[n.kind];
      if (rest.includes('--json')) {
        const d = n.kind === 'picture' ? describeEntry(n.id, inventory, families) : null;
        console.log(JSON.stringify({ ...n, picture: d }, null, 2));
        return code;
      }
      if (n.kind === 'picture') {
        if (n.finished)
          console.log(`Family "${n.finished.family}" is finished: ${tally(n.finished)}.\n`);
        printEntry(
          describeEntry(n.id, inventory, families),
          queue.entries.find((e) => e.id === n.id),
        );
        if (n.behind.length)
          console.log(
            `\n${n.behind.length} picture${n.behind.length === 1 ? '' : 's'} cannot be made, built on a picture that failed: ${some(n.behind)}`,
          );
      } else if (n.kind === 'gate')
        console.log(
          `GATE. The pictures of "${n.family}" are finished: ${tally(n)}. Stop here: check the family, build its review sheet, commit, and tell the user. The work goes on when the user has approved it (node tools/building-queue.mjs approve-pilot).`,
        );
      else if (n.kind === 'stop')
        console.log(
          `STOP. Too much of "${n.family}" could not be made: ${tally(n)}. Tell the user what kept going wrong. The work goes on when the pictures are put back (node tools/building-queue.mjs redo ${n.family}) or the user accepts the loss (node tools/building-queue.mjs accept ${n.family}).`,
        );
      else console.log('DONE. No picture is left to make.');
      if (n.lost.length)
        console.log(`\nrecorded as made, but the file is missing: ${some(n.lost)}`);
      return code;
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
      const r = settle(queue, inventory, rest[0], rest[1], {
        attempts: attempts === undefined ? undefined : Number(attempts),
        note: option('--note'),
      });
      writeQueue(queue);
      if (r.check) {
        writeReport({ [r.entry.id]: r.check });
        console.log(resultLine(r.entry.id, r.check));
      }
      console.log(
        `${r.entry.id}: ${r.entry.status}, ${r.entry.attempts} attempt${r.entry.attempts === 1 ? '' : 's'}` +
          (r.aside
            ? `; its file was set aside as ${r.aside.replace(/\.png$/, '.rejected.png')}`
            : ''),
      );
      return 0;
    }
    case 'redo': {
      const ids = redo(queue, inventory, families, rest[0]);
      writeQueue(queue);
      console.log(
        `${ids.length} picture${ids.length === 1 ? '' : 's'} back in the queue${ids.length ? `: ${some(ids)}` : ''}`,
      );
      return 0;
    }
    case 'approve-pilot': {
      const done = approveGate(queue, rest.includes('--all'));
      writeQueue(queue);
      console.log(
        done.length ? done.map((f) => `"${f}" approved`).join(', ') : 'no gate is waiting',
      );
      return 0;
    }
    case 'accept':
      accept(queue, rest[0]);
      writeQueue(queue);
      console.log(`the losses of "${rest[0]}" are accepted`);
      return 0;
    case 'status': {
      for (const r of progress(queue, inventory, families))
        console.log(
          `${r.family.padEnd(16)} ${`${r.made}/${r.total}`.padStart(6)} made` +
            (r.rejected ? `, ${r.rejected} rejected` : '') +
            (r.behind ? `, ${r.behind} not made (built on a picture that failed)` : ''),
        );
      for (const g of queue.gates)
        console.log(`gate "${g.family}": ${g.approved ? 'approved' : 'not approved yet'}`);
      if (queue.accepted.length) console.log(`losses accepted: ${queue.accepted.join(', ')}`);
      for (const line of mismatches(queue)) console.log(`mismatch  ${line}`);
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
