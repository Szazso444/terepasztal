import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { FOOTPRINTS, loadInventory, pictureFile } from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly, guideFile } from './building-guides.mjs';
import {
  accept,
  approveGate,
  buildQueue,
  describeEntry,
  loadFamilies,
  mismatches,
  nextEntry,
  progress,
  redo,
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
    expect(q.entries).toHaveLength(560);
    expect(new Set(q.entries.map((e) => e.id)).size).toBe(560);
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
    expect(q.counts).toEqual({ pictures: 560, families: 27 });
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

  it('names the references that fix what a picture shows', () => {
    // the first picture of a family: today's picture, and the mood of its age
    expect(about('depot-a0-r0').references).toEqual([
      STYLE_BOARD,
      'assets/source/base-v1/depot.png',
      MOOD_EARLY,
    ]);
    expect(about('refinery-a1-r0').references).toEqual([
      STYLE_BOARD,
      'assets/source/base-v1/refinery.png',
      MOOD_EARLY,
    ]);
    // another view: the same age's front view
    expect(about('depot-a0-r2').references).toEqual([STYLE_BOARD, pictureFile('depot', 0, 0)]);
    // a later age: the front view of the age before
    expect(about('depot-a3-r0').references).toEqual([
      STYLE_BOARD,
      pictureFile('depot', 2, 0),
      MOOD_LATE,
    ]);
    // no picture of its own today: the main-line depot of the same age
    expect(about('depot_narrow-a0-r0').references).toEqual([
      STYLE_BOARD,
      pictureFile('depot', 0, 0),
      MOOD_EARLY,
    ]);
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
    expect(again.entries).toHaveLength(560);
    expect(again.entries[3]).toMatchObject({ status: 'approved', attempts: 2, note: 'second try' });
    expect(again.entries[30]).toMatchObject({ status: 'rejected', attempts: 3, note: 'floats' });
    expect(again.entries[4].status).toBe('pending');
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
    const files = made(queue, 560);
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
      rejected: 1,
      behind: 0,
      pending: 0,
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
    check: () => verdict,
    setAside: (f) => {
      files.delete(f);
      files.add(f.replace(/\.png$/, '.rejected.png'));
    },
  });

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
    expect(queue.entries[0]).toMatchObject({ status: 'pending', attempts: 0 });
    const done = settle(queue, inv, 'depot-a0-r0', 'generated', { attempts: 2 }, disk(files));
    expect(done.entry).toMatchObject({ status: 'generated', attempts: 2 });
    expect(done.check).toEqual({ ok: true, problems: [] });
    // an approval is for a picture that was made
    expect(() => settle(queue, inv, 'depot-a0-r1', 'approved', {}, disk(files))).toThrow(
      /has not been made/,
    );
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
  const run = (root, ...args) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [tool, ...args], { cwd: root, encoding: 'utf8' }),
      };
    } catch (e) {
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };
  /** a painted depot, as the generator returns it */
  const paint = (root, id) => {
    const d = about(id);
    const fp = FOOTPRINTS[d.footprint];
    const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
    const faces = boxFaces(fp, { ...blockOf(d.footprint, d.rot), z0: 0 });
    const shade = { top: [220, 210, 180], left: [160, 120, 90], right: [110, 80, 60] };
    for (const [name, pts] of Object.entries(faces)) fillPoly(png, pts, shade[name]);
    mkdirSync(dirname(join(root, d.file)), { recursive: true });
    writeFileSync(join(root, d.file), PNG.sync.write(png));
  };

  it('hands out a picture, records it only when it passes, and holds the gate', () => {
    const root = sandbox();
    expect(run(root).out).toMatch(/560 pictures, 27 families/);
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
    expect(run(root, 'next').out).toMatch(/^picture: +depot-a0-r1$/m);
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
});
