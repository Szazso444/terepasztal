/** The building work list: which pictures exist to make, how far each has got, and what to do next.
 *
 *   node tools/building-queue.mjs                 rebuild queue.json from the game's data
 *   node tools/building-queue.mjs next [--json]   the next picture to make, with its prompt
 *   node tools/building-queue.mjs take <id> [--from <folder or file>]   the picture the image
 *                                                 tool just made: written to the picture's
 *                                                 file, and shown for the eye
 *   node tools/building-queue.mjs show <id>       any picture, with its prompt
 *   node tools/building-queue.mjs set <id> <status> [--attempts n] [--note "text"]
 *   node tools/building-queue.mjs keep <id>       the closest attempt the tool holds becomes
 *                                                 the picture, where it would be given up
 *   node tools/building-queue.mjs status          progress per family, gates, list against disk
 *   node tools/building-queue.mjs recheck [<family>]   made pictures whose camera is off: back
 *                                                 in the queue, to be painted again
 *   node tools/building-queue.mjs redo <id> [--yes]   a picture and all built on it: afresh
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
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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
      ...(old?.kept ? { kept: old.kept } : {}),
      ...(old?.repaint ? { repaint: old.repaint } : {}),
      // taken from the image tool, not looked at and recorded yet
      ...(old?.taken ? { taken: true } : {}),
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

/**
 * How a queue entry is made: again from its earlier self while that is on disk, else afresh.
 * `repaint` holds what was wrong with the earlier self (`was`) and how far off its camera was
 * (`by`); a list written when it was only a mark has the words in the note.
 */
const madeFrom = (e, exists) =>
  e?.repaint && exists(beforeFile(e.file))
    ? { repaint: true, note: typeof e.repaint === 'object' ? e.repaint.was : e.note }
    : {};

/**
 * `describeEntry` for a picture as it stands in the queue. For one that is painted again,
 * `earlier` is its earlier self and how far off its camera was: it counts when the closest
 * attempt is chosen.
 */
export function describeQueued(queue, id, inventory, families, exists = existsSync) {
  const e = queue.entries.find((x) => x.id === id);
  const d = describeEntry(id, inventory, families, madeFrom(e, exists));
  if (d.repaint)
    d.earlier = {
      file: beforeFile(e.file),
      by: typeof e.repaint === 'object' ? e.repaint.by : null,
    };
  return d;
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
    // all the way, however far off: a later picture copies the wall feet it is shown
    const fit = fitPicture(png, footprint, of.rot, { fully: true });
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
      far: 0,
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
    // of those: the ones not near enough, which are held against the family
    if (s === 'made' && e.kept && !(typeof e.kept === 'number' && e.kept <= FIT.near)) row.far++;
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
 * any other finished family stops the work when more than a quarter of its pictures were lost
 * (rejected, or built on a rejected one) or kept with the camera far off, until the user accepts
 * it as it is or the pictures are put back.
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
      far: row.far,
      rejected: row.rejected,
    };
    if (gate && !gate.approved)
      return { kind: 'gate', ...counts, behind: row.behind, lost: facts.lost };
    const lostShare = (row.rejected + row.behind + row.far) / row.total;
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

/**
 * Move a picture to another name. A picture already under that name is kept too, under a
 * number: nothing that was painted is ever removed.
 */
function moveTo(file, to) {
  if (existsSync(to)) {
    let n = 1;
    while (existsSync(to.replace(/\.png$/, `.${n}.png`))) n++;
    renameSync(to, to.replace(/\.png$/, `.${n}.png`));
  }
  renameSync(file, to);
}

/** The files a command touches: is a file there, does a picture pass, move a picture aside. */
const DISK = {
  exists: existsSync,
  check: checkFile,
  setAside(file) {
    moveTo(file, file.replace(/\.png$/, '.rejected.png'));
  },
  /** keep a picture beside its place while it is painted again */
  setBefore(file) {
    moveTo(file, beforeFile(file));
  },
  /** keep an attempt that was not the closest: beside the earlier self, under a number */
  shelve(file) {
    const to = beforeFile(file);
    let n = 1;
    while (existsSync(to.replace(/\.png$/, `.${n}.png`))) n++;
    renameSync(file, to.replace(/\.png$/, `.${n}.png`));
  },
  /** make the earlier self the picture again; it stays where it is as well */
  restoreBefore(file) {
    copyFileSync(beforeFile(file), file);
  },
  /**
   * Clear a picture that lies under its name though it is not made. A copy of a picture that is
   * kept already (the earlier self, or the one set aside) is removed. Anything else is kept
   * beside the earlier self under a number when `keepBeside` says so, and left where it is
   * otherwise: it may be a new picture that waits to be recorded. Says whether it was cleared.
   */
  clearStray(file, keepBeside) {
    const bytes = readFileSync(file);
    const same = (kept) =>
      existsSync(kept) && statSync(kept).size === bytes.length && readFileSync(kept).equals(bytes);
    if (same(beforeFile(file)) || same(file.replace(/\.png$/, '.rejected.png'))) rmSync(file);
    else if (keepBeside) this.shelve(file);
    else return false;
    return true;
  },
};

/**
 * Is a camera `a` degrees off closer to the game's than one `b` degrees off? A camera not told
 * in degrees (one wall foot only was measured) is taken for the further.
 */
const closer = (a, b) =>
  typeof a === 'number' ? typeof b !== 'number' || a < b : typeof b !== 'number';

/** The earlier self a picture is painted from, where it has one on disk. */
const earlierSelf = (e, disk) => (e.repaint && disk.exists(beforeFile(e.file)) ? e.repaint : null);
const degrees = (by) => (typeof by === 'number' ? ` by ${by.toFixed(1)}°` : '');

/**
 * Record a result with the disk in step: a picture counts as made only when its file is there and
 * passes the check, and a rejected picture's file is set aside so nothing is built on it.
 *
 * A picture that fails the check is not made, but it was tried: the attempt is counted in the
 * list, and the error thrown carries `refused` so that the list is saved all the same.
 *
 * A picture refused for its camera alone is kept: the closest attempt so far is the picture's
 * earlier self (`beforeFile`), the others lie beside it under numbers, and the next attempt is
 * painted from the earlier self, straightened. An attempt painted from a picture whose wall
 * feet already run right comes closer than one made again from scratch with a sentence added;
 * and the agent has nothing to copy, to add or to choose. At the last attempt the closest of
 * them all becomes the picture: made, corrected by the tools as far as they correct, and marked
 * `kept` with how far off it is, for the user to judge.
 */
export function settle(queue, inventory, id, status, options = {}, disk = DISK) {
  const e = queue.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no picture is called ${id}`);
  if (!STATUSES.includes(status))
    throw new Error(`"${status}" is not a status; use ${STATUSES.join(', ')}`);
  checkAttempts(options.attempts);
  // whatever comes of it, the picture in hand is settled now
  delete e.taken;
  let check = null,
    aside = null,
    kept = null;
  if (status === 'generated') {
    if (!disk.exists(e.file)) throw new Error(`not recorded: no such file ${e.file}`);
    const f = inventory.find((x) => x.family === e.family);
    // which attempt this is: one more than were counted, or the number given where that is
    // higher (attempts the tool never saw). A lower one is an agent that has lost count
    const attempt = Math.max(options.attempts ?? 0, e.attempts + 1);
    check = disk.check(e.file, f.footprint, e.rot);
    if (!check.ok) {
      // not made, but tried: counted, so that a later session knows where the picture stands
      e.attempts = Math.max(e.attempts, attempt);
      const refuse = (what) =>
        Object.assign(new Error(`not recorded: ${check.problems.join('; ')}. ${what}`), {
          refused: true,
        });
      if (!check.camera || check.problems.length > 1)
        throw refuse(`Make ${id} again, or record it as rejected.`);
      const again = 'run `node tools/building-queue.mjs next` again';
      const earlier = earlierSelf(e, disk);
      const closest = !earlier || closer(check.camera.by, earlier.by);
      if (attempt < ATTEMPTS) {
        if (closest) {
          disk.setBefore(e.file);
          e.repaint = { by: check.camera.by, was: check.camera.was };
          throw refuse(
            `It is kept as the picture's earlier self: ${again}, and it is handed out to be painted from that, straightened.`,
          );
        }
        disk.shelve(e.file);
        throw refuse(
          `An earlier attempt was closer${degrees(earlier.by).replace(' by ', ' (')}${typeof earlier.by === 'number' ? ')' : ''} and stays what the picture is painted from: ${again}.`,
        );
      }
      // the last attempt: the closest of them all is the picture
      if (!closest) {
        disk.shelve(e.file);
        disk.restoreBefore(e.file);
      }
      check = disk.check(e.file, f.footprint, e.rot, { camera: false });
      if (!check.ok) throw refuse(`Make ${id} again, or record it as rejected.`);
      const by = check.camera?.by;
      kept = {
        by: typeof by === 'number' ? by : true,
        note: `kept with its camera off${degrees(by)} after ${attempt} attempts${closest ? '' : ': an earlier one was the closest'}`,
      };
    }
    options = { ...options, attempts: attempt };
  }
  if (status === 'approved' && !isMade(e))
    throw new Error(`${id} has not been made: only a picture that was made can be approved`);
  // a made picture taken back is a picture found faulty: its file goes aside like a rejected one
  const takenBack = status === 'pending' && isMade(e);
  const entry = setStatus(queue, id, status, kept ? { ...options, note: kept.note } : options);
  if (kept) entry.kept = kept.by;
  else if (status !== 'approved') delete entry.kept;
  // `repaint` stays when the picture is made: taken back (`pending`), it is painted again the
  // way it was, from its earlier self
  if ((status === 'rejected' || takenBack) && disk.exists(e.file)) {
    disk.setAside(e.file);
    aside = e.file;
  }
  return { entry, check, aside };
}

/**
 * Make the closest attempt the tool holds the picture, where the picture would be given up: its
 * last attempt failed for another reason than the camera, but an earlier one was right and was
 * refused for its camera alone (`beforeFile`). It is recorded as made and marked `kept`, like the
 * closest of three attempts; the attempt that lies under the picture's name goes aside. A picture
 * that was rejected already is kept the same way.
 *
 * Only at the last attempt: before that the picture is made again. The count is the tool's own
 * (a picture in hand is one more attempt); a number given can raise it, as with `set`.
 */
export function keepEarlier(queue, inventory, id, options = {}, disk = DISK) {
  const e = queue.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no picture is called ${id}`);
  if (isMade(e))
    throw new Error(`${id} is recorded as ${e.status}: there is nothing to keep in its place`);
  checkAttempts(options.attempts);
  if (!earlierSelf(e, disk))
    throw new Error(
      `the tool holds no picture of ${id} whose only fault was its camera: make it again, or record it as rejected`,
    );
  const attempts = Math.max(options.attempts ?? 0, e.attempts + (e.taken ? 1 : 0));
  if (attempts < ATTEMPTS)
    throw new Error(
      `${id} has had ${attempts} attempt${attempts === 1 ? '' : 's'}: an attempt is kept at the last of ${ATTEMPTS}. Make it again first: run \`node tools/building-queue.mjs next\``,
    );
  const f = inventory.find((x) => x.family === e.family);
  const check = disk.check(beforeFile(e.file), f.footprint, e.rot, { camera: false });
  if (!check.ok)
    throw new Error(
      `not kept: ${check.problems.join('; ')}. Make ${id} again, or record it as rejected.`,
    );
  let aside = null;
  if (disk.exists(e.file)) {
    disk.setAside(e.file);
    aside = e.file;
  }
  disk.restoreBefore(e.file);
  const by = check.camera?.by;
  delete e.taken;
  Object.assign(e, {
    status: 'generated',
    attempts,
    kept: typeof by === 'number' ? by : true,
    note: `kept with its camera off${degrees(by)} after ${attempts} attempts: the closest the tool held`,
  });
  return { entry: e, check, aside };
}

/**
 * Look again at the pictures that are made, by the check as it is today. A picture whose camera
 * is off, and nothing else wrong with it, goes back in the queue to be painted again: its file is
 * kept beside it (`beforeFile`) and the generator is shown that, so it is the same building and
 * the pictures built on it stay. Where an earlier self of it was closer still, that one stays
 * what it is painted from. Left as they are, and named: a picture the user approved, one
 * with another fault, and one whose file could not be moved. A picture kept as the closest of
 * its attempts is not asked for again. A gate family that has pictures put back is shown to the
 * user again: its gate is closed, and `gates` names it. `only` is one family.
 *
 * It also tidies what other tools left: a picture lying under its name though it is not made (a
 * checkout or a stash put it back) is cleared where it is a copy of one that is kept already, or
 * where its entry waits to be painted again; and a mark from an earlier list is brought up to
 * date.
 */
export function recheck(queue, inventory, only = null, disk = DISK) {
  if (only && !queue.entries.some((e) => e.family === only))
    throw new Error(`no family is called ${only}`);
  const back = [],
    left = [],
    strays = [],
    results = {},
    families = new Set();
  for (const e of queue.entries) {
    if (only && e.family !== only) continue;
    const f = inventory.find((x) => x.family === e.family);
    const waits = e.status === 'pending' && e.repaint && disk.exists(beforeFile(e.file));
    // a list written when the mark was only a mark: read the earlier self's camera now
    if (waits && typeof e.repaint !== 'object') {
      const was = disk.check(beforeFile(e.file), f.footprint, e.rot).camera;
      if (was) Object.assign(e, { note: '', repaint: { by: was.by, was: was.was } });
    }
    // a checkout or a stash put a picture back under its name: it is not an attempt
    if (
      e.status === 'pending' &&
      !e.taken &&
      disk.exists(e.file) &&
      disk.clearStray(e.file, !!waits)
    )
      strays.push(e.id);
    if (!isMade(e) || !disk.exists(e.file)) continue;
    const check = disk.check(e.file, f.footprint, e.rot, { camera: !e.kept });
    results[e.id] = check;
    if (check.ok) continue;
    const why = check.problems.join('; ');
    // a kept picture's camera was waived: what fails it now is something else
    const camera = !e.kept && check.camera && check.problems.length === 1;
    if (!camera || e.status === 'approved') {
      left.push({ id: e.id, why: camera ? `approved by the user; ${why}` : why });
      continue;
    }
    const earlier = earlierSelf(e, disk);
    const closest = !earlier || closer(check.camera.by, earlier.by);
    try {
      if (closest) disk.setBefore(e.file);
      else disk.shelve(e.file);
    } catch (err) {
      // open in a viewer, say: the picture stays made, so the list and the disk agree
      left.push({
        id: e.id,
        why: `${why}; it could not be moved aside (${err.message}) and stays as it is`,
      });
      continue;
    }
    Object.assign(e, {
      status: 'pending',
      attempts: 0,
      note: '',
      repaint: closest ? { by: check.camera.by, was: check.camera.was } : earlier,
    });
    back.push({ id: e.id, problem: check.problems[0] });
    families.add(e.family);
  }
  const gates = queue.gates.filter((g) => g.approved && families.has(g.family));
  for (const g of gates) g.approved = false;
  return {
    checked: Object.keys(results).length,
    back,
    left,
    strays,
    results,
    gates: gates.map((g) => g.family),
  };
}

/**
 * The pictures `redo` puts back. A family's name: the family's rejected pictures. A picture's id:
 * that picture and every picture built on it, `afresh`.
 */
function redoList(queue, inventory, families, target) {
  if (queue.entries.some((e) => e.family === target))
    return {
      afresh: false,
      entries: queue.entries.filter((e) => e.family === target && e.status === 'rejected'),
    };
  const first = queue.entries.find((e) => e.id === target);
  if (!first) throw new Error(`no picture or family is called ${target}`);
  const again = new Set([first.file]);
  // the list is in working order, so a picture always comes after the one it is built on
  const entries = queue.entries.filter((e) => {
    const built =
      e === first ||
      describeEntry(e.id, inventory, families).sources.some((file) => again.has(file));
    if (built) again.add(e.file);
    return built;
  });
  return { afresh: true, entries };
}

/**
 * What `redo` would undo, before it is done: the pictures it puts back, how many of them are made
 * (their files would be set aside) and how many wait to be painted again from their earlier
 * selves (they would be made afresh instead). A front view of a family's first age takes the
 * whole family with it.
 */
export function redoPlan(queue, inventory, families, target, exists = existsSync) {
  const { entries } = redoList(queue, inventory, families, target);
  return {
    ids: entries.map((e) => e.id),
    made: entries.filter((e) => isMade(e) && exists(e.file)).length,
    repaint: entries.filter((e) => e.status === 'pending' && e.repaint).length,
  };
}

/**
 * Put pictures back in the queue. A picture's id: that picture and every picture built on it, their
 * files set aside, each to be made afresh. A family's name: the family's rejected pictures, each
 * to be made as it was being made.
 */
export function redo(queue, inventory, families, target, disk = DISK) {
  const { afresh, entries } = redoList(queue, inventory, families, target);
  return entries.map((e) => {
    if (disk.exists(e.file)) disk.setAside(e.file);
    Object.assign(e, { status: 'pending', attempts: 0, note: '' });
    delete e.kept;
    if (afresh) delete e.repaint;
    return e.id;
  });
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

/** How many minutes old a picture of an image tool may be, and still be the one just made. */
const TAKE = { fresh: 15 };

/** Where an image tool keeps the pictures it makes, when nothing else is said: Codex's folder. */
function picturesFolder() {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'generated_images');
}

/** The PNG files in a folder and in the folders in it (an image tool keeps one a chat), newest first. */
function picturesIn(dir, depth = 2) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, d.name);
    if (d.isDirectory()) {
      if (depth > 1) out.push(...picturesIn(path, depth - 1));
    } else if (/\.png$/i.test(d.name)) {
      const { mtimeMs, size } = statSync(path);
      out.push({ path, dir, at: mtimeMs, size });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Every picture file in the list's folders, with its size: what was ever taken lies among them. */
function listPictures(queue) {
  const dirs = [...new Set(queue.entries.map((e) => dirname(e.file)))].filter((d) => existsSync(d));
  return dirs.flatMap((d) =>
    readdirSync(d)
      .filter((n) => n.endsWith('.png'))
      .map((n) => ({ path: `${d}/${n}`, size: statSync(`${d}/${n}`).size })),
  );
}

/** "12 s", "4 minutes": how long ago a picture was made */
const ago = (ms) =>
  ms < 120000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} minutes`;

/**
 * Choose the picture an image tool wrote for an entry of the list. `from` is a file, or a folder
 * whose newest new picture is the one; without it, the folder Codex keeps its pictures in, where
 * each chat has a folder of its own. Answers with the `source`, its `bytes`, how many `seconds`
 * old it is, and `again` where it is the picture that lies under the entry's name already.
 * Nothing is written here.
 *
 * What is new: a picture made after the last one that was taken, and not long ago. Whatever is
 * older than the last one taken was taken itself or given up, and a picture whose bytes lie in
 * the list's folders was taken, whoever's it is: so a generation that failed never hands the
 * picture before it to the next entry.
 *
 * Whose chat: the folder the last picture was taken from. Other chats make other pictures
 * meanwhile, and theirs are not taken unasked: where the new pictures are in another chat's
 * folder, or in more than one and none was ever taken, the folders are named for `--from`.
 */
export function choosePicture(queue, id, from, now = Date.now()) {
  const tool = 'node tools/building-queue.mjs';
  const entry = queue.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no picture is called "${id}"`);
  if (entry.status !== 'pending')
    throw new Error(
      `${id} is recorded as ${entry.status}: only a picture that waits to be made is taken` +
        (entry.status === 'generated'
          ? `. To make it again, take it back first: ${tool} set ${id} pending`
          : ''),
    );
  const where = from ?? picturesFolder();
  const how = 'say where your image tool writes its pictures with --from <folder or file>';
  if (!existsSync(where)) throw new Error(`no folder of pictures at ${where}: ${how}`);
  const list = listPictures(queue);
  /** the file of the list that holds exactly these bytes */
  const holder = (bytes) =>
    list.find((f) => f.size === bytes.length && readFileSync(f.path).equals(bytes))?.path ?? null;
  const owner = (path) =>
    queue.entries.find((e) => basename(path).startsWith(`${basename(e.file, '.png')}.`))?.id;
  const whose = (path) => (owner(path) ? `${owner(path)}'s` : "the list's");
  const first = 'Make the picture first.';

  if (statSync(where).isFile()) {
    // a file that is named: taken whatever its age, unless it is another entry's picture, or one
    // this entry was refused before (which the tool gives back only by its own name)
    const bytes = readFileSync(where);
    const held = holder(bytes);
    const seconds = Math.max(0, Math.round((now - statSync(where).mtimeMs) / 1000));
    if (held && owner(held) !== id)
      throw new Error(
        `${where} is ${whose(held)} picture (${held}): nothing new was made. ${first}`,
      );
    if (held && held !== entry.file && resolve(held) !== resolve(where))
      throw new Error(`${where} was taken before (it is ${held}). ${first}`);
    return { entry, source: where, bytes, seconds, again: held === entry.file };
  }

  const files = picturesIn(where);
  if (!files.length)
    throw new Error(
      `no picture in ${where} or in the folders in it: make the picture first, or ${how}`,
    );
  const sizes = new Set(list.map((f) => f.size));
  // the last picture taken from here, and what was made after it
  let last = null;
  for (const f of files) {
    const held = sizes.has(f.size) ? holder(readFileSync(f.path)) : null;
    if (held) {
      last = { ...f, held };
      break;
    }
  }
  const fresh = (f) => now - f.at <= TAKE.fresh * 60000;
  const made = (f) => `${f.path} (made ${ago(now - f.at)} ago)`;
  const newestOf = (some) =>
    [...new Set(some.map((f) => f.dir))].map((d) => some.find((f) => f.dir === d));
  let news = files.filter((f) => !last || f.at > last.at);
  if (from === undefined) {
    if (last) {
      // its own chat's folder: the one the last picture came from
      const others = newestOf(news.filter((f) => f.dir !== last.dir && fresh(f)));
      news = news.filter((f) => f.dir === last.dir);
      if (!news.length && others.length)
        throw new Error(
          [
            `nothing new in ${last.dir}, where the last picture was taken from. ${others.length === 1 ? 'There is a new picture in another' : 'There are new pictures in other'} chat's folder${others.length === 1 ? '' : 's'}:`,
            ...others.map((f) => `  ${made(f)}`),
            `If that chat is yours, take the picture from there: ${tool} take ${id} --from "${others[0].dir}"`,
            'The tool follows that chat from then on. If it is not, make the picture first.',
          ].join('\n'),
        );
    } else {
      const chats = newestOf(news.filter(fresh));
      if (chats.length > 1)
        throw new Error(
          [
            `pictures were made in more than one chat's folder in the last ${TAKE.fresh} minutes:`,
            ...chats.map((f) => `  ${made(f)}`),
            `Say which is yours: ${tool} take ${id} --from "<folder>"`,
            'The tool follows that chat from then on.',
          ].join('\n'),
        );
      if (chats.length) news = news.filter((f) => f.dir === chats[0].dir);
    }
  }
  const found = news[0];
  if (found && fresh(found))
    return {
      entry,
      source: found.path,
      bytes: readFileSync(found.path),
      seconds: Math.max(0, Math.round((now - found.at) / 1000)),
      again: false,
    };
  if (found)
    throw new Error(
      `the newest picture there, ${found.path}, was made ${Math.round((now - found.at) / 60000)} minutes ago: make the picture first, or name the file with --from <file>`,
    );
  // nothing was made since the last picture taken: is that one this entry's, in hand?
  if (last.held === entry.file)
    return {
      entry,
      source: last.path,
      bytes: readFileSync(last.path),
      seconds: Math.max(0, Math.round((now - last.at) / 1000)),
      again: true,
    };
  throw new Error(
    `nothing new was made: the newest picture there, ${last.path}, ` +
      (owner(last.held) === id
        ? `was taken before (it is ${last.held}). ${first}`
        : `is ${whose(last.held)} (${last.held}). ${first}`),
  );
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
      `file:       ${d.file}`,
      `ask for:    ${d.canvas[0]} x ${d.canvas[1]} px (the guide's size), transparent background`,
      `edit this:  ${d.guide}`,
      'attach, in this order:',
      ...d.references.map((f, i) => `  ${i + 1}. ${f}`),
      // it counts when the closest attempt is chosen
      ...(d.earlier
        ? [
            `earlier self: ${d.earlier.by === null ? 'its camera was off' : `off by ${d.earlier.by.toFixed(1)}°`}, in ${d.earlier.file}`,
          ]
        : []),
      // what was wrong with a picture that is painted again is in its prompt
      `attempts so far: ${entry.attempts}${entry.note && !d.repaint ? ` (${entry.note})` : ''}`,
      '',
      '----- prompt -----',
      d.prompt,
      '----- end of prompt -----',
      '',
      `when the picture is made: node tools/building-queue.mjs take ${d.id}`,
      '(it writes the picture your image tool made to the file above and shows it to you: do not save it yourself)',
    ].join('\n'),
  );
}

/** ", 5 kept with the camera off (2 by more than 3°)" */
const keptWords = (r) =>
  r.kept
    ? `, ${r.kept} kept with the camera off${r.far ? ` (${r.far} by more than ${FIT.near}°)` : ''}`
    : '';

/** "20 of 24 made, 2 kept with the camera off, 1 rejected, 3 not made (built on a picture that failed)" */
function tally(r) {
  return (
    `${r.made} of ${r.total} made` +
    keptWords(r) +
    (r.rejected ? `, ${r.rejected} rejected` : '') +
    (r.behind ? `, ${r.behind} not made (built on a picture that failed)` : '')
  );
}
const some = (ids, n = 6) =>
  ids.slice(0, n).join(', ') + (ids.length > n ? ` and ${ids.length - n} more` : '');

async function main(args) {
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
          `STOP. Too much of "${n.family}" could not be made as it should be: ${tally(n)}. Tell the user what kept going wrong. The work goes on when the user has the pictures put back (node tools/building-queue.mjs redo ${n.family} for the rejected ones) or accepts the family as it is (node tools/building-queue.mjs accept ${n.family}).`,
        );
      else console.log('DONE. No picture is left to make.');
      if (n.lost.length)
        console.log(`\nrecorded as made, but the file is missing: ${some(n.lost)}`);
      return code;
    }
    case 'take': {
      const [id, ...words] = rest;
      if (!id || id.startsWith('--'))
        throw new Error('say which picture: node tools/building-queue.mjs take <id>');
      if (words.includes('--from') && !option('--from'))
        throw new Error('--from needs a folder or a file');
      const odd = words.find((w, i) => w !== '--from' && words[i - 1] !== '--from');
      if (odd !== undefined)
        throw new Error(
          `take does not understand "${odd}": it is node tools/building-queue.mjs take <id> [--from <folder or file>]`,
        );
      // the sheet tool reads this one: loaded here, and before anything is written
      const { drawLook, lookFile } = await import('./building-sheets.mjs');
      const pick = choosePicture(queue, id, option('--from'));
      const e = pick.entry;
      // whose turn it is; trouble with the list itself is for `next` to tell
      let turn = null;
      try {
        const n = nextEntry(queue, inventory, families);
        if (n.kind === 'picture') turn = n.id;
      } catch {
        turn = null;
      }
      const nothing = 'nothing was taken. Make the picture again.';
      let shown;
      try {
        const f = inventory.find((x) => x.family === e.family);
        shown = drawLook(PNG.sync.read(pick.bytes), f.footprint, e.rot);
      } catch (error) {
        throw new Error(
          `${pick.source} cannot be read as a picture (${error.message}): ${nothing}`,
        );
      }
      if (!shown) throw new Error(`there is no building in ${pick.source}: ${nothing}`);
      const lines = [];
      if (pick.again) lines.push(`nothing new was made: ${pick.source} was taken already`);
      else {
        lines.push(`took:      ${pick.source} (made ${ago(pick.seconds * 1000)} ago)`);
        if (existsSync(e.file)) {
          // a picture taken and never recorded was looked at and given up: that was an attempt
          if (e.taken) e.attempts += 1;
          lines.push(
            e.taken
              ? `replaced:  the picture taken before, which was not recorded: counted as an attempt (${e.attempts} so far)`
              : 'replaced:  the picture that lay there, which was not recorded',
          );
        }
        mkdirSync(dirname(e.file), { recursive: true });
        // written, not copied: a copy keeps the date of its source, and what is made from a
        // picture (its straightened self, shown to later ones) is renewed by the picture's date
        writeFileSync(e.file, pick.bytes);
        e.taken = true;
        writeQueue(queue);
      }
      const look = lookFile(e.file);
      mkdirSync(dirname(look), { recursive: true });
      writeFileSync(look, PNG.sync.write(shown));
      lines.push(
        `${pick.again ? 'it is:     ' : 'saved as:  '}${e.file}`,
        `look at:   ${look}`,
        `then:      node tools/building-queue.mjs set ${e.id} generated`,
      );
      if (turn && turn !== e.id) lines.push(`note:      \`next\` hands out ${turn}, not ${e.id}`);
      console.log(lines.join('\n'));
      return 0;
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
      let r;
      try {
        r = settle(queue, inventory, rest[0], rest[1], {
          attempts: attempts === undefined ? undefined : Number(attempts),
          note: option('--note'),
        });
      } catch (e) {
        // a picture that was refused was tried: the count is saved
        if (e.refused) writeQueue(queue);
        throw e;
      }
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
      // given up, though an attempt of it was right but for its camera: said, not decided
      if (r.entry.status === 'rejected' && earlierSelf(r.entry, DISK))
        console.log(
          `note:      the tool holds a picture of ${r.entry.id} whose only fault was its camera` +
            `${degrees(r.entry.repaint.by).replace(' by ', ' (off by ')}${typeof r.entry.repaint.by === 'number' ? ')' : ''}, in ${beforeFile(r.entry.file)}. ` +
            `If that one was right, do not give the picture up: node tools/building-queue.mjs keep ${r.entry.id}`,
        );
      return 0;
    }
    case 'keep': {
      if (!rest[0] || rest[0].startsWith('--'))
        throw new Error('say which picture: node tools/building-queue.mjs keep <id>');
      const attempts = option('--attempts');
      const r = keepEarlier(queue, inventory, rest[0], {
        attempts: attempts === undefined ? undefined : Number(attempts),
      });
      writeQueue(queue);
      writeReport({ [r.entry.id]: r.check });
      // shown for the eye: the closest by its camera is kept, which may not be the one meant
      const { showPicture } = await import('./building-sheets.mjs');
      const shown = showPicture(r.entry.file, inventory);
      console.log(resultLine(r.entry.id, r.check));
      if (shown.file) console.log(`look at:   ${shown.file}`);
      console.log(
        `${r.entry.id}: ${r.entry.status}, ${r.entry.attempts} attempts (${r.entry.note})` +
          (r.aside
            ? `; the attempt that lay there was set aside as ${r.aside.replace(/\.png$/, '.rejected.png')}`
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
      if (r.strays.length)
        console.log(
          `${r.strays.length} picture${r.strays.length === 1 ? ' was' : 's were'} on disk for ${r.strays.length === 1 ? 'an entry that waits' : 'entries that wait'} to be painted again, put there by something other than this tool: cleared (a copy of a picture that is kept already is removed, anything else kept beside the earlier self under a number).`,
        );
      for (const family of r.gates)
        console.log(
          `The gate of "${family}" is closed again: \`next\` prints GATE when its pictures are painted again, for the user to look at them.`,
        );
      return 0;
    }
    case 'redo': {
      const plan = redoPlan(queue, inventory, families, rest[0]);
      const more = plan.ids.length - 1;
      // more than the picture named: said first, and done only when the user has asked for it
      if (more > 0 && plan.ids[0] === rest[0] && !rest.includes('--yes')) {
        const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
        console.log(
          `redo ${rest[0]} would put ${plan.ids.length} pictures back, each to be made afresh: ${rest[0]} and the ${more} built on it. ` +
            `${count(plan.made, 'of them is made (its file would be set aside)', 'of them are made (their files would be set aside)')}, ` +
            `${count(plan.repaint, 'is waiting to be painted again from its earlier self', 'are waiting to be painted again from their earlier selves')} (that would be lost). ` +
            `Nothing was changed. This is for the user to ask for: if they asked for exactly this, run it again with --yes. ` +
            `To make one recorded picture again, take it back instead: node tools/building-queue.mjs set ${rest[0]} pending`,
        );
        return 1;
      }
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
            keptWords(r) +
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

// not awaited here: `take` loads the sheet tool, which reads this module and waits for it
if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
    },
  );
