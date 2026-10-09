/**
 * The default set, Pastoral Pulse and its genre variations. First play is always the original;
 * subsequent rounds visit every available mix. An age with no files of its own plays this set.
 */
export const MUSIC_TRACKS = [
  '/assets/audio/music/pastoral-pulse.mp3',
  '/assets/audio/music/pastoral-pulse-genshin-style.mp3',
  '/assets/audio/music/pastoral-pulse-chillstep.mp3',
  '/assets/audio/music/pastoral-pulse-liquid-dnb.mp3',
] as const;

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
};

/** The set an age plays: its own when it lists files, `MUSIC_TRACKS` otherwise. */
export function musicForAge(
  id: string | null,
  table: Record<string, readonly string[]> = AGE_MUSIC,
): readonly string[] {
  const own = id !== null && Object.hasOwn(table, id) ? table[id] : undefined;
  return own?.length ? own : MUSIC_TRACKS;
}

/** The order one set's tracks play in; `current` and `next` are indices into `tracks`. */
export class MusicPlaylist {
  current = 0;
  private queue: number[] = [];
  private firstRound = true;
  constructor(
    private readonly random = Math.random,
    readonly tracks: readonly string[] = MUSIC_TRACKS,
  ) {}

  next(unavailable: ReadonlySet<number> = new Set()): number | null {
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
  ) {
    this.list = new MusicPlaylist(random);
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

  private start(tracks: readonly string[]) {
    this.list = new MusicPlaylist(this.random, tracks);
    this.exhausted = false;
    // a set opens on its first track unless that one has already failed
    if (this.failed.has(tracks[0]) && this.playlist.next(this.unavailable()) === null)
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
