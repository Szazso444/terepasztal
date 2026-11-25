/** Which loop callback threw. */
export type LoopPhase = 'update' | 'render';

/**
 * Fixed-timestep simulation loop decoupled from render; render receives interpolation alpha.
 *
 * A callback that throws is handed to `onError` (`console.error` when none is given) and the frame
 * carries on, so the loop keeps the same schedule, steps and renders whether or not a frame throws.
 */
export class GameLoop {
  readonly stepMs: number;
  private acc = 0;
  private last = 0;
  private running = false;
  private raf = 0;
  fps = 0;
  private fpsAcc = 0;
  private fpsCount = 0;

  constructor(
    hz: number,
    private readonly update: (dtSec: number) => void,
    private readonly render: (alpha: number, dtSec: number) => void,
    private readonly onError: (err: unknown, phase: LoopPhase) => void = (err) =>
      console.error(err),
  ) {
    this.stepMs = 1000 / hz;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      // the next frame first, so nothing this one does, a throw included, can end the loop; a
      // stop() during the frame cancels it
      this.raf = requestAnimationFrame(frame);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick(now: number) {
    // A frame stamped before the last one counts as no time: headless Chromium's first stamp came
    // seconds before start()'s performance.now(), and the negative dt held every update back until
    // the accumulator climbed back above zero.
    let dt = Math.max(0, now - this.last);
    this.last = now;
    if (dt > 250) dt = 250; // avoid spiral of death after tab switch
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.stepMs && steps < 10) {
      try {
        this.update(this.stepMs / 1000);
      } catch (err) {
        this.onError(err, 'update');
      }
      this.acc -= this.stepMs;
      steps++;
    }
    if (steps === 10) this.acc = 0;
    try {
      this.render(this.acc / this.stepMs, dt / 1000);
    } catch (err) {
      this.onError(err, 'render');
    }
    this.fpsAcc += dt;
    this.fpsCount++;
    if (this.fpsAcc >= 500) {
      this.fps = Math.round((this.fpsCount * 1000) / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsCount = 0;
    }
  }
}
