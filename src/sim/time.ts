import { daySeconds } from './rules';

/** In-game clock. One day = 4 real minutes at 1x by default (tunable). */
export const DAY_SECONDS = 240;
export const SPEEDS = [0, 1, 2, 3] as const;
/**
 * Game seconds per simulation step. The game loop runs at 1 / SIM_STEP Hz, and at speed s each
 * loop tick runs s of these steps (`GameClock.run`), so every speed sees the same steps and the
 * same outcomes.
 */
export const SIM_STEP = 0.05;

export class GameClock {
  /** elapsed in-game seconds */
  time = 0;
  speedIndex = 1;
  private prevSpeed = 1;
  get speed() {
    return SPEEDS[this.speedIndex];
  }
  get day() {
    return Math.floor(this.time / daySeconds()) + 1;
  }
  /** 0..1 within the day; 0 = midnight. */
  get dayFraction() {
    return (this.time % daySeconds()) / daySeconds();
  }
  get hour() {
    return Math.floor(this.dayFraction * 24);
  }
  get minute() {
    return Math.floor(((this.dayFraction * 24) % 1) * 60);
  }
  /** Elapsed days as a float. */
  get days() {
    return this.time / daySeconds();
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
  /**
   * One loop tick on the fixed-step path: `speed` steps of SIM_STEP game seconds (none when
   * paused). Each adds SIM_STEP to `time`, then calls `step(SIM_STEP)`. Returns the game seconds
   * run.
   */
  run(step: (gdt: number) => void): number {
    const steps = this.speed;
    for (let i = 0; i < steps; i++) {
      this.time += SIM_STEP;
      step(SIM_STEP);
    }
    return steps * SIM_STEP;
  }
  formatClock() {
    return `${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`;
  }
}
