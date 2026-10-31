import { existsSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AGE_MUSIC,
  lastPlayed,
  MusicPlaylist,
  MusicSelection,
  MUSIC_TITLES,
  MUSIC_TRACKS,
  musicForAge,
  rememberPlayed,
  trackTitle,
  type SessionStore,
} from './musicPlaylist';
import { Rng } from './rng';
import ages from '../data/ages.json';
import credits from '../data/credits.json';

const AGE_IDS = ages.map((a) => a.id);
const FIRST = '/assets/audio/music/pastoral-pulse.mp3';
const ALL = MUSIC_TRACKS.length;

/** A tab's storage, which survives the page loads of a test. */
function tab(): SessionStore {
  const items = new Map<string, string>();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) };
}

/** A browser that refuses the storage it hands out. */
const refusing: SessionStore = {
  getItem: () => {
    throw new DOMException('refused', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('refused', 'QuotaExceededError');
  },
};

describe('the tracks', () => {
  it('lists all eight files, every one of them on disk', () => {
    expect(ALL).toBe(8);
    expect(new Set(MUSIC_TRACKS).size).toBe(8);
    const onDisk = [
      ...readdirSync('public/assets/audio/music'),
      ...readdirSync('public/assets/audio/music/steam').map((f) => `steam/${f}`),
    ].filter((f) => f.endsWith('.mp3'));
    expect(MUSIC_TRACKS.map((t) => t.replace('/assets/audio/music/', '')).sort()).toEqual(
      onDisk.sort(),
    );
  });

  it('puts Pastoral Pulse first', () => {
    expect(MUSIC_TRACKS[0]).toBe(FIRST);
  });

  it('gives the Steam age no set of its own, so it plays all eight', () => {
    expect(AGE_MUSIC.steam).toEqual([]);
    for (const id of AGE_IDS) expect(musicForAge(id), id).toBe(MUSIC_TRACKS);
  });

  it('titles every track, from the credits, and never with a file name', () => {
    expect(Object.keys(MUSIC_TITLES).sort()).toEqual([...MUSIC_TRACKS].sort());
    const credited = credits.credits.filter((c) => c.kind === 'Music').map((c) => c.title);
    expect(credited).toHaveLength(ALL);
    for (const track of MUSIC_TRACKS) {
      const title = trackTitle(track)!;
      expect(title, track).not.toMatch(/\.mp3|\/|-/);
      expect(credited, track).toContain(title);
    }
    expect(new Set(MUSIC_TRACKS.map(trackTitle)).size).toBe(ALL);
    expect(trackTitle('/assets/audio/music/pastoral-pulse-liquid-dnb.mp3')).toBe(
      'Pastoral Pulse (Liquid DnB)',
    );
  });

  it('shows no name for a file the table does not list, or an inherited key, or none', () => {
    expect(trackTitle('/assets/audio/music/diesel/a.mp3')).toBeNull();
    expect(trackTitle('constructor')).toBeNull();
    expect(trackTitle(null)).toBeNull();
  });
});

describe('the playlist', () => {
  it('starts with the original, then plays each mix before repeating', () => {
    const rng = new Rng(19),
      p = new MusicPlaylist(() => rng.next());
    expect(MUSIC_TRACKS[p.current]).toBe(FIRST);
    const opening = [p.current];
    for (let i = 1; i < ALL; i++) opening.push(p.next()!);
    expect(new Set(opening).size).toBe(ALL);
    let previous = p.current;
    for (let round = 0; round < 100; round++) {
      const played = [];
      for (let i = 0; i < ALL; i++) {
        const next = p.next();
        expect(next).not.toBe(previous);
        played.push(next);
        previous = next!;
      }
      expect(new Set(played).size).toBe(ALL);
    }
  });
  it('skips unavailable files and terminates if all files fail', () => {
    const p = new MusicPlaylist(() => 0.5),
      failed = new Set([1, 3, 5, 6, 7]);
    for (let i = 0; i < 20; i++) expect([0, 2, 4]).toContain(p.next(failed));
    failed.add(0);
    failed.add(2);
    failed.add(4);
    expect(p.next(failed)).toBeNull();
  });
});

describe('Pastoral Pulse once, on opening the game', () => {
  const selection = (store: SessionStore | null, seed = 7) => {
    const rng = new Rng(seed);
    return new MusicSelection(
      () => rng.next(),
      undefined,
      () => lastPlayed(store),
    );
  };

  it('opens on it in a tab that has played nothing', () => {
    expect(selection(tab()).track).toBe(FIRST);
  });

  it('does not open on it again once a track has played, on any number of page loads', () => {
    const store = tab();
    rememberPlayed(selection(store).track!, store);
    for (let load = 1; load < 200; load++) {
      const s = selection(store, load);
      expect(s.track, `page load ${load}`).not.toBe(FIRST);
      rememberPlayed(s.track!, store);
    }
  });

  it('waits until a track has played: the page the title reloads into still opens on it', () => {
    const store = tab();
    selection(store); // the title: fetched ahead and held, heard by nobody
    selection(store);
    expect(selection(store).track).toBe(FIRST);
  });

  it('does not start a page load with what played last', () => {
    for (const last of MUSIC_TRACKS)
      for (let seed = 1; seed <= 60; seed++) {
        const store = tab();
        rememberPlayed(last, store);
        expect(selection(store, seed).track, `after ${last}, seed ${seed}`).not.toBe(last);
      }
  });

  it('plays the rest after a reload, then whole rounds with Pastoral Pulse among them', () => {
    const store = tab();
    rememberPlayed(MUSIC_TRACKS[3], store);
    const s = selection(store);
    const rest = new Set([s.track]);
    for (let i = 2; i < ALL; i++) rest.add(s.next());
    expect(rest.size).toBe(ALL - 1);
    expect(rest.has(FIRST)).toBe(false);
    const round = new Set<string | null>();
    for (let i = 0; i < ALL; i++) round.add(s.next());
    expect(round.size).toBe(ALL);
  });

  it('shuffles: different page loads start on different tracks', () => {
    const starts = new Set<string | null>();
    for (let seed = 1; seed <= 200; seed++) {
      const store = tab();
      rememberPlayed(MUSIC_TRACKS[1], store);
      starts.add(selection(store, seed).track);
    }
    // all but Pastoral Pulse and the track that played last
    expect(starts.size).toBe(ALL - 2);
  });

  it('opens on it on every load where storage is refused, and throws nothing', () => {
    expect(() => rememberPlayed(FIRST, refusing)).not.toThrow();
    expect(lastPlayed(refusing)).toBeNull();
    expect(selection(refusing).track).toBe(FIRST);
    expect(selection(null).track).toBe(FIRST);
    expect(() => rememberPlayed(FIRST, null)).not.toThrow();
  });

  it('forgets a file that is gone, and starts a shuffled round all the same', () => {
    const store = tab();
    rememberPlayed('/assets/audio/music/removed.mp3', store);
    const s = selection(store);
    expect(MUSIC_TRACKS).toContain(s.track);
    expect(s.track).not.toBe(FIRST);
    expect(s.canGoBack).toBe(false);
  });

  it('does not open on it again when the default set comes back after an age of its own', () => {
    const store = tab();
    const rng = new Rng(3);
    const s = new MusicSelection(
      () => rng.next(),
      table(),
      () => lastPlayed(store),
    );
    rememberPlayed(s.track!, store); // Pastoral Pulse has played
    rememberPlayed(MUSIC_TRACKS[3], store);
    s.setAge('diesel');
    expect(s.track).toBe(DIESEL[0]);
    s.setAge('electric');
    expect(MUSIC_TRACKS).toContain(s.track);
    expect(s.track).not.toBe(FIRST);
    expect(s.track).not.toBe(MUSIC_TRACKS[3]);
  });
});

describe('back and forward', () => {
  const playing = (seed = 11) => {
    const rng = new Rng(seed);
    return new MusicPlaylist(() => rng.next());
  };

  it('has nothing to go back to on the first track', () => {
    const p = playing();
    expect(p.canGoBack()).toBe(false);
    expect(p.back()).toBeNull();
    expect(p.current).toBe(0);
  });

  it('goes back through the tracks played, latest first', () => {
    const p = playing();
    const played = [p.current, p.next()!, p.next()!, p.next()!];
    expect(p.canGoBack()).toBe(true);
    expect([p.back(), p.back(), p.back()]).toEqual([played[2], played[1], played[0]]);
    expect(p.back()).toBeNull();
    expect(p.current).toBe(played[0]);
  });

  it('comes forward again over the same tracks, then on with the round', () => {
    const p = playing();
    const played = [p.current, p.next()!, p.next()!];
    p.back();
    p.back();
    expect([p.next(), p.next()]).toEqual([played[1], played[2]]);
    // the rest of the opening round, with nothing played twice
    const rest = [];
    for (let i = played.length; i < ALL; i++) rest.push(p.next()!);
    expect(new Set([...played, ...rest]).size).toBe(ALL);
  });

  it('goes back to the track left for a new one, and not past a track that has failed', () => {
    const p = playing();
    const played = [p.current, p.next()!, p.next()!];
    expect(p.canGoBack(new Set([played[0], played[1]]))).toBe(false);
    expect(p.back(new Set([played[1]]))).toBe(played[0]);
  });

  it('skips a failed track on the way forward as well', () => {
    const p = playing();
    const played = [p.current, p.next()!, p.next()!];
    p.back();
    p.back();
    expect(p.next(new Set([played[1]]))).toBe(played[2]);
  });

  it('goes back past a reload, to what played before it', () => {
    const rng = new Rng(5);
    const p = new MusicPlaylist(() => rng.next(), MUSIC_TRACKS, MUSIC_TRACKS[2]);
    const opened = p.current;
    expect(p.back()).toBe(2);
    expect(p.next()).toBe(opened);
  });

  it('selects the file to play, and says when there is none', () => {
    const rng = new Rng(9);
    const s = new MusicSelection(
      () => rng.next(),
      undefined,
      () => null,
    );
    expect(s.canGoBack).toBe(false);
    expect(s.back()).toBeNull();
    expect(s.track).toBe(FIRST);
    const second = s.next();
    expect(s.back()).toBe(FIRST);
    expect(s.track).toBe(FIRST);
    expect(s.next()).toBe(second);
    for (let i = 0; i < ALL; i++) s.next(true);
    expect(s.track).toBeNull();
    expect(s.canGoBack).toBe(false);
    expect(s.back()).toBeNull();
  });

  it('starts over with a new set: the old set has no place in it', () => {
    const rng = new Rng(9);
    const s = new MusicSelection(
      () => rng.next(),
      table(),
      () => null,
    );
    s.next();
    s.setAge('diesel');
    expect(s.canGoBack).toBe(false);
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
    const s = new MusicSelection(
      () => 0.5,
      Object.fromEntries(AGE_IDS.map((id) => [id, []])),
      () => null,
    );
    expect(s.track).toBe(MUSIC_TRACKS[0]);
    for (const id of [...AGE_IDS, null, 'no-such-age']) expect(s.setAge(id)).toBe(false);
    expect(s.track).toBe(MUSIC_TRACKS[0]);
  });

  it("switches to a new age's set at its first file, and only when the set changes", () => {
    const s = new MusicSelection(
      () => 0.5,
      table(),
      () => null,
    );
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
    const s = new MusicSelection(
      () => 0.5,
      table(),
      () => null,
    );
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
    const s = new MusicSelection(
      () => 0.5,
      table(),
      () => null,
    );
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
    const s = new MusicSelection(
      () => 0.5,
      table(),
      () => null,
    );
    s.setAge('diesel');
    expect(s.next(true)).toBe(DIESEL[1]);
    s.setAge('steam');
    expect(s.track).toBe(MUSIC_TRACKS[0]);
    expect(s.setAge('diesel')).toBe(true);
    expect(s.track).toBe(DIESEL[1]);
  });

  it('tries an age with files even after every other file has failed', () => {
    const s = new MusicSelection(
      () => 0.5,
      table(),
      () => null,
    );
    for (let i = 0; i < MUSIC_TRACKS.length; i++) s.next(true);
    expect(s.track).toBeNull();
    expect(s.setAge('diesel')).toBe(true);
    expect(s.track).toBe(DIESEL[0]);
  });
});
