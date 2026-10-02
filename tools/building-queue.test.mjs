import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { loadInventory, pictureFile } from './building-kit.mjs';
import { guideFile } from './building-guides.mjs';
import {
  buildQueue,
  describeEntry,
  loadFamilies,
  nextEntry,
  setStatus,
  STYLE_BOARD,
  MOOD_EARLY,
  MOOD_LATE,
} from './building-queue.mjs';

const inv = loadInventory();
const fam = loadFamilies();
const q = buildQueue(inv, fam);
const about = (id) => describeEntry(id, inv, fam);

describe('building queue', () => {
  it('lists every picture once, the pilot first', () => {
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
    expect(q.pilot).toEqual({ family: 'depot', approved: false });
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

  it("keeps the pilot's approval and refuses a status it does not know", () => {
    const before = structuredClone(q);
    before.pilot.approved = true;
    expect(buildQueue(inv, fam, before).pilot.approved).toBe(true);
    before.entries[7].status = 'done';
    expect(() => buildQueue(inv, fam, before)).toThrow(/depot-a1-r3.*done/);
  });
});

describe('working through the queue', () => {
  const fresh = () => structuredClone(q);
  const onDisk = (files) => (f) => f.startsWith('docs/') || f.includes('/base-v1/') || files.has(f);
  const made = (queue, upTo) => {
    const files = new Set();
    for (const e of queue.entries.slice(0, upTo)) {
      e.status = 'generated';
      files.add(e.file);
    }
    return files;
  };

  it('hands out the first picture that is still to do', () => {
    const queue = fresh();
    expect(nextEntry(queue, inv, fam, onDisk(new Set()))).toMatchObject({
      kind: 'picture',
      id: 'depot-a0-r0',
    });
    const files = made(queue, 2);
    expect(nextEntry(queue, inv, fam, onDisk(files))).toMatchObject({ id: 'depot-a0-r2' });
  });

  it('stops after the pilot until the user has approved it', () => {
    const queue = fresh();
    const files = made(queue, 24);
    expect(nextEntry(queue, inv, fam, onDisk(files))).toMatchObject({
      kind: 'pilot',
      family: 'depot',
    });
    queue.pilot.approved = true;
    expect(nextEntry(queue, inv, fam, onDisk(files))).toMatchObject({
      kind: 'picture',
      id: 'station-a0-r0',
    });
  });

  it('skips pictures whose reference was never made, and says which', () => {
    const queue = fresh();
    queue.pilot.approved = true;
    // the depot's steam front view was rejected: its other views and its later ages wait for it
    Object.assign(queue.entries[0], { status: 'rejected', attempts: 3, note: 'floats' });
    const next = nextEntry(queue, inv, fam, onDisk(new Set()));
    expect(next).toMatchObject({ kind: 'picture', id: 'station-a0-r0' });
    expect(next.blocked).toContain('depot-a0-r1');
    expect(next.blocked).toContain('depot-a1-r0');
    expect(next.blocked).not.toContain('station-a0-r0');
  });

  it('says so when nothing is left', () => {
    const queue = fresh();
    queue.pilot.approved = true;
    const files = made(queue, 560);
    expect(nextEntry(queue, inv, fam, onDisk(files))).toMatchObject({ kind: 'done' });
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
});
