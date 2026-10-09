import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AGE_MUSIC,
  MusicPlaylist,
  MusicSelection,
  MUSIC_TRACKS,
  musicForAge,
} from './musicPlaylist';
import { Rng } from './rng';
import ages from '../data/ages.json';

const AGE_IDS = ages.map((a) => a.id);

describe('Pastoral Pulse playlist', () => {
  it('starts with the original, then plays each mix before repeating', () => {
    const rng = new Rng(19),
      p = new MusicPlaylist(() => rng.next());
    expect(MUSIC_TRACKS[p.current]).toBe('/assets/audio/music/pastoral-pulse.mp3');
    expect(new Set([p.current, p.next(), p.next(), p.next()]).size).toBe(4);
    let previous = p.current;
    for (let round = 0; round < 100; round++) {
      const played = [];
      for (let i = 0; i < 4; i++) {
        const next = p.next();
        expect(next).not.toBe(previous);
        played.push(next);
        previous = next!;
      }
      expect(new Set(played).size).toBe(4);
    }
  });
  it('skips unavailable files and terminates if all files fail', () => {
    const p = new MusicPlaylist(() => 0.5),
      failed = new Set([1, 3]);
    for (let i = 0; i < 20; i++) expect([0, 2]).toContain(p.next(failed));
    failed.add(0);
    failed.add(2);
    expect(p.next(failed)).toBeNull();
  });
});

/** A table that gives diesel two files of its own and leaves the other ages empty. */
const DIESEL = ['/assets/audio/music/diesel/a.mp3', '/assets/audio/music/diesel/b.mp3'];
const table = (): Record<string, readonly string[]> => ({
  ...Object.fromEntries(AGE_IDS.map((id) => [id, []])),
  diesel: DIESEL,
});

describe('music by age', () => {
  it('resolves every age to a set, the default one while the age lists no files', () => {
    for (const id of AGE_IDS) {
      expect(id in AGE_MUSIC).toBe(true);
      const set = musicForAge(id);
      expect(set.length).toBeGreaterThan(0);
      if (!AGE_MUSIC[id].length) expect(set).toBe(MUSIC_TRACKS);
      else expect(set).toBe(AGE_MUSIC[id]);
    }
    expect(musicForAge('no-such-age')).toBe(MUSIC_TRACKS);
    expect(musicForAge(null)).toBe(MUSIC_TRACKS);
    // inherited object keys are not ages
    expect(musicForAge('constructor')).toBe(MUSIC_TRACKS);
    expect(musicForAge('toString')).toBe(MUSIC_TRACKS);
  });

  it('lists nuclear, magnetic and hyper, which play the default set while they list no files', () => {
    for (const id of ['nuclear', 'magnetic', 'hyper']) {
      expect(Object.hasOwn(AGE_MUSIC, id), id).toBe(true);
      const own = AGE_MUSIC[id];
      expect(musicForAge(id)).toBe(own.length ? own : MUSIC_TRACKS);
      expect(musicForAge(id, { ...AGE_MUSIC, [id]: [] })).toBe(MUSIC_TRACKS);
    }
  });

  it("keeps every age's files in its own directory, and every listed file exists", () => {
    for (const [id, set] of Object.entries(AGE_MUSIC))
      for (const file of set) expect(file.startsWith(`/assets/audio/music/${id}/`)).toBe(true);
    for (const file of [...MUSIC_TRACKS, ...Object.values(AGE_MUSIC).flat()])
      expect(existsSync(`public${file}`), file).toBe(true);
  });

  it("plays only an age's own files, the first one first", () => {
    const set = musicForAge('diesel', table());
    expect(set).toEqual(DIESEL);
    for (let seed = 1; seed <= 20; seed++) {
      const rng = new Rng(seed),
        p = new MusicPlaylist(() => rng.next(), set);
      expect(set[p.current]).toBe(DIESEL[0]);
      const played = [p.current];
      for (let i = 0; i < 40; i++) played.push(p.next()!);
      expect(new Set(played.map((i) => set[i]))).toEqual(new Set(DIESEL));
    }
  });

  it('returns null from a set whose files are all unavailable', () => {
    const p = new MusicPlaylist(() => 0.5, DIESEL);
    expect(p.next(new Set([0, 1]))).toBeNull();
  });
});

describe('switching sets', () => {
  it('plays the default set on, unchanged, while no age lists files', () => {
    const s = new MusicSelection(() => 0.5, Object.fromEntries(AGE_IDS.map((id) => [id, []])));
    expect(s.track).toBe(MUSIC_TRACKS[0]);
    for (const id of [...AGE_IDS, null, 'no-such-age']) expect(s.setAge(id)).toBe(false);
    expect(s.track).toBe(MUSIC_TRACKS[0]);
  });

  it("switches to a new age's set at its first file, and only when the set changes", () => {
    const s = new MusicSelection(() => 0.5, table());
    expect(s.setAge('steam')).toBe(false);
    s.next();
    expect(s.track).not.toBe(MUSIC_TRACKS[0]);
    expect(s.setAge('diesel')).toBe(true);
    expect(s.track).toBe(DIESEL[0]);
    expect(s.setAge('diesel')).toBe(false);
    expect(s.track).toBe(DIESEL[0]);
    for (let i = 0; i < 10; i++) expect(DIESEL).toContain(s.next());
    expect(s.setAge('electric')).toBe(true);
    expect(s.track).toBe(MUSIC_TRACKS[0]);
  });

  it("falls back to the default set when every file of the age's set fails, then to nothing", () => {
    const s = new MusicSelection(() => 0.5, table());
    s.setAge('diesel');
    expect(DIESEL).toContain(s.next(true));
    expect(s.next(true)).toBe(MUSIC_TRACKS[0]);
    for (let i = 1; i < MUSIC_TRACKS.length; i++) expect(MUSIC_TRACKS).toContain(s.next(true));
    expect(s.next(true)).toBeNull();
    expect(s.track).toBeNull();
    expect(s.next()).toBeNull();
    // the age is still diesel and its files failed: nothing to switch to
    expect(s.setAge('diesel')).toBe(false);
    expect(s.track).toBeNull();
  });

  it('does not go back to a set whose files have all failed', () => {
    const s = new MusicSelection(() => 0.5, table());
    s.setAge('diesel');
    s.next(true);
    s.next(true);
    expect(s.track).toBe(MUSIC_TRACKS[0]);
    // leaving and re-entering the age keeps the default set playing
    expect(s.setAge('steam')).toBe(false);
    expect(s.setAge('diesel')).toBe(false);
    expect(s.track).toBe(MUSIC_TRACKS[0]);
  });

  it('opens a set past a first file that has already failed', () => {
    const s = new MusicSelection(() => 0.5, table());
    s.setAge('diesel');
    expect(s.next(true)).toBe(DIESEL[1]);
    s.setAge('steam');
    expect(s.track).toBe(MUSIC_TRACKS[0]);
    expect(s.setAge('diesel')).toBe(true);
    expect(s.track).toBe(DIESEL[1]);
  });

  it('tries an age with files even after every other file has failed', () => {
    const s = new MusicSelection(() => 0.5, table());
    for (let i = 0; i < MUSIC_TRACKS.length; i++) s.next(true);
    expect(s.track).toBeNull();
    expect(s.setAge('diesel')).toBe(true);
    expect(s.track).toBe(DIESEL[0]);
  });
});
