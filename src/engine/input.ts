/** Keyboard + mouse state for a canvas. Wheel and click events are queued for the game to consume. */
export interface ClickEvent {
  x: number;
  y: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
}

export class Input {
  readonly keys = new Set<string>();
  readonly pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseInside = false;
  /** Pointer currently over a DOM overlay element (panels swallow world interaction). */
  overUi = false;
  readonly buttons = new Set<number>();
  /** buttons that went down this frame (on the canvas) */
  readonly buttonPressed = new Set<number>();
  /** buttons released this frame (anywhere) */
  readonly buttonReleased = new Set<number>();
  wheelDelta = 0;
  clicks: ClickEvent[] = [];
  /** Set true if a DOM element (UI) should swallow the pointer. */
  dragDX = 0;
  dragDY = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    window.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      if (this.buttons.size) {
        this.dragDX += this.mouseX - this.lastX;
        this.dragDY += this.mouseY - this.lastY;
      }
      this.lastX = this.mouseX;
      this.lastY = this.mouseY;
      this.mouseInside = true;
      this.overUi = !!(e.target as HTMLElement | null)?.closest?.('#ui-root > *');
    });
    document.addEventListener('mouseleave', () => (this.mouseInside = false));

    el.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button);
      this.buttonPressed.add(e.button);
      this.lastX = this.mouseX;
      this.lastY = this.mouseY;
      if (e.button === 1) e.preventDefault();
      el.focus();
    });
    window.addEventListener('mouseup', (e) => {
      if (this.buttons.has(e.button) && e.target === el) {
        this.clicks.push({
          x: this.mouseX,
          y: this.mouseY,
          button: e.button,
          shift: e.shiftKey,
          ctrl: e.ctrlKey,
        });
      }
      this.buttons.delete(e.button);
      this.buttonReleased.add(e.button);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        this.wheelDelta += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  isDown(code: string) {
    return this.keys.has(code);
  }
  wasPressed(code: string) {
    return this.pressed.has(code);
  }
  /** Call at end of frame. */
  endFrame() {
    this.pressed.clear();
    this.buttonPressed.clear();
    this.buttonReleased.clear();
    this.wheelDelta = 0;
    this.clicks.length = 0;
    this.dragDX = 0;
    this.dragDY = 0;
  }
  get width() {
    return this.el.clientWidth;
  }
  get height() {
    return this.el.clientHeight;
  }
}
