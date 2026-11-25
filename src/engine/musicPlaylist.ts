/**
 * The default set, all eight tracks. Pastoral Pulse opens the game once a tab (`lastPlayed`); from
 * then on they play in shuffled rounds. An age with no files of its own plays this set.
 */
export const MUSIC_TRACKS = [
  '/assets/audio/music/pastoral-pulse.mp3',
  '/assets/audio/music/pastoral-pulse-genshin-style.mp3',
  '/assets/audio/music/pastoral-pulse-chillstep.mp3',
  '/assets/audio/music/pastoral-pulse-liquid-dnb.mp3',
  '/assets/audio/music/steam/whispering-wheel.mp3',
  '/assets/audio/music/steam/anearach-na-heireann.mp3',
  '/assets/audio/music/steam/interlocking-routes.mp3',
  '/assets/audio/music/steam/sparse-pulse.mp3',
] as const;

/** What the player reads for each file, whose name they never see. A file added needs its line. */
export const MUSIC_TITLES: Record<(typeof MUSIC_TRACKS)[number], string> = {
  '/assets/audio/music/pastoral-pulse.mp3': 'Pastoral Pulse',
  '/assets/audio/music/pastoral-pulse-genshin-style.mp3': 'Pastoral Pulse (Genshin Style)',
  '/assets/audio/music/pastoral-pulse-chillstep.mp3': 'Pastoral Pulse (Chillstep)',
  '/assets/audio/music/pastoral-pulse-liquid-dnb.mp3': 'Pastoral Pulse (Liquid DnB)',
  '/assets/audio/music/steam/whispering-wheel.mp3': 'Whispering Wheel',
  '/assets/audio/music/steam/anearach-na-heireann.mp3': 'Anearach na hÉireann',
  '/assets/audio/music/steam/interlocking-routes.mp3': 'Interlocking Routes',
  '/assets/audio/music/steam/sparse-pulse.mp3': 'Sparse Pulse',
};

/** A file's title; null for one the table does not list, whose name is not shown instead. */
export function trackTitle(track: string | null): string | null {
  return track !== null && Object.hasOwn(MUSIC_TITLES, track)
    ? MUSIC_TITLES[track as keyof typeof MUSIC_TITLES]
    : null;
}

/** The little of `sessionStorage` the music uses. */
export type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;

const LAST_PLAYED_KEY = 'terepasztal.musicLast';

/** The tab's storage; where a browser refuses it, even reading the name throws. */
function tabStore(): SessionStore | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The file this tab played last, null when it has played none: the game has just been opened, so
 * Pastoral Pulse comes first. A reload, a restart and a new game are all page loads, and only this
 * survives one and ends with the tab. Where storage is refused nothing can be known, and Pastoral
 * Pulse comes first on every load.
 */
export function lastPlayed(store = tabStore()): string | null {
  try {
    return store?.getItem(LAST_PLAYED_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * A file has started to play. Written then and not on opening the game: the title holds the music,
 * and its New game reloads the page, which must still open on Pastoral Pulse.
 */
export function rememberPlayed(track: string, store = tabStore()) {
  try {
    store?.setItem(LAST_PLAYED_KEY, track);
  } catch {
    /* refused: see lastPlayed */
  }
}

/**
 * Each age's own set, by the age ids of `src/data/ages.json`: the same melody, Pastoral Pulse,
 * arranged in a genre that fits the age. The author puts an age's files in
 * `public/assets/audio/music/<age id>/` and lists them here as
 * `/assets/audio/music/<age id>/<file>.mp3`. A set plays its first track first and then shuffled
 * rounds of all its tracks, as the default set does. An age that lists nothing plays
 * `MUSIC_TRACKS`.
 */
export const AGE_MUSIC: Record<string, readonly string[]> = {
  steam: [],
  diesel: [],
  electric: [],
  nuclear: [],
  magnetic: [],
  hyper: [],
};

/** The set an age plays: its own when it lists files, `MUSIC_TRACKS` otherwise. */
export function musicForAge(
  id: string | null,
  table: Record<string, readonly string[]> = AGE_MUSIC,
): readonly string[] {
  const own = id !== null && Object.hasOwn(table, id) ? table[id] : undefined;
  return own?.length ? own : MUSIC_TRACKS;
}

/**
 * The order one set's tracks play in; `current`, `next` and `back` are indices into `tracks`. A set
 * opens on its first track, then the rest shuffled, then shuffled rounds of all of them. With
 * `after`, the file an earlier page load played last, it has opened already: it starts on the rest
 * shuffled, the first track not replayed, not beginning with that file, which is where Back goes.
 */
export class MusicPlaylist {
  current = 0;
  private queue: number[] = [];
  private firstRound = true;
  /** the tracks played before this one, the latest last: Back goes down this */
  private played: number[] = [];
  /** the tracks Back stepped off, the nearest last: forward plays them again before the queue */
  private ahead: number[] = [];
  constructor(
    private readonly random = Math.random,
    readonly tracks: readonly string[] = MUSIC_TRACKS,
    after: string | null = null,
  ) {
    if (after === null) return;
    this.current = tracks.indexOf(after);
    this.next();
  }

  next(unavailable: ReadonlySet<number> = new Set()): number | null {
    if (this.current >= 0) this.played.push(this.current);
    while (this.ahead.length) {
      const i = this.ahead.pop()!;
      if (!unavailable.has(i)) return (this.current = i);
    }
    this.queue = this.queue.filter((i) => !unavailable.has(i));
    if (!this.queue.length) {
      this.queue = this.tracks
        .map((_, i) => i)
        .filter((i) => !unavailable.has(i) && (!this.firstRound || i !== 0));
      this.firstRound = false;
      if (!this.queue.length)
        this.queue = this.tracks.map((_, i) => i).filter((i) => !unavailable.has(i));
      for (let i = this.queue.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
      }
      if (this.queue.length > 1 && this.queue[this.queue.length - 1] === this.current)
        [this.queue[0], this.queue[this.queue.length - 1]] = [
          this.queue[this.queue.length - 1],
          this.queue[0],
        ];
    }
    const next = this.queue.pop();
    if (next === undefined) return null;
    this.current = next;
    return next;
  }

  /** Back to the track played before this one; null, and no move, when there is none. */
  back(unavailable: ReadonlySet<number> = new Set()): number | null {
    while (this.played.length) {
      const i = this.played.pop()!;
      if (unavailable.has(i)) continue;
      this.ahead.push(this.current);
      this.current = i;
      return i;
    }
    return null;
  }

  canGoBack(unavailable: ReadonlySet<number> = new Set()): boolean {
    return this.played.some((i) => !unavailable.has(i));
  }
}

function sameTracks(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * Which set the music plays, and which of its files: the audio bus asks and plays the answer. The
 * age's own set plays while any of its files can; once every one has failed, `MUSIC_TRACKS` takes
 * over, and once those have failed too no file is left (`track` is null) and the synth loop
 * plays. A file that failed stays failed for the session, in every set that lists it.
 */
export class MusicSelection {
  private list: MusicPlaylist;
  /** the set the current age resolves to, whether or not it is the one playing */
  private wanted: readonly string[] = MUSIC_TRACKS;
  private readonly failed = new Set<string>();
  private exhausted = false;
  constructor(
    private readonly random = Math.random,
    private readonly table: Record<string, readonly string[]> = AGE_MUSIC,
    /** what this tab played last (`lastPlayed`), asked each time the default set opens */
    private readonly recall: () => string | null = lastPlayed,
  ) {
    this.list = new MusicPlaylist(random, MUSIC_TRACKS, recall());
  }

  /** The playlist of the set playing now. */
  get playlist(): MusicPlaylist {
    return this.list;
  }

  /** The file to play now, or null when every file of the age's set and the default has failed. */
  get track(): string | null {
    return this.exhausted ? null : this.playlist.tracks[this.playlist.current];
  }

  /**
   * The player is in this age. True when that changes the set that plays: the current track stops
   * and the new set starts with its first track. False when the same set plays on.
   */
  setAge(id: string | null): boolean {
    const set = musicForAge(id, this.table);
    if (sameTracks(set, this.wanted)) return false;
    this.wanted = set;
    const tracks = set.some((t) => !this.failed.has(t)) ? set : MUSIC_TRACKS;
    if (sameTracks(tracks, this.playlist.tracks)) return false;
    this.start(tracks);
    return true;
  }

  /**
   * Move past the current file: it ended, or with `failed` it could not be played. Returns the
   * file to play next, or null when none is left.
   */
  next(failed = false): string | null {
    if (this.exhausted) return null;
    if (failed) this.failed.add(this.playlist.tracks[this.playlist.current]);
    if (this.playlist.next(this.unavailable()) === null) this.fallBack();
    return this.track;
  }

  /** Back to the track played before this one: the file to play, or null when there is none. */
  back(): string | null {
    if (this.exhausted || this.playlist.back(this.unavailable()) === null) return null;
    return this.track;
  }

  /** There is a track to go back to. */
  get canGoBack(): boolean {
    return !this.exhausted && this.playlist.canGoBack(this.unavailable());
  }

  private start(tracks: readonly string[]) {
    // Pastoral Pulse opens the game once: back on the default set, it takes its turn with the rest
    const after = sameTracks(tracks, MUSIC_TRACKS) ? this.recall() : null;
    this.list = new MusicPlaylist(this.random, tracks, after);
    this.exhausted = false;
    // a set opens on its first track unless that one has already failed
    const opening = this.playlist.tracks[this.playlist.current];
    if (this.failed.has(opening) && this.playlist.next(this.unavailable()) === null)
      this.fallBack();
  }

  /** Every file of the playing set has failed: the default set, or nothing once it has too. */
  private fallBack() {
    if (sameTracks(this.playlist.tracks, MUSIC_TRACKS)) this.exhausted = true;
    else this.start(MUSIC_TRACKS);
  }

  private unavailable(): Set<number> {
    const out = new Set<number>();
    for (const [i, t] of this.playlist.tracks.entries()) if (this.failed.has(t)) out.add(i);
    return out;
  }
}
