import { daySeconds } from './rules';

/** In-game clock. One day = 4 real minutes at 1x by default (tunable). */
export const DAY_SECONDS = 240;
/**
 * Game speed by index; saves store the index (`clock.speedIndex`), so an index keeps its speed
 * for good and a new speed takes the next one: ½× came last, as 4.
 */
export const SPEEDS = [0, 1, 2, 3, 0.5] as const;
/** The indexes of SPEEDS in the order players see and step through them: pause, ½×, 1×, 2×, 3×. */
export const SPEED_ORDER: readonly number[] = [0, 4, 1, 2, 3];
/** SPEED_ORDER without the pause: what + and − step along. */
const RUNNING_ORDER = SPEED_ORDER.filter((i) => i !== 0);
/**
 * Game seconds per simulation step. The game loop runs at 1 / SIM_STEP Hz, and at speed s each
 * loop tick runs s of these steps (`GameClock.run`), so every speed sees the same steps and the
 * same outcomes. A fractional speed carries the part of a step it has not run to the next tick:
 * ½× runs one step every second tick.
 */
export const SIM_STEP = 0.05;

export class GameClock {
  /** elapsed in-game seconds */
  time = 0;
  speedIndex = 1;
  private prevSpeed = 1;
  /** the part of a step a fractional speed has not run yet (`run`) */
  private carry = 0;
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
    this.carry = 0;
  }
  togglePause() {
    this.speedIndex = this.speedIndex === 0 ? this.prevSpeed : 0;
    this.carry = 0;
  }
  /**
   * One speed up (1) or down (-1) along SPEED_ORDER, stopping at ½× and 3×. From pause it
   * resumes one step from the speed the clock had.
   */
  stepSpeed(dir: 1 | -1) {
    const base = this.speedIndex === 0 ? this.prevSpeed : this.speedIndex;
    const at = RUNNING_ORDER.indexOf(base) + dir;
    this.setSpeed(RUNNING_ORDER[Math.max(0, Math.min(RUNNING_ORDER.length - 1, at))]);
  }
  /** How many steps the next `run` takes: `floor(carry + speed)`, 0 on ½×'s empty ticks. */
  dueSteps(): number {
    return Math.floor(this.carry + this.speed);
  }
  /**
   * Whether the next loop tick starts a new span for the renderer (`Fleet.beginFrame`): it runs
   * a step, or the clock is stopped and the poses hold still. Always, at a whole speed. Below 1x
   * the empty ticks between steps go on drawing the span of the last step.
   */
  startsSpan(): boolean {
    return this.speed === 0 || this.dueSteps() > 0;
  }
  /**
   * How far the renderer is from the poses before the last step to the poses after it, given the
   * loop's `alpha` through the current loop tick: `alpha` at a whole speed, 1 when paused. Below
   * 1x a step spans 1 / speed loop ticks, so ½× goes 0 to ½ through the tick that ran the step and
   * ½ to 1 through the empty one after it: `carry + alpha * speed`.
   */
  stepAlpha(alpha: number): number {
    const speed = this.speed;
    if (speed === 0) return 1;
    return speed < 1 ? this.carry + alpha * speed : alpha;
  }
  /** Advance by real seconds, returns in-game seconds elapsed. */
  advance(realDt: number): number {
    const dt = realDt * this.speed;
    this.time += dt;
    return dt;
  }
  /**
   * One loop tick on the fixed-step path: `speed` steps of SIM_STEP game seconds (none when
   * paused), with a fractional speed's remainder carried to the next tick, so ½× runs one step
   * every second tick. Each adds SIM_STEP to `time`, then calls `step(SIM_STEP)`. Returns the
   * game seconds run.
   */
  run(step: (gdt: number) => void): number {
    const due = this.carry + this.speed;
    const steps = Math.floor(due);
    this.carry = due - steps;
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
