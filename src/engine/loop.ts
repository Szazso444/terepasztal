/** Fixed-timestep simulation loop decoupled from render; render receives interpolation alpha. */
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
  ) {
    this.stepMs = 1000 / hz;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      let dt = now - this.last;
      this.last = now;
      if (dt > 250) dt = 250; // avoid spiral of death after tab switch
      this.acc += dt;
      let steps = 0;
      while (this.acc >= this.stepMs && steps < 10) {
        this.update(this.stepMs / 1000);
        this.acc -= this.stepMs;
        steps++;
      }
      if (steps === 10) this.acc = 0;
      this.render(this.acc / this.stepMs, dt / 1000);
      this.fpsAcc += dt;
      this.fpsCount++;
      if (this.fpsAcc >= 500) {
        this.fps = Math.round((this.fpsCount * 1000) / this.fpsAcc);
        this.fpsAcc = 0;
        this.fpsCount = 0;
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
