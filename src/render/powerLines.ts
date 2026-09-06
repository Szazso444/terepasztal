import { Container, Graphics } from 'pixi.js';
import type { PowerGrid, PowerEdge } from '../sim/power';
import { PAL, hex } from '../art/palette';

/**
 * Wires between connected poles and plants. Static catenaries are rebuilt when the grid changes;
 * live networks get a few cyan sparks drifting along each wire every frame.
 */
export class PowerLines {
  readonly root = new Container();
  private wires = new Graphics();
  private sparks = new Graphics();
  private edges: { a: { x: number; y: number }; b: { x: number; y: number }; live: boolean }[] = [];
  private t = 0;
  constructor(private readonly anchor: (n: PowerEdge['a']) => { x: number; y: number }) {
    this.root.addChild(this.wires, this.sparks);
  }

  rebuild(grid: PowerGrid) {
    this.edges = grid
      .edges()
      .map((e) => ({ a: this.anchor(e.a), b: this.anchor(e.b), live: e.live }));
    const g = this.wires;
    g.clear();
    for (const e of this.edges) {
      const sag = 5 + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) * 0.04;
      const mx = (e.a.x + e.b.x) / 2;
      const my = (e.a.y + e.b.y) / 2 + sag;
      g.moveTo(e.a.x, e.a.y).quadraticCurveTo(mx, my, e.b.x, e.b.y);
      g.stroke({ color: e.live ? 0x2a2e36 : 0x202226, width: 1, alpha: 0.95 });
    }
  }

  update(dt: number) {
    this.t += dt;
    const g = this.sparks;
    g.clear();
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      if (!e.live) continue;
      const sag = 5 + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) * 0.04;
      const mx = (e.a.x + e.b.x) / 2;
      const my = (e.a.y + e.b.y) / 2 + sag;
      for (let k = 0; k < 3; k++) {
        const u = (this.t * 0.22 + k * 0.33 + i * 0.17) % 1;
        // point on the quadratic curve
        const x = (1 - u) * (1 - u) * e.a.x + 2 * (1 - u) * u * mx + u * u * e.b.x;
        const y = (1 - u) * (1 - u) * e.a.y + 2 * (1 - u) * u * my + u * u * e.b.y;
        g.rect(Math.round(x), Math.round(y), 1, 1).fill({ color: hex(PAL.cyan), alpha: 0.9 });
      }
    }
  }
}
