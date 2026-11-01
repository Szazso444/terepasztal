import { Sprite, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { WindState } from '../sim/wind';
import { TreeSway } from './treeSway';

const wind = (strength: number, x = 1, y = 0): WindState => ({
  level: 'windy',
  strength,
  gust: strength,
  fromRad: 0,
  dir: { x, y },
  tile: { x: 0.7, y: 0.7 },
});
const VIEW = { x: 0, y: 0, w: 800, h: 600 };
const FAR = { x: 50000, y: 50000, w: 800, h: 600 };

/** Two frames: a tree moves on every other one. */
function move(sway: TreeSway, dt: number, w: WindState, view: typeof VIEW) {
  sway.update(dt, w, view);
  sway.update(0, w, view);
}

function tree(x = 300, y = 200) {
  const s = new Sprite(Texture.EMPTY);
  s.anchor.set(0.5, 1);
  s.position.set(x, y);
  s.scale.set(1.5);
  return s;
}

describe('trees in the wind', () => {
  it('shear about the foot, which stays where it was', () => {
    const sway = new TreeSway();
    const s = tree();
    sway.add(s, 'oak');
    for (let i = 0; i < 30; i++) {
      move(sway, 0.1, wind(0.8), VIEW);
      expect(s.x).toBe(300);
      expect(s.y).toBe(200);
      // the matrix leaves the anchor where it is: only the top moves
      expect(s.scale.x).toBe(1.5);
    }
    expect(s.skew.x).not.toBe(0);
  });

  it('lean downwind, the other way in the opposite wind', () => {
    const lean = (x: number) => {
      const sway = new TreeSway();
      const s = tree();
      sway.add(s, 'oak');
      let sum = 0;
      for (let i = 0; i < 400; i++) {
        move(sway, 0.05, wind(0.7, x), VIEW);
        sum += s.skew.x;
      }
      return sum;
    };
    // a negative skew takes the top toward +x, as y runs up the tree below the anchor
    expect(lean(1)).toBeLessThan(0);
    expect(lean(-1)).toBeGreaterThan(0);
  });

  it('are squashed a little by a push toward the camera, about the foot', () => {
    const sway = new TreeSway();
    const s = tree();
    sway.add(s, 'oak');
    let least = 2;
    for (let i = 0; i < 200; i++) {
      move(sway, 0.05, wind(1, 0, 1), VIEW);
      least = Math.min(least, s.scale.y);
    }
    expect(least).toBeLessThan(1.5);
    expect(least).toBeGreaterThan(1.3);
    expect(s.skew.x).toBeCloseTo(0, 9);
  });

  it('stand exactly as they were drawn in a calm', () => {
    const sway = new TreeSway();
    const s = tree();
    sway.add(s, 'pine');
    move(sway, 0.1, wind(1), VIEW);
    expect(s.skew.x).not.toBe(0);
    move(sway, 0.1, wind(0), VIEW);
    expect(s.skew.x).toBeCloseTo(0, 12);
    expect(s.scale.y).toBe(1.5);
  });

  it('do not move outside the view, or when hidden', () => {
    const sway = new TreeSway();
    const out = tree(),
      hidden = tree(320, 210);
    hidden.visible = false;
    sway.add(out, 'oak');
    sway.add(hidden, 'oak');
    move(sway, 0.1, wind(1), FAR);
    expect(out.skew.x).toBe(0);
    move(sway, 0.1, wind(1), VIEW);
    expect(hidden.skew.x).toBe(0);
  });

  it('leave what does not sway, and forget a tree that is gone', () => {
    const sway = new TreeSway();
    const rock = tree(),
      gone = tree(310, 205),
      kept = tree(330, 215);
    sway.add(rock, 'boulder');
    sway.add(gone, 'oak');
    sway.add(kept, 'oak');
    gone.destroy();
    move(sway, 0.1, wind(1), VIEW);
    expect(rock.skew.x).toBe(0);
    expect(kept.skew.x).not.toBe(0);
  });

  it('stand still for a player who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    try {
      const sway = new TreeSway();
      const s = tree();
      sway.add(s, 'oak');
      move(sway, 0.1, wind(1), VIEW);
      expect(s.skew.x).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('do not keep step: two trees sway apart', () => {
    const sway = new TreeSway();
    const a = tree(300, 200),
      b = tree(420, 260);
    sway.add(a, 'oak');
    sway.add(b, 'oak');
    for (let i = 0; i < 9; i++) move(sway, 1.3, wind(0.5), VIEW);
    expect(a.skew.x).not.toBeCloseTo(b.skew.x, 4);
  });
});
