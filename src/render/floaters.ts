import { Container, Sprite, Text } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { PAL, hex } from '../art/palette';

interface Floater {
  node: Container;
  life: number;
  max: number;
  dir: number;
  y0: number;
}

/**
 * Floating "+3 wheat" / "-2 coal" markers over stations. Gains rise from below in green, losses
 * descend from above in red; both fade out over about two seconds.
 */
export class Floaters {
  private items: Floater[] = [];
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
  ) {}

  spawn(x: number, y: number, resource: string, delta: number) {
    const positive = delta > 0;
    const node = new Container();
    const frame = `icons/${resource}`;
    if (this.atlas.has(frame)) {
      const f = this.atlas.get(frame);
      const s = new Sprite(f.texture);
      s.anchor.set(0.5);
      s.position.set(-14, 0);
      node.addChild(s);
    }
    const label = new Text({
      text: `${positive ? '+' : '-'}${Math.abs(delta) >= 10 ? Math.round(Math.abs(delta)) : Math.round(Math.abs(delta) * 10) / 10}`,
      style: {
        fontFamily: 'Georgia, serif',
        fontSize: 13,
        fontWeight: 'bold',
        fill: positive ? 0x7fd28a : hex(PAL.red) + 0x303030,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    label.anchor.set(0, 0.5);
    label.position.set(-4, 0);
    node.addChild(label);
    const p = this.surface(x, y);
    // stagger simultaneous markers on the same tile
    const same = this.items.filter((f) => Math.abs(f.node.x - p.x) < 2).length;
    const y0 = positive ? p.y - 8 - same * 12 : p.y - 60 + same * 12;
    node.position.set(p.x, y0);
    node.alpha = 0;
    this.layer.addChild(node);
    this.items.push({ node, life: 0, max: 2.2, dir: positive ? -1 : 1, y0 });
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.life += dt;
      const k = f.life / f.max;
      f.node.y = f.y0 + f.dir * k * 34;
      f.node.alpha = k < 0.15 ? k / 0.15 : k > 0.55 ? Math.max(0, 1 - (k - 0.55) / 0.45) : 1;
      if (k >= 1) {
        f.node.destroy({ children: true });
        this.items.splice(i, 1);
      }
    }
  }
}
