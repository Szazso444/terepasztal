/** In-game clock. One day = 4 real minutes at 1x. */
export const DAY_SECONDS = 240;
export const SPEEDS = [0, 1, 2, 3] as const;

export class GameClock {
  /** elapsed in-game seconds */
  time = 0;
  speedIndex = 1;
  private prevSpeed = 1;
  get speed() {
    return SPEEDS[this.speedIndex];
  }
  get day() {
    return Math.floor(this.time / DAY_SECONDS) + 1;
  }
  /** 0..1 within the day; 0 = midnight. */
  get dayFraction() {
    return (this.time % DAY_SECONDS) / DAY_SECONDS;
  }
  get hour() {
    return Math.floor(this.dayFraction * 24);
  }
  get minute() {
    return Math.floor(((this.dayFraction * 24) % 1) * 60);
  }
  /** Elapsed days as a float. */
  get days() {
    return this.time / DAY_SECONDS;
  }
  setSpeed(i: number) {
    if (i !== 0) this.prevSpeed = i;
    this.speedIndex = i;
  }
  togglePause() {
    this.speedIndex = this.speedIndex === 0 ? this.prevSpeed : 0;
  }
  /** Advance by real seconds, returns in-game seconds elapsed. */
  advance(realDt: number): number {
    const dt = realDt * this.speed;
    this.time += dt;
    return dt;
  }
  formatClock() {
    return `${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`;
  }
}
