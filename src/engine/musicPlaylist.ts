/** First play is always the original; subsequent rounds visit every available mix. */
export const MUSIC_TRACKS = [
  '/assets/audio/music/pastoral-pulse.mp3',
  '/assets/audio/music/pastoral-pulse-genshin-style.mp3',
  '/assets/audio/music/pastoral-pulse-chillstep.mp3',
  '/assets/audio/music/pastoral-pulse-liquid-dnb.mp3',
] as const;

export class MusicPlaylist {
  current = 0;
  private queue: number[] = [];
  private firstRound = true;
  constructor(private readonly random = Math.random) {}

  next(unavailable: ReadonlySet<number> = new Set()): number | null {
    this.queue = this.queue.filter((i) => !unavailable.has(i));
    if (!this.queue.length) {
      this.queue = MUSIC_TRACKS.map((_, i) => i).filter(
        (i) => !unavailable.has(i) && (!this.firstRound || i !== 0),
      );
      this.firstRound = false;
      if (!this.queue.length)
        this.queue = MUSIC_TRACKS.map((_, i) => i).filter((i) => !unavailable.has(i));
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
