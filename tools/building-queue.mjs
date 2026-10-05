/** The building work list: which pictures exist to make, how far each has got, and what to do next.
 *
 *   node tools/building-queue.mjs                 rebuild queue.json from the game's data
 *   node tools/building-queue.mjs next [--json]   the next picture to make, with its prompt
 *   node tools/building-queue.mjs show <id>       any picture, with its prompt
 *   node tools/building-queue.mjs set <id> <status> [--attempts n] [--note "text"] [--keep]
 *   node tools/building-queue.mjs status          progress per family, gates, list against disk
 *   node tools/building-queue.mjs recheck [<family>]   made pictures whose camera is off: back
 *                                                 in the queue, to be painted again
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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { AGES, FOOTPRINTS, ROOT, loadInventory, pictureFile, pictures } from './building-kit.mjs';
import { guideFile } from './building-guides.mjs';
import { checkFile, pictureOf, resultLine, writeReport } from './building-check.mjs';
import { FIT, fitPicture, normalisePicture } from './building-fit.mjs';

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
/** How often a picture is tried; after that the closest attempt is kept, or it is given up. */
const ATTEMPTS = 3;

/**
 * An earlier picture as a later one is shown it: laid onto its footprint, at the guide's camera,
 * scale and place. A generator copies what it is shown, so a picture that came back larger than
 * its guide, or with a ground line a little flat, would hand that on to every picture made from
 * it. These files are made when a picture is handed out and are not kept in git.
 */
export function fittedFile(id) {
  return `${ROOT}/.fitted/${id}.png`;
}

/**
 * Where a picture is kept while it is painted again: a picture whose camera was off goes back in
 * the queue, and this earlier self of it is what the generator is shown, laid onto its footprint,
 * so that it paints the same building.
 */
export function beforeFile(file) {
  return file.replace(/\.png$/, '.before.png');
}

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
      // kept as the closest attempt though its camera is off; to be painted again from its
      // earlier self
      ...(old?.kept ? { kept: true } : {}),
      ...(old?.repaint ? { repaint: true } : {}),
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

/**
 * Everything needed to make one picture: where to save it, what to edit, what to attach, the
 * prompt. With `repaint` the picture is one that is painted again because its camera was off: it
 * is made from its own earlier self, and `note` says what was wrong with that.
 */
export function describeEntry(id, inventory, families, { repaint = false, note = '' } = {}) {
  const m = /^(.+)-a(\d)-r(\d)$/.exec(id);
  const f = m && inventory.find((x) => x.family === m[1]);
  const age = m ? Number(m[2]) : -1;
  const rot = m ? Number(m[3]) : -1;
  if (!f || age < f.firstAge || age >= f.firstAge + f.ages || rot > 3)
    throw new Error(`no picture is called ${id}`);
  const d = families.families[f.family];
  const a = AGES[age];
  const before = beforeFile(pictureFile(f.family, age, rot));
  const ref = repaint
    ? { files: [STYLE_BOARD, before], text: families.references.repaint }
    : referencesFor(f, age, rot, families);
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
    ...(repaint && note ? [`What was wrong with it: ${note}`] : []),
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
    repaint,
    // what the picture is built on, and what the generator is shown of it
    sources: ref.files,
    references: ref.files.map((file) => {
      if (file === before) return beforeFile(fittedFile(id));
      const made = file.startsWith(`${ROOT}/`) ? pictureOf(file) : null;
      return made ? fittedFile(made.id) : file;
    }),
    prompt,
  };
}

/** How a queue entry is made: again from its earlier self while that is on disk, else afresh. */
const madeFrom = (e, exists) =>
  e?.repaint && exists(beforeFile(e.file)) ? { repaint: true, note: e.note } : {};

/** `describeEntry` for a picture as it stands in the queue. */
export function describeQueued(queue, id, inventory, families, exists = existsSync) {
  const e = queue.entries.find((x) => x.id === id);
  return describeEntry(id, inventory, families, madeFrom(e, exists));
}

/**
 * Make the fitted pictures an entry is shown, where the pictures they come from are on disk.
 * Returns the files to attach: a picture that cannot be laid onto its footprint is attached as it
 * is.
 */
export function fittedReferences(d, inventory) {
  return d.references.map((file, i) => {
    const raw = d.sources[i];
    if (file === raw || !existsSync(raw)) return file;
    if (existsSync(file) && statSync(file).mtimeMs >= statSync(raw).mtimeMs) return file;
    // a picture's earlier self is laid down as the picture itself would be
    const of = pictureOf(raw.replace(/\.before\.png$/, '.png'));
    const footprint = inventory.find((f) => f.family === of.family).footprint;
    let png;
    try {
      png = PNG.sync.read(readFileSync(raw));
    } catch {
      return raw;
    }
    const fit = fitPicture(png, footprint, of.rot);
    if (!fit) return raw;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, PNG.sync.write(normalisePicture(png, fit, footprint)));
    return file;
  });
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
      for (const file of describeEntry(e.id, inventory, families, madeFrom(e, exists)).sources) {
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
      kept: 0,
      rejected: 0,
      behind: 0,
      pending: 0,
      repaint: 0,
    };
    const s = state.get(e.id);
    row.total++;
    if (s === 'made') row.made++;
    if (s === 'made' && e.status === 'approved') row.approved++;
    // made, but with the camera off: the closest of its attempts
    if (s === 'made' && e.kept) row.kept++;
    if (s === 'rejected') row.rejected++;
    // a picture whose file is gone was not made, and nothing can be built on it
    if (s === 'behind' || s === 'lost') row.behind++;
    if (s === 'ready' || s === 'later') row.pending++;
    // of those still to make: the ones that are painted again
    if ((s === 'ready' || s === 'later') && e.repaint) row.repaint++;
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
    const counts = {
      family: row.family,
      total: row.total,
      made: row.made,
      kept: row.kept,
      rejected: row.rejected,
    };
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
  /** keep a picture beside its place while it is painted again */
  setBefore(file) {
    const to = beforeFile(file);
    rmSync(to, { force: true });
    renameSync(file, to);
  },
};

/**
 * Record a result with the disk in step: a picture counts as made only when its file is there and
 * passes the check, and a rejected picture's file is set aside so nothing is built on it.
 *
 * A picture whose camera is off is not recorded: the error says what to add to the prompt for the
 * next attempt. When the camera is still off at the third attempt, `keep` records the attempt
 * that came closest: the picture is made, the tools correct its camera as far as they can, and it
 * is marked `kept` for the user to judge. `keep` waives nothing else.
 */
export function settle(queue, inventory, id, status, options = {}, disk = DISK) {
  const e = queue.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no picture is called ${id}`);
  if (!STATUSES.includes(status))
    throw new Error(`"${status}" is not a status; use ${STATUSES.join(', ')}`);
  checkAttempts(options.attempts);
  let check = null,
    aside = null,
    kept = null;
  if (status === 'generated') {
    if (!disk.exists(e.file)) throw new Error(`not recorded: no such file ${e.file}`);
    const f = inventory.find((x) => x.family === e.family);
    const attempt = options.attempts ?? e.attempts + 1;
    if (options.keep && attempt < ATTEMPTS)
      throw new Error(
        `not recorded: --keep is for the third attempt of a picture whose camera stays off; this is attempt ${attempt}`,
      );
    check = disk.check(e.file, f.footprint, e.rot, { camera: !options.keep });
    if (!check.ok) {
      const why = `not recorded: ${check.problems.join('; ')}.`;
      if (!check.camera) throw new Error(`${why} Make ${id} again, or record it as rejected.`);
      if (check.problems.length > 1 || attempt < ATTEMPTS)
        throw new Error(`${why} Make ${id} again, adding to the prompt: "${check.camera.say}"`);
      throw new Error(
        `${why} That was attempt ${attempt}. Put back the attempt whose camera was closest and record it with --keep: it is kept, and marked for the user.`,
      );
    }
    if (options.keep && check.camera) {
      const by = check.camera.by === null ? '' : ` by ${check.camera.by.toFixed(1)}°`;
      kept = `kept with its camera off${by} after ${attempt} attempts`;
    }
  }
  if (status === 'approved' && !isMade(e))
    throw new Error(`${id} has not been made: only a picture that was made can be approved`);
  const entry = setStatus(queue, id, status, kept ? { ...options, note: kept } : options);
  if (kept) entry.kept = true;
  else if (status !== 'approved') delete entry.kept;
  // made: whatever it was made from, it is a picture like any other now
  if (status === 'generated') delete entry.repaint;
  if (status === 'rejected' && disk.exists(e.file)) {
    disk.setAside(e.file);
    aside = e.file;
  }
  return { entry, check, aside };
}

/**
 * Look again at the pictures that are made, by the check as it is today. A picture whose camera
 * is off, and nothing else wrong with it, goes back in the queue to be painted again: its file is
 * kept beside it (`beforeFile`) and the generator is shown that, so it is the same building and
 * the pictures built on it stay. Left as they are, and named: a picture the user approved, and
 * one with another fault. A picture kept as the closest of its attempts is not asked for again.
 * `only` is one family.
 */
export function recheck(queue, inventory, only = null, disk = DISK) {
  if (only && !queue.entries.some((e) => e.family === only))
    throw new Error(`no family is called ${only}`);
  const back = [],
    left = [],
    results = {};
  for (const e of queue.entries) {
    if ((only && e.family !== only) || !isMade(e) || !disk.exists(e.file)) continue;
    const f = inventory.find((x) => x.family === e.family);
    const check = disk.check(e.file, f.footprint, e.rot, { camera: !e.kept });
    results[e.id] = check;
    if (check.ok) continue;
    const camera = check.camera && check.problems.length === 1;
    if (!camera || e.status === 'approved') {
      const why = check.problems.join('; ');
      left.push({ id: e.id, why: camera ? `approved by the user; ${why}` : why });
      continue;
    }
    disk.setBefore(e.file);
    Object.assign(e, { status: 'pending', attempts: 0, note: check.camera.say, repaint: true });
    back.push({ id: e.id, problem: check.problems[0] });
  }
  return { checked: Object.keys(results).length, back, left, results };
}

/**
 * Put pictures back in the queue. A picture's id: that picture and every picture built on it, their
 * files set aside, each to be made afresh. A family's name: the family's rejected pictures, each
 * to be made as it was being made.
 */
export function redo(queue, inventory, families, target, disk = DISK) {
  const reset = (e) => {
    if (disk.exists(e.file)) disk.setAside(e.file);
    Object.assign(e, { status: 'pending', attempts: 0, note: '' });
    delete e.kept;
    return e.id;
  };
  const afresh = (e) => {
    delete e.repaint;
    return reset(e);
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
        describeEntry(e.id, inventory, families).sources.some((file) => again.has(file));
      if (built) again.add(e.file);
      return built;
    })
    .map(afresh);
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
    if (e.status === 'pending' && e.repaint && !exists(beforeFile(e.file)))
      out.push(
        `${e.id}: to be painted again, but its earlier picture is missing; it will be made afresh`,
      );
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
      `picture:    ${d.id}${d.repaint ? ' (to paint again: the same building)' : ''}`,
      `save as:    ${d.file}`,
      `ask for:    ${d.canvas[0]} x ${d.canvas[1]} px (the guide's size), transparent background`,
      `edit this:  ${d.guide}`,
      'attach, in this order:',
      ...d.references.map((f, i) => `  ${i + 1}. ${f}`),
      // what was wrong with a picture that is painted again is in its prompt
      `attempts so far: ${entry.attempts}${entry.note && !d.repaint ? ` (${entry.note})` : ''}`,
      '',
      '----- prompt -----',
      d.prompt,
      '----- end of prompt -----',
    ].join('\n'),
  );
}

/** "20 of 24 made, 2 kept with the camera off, 1 rejected, 3 not made (built on a picture that failed)" */
function tally(r) {
  return (
    `${r.made} of ${r.total} made` +
    (r.kept ? `, ${r.kept} kept with the camera off` : '') +
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
        const d = n.kind === 'picture' ? describeQueued(queue, n.id, inventory, families) : null;
        if (d) d.references = fittedReferences(d, inventory);
        console.log(JSON.stringify({ ...n, picture: d }, null, 2));
        return code;
      }
      if (n.kind === 'picture') {
        if (n.finished)
          console.log(`Family "${n.finished.family}" is finished: ${tally(n.finished)}.\n`);
        const d = describeQueued(queue, n.id, inventory, families);
        d.references = fittedReferences(d, inventory);
        printEntry(
          d,
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
      const d = describeQueued(queue, rest[0], inventory, families);
      d.references = fittedReferences(d, inventory);
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
        keep: rest.includes('--keep'),
      });
      writeQueue(queue);
      if (r.check) {
        writeReport({ [r.entry.id]: r.check });
        console.log(resultLine(r.entry.id, r.check));
      }
      console.log(
        `${r.entry.id}: ${r.entry.status}, ${r.entry.attempts} attempt${r.entry.attempts === 1 ? '' : 's'}` +
          (r.entry.kept ? ` (${r.entry.note})` : '') +
          (r.aside
            ? `; its file was set aside as ${r.aside.replace(/\.png$/, '.rejected.png')}`
            : ''),
      );
      return 0;
    }
    case 'recheck': {
      const r = recheck(queue, inventory, rest[0] ?? null);
      writeQueue(queue);
      if (r.checked) writeReport(r.results);
      console.log(
        `${r.checked} made picture${r.checked === 1 ? '' : 's'} checked: ${r.back.length} back in the queue, to be painted again as the same building (camera further than ${FIT.camera}° from the game's)`,
      );
      for (const b of r.back) console.log(`  ${b.id.padEnd(22)} ${b.problem}`);
      if (r.left.length) console.log('left as they are:');
      for (const l of r.left) console.log(`  ${l.id.padEnd(22)} ${l.why}`);
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
            (r.kept ? `, ${r.kept} kept with the camera off` : '') +
            (r.repaint ? `, ${r.repaint} to paint again` : '') +
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
