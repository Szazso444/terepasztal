import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { FOOTPRINTS, loadInventory, pictureFile } from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly, guideFile, openingsOf } from './building-guides.mjs';
import { fitPicture } from './building-fit.mjs';
import {
  accept,
  approveGate,
  beforeFile,
  buildQueue,
  describeEntry,
  describeQueued,
  fittedFile,
  keepEarlier,
  loadFamilies,
  mismatches,
  nextEntry,
  progress,
  recheck,
  redo,
  redoPlan,
  setStatus,
  settle,
  STYLE_BOARD,
  MOOD_EARLY,
  MOOD_LATE,
} from './building-queue.mjs';

const inv = loadInventory();
const fam = loadFamilies();
const q = buildQueue(inv, fam);
const about = (id) => describeEntry(id, inv, fam);
const idsOf = (queue, family) => queue.entries.filter((e) => e.family === family).map((e) => e.id);

describe('building queue', () => {
  it('lists every picture once, the depot first and the station second', () => {
    expect(q.entries).toHaveLength(548);
    expect(new Set(q.entries.map((e) => e.id)).size).toBe(548);
    expect(q.entries.slice(0, 24).every((e) => e.family === 'depot')).toBe(true);
    expect(q.entries.slice(0, 5).map((e) => e.id)).toEqual([
      'depot-a0-r0',
      'depot-a0-r1',
      'depot-a0-r2',
      'depot-a0-r3',
      'depot-a1-r0',
    ]);
    expect(q.entries[24].family).toBe('station');
    expect(q.schema).toBe(2);
    expect(q.gates).toEqual([
      { family: 'depot', approved: false },
      { family: 'station', approved: false },
    ]);
    expect(q.accepted).toEqual([]);
    expect(q.counts).toEqual({ pictures: 548, families: 27 });
    for (const e of q.entries) expect([e.status, e.attempts, e.note]).toEqual(['pending', 0, '']);
    // the list is the record of progress: it stays small, prompts are written on demand
    expect(Object.keys(q.entries[0])).toEqual([
      'id',
      'family',
      'age',
      'rot',
      'file',
      'status',
      'attempts',
      'note',
    ]);
  });

  it('gives every picture its file, canvas and the guide of its footprint and rotation', () => {
    expect(about('depot-a2-r3')).toMatchObject({
      family: 'depot',
      age: 2,
      rot: 3,
      file: pictureFile('depot', 2, 3),
      guide: guideFile('t2x2', 3),
      canvas: [1536, 1024],
    });
    expect(about('depot_narrow-a0-r1').guide).toBe(guideFile('t1x2', 1));
    expect(about('townhouse-a5-r0')).toMatchObject({
      guide: guideFile('t1tall', 0),
      canvas: [1024, 1536],
    });
    expect(about('farm-a0-r2').guide).toBe(guideFile('t1', 2));
    expect(() => about('farm-a9-r0')).toThrow(/farm-a9-r0/);
  });

  it('stops when a family has no description', () => {
    const { depot: _depot, ...rest } = fam.families;
    expect(() => buildQueue(inv, { ...fam, families: rest })).toThrow(/depot/);
    const extra = { ...fam.families, lighthouse: fam.families.depot };
    expect(() => buildQueue(inv, { ...fam, families: extra })).toThrow(/lighthouse/);
  });

  it("stops when a description names no line for one of the family's ages", () => {
    const { a3: _a3, ...ages } = fam.families.refinery.ages;
    const families = { ...fam.families, refinery: { ...fam.families.refinery, ages } };
    expect(() => buildQueue(inv, { ...fam, families })).toThrow(/refinery.*a3/);
  });

  it('refers only to pictures that exist: the boards and the base of every family', () => {
    for (const f of [STYLE_BOARD, MOOD_EARLY, MOOD_LATE]) expect(existsSync(f), f).toBe(true);
    for (const [name, f] of Object.entries(fam.families))
      if (f.base !== null) expect(existsSync(f.base), `${name}: ${f.base}`).toBe(true);
    expect(fam.families.depot_narrow.base).toBeNull();
  });

  it('names the pictures that fix what a picture shows', () => {
    // the first picture of a family: today's picture, and the mood of its age
    expect(about('depot-a0-r0').sources).toEqual([
      STYLE_BOARD,
      'assets/source/base-v1/depot.png',
      MOOD_EARLY,
    ]);
    expect(about('refinery-a1-r0').sources).toEqual([
      STYLE_BOARD,
      'assets/source/base-v1/refinery.png',
      MOOD_EARLY,
    ]);
    // another view: the same age's front view
    expect(about('depot-a0-r2').sources).toEqual([STYLE_BOARD, pictureFile('depot', 0, 0)]);
    // a later age: the front view of the age before
    expect(about('depot-a3-r0').sources).toEqual([
      STYLE_BOARD,
      pictureFile('depot', 2, 0),
      MOOD_LATE,
    ]);
    // no picture of its own today: the main-line depot of the same age
    expect(about('depot_narrow-a0-r0').sources).toEqual([
      STYLE_BOARD,
      pictureFile('depot', 0, 0),
      MOOD_EARLY,
    ]);
  });

  it('hands the generator earlier pictures laid onto their footprint, not as they came back', () => {
    // a picture comes back larger than its guide and with its ground lines a little off; a later
    // picture copies what it is shown, so it is shown the earlier one at the guide's camera
    expect(fittedFile('depot-a0-r0')).toBe('assets/source/buildings-v2/.fitted/depot-a0-r0.png');
    expect(about('depot-a0-r2').references).toEqual([STYLE_BOARD, fittedFile('depot-a0-r0')]);
    expect(about('depot-a3-r0').references).toEqual([
      STYLE_BOARD,
      fittedFile('depot-a2-r0'),
      MOOD_LATE,
    ]);
    expect(about('depot_narrow-a0-r0').references[1]).toBe(fittedFile('depot-a0-r0'));
    // boards and today's pictures are attached as they are
    expect(about('depot-a0-r0').references).toEqual(about('depot-a0-r0').sources);
    // and the prompt says what the generator is looking at
    expect(about('depot-a0-r2').prompt).toMatch(/exactly the block-out's camera and scale/);
    expect(about('depot-a3-r0').prompt).toMatch(/exactly the block-out's camera, scale and place/);
  });

  it('shows a picture that is painted again its own earlier self, straightened', () => {
    // its camera was off: the same building is asked for again, from what the tools made of it
    const say = 'The camera is too low: the wall feet run too flat.';
    const before = beforeFile(pictureFile('depot', 3, 2));
    expect(before).toBe('assets/source/buildings-v2/depot/depot-a3-r2.before.png');
    const again = describeEntry('depot-a3-r2', inv, fam, { repaint: true, note: say });
    expect(again.sources).toEqual([STYLE_BOARD, before]);
    expect(again.references).toEqual([
      STYLE_BOARD,
      'assets/source/buildings-v2/.fitted/depot-a3-r2.before.png',
    ]);
    expect(again.prompt).toContain(fam.references.repaint);
    expect(again.prompt.endsWith(`What was wrong with it: ${say}`)).toBe(true);
    expect(again.prompt).not.toContain(fam.references.turn);
    // the rest of the prompt is the picture's own
    for (const part of [fam.shared, fam.ages.a3, fam.families.depot.ages.a3, fam.views.r2])
      expect(again.prompt).toContain(part);
    expect(again.file).toBe(pictureFile('depot', 3, 2));
    expect(fam.references.repaint).toMatch(/SAME building/);
    expect(fam.references.repaint).toMatch(/straightened/);
    // any other picture says nothing of the kind
    expect(about('depot-a3-r2').prompt).not.toMatch(/What was wrong with it/);
  });

  it('writes a prompt from the shared block, the age, the family and the view', () => {
    const turn = about('depot-a3-r1').prompt;
    for (const part of [
      fam.shared,
      fam.ages.a3,
      fam.families.depot.what,
      fam.families.depot.ages.a3,
      fam.families.depot.keep,
      fam.families.depot.front,
      fam.views.r1,
      fam.references.turn,
    ])
      expect(turn).toContain(part);
    expect(turn).not.toContain(fam.views.r0);
    expect(turn).not.toContain(fam.ages.a2);
    const first = about('depot-a0-r0').prompt;
    expect(first).toContain(fam.references.base);
    expect(first).toContain(fam.references.mood);
    expect(about('depot-a3-r0').prompt).toContain(fam.references.next);
    expect(about('depot_narrow-a0-r0').prompt).toContain(fam.references.sibling);
    expect(about('water_tower-a0-r0').prompt).toContain(fam.families.water_tower.ages.a0);
  });

  it('never tells a building to keep its size where its age tells it to grow', () => {
    // a later age keeps the footprint, not the size: houses grow taller, works grow larger
    for (const id of ['townhouse-a4-r0', 'station-a1-r0', 'depot-a2-r0']) {
      const prompt = about(id).prompt;
      expect(prompt, id).not.toMatch(/keep its size/i);
      expect(prompt, id).toContain('keep its footprint');
    }
    // and no prompt asks for a canvas size or a place the generator does not keep
    expect(fam.shared).not.toMatch(/keep the canvas size/i);
  });

  it('says in a rear view that nothing of the front is in the picture', () => {
    // told of a crew door in the front wall, the generator painted one on the back wall of rear
    // views time and again, though the view said the front could not be seen
    for (const id of ['depot-a2-r1', 'depot-a2-r2', 'station-a0-r2', 'kiln-a0-r1']) {
      const prompt = about(id).prompt;
      expect(prompt, id).toMatch(/nothing of it is in this picture/);
      expect(prompt, id).toMatch(/no entrance door/);
    }
    for (const id of ['depot-a2-r0', 'depot-a2-r3'])
      expect(about(id).prompt, id).not.toMatch(/no entrance door/);
    // the walls are named as before
    expect(fam.views.r1).toMatch(
      /lower-left wall is the right-hand side; the lower-right wall is the BACK/,
    );
    expect(fam.views.r2).toMatch(
      /lower-left wall is the BACK.*; the lower-right wall is the left-hand side/,
    );
  });

  it("says of a depot that the ground inside its portals stays empty, for the game's rails", () => {
    // the game lays its rails under the picture, through the portals: a floor painted there
    // hides them. Four of the first depot's 24 pictures had one
    for (const id of ['depot-a0-r0', 'depot-a3-r2', 'depot_narrow-a0-r1'])
      expect(about(id).prompt, id).toMatch(
        /the ground inside (each|the) portals? left empty and transparent.*the game lays its own rails through/,
      );
    expect(about('station-a0-r0').prompt).not.toMatch(/lays its own rails through/);
  });

  it('calls a building what its description calls it', () => {
    // the game's data names the town hall "Townhouse": the description's own title wins
    expect(about('town-a0-r0').prompt).toContain('Building: Town hall.');
    expect(about('townhouse-a0-r0').prompt).toContain('Building: House.');
    expect(about('depot-a0-r0').prompt).toContain('Building: Depot.');
  });

  it('keeps status, attempts and note on a re-run', () => {
    const before = structuredClone(q);
    Object.assign(before.entries[3], { status: 'approved', attempts: 2, note: 'second try' });
    Object.assign(before.entries[30], { status: 'rejected', attempts: 3, note: 'floats' });
    before.entries.push({ id: 'gone-a0-r0', status: 'approved', attempts: 1, note: '' });
    const again = buildQueue(inv, fam, before);
    expect(again.entries).toHaveLength(548);
    expect(again.entries[3]).toMatchObject({ status: 'approved', attempts: 2, note: 'second try' });
    expect(again.entries[30]).toMatchObject({ status: 'rejected', attempts: 3, note: 'floats' });
    expect(again.entries[4].status).toBe('pending');
  });

  it('keeps what was kept with its camera off, and what is to be painted again, on a re-run', () => {
    const before = structuredClone(q);
    Object.assign(before.entries[3], { status: 'generated', attempts: 3, kept: true });
    const was = { by: 6.4, was: 'It was painted from too low a camera.' };
    Object.assign(before.entries[5], { repaint: was });
    const again = buildQueue(inv, fam, before);
    expect(again.entries[3]).toMatchObject({ status: 'generated', kept: true });
    expect(again.entries[5]).toMatchObject({ status: 'pending', repaint: was });
    // the other pictures carry neither mark
    expect(Object.keys(again.entries[4])).toEqual(Object.keys(q.entries[4]));
  });

  it('keeps approvals and accepted families, and refuses a status it does not know', () => {
    const before = structuredClone(q);
    before.gates[1].approved = true;
    before.accepted = ['farm'];
    const again = buildQueue(inv, fam, before);
    expect(again.gates).toEqual([
      { family: 'depot', approved: false },
      { family: 'station', approved: true },
    ]);
    expect(again.accepted).toEqual(['farm']);
    before.entries[7].status = 'done';
    expect(() => buildQueue(inv, fam, before)).toThrow(/depot-a1-r3.*done/);
  });

  it('reads a list written before there were two gates', () => {
    const old = structuredClone(q);
    delete old.gates;
    delete old.accepted;
    old.schema = 1;
    old.pilot = { family: 'depot', approved: true };
    expect(buildQueue(inv, fam, old).gates).toEqual([
      { family: 'depot', approved: true },
      { family: 'station', approved: false },
    ]);
  });
});

describe('working through the queue', () => {
  const fresh = (approved = false) => {
    const queue = structuredClone(q);
    for (const g of queue.gates) g.approved = approved;
    return queue;
  };
  /** the boards and base pictures are there; of the building pictures, those in `files` */
  const onDisk = (files) => (f) => !f.startsWith('assets/source/buildings-v2/') || files.has(f);
  /** record the first `upTo` pictures as made, or those of the families named */
  const made = (queue, what) => {
    const files = new Set();
    const list =
      typeof what === 'number'
        ? queue.entries.slice(0, what)
        : queue.entries.filter((e) => what.includes(e.family));
    for (const e of list) {
      e.status = 'generated';
      files.add(e.file);
    }
    return files;
  };
  const next = (queue, files) => nextEntry(queue, inv, fam, onDisk(files));

  it('hands out the first picture that is still to do', () => {
    const queue = fresh();
    expect(next(queue, new Set())).toMatchObject({ kind: 'picture', id: 'depot-a0-r0' });
    const files = made(queue, 2);
    expect(next(queue, files)).toMatchObject({ id: 'depot-a0-r2' });
  });

  it('stops after the depot and again after the station until each is approved', () => {
    const queue = fresh();
    const files = made(queue, 24);
    expect(next(queue, files)).toMatchObject({ kind: 'gate', family: 'depot', made: 24 });
    expect(approveGate(queue)).toEqual(['depot']);
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: 'station-a0-r0' });
    for (const f of made(queue, 48)) files.add(f);
    expect(next(queue, files)).toMatchObject({ kind: 'gate', family: 'station', made: 24 });
    expect(approveGate(queue)).toEqual(['station']);
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: queue.entries[48].id });
    expect(approveGate(queue)).toEqual([]);
    // both at once
    const other = fresh();
    expect(approveGate(other, true)).toEqual(['depot', 'station']);
  });

  it('names as waiting only the pictures behind a rejected one', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    // nothing was rejected: nothing waits, however many pictures are still to come
    expect(next(queue, files)).toMatchObject({
      kind: 'picture',
      id: 'station-a0-r0',
      behind: [],
      lost: [],
    });
    // the station's steam front view was rejected: every other station picture is built on it
    setStatus(queue, 'station-a0-r0', 'rejected', { attempts: 3, note: 'no canopy' });
    const n = next(queue, files);
    expect(n.behind).toEqual(idsOf(queue, 'station').slice(1));
    expect(n.behind).toHaveLength(23);
  });

  it('does not build on a rejected picture that was left on disk', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    setStatus(queue, 'station-a0-r0', 'rejected', { attempts: 3 });
    files.add(pictureFile('station', 0, 0));
    const n = next(queue, files);
    expect(n.id).not.toBe('station-a0-r1');
    expect(n.behind).toContain('station-a0-r1');
  });

  it('does not build on a picture recorded as made whose file is gone', () => {
    const queue = fresh();
    const files = made(queue, 4);
    files.delete(pictureFile('depot', 0, 0));
    const n = next(queue, files);
    // the depot's steam front view is lost, so nothing more of the depot can be made: the gate,
    // with the lost picture counted among those not made
    expect(n).toMatchObject({ kind: 'gate', family: 'depot', made: 3, behind: 21 });
    expect(n.lost).toEqual(['depot-a0-r0']);
  });

  it('stops when more than a quarter of a family was not made', () => {
    const queue = fresh(true);
    const files = made(queue, ['depot', 'station']);
    const third = queue.entries[48].family;
    const fourth = queue.entries.find((e) => !['depot', 'station', third].includes(e.family));
    // its first picture is rejected, so none of the family can be made
    setStatus(queue, queue.entries[48].id, 'rejected', { attempts: 3, note: 'wrong view' });
    const stop = next(queue, files);
    expect(stop).toMatchObject({ kind: 'stop', family: third, made: 0, rejected: 1 });
    expect(stop.behind).toBe(idsOf(queue, third).length - 1);
    // the user accepts the loss: on to the next family, and the lost one is said once
    accept(queue, third);
    const on = next(queue, files);
    expect(on).toMatchObject({ kind: 'picture', id: fourth.id });
    expect(on.finished).toMatchObject({ family: third, made: 0, rejected: 1 });
    expect(() => accept(queue, 'lighthouse')).toThrow(/lighthouse/);
  });

  it('goes on when only a few pictures of a family were lost', () => {
    const queue = fresh(true);
    const third = queue.entries[48].family;
    const files = made(queue, ['depot', 'station', third]);
    // one side view of the third family failed: nothing is built on a side view
    const side = queue.entries.find((e) => e.family === third && e.rot === 3);
    setStatus(queue, side.id, 'rejected', { attempts: 3 });
    files.delete(side.file);
    const n = next(queue, files);
    expect(n.kind).toBe('picture');
    expect(n.finished).toMatchObject({ family: third, rejected: 1, behind: 0 });
    expect(n.finished.made).toBe(idsOf(queue, third).length - 1);
  });

  it('says so when nothing is left', () => {
    const queue = fresh(true);
    const files = made(queue, 548);
    expect(next(queue, files)).toMatchObject({ kind: 'done' });
  });

  it('names the board that is missing instead of blaming pictures', () => {
    const queue = fresh();
    const noBoard = (f) => f !== STYLE_BOARD;
    expect(() => nextEntry(queue, inv, fam, noBoard)).toThrow(/03-theme-town-growth\.png/);
  });

  it('counts what was made, rejected and never made', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    setStatus(queue, 'depot-a5-r3', 'rejected', { attempts: 3 });
    setStatus(queue, 'depot-a5-r2', 'approved');
    setStatus(queue, 'station-a0-r0', 'rejected', { attempts: 3 });
    const rows = progress(queue, inv, fam, onDisk(files));
    expect(rows.find((r) => r.family === 'depot')).toEqual({
      family: 'depot',
      total: 24,
      made: 23,
      approved: 1,
      kept: 0,
      far: 0,
      rejected: 1,
      behind: 0,
      pending: 0,
      repaint: 0,
    });
    expect(rows.find((r) => r.family === 'station')).toMatchObject({
      total: 24,
      made: 0,
      rejected: 1,
      behind: 23,
      pending: 0,
    });
    expect(rows.find((r) => r.family === 'farm')).toMatchObject({
      made: 0,
      behind: 0,
      pending: 24,
    });
  });

  it('records a status with its attempts and note, and nothing else', () => {
    const queue = fresh();
    setStatus(queue, 'depot-a0-r1', 'rejected', { attempts: 3, note: 'portals on the wrong wall' });
    expect(queue.entries[1]).toMatchObject({
      status: 'rejected',
      attempts: 3,
      note: 'portals on the wrong wall',
    });
    setStatus(queue, 'depot-a0-r0', 'generated');
    expect(queue.entries[0]).toMatchObject({ status: 'generated', attempts: 1, note: '' });
    expect(() => setStatus(queue, 'depot-a0-r0', 'done')).toThrow(/done/);
    expect(() => setStatus(queue, 'nowhere-a0-r0', 'generated')).toThrow(/nowhere-a0-r0/);
  });

  it('counts an attempt only when a picture was made or given up', () => {
    const queue = fresh();
    setStatus(queue, 'depot-a0-r0', 'generated', { note: 'second try' });
    // an approval is no attempt, and leaves the note
    setStatus(queue, 'depot-a0-r0', 'approved');
    setStatus(queue, 'depot-a0-r0', 'approved');
    expect(queue.entries[0]).toMatchObject({ status: 'approved', attempts: 1, note: 'second try' });
    expect(() => setStatus(queue, 'depot-a0-r1', 'generated', { attempts: Number('two') })).toThrow(
      /whole number/,
    );
    expect(() => setStatus(queue, 'depot-a0-r1', 'generated', { attempts: -1 })).toThrow(
      /whole number/,
    );
    expect(queue.entries[1]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  /** a disk in memory for the commands that look at files */
  const disk = (files, verdict = { ok: true, problems: [] }) => ({
    exists: onDisk(files),
    check: (file, footprint, rot, options) =>
      typeof verdict === 'function' ? verdict(file, options) : verdict,
    setAside: (f) => {
      files.delete(f);
      files.add(f.replace(/\.png$/, '.rejected.png'));
    },
    setBefore: (f) => {
      files.delete(f);
      files.add(beforeFile(f));
    },
    shelve: (f) => {
      files.delete(f);
      files.add(beforeFile(f).replace(/\.png$/, '.1.png'));
    },
    restoreBefore: (f) => files.add(f),
    clearStray: (f) => files.delete(f),
  });
  /** what the check says of a camera that is off: it fails, or passes with a note when waived */
  const WAS = 'It was painted from too low a camera.';
  const LINE = 'camera off by 6.4°: it looks down from 23.6° where the game looks down from 30°';
  const CAMERA = { by: 6.4, was: WAS };
  const KEPT = `${LINE}; kept, and corrected by the tools`;
  const cameraOff = (file, options) =>
    options?.camera === false
      ? { ok: true, problems: [], notes: [KEPT], camera: CAMERA }
      : { ok: false, problems: [LINE], camera: CAMERA };
  /** a camera that is off and the top edge touched: the second fault stays when the first is waived */
  const twoFaults = (file, options) =>
    options?.camera === false
      ? { ok: false, problems: ['touches the top edge'], notes: [KEPT], camera: CAMERA }
      : { ok: false, problems: ['touches the top edge', LINE], camera: CAMERA };
  const fine = { ok: true, problems: [] };
  /**
   * A disk in memory whose pictures have a camera: `shots` maps a file to how many degrees its
   * camera is off. The check reads that, and the commands move the pictures about as on disk,
   * a picture under a name that is taken being kept under a number.
   */
  const studio = (shots) => {
    const numbered = (name) => {
      let n = 1;
      while (shots.has(name.replace(/\.png$/, `.${n}.png`))) n++;
      return name.replace(/\.png$/, `.${n}.png`);
    };
    const move = (from, to) => {
      shots.set(to, shots.get(from));
      shots.delete(from);
    };
    const moveTo = (from, to) => {
      if (shots.has(to)) move(to, numbered(to));
      move(from, to);
    };
    return {
      exists: onDisk(shots),
      check: (file, footprint, rot, options) => {
        const by = shots.get(file);
        if (by <= 2) return fine;
        const line = `camera off by ${by.toFixed(1)}°: it looks down from too low`;
        return options?.camera === false
          ? {
              ok: true,
              problems: [],
              notes: [`${line}; kept, and corrected by the tools`],
              camera: { by, was: WAS },
            }
          : { ok: false, problems: [line], camera: { by, was: WAS } };
      },
      setAside: (f) => moveTo(f, f.replace(/\.png$/, '.rejected.png')),
      setBefore: (f) => moveTo(f, beforeFile(f)),
      shelve: (f) => move(f, numbered(beforeFile(f))),
      restoreBefore: (f) => shots.set(f, shots.get(beforeFile(f))),
      stamp: (f) => String(shots.get(f)),
      same: (a, b) => shots.has(a) && shots.has(b) && shots.get(a) === shots.get(b),
      clearStray: (f, keepBeside) => {
        const kept = [beforeFile(f), f.replace(/\.png$/, '.rejected.png')];
        if (kept.some((k) => shots.has(k) && shots.get(k) === shots.get(f))) shots.delete(f);
        else if (keepBeside) move(f, numbered(beforeFile(f)));
        else return false;
        return true;
      },
    };
  };
  /** save an attempt whose camera is `by` degrees off and try to record it: the result or the error */
  const attempt = (queue, shots, by, options = {}) => {
    shots.set(pictureFile('depot', 0, 0), by);
    try {
      return settle(queue, inv, 'depot-a0-r0', 'generated', options, studio(shots));
    } catch (e) {
      return e;
    }
  };

  it('records a picture as made only when its file is there and passes the check', () => {
    const queue = fresh();
    const files = new Set();
    expect(() => settle(queue, inv, 'depot-a0-r0', 'generated', {}, disk(files))).toThrow(
      /no such file.*depot-a0-r0\.png/,
    );
    files.add(pictureFile('depot', 0, 0));
    const bad = { ok: false, problems: ['background is not transparent'] };
    expect(() => settle(queue, inv, 'depot-a0-r0', 'generated', {}, disk(files, bad))).toThrow(
      /not recorded.*background is not transparent/,
    );
    // not made, but tried: the tool keeps count of the attempts it refused
    expect(queue.entries[0]).toMatchObject({ status: 'pending', attempts: 1 });
    const done = settle(queue, inv, 'depot-a0-r0', 'generated', { attempts: 2 }, disk(files));
    expect(done.entry).toMatchObject({ status: 'generated', attempts: 2 });
    expect(done.check).toEqual({ ok: true, problems: [] });
    // an approval is for a picture that was made
    expect(() => settle(queue, inv, 'depot-a0-r1', 'approved', {}, disk(files))).toThrow(
      /has not been made/,
    );
  });

  it('keeps a picture refused for its camera as what the next attempt is painted from', () => {
    const queue = fresh();
    const file = pictureFile('depot', 0, 0);
    const shots = new Map();
    const first = attempt(queue, shots, 6.4);
    expect(first.refused).toBe(true);
    expect(first.message).toMatch(
      /^not recorded: camera off by 6\.4°.*\. It is kept as the picture's earlier self: run `node tools\/building-queue\.mjs next` again, and it is handed out to be painted from that, straightened\.$/,
    );
    // not made, but tried: counted, and kept, so that nothing has to be copied or remembered
    expect(queue.entries[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      note: '',
      repaint: { by: 6.4, was: WAS },
    });
    expect([...shots.keys()]).toEqual([beforeFile(file)]);
    expect(next(queue, shots)).toMatchObject({ kind: 'picture', id: 'depot-a0-r0' });
    const again = describeQueued(queue, 'depot-a0-r0', inv, fam, onDisk(shots));
    expect(again.sources).toEqual([STYLE_BOARD, beforeFile(file)]);
    expect(again.prompt.endsWith(`What was wrong with it: ${WAS}`)).toBe(true);
    // a closer attempt takes its place as the earlier self; the first is kept under a number
    expect(attempt(queue, shots, 4).message).toMatch(/camera off by 4\.0°.*kept as the picture's/);
    expect(queue.entries[0]).toMatchObject({ attempts: 2, repaint: { by: 4 } });
    expect(Object.fromEntries(shots)).toEqual({
      [beforeFile(file)]: 4,
      [beforeFile(file).replace(/\.png$/, '.1.png')]: 6.4,
    });
    // a file that is not there was not tried
    shots.delete(file);
    expect(() => settle(queue, inv, 'depot-a0-r0', 'generated', {}, studio(shots))).toThrow(
      /no such file/,
    );
    expect(queue.entries[0].attempts).toBe(2);
  });

  it('paints on from the closest attempt, not from a later one that was worse', () => {
    const queue = fresh();
    const file = pictureFile('depot', 0, 0);
    const shots = new Map();
    attempt(queue, shots, 3.5);
    const worse = attempt(queue, shots, 6.4);
    expect(worse.message).toMatch(
      /^not recorded: camera off by 6\.4°.*\. An earlier attempt was closer \(3\.5°\) and stays what the picture is painted from: run `node tools\/building-queue\.mjs next` again\.$/,
    );
    expect(queue.entries[0]).toMatchObject({ attempts: 2, repaint: { by: 3.5 } });
    expect(shots.get(beforeFile(file))).toBe(3.5);
    expect(shots.get(beforeFile(file).replace(/\.png$/, '.1.png'))).toBe(6.4);
  });

  it('keeps the closest of three attempts by itself, and marks the picture', () => {
    const file = pictureFile('depot', 0, 0);
    // the third attempt is the closest: it stays
    const queue = fresh();
    const shots = new Map();
    expect(attempt(queue, shots, 6.4).refused).toBe(true);
    expect(attempt(queue, shots, 5).refused).toBe(true);
    const r = attempt(queue, shots, 3.4);
    expect(r.entry).toMatchObject({
      status: 'generated',
      attempts: 3,
      kept: 3.4,
      note: 'kept with its camera off by 3.4° after 3 attempts',
    });
    expect(shots.get(file)).toBe(3.4);
    expect(r.check.notes[0]).toMatch(/camera off by 3\.4°.*kept, and corrected by the tools$/);
    // a kept picture is a made one: the work goes on from it
    expect(next(queue, shots)).toMatchObject({ kind: 'picture', id: 'depot-a0-r1' });
    // further than three degrees off, it is held against its family
    expect(progress(queue, inv, fam, onDisk(shots))[0]).toMatchObject({ made: 1, kept: 1, far: 1 });

    // an earlier attempt was the closest: that one becomes the picture
    const other = fresh();
    const taken = new Map();
    attempt(other, taken, 6.4);
    attempt(other, taken, 2.4);
    const e = attempt(other, taken, 5);
    expect(e.entry).toMatchObject({
      status: 'generated',
      attempts: 3,
      kept: 2.4,
      note: 'kept with its camera off by 2.4° after 3 attempts: an earlier one was the closest',
    });
    expect(taken.get(file)).toBe(2.4);
    expect(e.check.notes[0]).toMatch(/camera off by 2\.4°/);
    // nothing painted is lost: the other two attempts are still there
    expect([...taken.values()].sort()).toEqual([2.4, 2.4, 5, 6.4]);
    // within three degrees it is near enough: kept, but not held against its family
    expect(progress(other, inv, fam, onDisk(taken))[0]).toMatchObject({ made: 1, kept: 1, far: 0 });

    // right at the second attempt: made like any other picture
    const third = fresh();
    const good = new Map();
    attempt(third, good, 6.4);
    const made2 = attempt(third, good, 1.2);
    expect(made2.entry).toMatchObject({ status: 'generated', attempts: 2, note: '' });
    expect(made2.entry.kept).toBeUndefined();
    // a number given says which attempt this is
    const fourth = fresh();
    expect(attempt(fourth, new Map(), 6.4, { attempts: 3 }).entry).toMatchObject({
      status: 'generated',
      attempts: 3,
      kept: 6.4,
    });
  });

  it('does not let a count that is given lower its own', () => {
    // an agent that has lost count says "1" every time: the third attempt is the last all the same
    const queue = fresh();
    const shots = new Map();
    expect(attempt(queue, shots, 6.4, { attempts: 1 }).refused).toBe(true);
    expect(attempt(queue, shots, 5, { attempts: 1 }).refused).toBe(true);
    expect(queue.entries[0].attempts).toBe(2);
    const r = attempt(queue, shots, 3.4, { attempts: 1 });
    expect(r.entry).toMatchObject({ status: 'generated', attempts: 3, kept: 3.4 });
    // a number that is higher is taken: attempts the tool never saw
    const other = fresh();
    expect(attempt(other, new Map(), 1, { attempts: 2 }).entry).toMatchObject({ attempts: 2 });
  });

  it('does not count the same picture twice when it is refused twice', () => {
    // a picture refused for another fault than its camera stays under its name: recorded again
    // unchanged, it is refused again, and that is no new attempt
    const queue = fresh();
    const file = pictureFile('depot', 0, 0);
    const shots = new Map([[file, 1]]);
    const edge = {
      ...studio(shots),
      check: () => ({ ok: false, problems: ['touches the top edge'] }),
    };
    const again = () => {
      try {
        return settle(queue, inv, 'depot-a0-r0', 'generated', {}, edge);
      } catch (e) {
        return e;
      }
    };
    expect(again().message).toMatch(/^not recorded: touches the top edge\. Make depot-a0-r0 again/);
    expect(queue.entries[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(again().message).toMatch(
      /^not recorded: touches the top edge\. It is the picture that was refused before: make depot-a0-r0 again, or record it as rejected\.$/,
    );
    expect(queue.entries[0].attempts).toBe(1);
    // another picture under the name is another attempt
    shots.set(file, 1.5);
    again();
    expect(queue.entries[0].attempts).toBe(2);
    // given up: the count that is given cannot lower the tool's own
    settle(queue, inv, 'depot-a0-r0', 'rejected', { attempts: 1, note: 'the edge' }, edge);
    expect(queue.entries[0]).toMatchObject({ status: 'rejected', attempts: 2 });
    expect(queue.entries[0].refused).toBeUndefined();
  });

  it('starts a picture that is taken back anew, and never brings it back as the closest', () => {
    const file = pictureFile('depot', 0, 0);
    // three attempts, the first the closest: it is kept, and it is the earlier self as well
    const queue = fresh();
    const shots = new Map();
    attempt(queue, shots, 2.6);
    attempt(queue, shots, 5);
    expect(attempt(queue, shots, 4).entry).toMatchObject({ status: 'generated', kept: 2.6 });
    // found faulty after all: taken back, it starts again, and not from the faulty picture
    const d = studio(shots);
    const back = settle(queue, inv, 'depot-a0-r0', 'pending', {}, d);
    expect(back.entry).toMatchObject({ status: 'pending', attempts: 0 });
    expect(back.entry.repaint).toBeUndefined();
    expect(back.entry.kept).toBeUndefined();
    expect(shots.has(file)).toBe(false);
    expect(describeQueued(queue, 'depot-a0-r0', inv, fam, onDisk(shots)).repaint).toBeFalsy();
    // the next one is a first attempt: refused for its camera, it is not "the last of three",
    // and the picture that was taken back is not what the tool falls back on
    const first = attempt(queue, shots, 4);
    expect(first.refused).toBe(true);
    expect(first.message).toMatch(/kept as the picture's earlier self/);
    expect(queue.entries[0]).toMatchObject({ status: 'pending', attempts: 1, repaint: { by: 4 } });

    // a picture that is not its own earlier self keeps what it was painted from
    const other = fresh();
    const more = new Map();
    attempt(other, more, 6.4);
    expect(attempt(other, more, 1.2).entry).toMatchObject({ status: 'generated', attempts: 2 });
    const again = settle(other, inv, 'depot-a0-r0', 'pending', {}, studio(more));
    expect(again.entry).toMatchObject({ status: 'pending', attempts: 0, repaint: { by: 6.4 } });
  });

  it('moves the mark on when a picture is given up, and counts no attempt twice', () => {
    const file = pictureFile('depot', 0, 0);
    const at = new Date('2031-01-01T12:00:00Z').getTime();
    // refused for its camera, so kept aside, and then given up: nothing lies there to count
    const queue = fresh();
    const shots = new Map();
    attempt(queue, shots, 6.4);
    settle(queue, inv, 'depot-a0-r0', 'rejected', { note: 'x', now: at }, studio(shots));
    expect(queue.entries[0]).toMatchObject({ status: 'rejected', attempts: 1 });
    // what was made before it was given up is new no longer
    expect(queue.mark).toBe(at);
    // a picture in hand that is given up was an attempt
    const other = fresh();
    other.entries[0].taken = true;
    const door = { note: 'a door on the back wall' };
    settle(other, inv, 'depot-a0-r0', 'rejected', door, studio(new Map([[file, 0]])));
    expect(other.entries[0]).toMatchObject({ status: 'rejected', attempts: 1 });
    expect(other.entries[0].taken).toBeUndefined();
    // refused where it lay, and then given up: counted once
    const third = fresh();
    const edge = {
      ...studio(new Map([[file, 1]])),
      check: () => ({ ok: false, problems: ['touches the top edge'] }),
    };
    expect(() => settle(third, inv, 'depot-a0-r0', 'generated', {}, edge)).toThrow(/not recorded/);
    settle(third, inv, 'depot-a0-r0', 'rejected', { note: 'the edge' }, edge);
    expect(third.entries[0]).toMatchObject({ status: 'rejected', attempts: 1 });
    // said to be pending while a picture is in hand, the picture stays in hand
    const fourth = fresh();
    fourth.entries[0].taken = true;
    settle(fourth, inv, 'depot-a0-r0', 'pending', {}, studio(new Map([[file, 0]])));
    expect(fourth.entries[0].taken).toBe(true);
    // and one that `set` refused where it lies stays known as refused
    settle(third, inv, 'depot-a0-r0', 'pending', {}, edge);
    expect(third.entries[0].status).toBe('pending');
    const again = fresh();
    const lies = {
      ...studio(new Map([[file, 1]])),
      check: () => ({ ok: false, problems: ['touches the top edge'] }),
    };
    expect(() => settle(again, inv, 'depot-a0-r0', 'generated', {}, lies)).toThrow(
      /touches the top edge/,
    );
    settle(again, inv, 'depot-a0-r0', 'pending', {}, lies);
    expect(again.entries[0]).toMatchObject({ status: 'pending', attempts: 1, refused: '1' });
    // given up after the refused file has gone: no trouble, and nothing more to count
    const gone = { ...lies, exists: () => false };
    settle(again, inv, 'depot-a0-r0', 'rejected', { note: 'gone' }, gone);
    expect(again.entries[0]).toMatchObject({ status: 'rejected', attempts: 1 });
    expect(again.entries[0].refused).toBeUndefined();
    // a picture had back from the tool's own files and then given up was counted before
    const back = fresh();
    const kept = new Map();
    attempt(back, kept, 6.4);
    kept.set(file, 6.4);
    settle(back, inv, 'depot-a0-r0', 'rejected', { note: 'x' }, studio(kept));
    expect(back.entries[0]).toMatchObject({ status: 'rejected', attempts: 1 });
    // and so was a picture that is made
    const made1 = fresh();
    attempt(made1, new Map(), 1.2);
    expect(made1.entries[0]).toMatchObject({ status: 'generated', attempts: 1 });
    settle(made1, inv, 'depot-a0-r0', 'rejected', { note: 'x' }, studio(new Map([[file, 1.2]])));
    expect(made1.entries[0]).toMatchObject({ status: 'rejected', attempts: 1 });
  });

  it('knows a picture in hand until it is settled, and across a rebuild of the list', () => {
    const queue = fresh();
    queue.entries[0].taken = true;
    expect(buildQueue(inv, fam, queue).entries[0].taken).toBe(true);
    expect(buildQueue(inv, fam, queue).entries[1].taken).toBeUndefined();
    // recorded or refused, it is in hand no longer
    attempt(queue, new Map(), 6.4);
    expect(queue.entries[0].taken).toBeUndefined();
    // what was made before a picture was settled is new no longer: the mark moves on, never back
    const at = new Date('2031-01-01T12:00:00Z').getTime();
    const shots = new Map([[pictureFile('depot', 0, 0), 1]]);
    settle(queue, inv, 'depot-a0-r0', 'generated', { now: at }, studio(shots));
    expect(queue.mark).toBe(at);
    expect(buildQueue(inv, fam, queue).mark).toBe(at);
    shots.set(pictureFile('depot', 0, 1), 1);
    settle(queue, inv, 'depot-a0-r1', 'generated', { now: at - 5000 }, studio(shots));
    expect(queue.mark).toBe(at);
    // put back to be made afresh, a picture is in hand no longer either
    Object.assign(queue.entries[1], { taken: true, refused: 'x' });
    redo(queue, inv, fam, 'depot-a0-r1', studio(shots));
    expect(queue.entries[1].taken).toBeUndefined();
    expect(queue.entries[1].refused).toBeUndefined();
  });

  it('asks for a picture with another fault to be made again, however often', () => {
    const queue = fresh();
    const files = new Set([pictureFile('depot', 0, 0)]);
    // a camera that is off and the top edge touched: no earlier self is made of such a picture
    for (const attempts of [1, 3]) {
      expect(() =>
        settle(queue, inv, 'depot-a0-r0', 'generated', { attempts }, disk(files, twoFaults)),
      ).toThrow(
        /^not recorded: touches the top edge; camera off by 6\.4°.*\. Make depot-a0-r0 again, or record it as rejected\.$/,
      );
      expect(files.has(pictureFile('depot', 0, 0))).toBe(true);
      expect(queue.entries[0].repaint).toBeUndefined();
    }
    expect(queue.entries[0]).toMatchObject({ status: 'pending', attempts: 3 });
  });

  it('keeps the closest attempt it holds where the last one failed for another reason', () => {
    // a rear view came right at the second attempt but for its camera (2.5 degrees), the third
    // had a door on the back wall again, and the agent gave the whole picture up
    const file = pictureFile('depot', 0, 0);
    const aside = file.replace(/\.png$/, '.rejected.png');
    const queue = fresh();
    const shots = new Map();
    attempt(queue, shots, 6.4);
    attempt(queue, shots, 2.5);
    // the third attempt in hand: taken and looked at, not recorded
    shots.set(file, 0);
    queue.entries[0].taken = true;
    const r = keepEarlier(queue, inv, 'depot-a0-r0', {}, studio(shots));
    expect(r.entry).toMatchObject({
      status: 'generated',
      attempts: 3,
      kept: 2.5,
      note: 'kept with its camera off by 2.5° after 3 attempts: the closest the tool held',
    });
    expect(r.entry.taken).toBeUndefined();
    expect(r.check.notes[0]).toMatch(/camera off by 2\.5°.*kept, and corrected by the tools$/);
    // the attempt that failed goes aside; the others stay where they were
    expect(r.aside).toBe(file);
    expect(Object.fromEntries(shots)).toEqual({
      [file]: 2.5,
      [beforeFile(file)]: 2.5,
      [beforeFile(file).replace(/\.png$/, '.1.png')]: 6.4,
      [aside]: 0,
    });
    expect(next(queue, shots)).toMatchObject({ kind: 'picture', id: 'depot-a0-r1' });

    // a picture that was given up already is kept after all
    const given = fresh();
    const lost = new Map();
    attempt(given, lost, 2.5);
    lost.set(file, 0);
    const note = { attempts: 3, note: 'a door on the back wall' };
    settle(given, inv, 'depot-a0-r0', 'rejected', note, studio(lost));
    expect(keepEarlier(given, inv, 'depot-a0-r0', {}, studio(lost)).entry).toMatchObject({
      status: 'generated',
      attempts: 3,
      kept: 2.5,
    });
    expect(lost.get(file)).toBe(2.5);

    // given up below the third attempt, it is kept all the same: nothing else leads on from there
    const low = fresh();
    const few = new Map();
    attempt(low, few, 2.5);
    settle(low, inv, 'depot-a0-r0', 'rejected', { note: 'gave up early' }, studio(few));
    expect(keepEarlier(low, inv, 'depot-a0-r0', {}, studio(few)).entry).toMatchObject({
      status: 'generated',
      attempts: 1,
      kept: 2.5,
      note: 'kept with its camera off by 2.5° after 1 attempt: the closest the tool held',
    });

    // not before the third attempt: it is made again first
    const early = fresh();
    const one = new Map();
    attempt(early, one, 2.5);
    expect(() => keepEarlier(early, inv, 'depot-a0-r0', {}, studio(one))).toThrow(
      /depot-a0-r0 has had 1 attempt: .*run `node tools\/building-queue\.mjs next`/,
    );
    expect(early.entries[0]).toMatchObject({ status: 'pending', attempts: 1 });
    // attempts the tool never saw are said, as with `set`
    expect(
      keepEarlier(early, inv, 'depot-a0-r0', { attempts: 3 }, studio(one)).entry,
    ).toMatchObject({ status: 'generated', attempts: 3, kept: 2.5 });

    // nothing held, nothing to keep; and a picture that is made stays as it is
    const none = fresh();
    expect(() => keepEarlier(none, inv, 'depot-a0-r0', {}, studio(new Map()))).toThrow(
      /holds no picture of depot-a0-r0 whose only fault was its camera/,
    );
    expect(() => keepEarlier(queue, inv, 'depot-a0-r0', {}, studio(shots))).toThrow(
      /depot-a0-r0 is recorded as generated/,
    );
    // an earlier self with another fault as well is not kept
    const two = fresh();
    Object.assign(two.entries[0], { attempts: 3, repaint: { by: 6.4, was: WAS } });
    const files = new Set([beforeFile(file)]);
    expect(() => keepEarlier(two, inv, 'depot-a0-r0', {}, disk(files, twoFaults))).toThrow(
      /^not kept: touches the top edge/,
    );
    expect(two.entries[0].status).toBe('pending');
    expect([...files]).toEqual([beforeFile(file)]);
  });

  it('leaves a kept picture marked when the user approves it, not when it is given up', () => {
    const queue = fresh();
    const shots = new Map();
    attempt(queue, shots, 6.4, { attempts: 3 });
    const d = studio(shots);
    settle(queue, inv, 'depot-a0-r0', 'approved', {}, d);
    expect(queue.entries[0]).toMatchObject({ status: 'approved', kept: 6.4 });
    settle(queue, inv, 'depot-a0-r0', 'rejected', { attempts: 3, note: 'too far off' }, d);
    expect(queue.entries[0]).toMatchObject({ status: 'rejected', note: 'too far off' });
    expect(queue.entries[0].kept).toBeUndefined();
    expect(shots.has(pictureFile('depot', 0, 0))).toBe(false);
  });

  it('puts the made pictures whose camera is off back, to be painted again as the same building', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    setStatus(queue, 'depot-a2-r1', 'approved');
    const entry = (id) => queue.entries.find((e) => e.id === id);
    entry('depot-a3-r0').kept = true;
    entry('depot-a4-r0').kept = true;
    const off = new Set(
      ['depot-a0-r0', 'depot-a0-r2', 'depot-a1-r0', 'depot-a2-r1', 'depot-a3-r0'].map(
        (id) => entry(id).file,
      ),
    );
    const verdict = (file, options) =>
      file === pictureFile('depot', 5, 3) || file === pictureFile('depot', 4, 0)
        ? twoFaults(file, options)
        : off.has(file)
          ? cameraOff(file, options)
          : fine;
    const r = recheck(queue, inv, null, disk(files, verdict));
    expect(r.checked).toBe(24);
    expect(r.back).toEqual([
      { id: 'depot-a0-r0', problem: LINE },
      { id: 'depot-a0-r2', problem: LINE },
      { id: 'depot-a1-r0', problem: LINE },
    ]);
    // a picture the user approved, and one with another fault: named, and left as they are
    expect(r.left).toEqual([
      { id: 'depot-a2-r1', why: `approved by the user; ${LINE}` },
      // a kept picture's camera is not asked about again: its other fault is no camera fault
      { id: 'depot-a4-r0', why: 'touches the top edge' },
      { id: 'depot-a5-r3', why: `touches the top edge; ${LINE}` },
    ]);
    expect(entry('depot-a2-r1').status).toBe('approved');
    expect(entry('depot-a4-r0')).toMatchObject({ status: 'generated', kept: true });
    expect(entry('depot-a4-r0').repaint).toBeUndefined();
    expect(entry('depot-a5-r3').status).toBe('generated');
    // the depot is a gate family: the user sees it again once it is painted again
    expect(r.gates).toEqual(['depot']);
    expect(queue.gates).toEqual([
      { family: 'depot', approved: false },
      { family: 'station', approved: true },
    ]);
    // kept as the closest of its attempts: not asked for again
    expect(entry('depot-a3-r0')).toMatchObject({ status: 'generated', kept: true });
    expect(Object.keys(r.results)).toHaveLength(24);
    expect(r.results['depot-a3-r0'].ok).toBe(true);
    const first = entry('depot-a0-r0');
    // what was wrong with it is kept apart from the note, which is the agent's to write
    expect(first).toMatchObject({
      status: 'pending',
      attempts: 0,
      note: '',
      repaint: { by: 6.4, was: WAS },
    });
    expect(files.has(first.file)).toBe(false);
    expect(files.has(beforeFile(first.file))).toBe(true);
    // the pictures built on it stay: it will be the same building
    expect(entry('depot-a0-r1').status).toBe('generated');
    expect(entry('depot-a2-r0').status).toBe('generated');
    expect(progress(queue, inv, fam, onDisk(files))[0]).toMatchObject({
      made: 21,
      kept: 2,
      repaint: 3,
      rejected: 0,
      behind: 0,
    });
    // they are handed out before anything new, in the list's order
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: 'depot-a0-r0', behind: [] });
    const again = describeQueued(queue, 'depot-a0-r0', inv, fam, onDisk(files));
    expect(again.sources).toEqual([STYLE_BOARD, beforeFile(first.file)]);
    expect(again.prompt.endsWith(`What was wrong with it: ${WAS}`)).toBe(true);
    // its earlier self counts when the closest attempt is chosen: how far off that was
    expect(again.earlier).toEqual({ file: beforeFile(first.file), by: 6.4 });
    // painted again and right: made, and the work goes on
    files.add(first.file);
    settle(queue, inv, 'depot-a0-r0', 'generated', {}, disk(files));
    expect(first).toMatchObject({ status: 'generated', attempts: 1, note: '' });
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: 'depot-a0-r2' });
    // a fault found in it afterwards: taken back, it is painted again the way it was, from its
    // earlier self, and nothing built on it is touched
    const back = settle(queue, inv, 'depot-a0-r0', 'pending', {}, disk(files));
    expect(first).toMatchObject({ status: 'pending', repaint: { by: 6.4, was: WAS } });
    expect(entry('depot-a0-r1').status).toBe('generated');
    // the faulty picture is set aside, so that nothing shows it or is built on it
    expect(back.aside).toBe(first.file);
    expect(files.has(first.file)).toBe(false);
    expect(files.has(first.file.replace(/\.png$/, '.rejected.png'))).toBe(true);
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: 'depot-a0-r0' });
    expect(describeQueued(queue, 'depot-a0-r0', inv, fam, onDisk(files)).sources).toEqual([
      STYLE_BOARD,
      beforeFile(first.file),
    ]);
    files.add(first.file);
    settle(queue, inv, 'depot-a0-r0', 'generated', {}, disk(files));
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: 'depot-a0-r2' });
    // a picture that was never made has nothing to set aside
    expect(settle(queue, inv, 'station-a0-r0', 'pending', {}, disk(files)).aside).toBeNull();
    // a second look finds nothing new
    expect(recheck(queue, inv, null, disk(files, fine)).back).toEqual([]);
  });

  it('clears away pictures left on disk for entries that wait to be painted again', () => {
    // a checkout or a stash put pictures back under their names. They are not attempts: recorded
    // as such they would each cost the picture one of its three
    const queue = fresh(true);
    const file = pictureFile('depot', 0, 0),
      other = pictureFile('depot', 0, 2);
    const shots = new Map();
    for (const e of queue.entries.slice(0, 24)) {
      e.status = 'generated';
      shots.set(e.file, 0);
    }
    shots.set(file, 6.4);
    shots.set(other, 5);
    const d = studio(shots);
    expect(recheck(queue, inv, null, d).back).toHaveLength(2);
    // back under their names: a copy of the earlier self, and a picture that is not one
    shots.set(file, 6.4);
    shots.set(other, 3.3);
    expect(mismatches(queue, d.exists)).toHaveLength(2);
    const r = recheck(queue, inv, null, d);
    expect(r.strays).toEqual(['depot-a0-r0', 'depot-a0-r2']);
    expect(r.back).toEqual([]);
    // the copy is gone; the other is kept beside the earlier self, under a number
    expect([...shots.keys()].filter((f) => f.includes('depot-a0-r0'))).toEqual([beforeFile(file)]);
    expect(shots.has(other)).toBe(false);
    expect(shots.get(beforeFile(other))).toBe(5);
    expect(shots.get(beforeFile(other).replace(/\.png$/, '.1.png'))).toBe(3.3);
    expect(mismatches(queue, d.exists)).toEqual([]);
    expect(queue.entries[0]).toMatchObject({ status: 'pending', attempts: 0 });
    // a picture taken back and set aside, put back under its name: the copy goes as well
    settle(queue, inv, 'depot-a0-r1', 'pending', {}, d);
    shots.set(pictureFile('depot', 0, 1), 0);
    expect(recheck(queue, inv, null, d).strays).toEqual(['depot-a0-r1']);
    expect(shots.has(pictureFile('depot', 0, 1))).toBe(false);
    // but a new picture that only waits to be recorded is the agent's: it stays
    shots.set(pictureFile('depot', 0, 1), 1.5);
    expect(recheck(queue, inv, null, d).strays).toEqual([]);
    expect(shots.get(pictureFile('depot', 0, 1))).toBe(1.5);
    expect(mismatches(queue, d.exists)).toEqual(['depot-a0-r1: on disk, but not recorded']);
    // a picture the tool took for an entry that waits to be painted again is in hand, not stray
    shots.set(other, 1.5);
    queue.entries[2].taken = true;
    expect(recheck(queue, inv, null, d).strays).toEqual([]);
    expect(shots.get(other)).toBe(1.5);
    // nor is a picture that `set` refused where it lies
    delete queue.entries[2].taken;
    queue.entries[2].refused = '1.5';
    expect(recheck(queue, inv, null, d).strays).toEqual([]);
    expect(shots.get(other)).toBe(1.5);
  });

  it('brings the marks of an earlier list up to date when it looks again', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    // as an earlier tool left it: a mark without the camera, an instruction in the note
    const e = queue.entries[0];
    Object.assign(e, {
      status: 'pending',
      attempts: 0,
      note: 'Look down more steeply.',
      repaint: true,
    });
    files.delete(e.file);
    files.add(beforeFile(e.file));
    const was = (file, o) => (file === beforeFile(e.file) ? cameraOff(file, o) : fine);
    recheck(queue, inv, null, disk(files, was));
    expect(e).toMatchObject({ status: 'pending', note: '', repaint: { by: 6.4, was: WAS } });
  });

  it('looks again at one family alone', () => {
    const queue = fresh(true);
    const files = made(queue, 48);
    const r = recheck(queue, inv, 'station', disk(files, cameraOff));
    expect(r.checked).toBe(24);
    expect(r.back).toHaveLength(24);
    expect(r.gates).toEqual(['station']);
    expect(queue.gates[0]).toEqual({ family: 'depot', approved: true });
    expect(r.back.every((b) => b.id.startsWith('station-'))).toBe(true);
    expect(queue.entries[0].status).toBe('generated');
    expect(() => recheck(queue, inv, 'lighthouse', disk(files))).toThrow(/lighthouse/);
  });

  it('shows the user a gate family again once its pictures are painted again', () => {
    const queue = fresh(true);
    const files = made(queue, 48);
    const one = (file, o) => (/depot-a0-r0\.png$/.test(file) ? cameraOff(file, o) : fine);
    expect(recheck(queue, inv, null, disk(files, one)).gates).toEqual(['depot']);
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: 'depot-a0-r0' });
    files.add(pictureFile('depot', 0, 0));
    settle(queue, inv, 'depot-a0-r0', 'generated', {}, disk(files));
    expect(next(queue, files)).toMatchObject({ kind: 'gate', family: 'depot', made: 24 });
    expect(approveGate(queue)).toEqual(['depot']);
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: queue.entries[48].id });
  });

  it('leaves a picture where it is when it cannot be moved aside, and goes on', () => {
    // a picture open in a viewer cannot be renamed: the list and the disk must still agree
    const queue = fresh(true);
    const files = made(queue, 24);
    const two = (file, o) => (/depot-a0-r[01]\.png$/.test(file) ? cameraOff(file, o) : fine);
    const d = disk(files, two);
    const move = d.setBefore;
    d.setBefore = (file) => {
      if (file === pictureFile('depot', 0, 0)) throw new Error('EBUSY: resource busy or locked');
      move(file);
    };
    const r = recheck(queue, inv, null, d);
    expect(r.back.map((b) => b.id)).toEqual(['depot-a0-r1']);
    expect(r.left).toEqual([
      {
        id: 'depot-a0-r0',
        why: `${LINE}; it could not be moved aside (EBUSY: resource busy or locked) and stays as it is`,
      },
    ]);
    expect(queue.entries[0].status).toBe('generated');
    expect(queue.entries[0].repaint).toBeUndefined();
    expect(files.has(pictureFile('depot', 0, 0))).toBe(true);
    expect(mismatches(queue, onDisk(files))).toEqual([]);
  });

  it("puts a family's rejected picture back to be painted again as it was being", () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    const one = (file, o) => (/depot-a0-r2\.png$/.test(file) ? cameraOff(file, o) : fine);
    recheck(queue, inv, null, disk(files, one));
    // given up while it was being painted again, with a note of the agent's own
    settle(
      queue,
      inv,
      'depot-a0-r2',
      'rejected',
      { attempts: 3, note: 'the door moved to the other wall' },
      disk(files),
    );
    expect(redo(queue, inv, fam, 'depot', disk(files))).toEqual(['depot-a0-r2']);
    expect(queue.entries[2]).toMatchObject({
      status: 'pending',
      attempts: 0,
      note: '',
      repaint: { by: 6.4, was: WAS },
    });
    expect(describeQueued(queue, 'depot-a0-r2', inv, fam, onDisk(files)).prompt).toContain(
      `What was wrong with it: ${WAS}`,
    );
  });

  it('stops when more than a quarter of a family had to be kept with the camera off', () => {
    const queue = fresh(true);
    const third = queue.entries[48].family;
    const files = made(queue, ['depot', 'station', third]);
    const mine = queue.entries.filter((e) => e.family === third);
    const quarter = Math.floor(mine.length / 4);
    for (const e of mine.slice(0, quarter)) e.kept = true;
    // a quarter is not more than a quarter
    expect(next(queue, files).kind).toBe('picture');
    mine[quarter].kept = true;
    expect(next(queue, files)).toMatchObject({
      kind: 'stop',
      family: third,
      made: mine.length,
      kept: quarter + 1,
    });
    // the user takes the family as it is: on to the next
    accept(queue, third);
    expect(next(queue, files).kind).toBe('picture');
    // kept within three degrees is near enough: a whole family of those does not stop the work
    const near = fresh(true);
    const all = made(near, ['depot', 'station', third]);
    for (const e of near.entries.filter((x) => x.family === third)) e.kept = 2.6;
    expect(next(near, all).kind).toBe('picture');
    expect(progress(near, inv, fam, onDisk(all)).find((r) => r.family === third)).toMatchObject({
      kept: mine.length,
      far: 0,
    });
  });

  it('makes a picture afresh when its earlier self is gone', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    const two = (file, o) => (/depot-a0-r[01]\.png$/.test(file) ? cameraOff(file, o) : fine);
    recheck(queue, inv, null, disk(files, two));
    const before = beforeFile(pictureFile('depot', 0, 1));
    const sources = () => describeQueued(queue, 'depot-a0-r1', inv, fam, onDisk(files)).sources;
    expect(sources()).toEqual([STYLE_BOARD, before]);
    files.delete(before);
    // nothing to paint it again from: it is turned from the front view, like a new picture
    expect(sources()).toEqual([STYLE_BOARD, pictureFile('depot', 0, 0)]);
    expect(describeQueued(queue, 'depot-a0-r1', inv, fam, onDisk(files)).prompt).toContain(
      fam.references.turn,
    );
    expect(mismatches(queue, onDisk(files))).toEqual([
      'depot-a0-r1: to be painted again, but its earlier picture is missing; it will be made afresh',
    ]);
    // and so it waits for the front view, which is painted again first
    files.add(pictureFile('depot', 0, 0));
    settle(queue, inv, 'depot-a0-r0', 'generated', {}, disk(files));
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: 'depot-a0-r1' });
  });

  it("sets a rejected picture's file aside", () => {
    const queue = fresh();
    const files = made(queue, 1);
    const r = settle(
      queue,
      inv,
      'depot-a0-r0',
      'rejected',
      { attempts: 3, note: 'floats' },
      disk(files),
    );
    expect(r.aside).toBe(pictureFile('depot', 0, 0));
    expect(files.has(pictureFile('depot', 0, 0))).toBe(false);
    expect([...files]).toEqual(['assets/source/buildings-v2/depot/depot-a0-r0.rejected.png']);
    // nothing to set aside when there is no file
    expect(
      settle(queue, inv, 'depot-a0-r1', 'rejected', { attempts: 3 }, disk(files)).aside,
    ).toBeNull();
  });

  it('puts a picture and everything built on it back in the queue', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    setStatus(queue, 'depot-a2-r1', 'approved');
    const again = redo(queue, inv, fam, 'depot-a1-r0', disk(files));
    // the diesel front view, its three other views, and every later age: 4 + 16
    expect(again).toHaveLength(20);
    expect(again[0]).toBe('depot-a1-r0');
    expect(again).toContain('depot-a5-r3');
    expect(again).not.toContain('depot-a0-r3');
    for (const id of again) {
      const e = queue.entries.find((x) => x.id === id);
      expect([e.status, e.attempts, e.note]).toEqual(['pending', 0, '']);
      expect(files.has(e.file)).toBe(false);
    }
    expect(files.has(pictureFile('depot', 0, 3))).toBe(true);
    expect(next(queue, files)).toMatchObject({ kind: 'picture', id: 'depot-a1-r0' });
  });

  it('says what putting a picture back would undo, before anything is done', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    const two = (file, o) => (/depot-a0-r[02]\.png$/.test(file) ? cameraOff(file, o) : fine);
    recheck(queue, inv, null, disk(files, two));
    // the steam front view: every picture of the depot is built on it, and the narrow depot too,
    // which has no picture of its own today and leans on this one
    const plan = redoPlan(queue, inv, fam, 'depot-a0-r0', onDisk(files));
    expect(plan.ids).toHaveLength(48);
    expect(plan.ids[0]).toBe('depot-a0-r0');
    expect(plan.ids.filter((id) => id.startsWith('depot_narrow-'))).toHaveLength(24);
    // 22 are made and would be set aside; 2 wait to be painted again and would be made afresh
    expect(plan).toMatchObject({ made: 22, repaint: 2 });
    expect(queue.entries[1].status).toBe('generated');
    expect(queue.entries[0].repaint).toBeDefined();
    // a picture nothing is built on
    expect(redoPlan(queue, inv, fam, 'depot-a5-r3', onDisk(files))).toEqual({
      ids: ['depot-a5-r3'],
      made: 1,
      repaint: 0,
    });
    // a family: its rejected pictures
    setStatus(queue, 'depot-a5-r3', 'rejected', { attempts: 3 });
    expect(redoPlan(queue, inv, fam, 'depot', onDisk(files)).ids).toEqual(['depot-a5-r3']);
    expect(() => redoPlan(queue, inv, fam, 'lighthouse', onDisk(files))).toThrow(/lighthouse/);
  });

  it('makes a picture afresh, not from its earlier self, when it is put back by name', () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    queue.entries[20].kept = true;
    recheck(
      queue,
      inv,
      null,
      disk(files, (file, o) => (/depot-a5-r1\.png$/.test(file) ? cameraOff(file, o) : fine)),
    );
    expect(queue.entries[21]).toMatchObject({ id: 'depot-a5-r1', repaint: { by: 6.4 } });
    const again = redo(queue, inv, fam, 'depot-a5-r0', disk(files));
    expect(again).toEqual(['depot-a5-r0', 'depot-a5-r1', 'depot-a5-r2', 'depot-a5-r3']);
    for (const e of queue.entries.slice(20, 24)) {
      expect([e.status, e.attempts, e.note]).toEqual(['pending', 0, '']);
      expect(e.kept).toBeUndefined();
      expect(e.repaint).toBeUndefined();
    }
  });

  it("puts a family's rejected pictures back in the queue", () => {
    const queue = fresh(true);
    const files = made(queue, 24);
    setStatus(queue, 'station-a0-r0', 'rejected', { attempts: 3, note: 'no canopy' });
    expect(redo(queue, inv, fam, 'station', disk(files))).toEqual(['station-a0-r0']);
    expect(queue.entries[24]).toMatchObject({ status: 'pending', attempts: 0, note: '' });
    expect(() => redo(queue, inv, fam, 'lighthouse', disk(files))).toThrow(/lighthouse/);
  });

  it('finds where the list and the disk disagree', () => {
    const queue = fresh();
    const files = made(queue, 3);
    files.delete(pictureFile('depot', 0, 1));
    files.add(pictureFile('depot', 1, 0));
    setStatus(queue, 'depot-a0-r2', 'rejected', { attempts: 3 });
    expect(mismatches(queue, onDisk(files))).toEqual([
      'depot-a0-r1: recorded as made, but its file is missing',
      'depot-a0-r2: rejected, but its file is still on disk',
      'depot-a1-r0: on disk, but not recorded',
    ]);
  });
});

describe('the queue tool on the command line', () => {
  const tool = resolve('tools/building-queue.mjs');
  /** a copy of what the tool reads, in a folder of its own */
  const sandbox = () => {
    const root = mkdtempSync(join(tmpdir(), 'building-queue-'));
    cpSync('src/data', join(root, 'src/data'), { recursive: true });
    mkdirSync(join(root, 'assets/source/buildings-v2'), { recursive: true });
    cpSync(
      'assets/source/buildings-v2/families.json',
      join(root, 'assets/source/buildings-v2/families.json'),
    );
    const stub = (file) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), '');
    };
    for (const f of [STYLE_BOARD, MOOD_EARLY, MOOD_LATE]) stub(f);
    for (const f of Object.values(fam.families)) if (f.base) stub(f.base);
    return root;
  };
  /** the tool in a sandbox; the image tool's folder is the sandbox's own, never the developer's */
  const run = (root, ...args) => {
    try {
      const env = { ...process.env, CODEX_HOME: join(root, 'codex') };
      return {
        code: 0,
        out: execFileSync(process.execPath, [tool, ...args], { cwd: root, encoding: 'utf8', env }),
      };
    } catch (e) {
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };
  const at_ = (root, file) => join(root, file);
  /** a painted depot, as the generator returns it; `map` moves every point of it */
  const paint = (root, id, map = (p) => p, to = null) => {
    const d = about(id);
    const fp = FOOTPRINTS[d.footprint];
    const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
    const faces = boxFaces(fp, { ...blockOf(d.footprint, d.rot), z0: 0 });
    const shade = { top: [220, 210, 180], left: [160, 120, 90], right: [110, 80, 60] };
    for (const [name, pts] of Object.entries(faces)) fillPoly(png, pts.map(map), shade[name]);
    // a depot's portals are open to the ground, between the door posts: the game's rails run in
    // (the guide has its openings on the plinth; the painted block stands on the ground)
    const down = fp.scale * blockOf(d.footprint, d.rot).z0;
    const part = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (const o of openingsOf(d.footprint, d.rot).filter((x) => x.kind === 'side')) {
      const [a0, c0, cTop0, aTop0] = o.pts.map(([x, y]) => [x, y + down]);
      const [a, c] = [part(a0, c0, 0.15), part(a0, c0, 0.85)];
      const [aTop, cTop] = [part(aTop0, cTop0, 0.15), part(aTop0, cTop0, 0.85)];
      fillPoly(png, [a, c, part(c, cTop, 0.4), part(a, aTop, 0.4)].map(map), [0, 0, 0], 0);
    }
    const out = to ?? join(root, d.file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, PNG.sync.write(png));
  };
  /**
   * An image tool's folder under `base`: a folder for each chat, a file for each picture made,
   * numbered as they are made and dated by the clock; no two are the same picture. `old` is one
   * made an hour ago, `low` one seen from too low a camera, `small` one at half the size asked.
   */
  const imageTool = (root, base) => {
    let n = 0;
    return (chat, { id = 'depot-a0-r0', low = false, old = false, small = false } = {}) => {
      const k = ++n;
      const to = join(base, chat, `exec-${k}.png`);
      paint(root, id, ([x, y]) => [x + k, low ? 760 + (y - 760) * 0.8 : y], to);
      if (small) {
        const full = PNG.sync.read(readFileSync(to));
        const half = new PNG({ width: full.width >> 1, height: full.height >> 1 });
        for (let y = 0; y < half.height; y++)
          for (let x = 0; x < half.width; x++)
            full.data.copy(
              half.data,
              (y * half.width + x) * 4,
              (y * 2 * full.width + x * 2) * 4,
              (y * 2 * full.width + x * 2) * 4 + 4,
            );
        writeFileSync(to, PNG.sync.write(half));
      }
      if (old) {
        const t = new Date(Date.now() - 3600 * 1000);
        utimesSync(to, t, t);
      }
      return to;
    };
  };

  it('hands out a picture, records it only when it passes, and holds the gate', () => {
    const root = sandbox();
    expect(run(root).out).toMatch(/548 pictures, 27 families/);
    const first = run(root, 'next');
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/^picture: +depot-a0-r0$/m);
    expect(first.out).not.toMatch(/waiting/);
    // no file yet: not recorded
    const none = run(root, 'set', 'depot-a0-r0', 'generated');
    expect(none.code).toBe(1);
    expect(none.out).toMatch(/no such file/);
    paint(root, 'depot-a0-r0');
    const ok = run(root, 'set', 'depot-a0-r0', 'generated', '--attempts', '2');
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/depot-a0-r0: generated, 2 attempts/);
    const report = JSON.parse(
      readFileSync(join(root, 'assets/source/buildings-v2/report.json'), 'utf8'),
    );
    expect(report.pictures['depot-a0-r0'].ok).toBe(true);
    const second = run(root, 'next');
    expect(second.out).toMatch(/^picture: +depot-a0-r1$/m);
    // the front view it is turned from is attached laid onto its footprint
    expect(second.out).toMatch(/^ +2\. assets\/source\/buildings-v2\/\.fitted\/depot-a0-r0\.png$/m);
    const fitted = PNG.sync.read(readFileSync(join(root, fittedFile('depot-a0-r0'))));
    expect([fitted.width, fitted.height]).toEqual(FOOTPRINTS.t2x2.canvas);
    // a rejected picture leaves the list's hand: its file is set aside
    paint(root, 'depot-a0-r1');
    const no = run(
      root,
      'set',
      'depot-a0-r1',
      'rejected',
      '--attempts',
      '3',
      '--note',
      'portals on the wrong wall',
    );
    expect(no.code).toBe(0);
    expect(existsSync(join(root, pictureFile('depot', 0, 1)))).toBe(false);
    expect(
      existsSync(join(root, 'assets/source/buildings-v2/depot/depot-a0-r1.rejected.png')),
    ).toBe(true);
    expect(run(root, 'set', 'depot-a0-r1', 'generated', '--attempts', 'two').out).toMatch(
      /whole number/,
    );
    const status = run(root, 'status');
    expect(status.out).toMatch(/depot +1\/24 made, 1 rejected/);
    expect(status.out).toMatch(/gate "depot": not approved yet/);
    // redo it, and the list offers it again
    expect(run(root, 'redo', 'depot-a0-r1').out).toMatch(/1 picture back in the queue/);
    expect(run(root, 'next').out).toMatch(/^picture: +depot-a0-r1$/m);
  }, 60000);

  it('refuses a camera that is off, keeps the closest attempt, and repaints what was made', () => {
    const root = sandbox();
    run(root);
    const at = (file) => join(root, file);
    // a depot seen from too low: its wall feet at 0.4, which is 23.6 degrees
    const low = ([x, y]) => [x, 760 + (y - 760) * 0.8];
    paint(root, 'depot-a0-r0', low);
    const no = run(root, 'set', 'depot-a0-r0', 'generated');
    expect(no.code).toBe(1);
    expect(no.out).toMatch(/not recorded: camera off by 6\.\d°: it looks down from 23\.\d°/);
    expect(no.out).toMatch(
      /kept as the picture's earlier self: run `node tools\/building-queue\.mjs next` again/,
    );
    // the refused attempt is what the next one is painted from: the tool has moved it itself
    expect(existsSync(at(pictureFile('depot', 0, 0)))).toBe(false);
    expect(existsSync(at(beforeFile(pictureFile('depot', 0, 0))))).toBe(true);
    const second = run(root, 'next');
    expect(second.out).toMatch(/^picture: +depot-a0-r0 \(to paint again: the same building\)$/m);
    expect(second.out).toMatch(/^attempts so far: 1$/m);
    expect(second.out).toMatch(
      /^ +2\. assets\/source\/buildings-v2\/\.fitted\/depot-a0-r0\.before\.png$/m,
    );
    // the same camera twice more: the tool counts, and keeps the closest of the three itself
    paint(root, 'depot-a0-r0', low);
    expect(run(root, 'set', 'depot-a0-r0', 'generated').code).toBe(1);
    paint(root, 'depot-a0-r0', low);
    const kept = run(root, 'set', 'depot-a0-r0', 'generated');
    expect(kept.code).toBe(0);
    expect(kept.out).toMatch(
      /^ok +depot-a0-r0 +\(camera off by 6\.\d°.*kept, and corrected by the tools\)$/m,
    );
    expect(kept.out).toMatch(
      /depot-a0-r0: generated, 3 attempts \(kept with its camera off by 6\.\d° after 3 attempts/,
    );
    expect(existsSync(at(pictureFile('depot', 0, 0)))).toBe(true);
    expect(run(root, 'status').out).toMatch(/depot +1\/24 made, 1 kept with the camera off/);
    // the check of a family knows a kept picture: it passes, with its camera named
    const family = (() => {
      try {
        const out = execFileSync(
          process.execPath,
          [resolve('tools/building-check.mjs'), '--family', 'depot'],
          { cwd: root, encoding: 'utf8' },
        );
        return { code: 0, out };
      } catch (e) {
        return { code: e.status, out: `${e.stdout}${e.stderr}` };
      }
    })();
    expect(family.out).toMatch(
      /^ok +depot-a0-r0 +\(camera off by 6\.\d°.*kept, and corrected by the tools\)$/m,
    );
    expect(family.out).toMatch(/1 checked, 0 failed/);
    expect(family.code).toBe(0);
    // a picture recorded before the camera was looked at: `recheck` finds it
    paint(root, 'depot-a0-r1', low);
    const file = at('assets/source/buildings-v2/queue.json');
    const queue = JSON.parse(readFileSync(file, 'utf8'));
    Object.assign(queue.entries[1], { status: 'generated', attempts: 1 });
    writeFileSync(file, JSON.stringify(queue, null, 2) + '\n');
    const again = run(root, 'recheck');
    expect(again.code).toBe(0);
    expect(again.out).toMatch(
      /^2 made pictures checked: 1 back in the queue, to be painted again/m,
    );
    expect(again.out).toMatch(/^ +depot-a0-r1 +camera off by 6\.\d°/m);
    expect(again.out).not.toMatch(/^ +depot-a0-r0 /m);
    expect(existsSync(at(pictureFile('depot', 0, 1)))).toBe(false);
    expect(existsSync(at(beforeFile(pictureFile('depot', 0, 1))))).toBe(true);
    const report = JSON.parse(readFileSync(at('assets/source/buildings-v2/report.json'), 'utf8'));
    expect(report.pictures['depot-a0-r1'].ok).toBe(false);
    expect(report.pictures['depot-a0-r0'].ok).toBe(true);
    const status = run(root, 'status');
    expect(status.out).toMatch(
      /depot +1\/24 made, 1 kept with the camera off \(1 by more than 3°\), 1 to paint again/,
    );
    expect(status.out).not.toMatch(/mismatch/);
    // it is handed out with its earlier self, straightened, and with what was wrong with it
    const next = run(root, 'next');
    expect(next.out).toMatch(/^picture: +depot-a0-r1 \(to paint again: the same building\)$/m);
    expect(next.out).toMatch(
      /^ +2\. assets\/source\/buildings-v2\/\.fitted\/depot-a0-r1\.before\.png$/m,
    );
    expect(next.out).toContain(
      'What was wrong with it: It was painted from too low a camera, so too little of its roof showed.',
    );
    // its earlier self counts when the closest attempt is chosen
    expect(next.out).toMatch(
      /^earlier self: +off by 6\.\d°, in assets\/source\/buildings-v2\/depot\/depot-a0-r1\.before\.png$/m,
    );
    const straightened = (id) =>
      PNG.sync.read(readFileSync(at(`assets/source/buildings-v2/.fitted/${id}.before.png`)));
    const fitted = straightened('depot-a0-r1');
    expect([fitted.width, fitted.height]).toEqual(FOOTPRINTS.t2x2.canvas);
    // and what the generator is shown of it stands at the game's camera
    const shown = fitPicture(fitted, 't2x2', 1).camera;
    expect(Math.abs(shown.elevation - 30)).toBeLessThan(0.7);
    expect(Math.abs(shown.turn)).toBeLessThan(0.7);
    expect(JSON.parse(run(root, 'next', '--json').out).picture.sources[1]).toBe(
      beforeFile(pictureFile('depot', 0, 1)),
    );
    // painted again from the game's camera: recorded, and the work goes on
    paint(root, 'depot-a0-r1');
    expect(run(root, 'set', 'depot-a0-r1', 'generated').out).toMatch(
      /depot-a0-r1: generated, 1 attempt$/m,
    );
    expect(run(root, 'next').out).toMatch(/^picture: +depot-a0-r2$/m);
    // put back a second time: its first self is not lost, it is kept under a number
    paint(root, 'depot-a0-r1', low);
    expect(run(root, 'recheck').out).toMatch(/: 1 back in the queue/);
    expect(existsSync(at(beforeFile(pictureFile('depot', 0, 1))))).toBe(true);
    expect(existsSync(at('assets/source/buildings-v2/depot/depot-a0-r1.before.1.png'))).toBe(true);
    // a checkout put the earlier self back under the picture's name: `recheck` clears the copy
    cpSync(at(beforeFile(pictureFile('depot', 0, 1))), at(pictureFile('depot', 0, 1)));
    expect(run(root, 'status').out).toMatch(/mismatch +depot-a0-r1: on disk, but not recorded/);
    const tidy = run(root, 'recheck');
    expect(tidy.out).toMatch(/^1 picture was on disk for an entry that waits to be painted again/m);
    expect(existsSync(at(pictureFile('depot', 0, 1)))).toBe(false);
    expect(existsSync(at(beforeFile(pictureFile('depot', 0, 1))))).toBe(true);
    expect(run(root, 'status').out).not.toMatch(/mismatch/);
    // set aside twice: the first picture set aside is kept too, under a number
    paint(root, 'depot-a0-r1');
    expect(run(root, 'set', 'depot-a0-r1', 'rejected', '--note', 'again').code).toBe(0);
    expect(run(root, 'redo', 'depot').out).toMatch(/1 picture back in the queue: depot-a0-r1/);
    paint(root, 'depot-a0-r1');
    expect(run(root, 'set', 'depot-a0-r1', 'rejected', '--note', 'and again').code).toBe(0);
    expect(existsSync(at('assets/source/buildings-v2/depot/depot-a0-r1.rejected.png'))).toBe(true);
    expect(existsSync(at('assets/source/buildings-v2/depot/depot-a0-r1.rejected.1.png'))).toBe(
      true,
    );
    expect(run(root, 'redo', 'depot').out).toMatch(/1 picture back in the queue: depot-a0-r1/);
    // an earlier self is straightened all the way, however far off: 0.5 x 0.6 is 17.5 degrees,
    // flatter than the fit corrects a picture for the game
    paint(root, 'depot-a0-r3', ([x, y]) => [x, 760 + (y - 760) * 0.6]);
    const list = JSON.parse(readFileSync(file, 'utf8'));
    Object.assign(list.entries[3], { status: 'generated', attempts: 1 });
    writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
    expect(run(root, 'recheck').out).toMatch(/^ +depot-a0-r3 +camera off by 12\.\d°/m);
    expect(run(root, 'show', 'depot-a0-r3').out).toMatch(/^earlier self: +off by 12\.\d°, /m);
    const far = fitPicture(straightened('depot-a0-r3'), 't2x2', 3).camera;
    expect(Math.abs(far.elevation - 30)).toBeLessThan(0.7);
    expect(Math.abs(far.turn)).toBeLessThan(0.7);
    expect(run(root, 'recheck', 'lighthouse').code).toBe(1);
    // a picture on grass for the eye, as painted: opaque, whatever lies under its transparency
    const looked = execFileSync(
      process.execPath,
      [resolve('tools/building-sheets.mjs'), '--picture', pictureFile('depot', 0, 0)],
      { cwd: root, encoding: 'utf8' },
    );
    expect(looked).toMatch(/^assets\/source\/buildings-v2\/\.look\/depot-a0-r0\.png$/m);
    const look = PNG.sync.read(
      readFileSync(at('assets/source/buildings-v2/.look/depot-a0-r0.png')),
    );
    expect([look.width, look.height]).toEqual([768, 512]);
    // putting a front view back takes everything built on it along: said first, done when told
    const before = readFileSync(file, 'utf8');
    const plan = run(root, 'redo', 'depot-a0-r0');
    expect(plan.code).toBe(1);
    expect(plan.out).toMatch(/would put 48 pictures back, each to be made afresh/);
    expect(plan.out).toMatch(/Nothing was changed/);
    expect(plan.out).toMatch(/set depot-a0-r0 pending/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(existsSync(at(pictureFile('depot', 0, 0)))).toBe(true);
    expect(run(root, 'redo', 'depot-a0-r0', '--yes').out).toMatch(/48 pictures back in the queue/);
    expect(existsSync(at(pictureFile('depot', 0, 0)))).toBe(false);
  }, 60000);

  it('answers with the exit code for a gate, a stop and the end', () => {
    const root = sandbox();
    run(root);
    const file = join(root, 'assets/source/buildings-v2/queue.json');
    const edit = (change) => {
      const queue = JSON.parse(readFileSync(file, 'utf8'));
      change(queue);
      writeFileSync(file, JSON.stringify(queue, null, 2) + '\n');
    };
    // the depot's first picture rejected: nothing of the pilot can be made, so the gate
    edit((queue) =>
      Object.assign(queue.entries[0], { status: 'rejected', attempts: 3, note: 'floats' }),
    );
    const gate = run(root, 'next');
    expect(gate.code).toBe(2);
    expect(gate.out).toMatch(/GATE.*"depot"/);
    expect(gate.out).toMatch(/0 of 24 made, 1 rejected, 23 not made/);
    expect(run(root, 'approve-pilot').out).toMatch(/"depot" approved/);
    edit((queue) =>
      Object.assign(queue.entries[24], { status: 'rejected', attempts: 3, note: 'no canopy' }),
    );
    expect(run(root, 'approve-pilot').out).toMatch(/"station" approved/);
    // the third family's first picture rejected as well: more than a quarter lost, so a stop
    edit((queue) =>
      Object.assign(queue.entries[48], { status: 'rejected', attempts: 3, note: 'x' }),
    );
    const stop = run(root, 'next');
    expect(stop.code).toBe(4);
    expect(stop.out).toMatch(/STOP/);
    const third = JSON.parse(readFileSync(file, 'utf8')).entries[48].family;
    expect(run(root, 'accept', third).code).toBe(0);
    expect(run(root, 'next').code).toBe(0);
    edit((queue) => {
      for (const e of queue.entries) e.status = 'rejected';
      queue.accepted = [...new Set(queue.entries.map((e) => e.family))];
    });
    const done = run(root, 'next');
    expect(done.code).toBe(3);
    expect(done.out).toMatch(/DONE/);
    expect(run(root, 'frobnicate').code).toBe(1);
  }, 60000);

  it('keeps the attempt it holds for a picture that would be given up', () => {
    const root = sandbox();
    run(root);
    const low = ([x, y]) => [x, 760 + (y - 760) * 0.8];
    paint(root, 'depot-a0-r0', low);
    expect(run(root, 'set', 'depot-a0-r0', 'generated').code).toBe(1);
    // not at the first attempt: the picture is made again first
    const early = run(root, 'keep', 'depot-a0-r0');
    expect(early.code).toBe(1);
    expect(early.out).toMatch(/depot-a0-r0 has had 1 attempt/);
    // given up at the third, with the tool holding an attempt: it says how that one is kept
    const up = run(root, 'set', 'depot-a0-r0', 'rejected', '--attempts', '3', '--note', 'a door');
    expect(up.code).toBe(0);
    expect(up.out).toMatch(
      /^note: +the tool holds a picture of depot-a0-r0 whose only fault was its camera \(off by 6\.\d°\).*node tools\/building-queue\.mjs keep depot-a0-r0$/m,
    );
    const back = run(root, 'keep', 'depot-a0-r0');
    expect(back.code).toBe(0);
    expect(back.out).toMatch(
      /depot-a0-r0: generated, 3 attempts \(kept with its camera off by 6\.\d° after 3 attempts: the closest the tool held\)/,
    );
    expect(existsSync(join(root, pictureFile('depot', 0, 0)))).toBe(true);
    // what was kept is shown, to be looked at: the closest by its camera may not be the one meant
    expect(back.out).toMatch(/^look at: +assets\/source\/buildings-v2\/\.look\/depot-a0-r0\.png$/m);
    expect(existsSync(join(root, 'assets/source/buildings-v2/.look/depot-a0-r0.png'))).toBe(true);
    expect(run(root, 'status').out).toMatch(/depot +1\/24 made, 1 kept with the camera off/);
    expect(run(root, 'next').out).toMatch(/^picture: +depot-a0-r1$/m);
    // made now: nothing more to keep
    expect(run(root, 'keep', 'depot-a0-r0').code).toBe(1);
    expect(run(root, 'keep').out).toMatch(
      /say which picture: node tools\/building-queue\.mjs keep <id>/,
    );
  }, 60000);

  it('takes the picture the image tool just wrote, and lays it out to look at', () => {
    // an agent that had lost its way of saving moved each picture through the shell as text, a
    // hundred commands a picture: the way is the tool's, and `next` names it every time
    const root = sandbox();
    run(root);
    const at = (file) => join(root, file);
    const list = () =>
      JSON.parse(readFileSync(at('assets/source/buildings-v2/queue.json'), 'utf8'));
    const file = pictureFile('depot', 0, 0);
    const from = join(root, 'made');
    const chat = join(from, 'chat');
    const made = imageTool(root, from);
    const head = run(root, 'next').out;
    expect(head).toMatch(/^file: +assets\/source\/buildings-v2\/depot\/depot-a0-r0\.png$/m);
    expect(head).not.toMatch(/save as/);
    // how a picture is taken is said after how it is made
    expect(head).toMatch(
      /----- end of prompt -----\n\nwhen the picture is made: node tools\/building-queue\.mjs take depot-a0-r0 --from <the file your image tool reported>\n/,
    );
    // nothing made yet
    mkdirSync(chat, { recursive: true });
    const none = run(root, 'take', 'depot-a0-r0', '--from', chat);
    expect(none.code).toBe(1);
    expect(none.out).toMatch(/no picture in /);
    // an old picture is not the one just made
    made('chat', { old: true });
    const stale = run(root, 'take', 'depot-a0-r0', '--from', chat);
    expect(stale.code).toBe(1);
    expect(stale.out).toMatch(/exec-1\.png, was made 60 minutes ago/);
    expect(existsSync(at(file))).toBe(false);
    // the newest one is taken: written as it is, and laid on grass for the eye
    const first = made('chat');
    const ok = run(root, 'take', 'depot-a0-r0', '--from', chat);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/^took: +.*exec-2\.png \(made \d+ s ago\)$/m);
    expect(ok.out).not.toMatch(/replaced/);
    expect(ok.out).toMatch(/^saved as: +assets\/source\/buildings-v2\/depot\/depot-a0-r0\.png$/m);
    expect(ok.out).toMatch(/^look at: +assets\/source\/buildings-v2\/\.look\/depot-a0-r0\.png$/m);
    expect(ok.out).toMatch(/^then: +node tools\/building-queue\.mjs set depot-a0-r0 generated$/m);
    expect(ok.out).not.toMatch(/^note:/m);
    expect(readFileSync(at(file)).equals(readFileSync(first))).toBe(true);
    expect(existsSync(first)).toBe(true);
    // under a date of its own: what is made from a picture is renewed by its date
    expect(statSync(at(file)).mtimeMs).toBeGreaterThan(statSync(first).mtimeMs);
    const look = at('assets/source/buildings-v2/.look/depot-a0-r0.png');
    expect(PNG.sync.read(readFileSync(look)).data[3]).toBe(255);
    // what was made up to now is new no longer: the list keeps the mark
    expect(list().mark).toBe(statSync(first).mtimeMs);
    // taking does not make a picture: it waits to be looked at and recorded
    expect(run(root, 'status').out).toMatch(/mismatch +depot-a0-r0: on disk, but not recorded/);
    // asked again with nothing new made, it shows the same picture and says so
    const twice = run(root, 'take', 'depot-a0-r0', '--from', chat);
    expect(twice.code).toBe(0);
    expect(twice.out).toMatch(/^no new picture: this is the one that was taken before$/m);
    expect(twice.out).toMatch(
      /^look at: +assets\/source\/buildings-v2\/\.look\/depot-a0-r0\.png$/m,
    );
    // looked at and given up: the next one takes its place, and the one given up is counted
    const second = made('chat');
    const over = run(root, 'take', 'depot-a0-r0', '--from', chat);
    expect(over.code).toBe(0);
    expect(over.out).toMatch(/^took: +.*exec-3\.png/m);
    expect(over.out).toMatch(
      /^replaced: +the picture taken before, which was not recorded: counted as an attempt \(1 so far\)$/m,
    );
    // what was given up is not had back by naming it: it was made before the one taken last
    const older = run(root, 'take', 'depot-a0-r0', '--from', first);
    expect(older.code).toBe(1);
    expect(older.out).toMatch(
      /exec-2\.png was made before the last picture that was taken or recorded/,
    );
    expect(readFileSync(at(file)).equals(readFileSync(second))).toBe(true);
    expect(run(root, 'set', 'depot-a0-r0', 'generated').out).toMatch(
      /depot-a0-r0: generated, 2 attempts/,
    );
    // a picture that is recorded as made is not taken over
    const done = run(root, 'take', 'depot-a0-r0', '--from', chat);
    expect(done.code).toBe(1);
    expect(done.out).toMatch(
      /depot-a0-r0 is recorded as generated.*node tools\/building-queue\.mjs set depot-a0-r0 pending/,
    );

    // nor is a picture of the list taken for another entry by naming its file there
    const cross = run(root, 'take', 'depot-a0-r1', '--from', at(file));
    expect(cross.code).toBe(1);
    expect(cross.out).toMatch(/depot-a0-r0\.png is depot-a0-r0's picture/);

    // the next picture, and a generation that failed: the newest picture is the last one's
    const r1 = pictureFile('depot', 0, 1);
    const failed = run(root, 'take', 'depot-a0-r1', '--from', chat);
    expect(failed.code).toBe(1);
    expect(failed.out).toMatch(
      /nothing new was made: the newest picture there, .*exec-3\.png, is depot-a0-r0's \(.*depot-a0-r0\.png\)/,
    );
    const named = run(root, 'take', 'depot-a0-r1', '--from', second);
    expect(named.code).toBe(1);
    expect(named.out).toMatch(/exec-3\.png is depot-a0-r0's picture/);
    expect(existsSync(at(r1))).toBe(false);
    // a picture made and never taken is not new for the entry after: it was made before the
    // last picture was recorded
    const kept = made('chat', { id: 'depot-a0-r1' });
    expect(run(root, 'take', 'depot-a0-r1', '--from', kept).code).toBe(0);
    made('chat', { id: 'depot-a0-r1' });
    expect(run(root, 'set', 'depot-a0-r1', 'generated').code).toBe(0);
    const r2 = pictureFile('depot', 0, 2);
    const left = run(root, 'take', 'depot-a0-r2', '--from', chat);
    expect(left.code).toBe(1);
    expect(left.out).toMatch(
      /nothing new was made: the newest picture there, .*exec-5\.png, was made before the last picture was taken or recorded/,
    );
    expect(existsSync(at(r2))).toBe(false);

    // refused for its camera, the tool keeps a picture: it is still known as taken
    const low = made('chat', { id: 'depot-a0-r2', low: true });
    expect(run(root, 'take', 'depot-a0-r2', '--from', low).code).toBe(0);
    expect(run(root, 'set', 'depot-a0-r2', 'generated').code).toBe(1);
    expect(existsSync(at(r2))).toBe(false);
    const again = run(root, 'take', 'depot-a0-r2', '--from', low);
    expect(again.code).toBe(1);
    expect(again.out).toMatch(/was taken before \(it is .*depot-a0-r2\.before\.png\)/);
    // what the tool keeps of this picture can be had back by its own name, and that is no attempt
    expect(run(root, 'take', 'depot-a0-r2', '--from', at(beforeFile(r2))).code).toBe(0);
    expect(readFileSync(at(r2)).equals(readFileSync(low))).toBe(true);
    const same = run(root, 'take', 'depot-a0-r2', '--from', beforeFile(r2));
    expect(same.code).toBe(0);
    expect(same.out).toMatch(/^no new picture: this is the one that was taken before$/m);
    expect(run(root, 'show', 'depot-a0-r2').out).toMatch(/^attempts so far: 1$/m);
    // a picture had back is no new attempt: one made after it takes its place uncounted
    const newer = made('chat', { id: 'depot-a0-r2' });
    const place = run(root, 'take', 'depot-a0-r2', '--from', newer);
    expect(place.code).toBe(0);
    expect(place.out).toMatch(/^replaced: +the picture that lay there, which was not recorded$/m);
    expect(place.out).not.toMatch(/counted as an attempt/);
    // what cannot be read as a picture, or shows no building, is not taken
    const bad = join(from, 'chat', 'exec-bad.png');
    writeFileSync(bad, '');
    const unread = run(root, 'take', 'depot-a0-r2', '--from', bad);
    expect(unread.code).toBe(1);
    expect(unread.out).toMatch(/exec-bad\.png cannot be read as a picture/);
    const blank = join(from, 'chat', 'exec-blank.png');
    writeFileSync(blank, PNG.sync.write(new PNG({ width: 64, height: 64 })));
    const empty = run(root, 'take', 'depot-a0-r2', '--from', blank);
    expect(empty.code).toBe(1);
    expect(empty.out).toMatch(/there is no building in .*exec-blank\.png/);
    expect(readFileSync(at(r2)).equals(readFileSync(newer))).toBe(true);

    // refused by `set` for another fault, a picture stays under its name: asked for again with
    // nothing new made, it is not sent to `set` once more, and it is not counted twice
    const small = made('chat', { id: 'depot-a0-r3', small: true });
    expect(run(root, 'take', 'depot-a0-r3', '--from', small).code).toBe(0);
    const no = run(root, 'set', 'depot-a0-r3', 'generated');
    expect(no.code).toBe(1);
    expect(no.out).toMatch(/its short side must be at least 768 px\. Make depot-a0-r3 again/);
    const stuck = run(root, 'take', 'depot-a0-r3', '--from', chat);
    expect(stuck.code).toBe(1);
    expect(stuck.out).toMatch(
      /nothing new was made, and the picture in .*depot-a0-r3\.png was refused by `set`: make the picture again/,
    );
    expect(stuck.out).not.toMatch(/^then:/m);
    expect(run(root, 'set', 'depot-a0-r3', 'generated').out).toMatch(
      /It is the picture that was refused before/,
    );
    expect(run(root, 'show', 'depot-a0-r3').out).toMatch(/^attempts so far: 1$/m);

    // a picture whose turn has not come is taken, and said to be out of turn
    const early = made('chat', { id: 'depot-a5-r3' });
    const ahead = run(root, 'take', 'depot-a5-r3', '--from', early);
    expect(ahead.code).toBe(0);
    expect(ahead.out).toMatch(/^note: +`next` hands out depot-a0-r2, not depot-a5-r3$/m);
    // a command that is cut short or padded says what it does not understand, and takes nothing
    const bare = run(root, 'take');
    expect(bare.code).toBe(1);
    expect(bare.out).toMatch(/say which picture: node tools\/building-queue\.mjs take <id>/);
    const cut = run(root, 'take', 'depot-a1-r0', '--from');
    expect(cut.code).toBe(1);
    expect(cut.out).toMatch(/--from needs a folder or a file/);
    const padded = run(root, 'take', 'depot-a1-r0', first);
    expect(padded.code).toBe(1);
    expect(padded.out).toMatch(/take does not understand ".*exec-2\.png"/);
    expect(run(root, 'take', 'depot-a1-r0', '--from=x').out).toMatch(
      /take does not understand "--from=x"/,
    );
    expect(existsSync(at(pictureFile('depot', 1, 0)))).toBe(false);
    expect(run(root, 'take', 'nothing-a0-r0', '--from', chat).out).toMatch(
      /no picture is called "nothing-a0-r0"/,
    );
  }, 180000);

  it('does not guess between the chats of an image tool', () => {
    // an image tool keeps a folder for each chat, and other chats paint other things meanwhile
    const root = sandbox();
    run(root);
    const base = join(root, 'codex', 'generated_images');
    const made = imageTool(root, base);
    const file = at_(root, 'assets/source/buildings-v2/queue.json');
    // no such folder: the tool says how to name one
    const none = run(root, 'take', 'depot-a0-r0');
    expect(none.code).toBe(1);
    expect(none.out).toMatch(
      /no folder of pictures at .*generated_images.*--from <folder or file>/,
    );
    // the first picture of a list: the tool knows no chat yet, and does not take the one new
    // picture on trust; named once, that chat's pictures are found from then on
    const one = made('chat-a');
    const blind = run(root, 'take', 'depot-a0-r0');
    expect(blind.code).toBe(1);
    expect(blind.out).toMatch(/does not know your chat's folder yet/);
    expect(blind.out).toMatch(/chat-a.exec-1\.png/);
    expect(existsSync(join(root, pictureFile('depot', 0, 0)))).toBe(false);
    const alone = run(root, 'take', 'depot-a0-r0', '--from', one);
    expect(alone.code).toBe(0);
    expect(alone.out).toMatch(/^took: +.*chat-a.exec-1\.png/m);
    expect(run(root, 'set', 'depot-a0-r0', 'generated').code).toBe(0);
    // two chats have made pictures since: the tool names both and takes neither, whichever
    // the last picture came from; it offers no folder as the likely one
    made('chat-a', { id: 'depot-a0-r1' });
    made('chat-b');
    const which = run(root, 'take', 'depot-a0-r1');
    expect(which.code).toBe(1);
    expect(which.out).toMatch(/more than one chat/);
    expect(which.out).toMatch(/chat-a.exec-2\.png/);
    expect(which.out).toMatch(/chat-b.exec-3\.png/);
    expect(which.out).toMatch(/--from <the file your image tool reported>/);
    expect(which.out).not.toMatch(/--from ".*chat-[ab]/);
    expect(existsSync(join(root, pictureFile('depot', 0, 1)))).toBe(false);
    // the same when the folder of all chats is named
    expect(run(root, 'take', 'depot-a0-r1', '--from', base).out).toMatch(/more than one chat/);
    // told which chat, it takes that chat's
    const told = run(root, 'take', 'depot-a0-r1', '--from', join(base, 'chat-a'));
    expect(told.code).toBe(0);
    expect(told.out).toMatch(/^took: +.*chat-a.exec-2\.png/m);
    expect(run(root, 'set', 'depot-a0-r1', 'generated').code).toBe(0);
    // our generation fails while another chat goes on: its picture is the only new one, and it
    // is not taken for ours
    made('chat-b');
    const lone = run(root, 'take', 'depot-a0-r2');
    expect(lone.code).toBe(1);
    expect(lone.out).toMatch(/another chat's folder than the last picture that was taken/);
    expect(lone.out).toMatch(/chat-b.exec-4\.png/);
    expect(lone.out).toMatch(/--from <the file your image tool reported>/);
    expect(lone.out).not.toMatch(/--from ".*chat-b/);
    expect(existsSync(join(root, pictureFile('depot', 0, 2)))).toBe(false);
    // the work goes on in a new chat, and the old one left a picture it never took, long ago.
    // The leftover is passed over; the new chat's picture is named once, and found from then on
    const long = new Date(Date.now() - 3 * 3600 * 1000);
    for (const [chat, n] of [
      ['chat-a', 1],
      ['chat-a', 2],
      ['chat-b', 3],
      ['chat-b', 4],
    ])
      utimesSync(join(base, chat, `exec-${n}.png`), long, long);
    const queue = JSON.parse(readFileSync(file, 'utf8'));
    queue.mark = Date.now() - 2 * 3600 * 1000;
    writeFileSync(file, JSON.stringify(queue, null, 2) + '\n');
    made('chat-a', { id: 'depot-a0-r2', old: true });
    const mine = made('chat-c', { id: 'depot-a0-r2' });
    const over = run(root, 'take', 'depot-a0-r2');
    expect(over.code).toBe(1);
    expect(over.out).toMatch(/another chat's folder than the last picture that was taken/);
    expect(over.out).toMatch(/chat-c.exec-6\.png/);
    expect(over.out).not.toMatch(/exec-5\.png/);
    const moved = run(root, 'take', 'depot-a0-r2', '--from', mine);
    expect(moved.code).toBe(0);
    expect(moved.out).toMatch(/^took: +.*chat-c.exec-6\.png/m);
    expect(JSON.parse(readFileSync(file, 'utf8')).chat).toBe('chat-c');
    // a picture dated ahead of the clock is not found (it would stay new for ever), nor does
    // it hide the next one; named, it does not hold the mark in the future
    const ahead = made('chat-c', { id: 'depot-a0-r2' });
    const soon = new Date(Date.now() + 3600 * 1000);
    utimesSync(ahead, soon, soon);
    const early = run(root, 'take', 'depot-a0-r2');
    expect(early.code).toBe(0);
    expect(early.out).toMatch(/^no new picture: this is the one that was taken before$/m);
    made('chat-c', { id: 'depot-a0-r2' });
    expect(run(root, 'take', 'depot-a0-r2').out).toMatch(/^took: +.*chat-c.exec-8\.png/m);
    expect(run(root, 'take', 'depot-a0-r2', '--from', ahead).code).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).mark).toBeLessThanOrEqual(Date.now());
  }, 120000);

  it('starts from the pictures saved by hand in a list that has no mark yet', () => {
    // as the work stood before `take`: pictures copied by hand, the list written by an older tool
    const root = sandbox();
    run(root);
    const base = join(root, 'codex', 'generated_images');
    const made = imageTool(root, base);
    const file = join(root, 'assets/source/buildings-v2/queue.json');
    const one = made('chat-a');
    const r0 = join(root, pictureFile('depot', 0, 0));
    mkdirSync(dirname(r0), { recursive: true });
    cpSync(one, r0);
    const queue = JSON.parse(readFileSync(file, 'utf8'));
    Object.assign(queue.entries[0], { status: 'generated', attempts: 1 });
    expect(queue.mark).toBeUndefined();
    writeFileSync(file, JSON.stringify(queue, null, 2) + '\n');
    // the next picture's generation fails: the one saved by hand is not taken for it
    const none = run(root, 'take', 'depot-a0-r1');
    expect(none.code).toBe(1);
    expect(none.out).toMatch(
      /nothing new was made: the newest picture there, .*exec-1\.png, is depot-a0-r0's/,
    );
    expect(run(root, 'take', 'depot-a0-r1', '--from', one).out).toMatch(
      /exec-1\.png is depot-a0-r0's picture/,
    );
    // nor is another chat's picture, though it is the only new one: the list knows no chat yet
    made('chat-b');
    const guess = run(root, 'take', 'depot-a0-r1');
    expect(guess.code).toBe(1);
    expect(guess.out).toMatch(/does not know your chat's folder yet/);
    expect(existsSync(join(root, pictureFile('depot', 0, 1)))).toBe(false);
    // the next one made is taken, and the list has its mark and its chat from then on
    const two = made('chat-a', { id: 'depot-a0-r1' });
    expect(run(root, 'take', 'depot-a0-r1', '--from', two).code).toBe(0);
    const list = JSON.parse(readFileSync(file, 'utf8'));
    expect(list.mark).toBe(statSync(two).mtimeMs);
    expect(list.chat).toBe('chat-a');
    expect(list.entries[1].taken).toBe(true);

    // pictures of an age that is no longer in the list are named when the list is rebuilt
    list.entries.push({ id: 'kiln-a3-r0', family: 'kiln', status: 'generated', attempts: 1 });
    list.entries.push({ id: 'kiln-a3-r1', family: 'kiln', status: 'pending', attempts: 0 });
    writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
    // by whichever command writes the list first, and once
    expect(run(root, 'status').out).not.toMatch(/no longer in it/);
    const rebuilt = run(root, 'set', 'depot-a0-r1', 'generated');
    expect(rebuilt.code).toBe(0);
    expect(rebuilt.out).toMatch(
      /2 pictures of the earlier list are no longer in it \(kiln-a3-r0, kiln-a3-r1\); 1 of them was made, and its file stays on disk/,
    );
    const after = run(root);
    expect(after.out).toMatch(/548 pictures, 27 families/);
    expect(after.out).not.toMatch(/no longer in it/);
  }, 60000);
});
