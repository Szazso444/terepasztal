import { describe, expect, it, vi } from 'vitest';
import {
  Bounds,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
  getGlobalBounds,
} from 'pixi.js';
import { Rng } from '../engine/rng';
import { ChunkCull, cullByChunk } from './chunkCull';

const SOURCE = new TextureSource({ width: 512, height: 512 });
const texture = (w: number, h: number) =>
  new Texture({ source: SOURCE, frame: new Rectangle(0, 0, w, h) });
const TEXTURES = [texture(64, 32), texture(40, 90), texture(200, 160), texture(8, 8)];

const SCREEN = { width: 1280, height: 720 };

/** Is `child` on the screen by Pixi's own measure (its culler's test, never culled when false)? */
function onScreen(child: Container) {
  const b = getGlobalBounds(child, false, new Bounds());
  return !(
    b.x >= SCREEN.width ||
    b.y >= SCREEN.height ||
    b.x + b.width <= 0 ||
    b.y + b.height <= 0
  );
}

/** A world: a root the camera moves and scales, one flat layer of sprites under it. */
function world(rng: Rng, n: number) {
  const root = new Container(),
    layer = new Container({ sortableChildren: true });
  root.addChild(layer);
  for (let i = 0; i < n; i++) layer.addChild(sprite(rng));
  return { root, layer };
}

function sprite(rng: Rng) {
  const s = new Sprite({ texture: rng.pick(TEXTURES), cullable: true });
  s.anchor.set(rng.range(0, 1), rng.range(0, 1));
  place(rng, s);
  return s;
}

function place(rng: Rng, s: Sprite) {
  // the world of a 160 x 160 tile map, and a little beyond
  const tx = rng.range(-8, 168),
    ty = rng.range(-8, 168);
  s.position.set((tx - ty) * 32, (tx + ty) * 16);
  s.scale.set(rng.chance(0.2) ? rng.range(0.3, 3) : 1, rng.chance(0.1) ? -1 : 1);
  s.rotation = rng.chance(0.2) ? rng.range(-3, 3) : 0;
  s.zIndex = (tx + ty) * 100;
}

function aim(rng: Rng, root: Container) {
  const z = rng.pick([0.5, 0.75, 1, 1.5, 2, 3, 4]);
  root.scale.set(z);
  root.position.set(
    Math.round(SCREEN.width / 2 - rng.range(-5200, 5200) * z),
    Math.round(SCREEN.height / 2 - rng.range(-200, 5300) * z),
  );
}

describe('ChunkCull', () => {
  it('never culls what is on the screen, as the camera moves and the layer changes', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = new Rng(seed),
        { root, layer } = world(rng, 600),
        cull = new ChunkCull(layer);
      let culled = 0,
        off = 0;
      for (let frame = 0; frame < 120; frame++) {
        if (rng.chance(0.3)) aim(rng, root);
        // the layer changes under it: things move, change picture, come, go and hide
        for (let k = 0; k < 20; k++) {
          const kids = layer.children as Sprite[],
            s = kids[rng.int(0, kids.length - 1)],
            op = rng.next();
          if (op < 0.4) place(rng, s);
          else if (op < 0.55) s.texture = rng.pick(TEXTURES);
          else if (op < 0.65) s.visible = !s.visible;
          else if (op < 0.75) s.destroy();
          else if (op < 0.85) layer.addChild(sprite(rng));
          else if (op < 0.9) {
            // cullable is read when a child changes (it is set as a child is made)
            s.cullable = !s.cullable;
            s.position.y += 1;
          } else s.position.x += rng.range(-40, 40);
        }
        cull.update(SCREEN.width, SCREEN.height);
        for (const child of layer.children) {
          const seen = onScreen(child);
          if (seen || !child.cullable) expect(child.culled).toBe(false);
          if (!seen && child.cullable) {
            off++;
            if (child.culled) culled++;
          }
        }
      }
      // and it culls as Pixi did: what is off the screen is culled, bar a sliver at the edges
      expect(culled / off).toBeGreaterThan(0.97);
    }
  });

  it('measures nothing and sets nothing in a frame where nothing changed', () => {
    const rng = new Rng(9),
      { root, layer } = world(rng, 400),
      cull = new ChunkCull(layer);
    aim(rng, root);
    cull.update(SCREEN.width, SCREEN.height);
    expect(cull.measured).toBe(400);
    const before = layer.children.map((c) => c.culled);
    cull.update(SCREEN.width, SCREEN.height);
    expect(cull.measured).toBe(0);
    expect(layer.children.map((c) => c.culled)).toEqual(before);
    // one sprite moving is measured alone
    (layer.children[7] as Sprite).position.x += 5;
    cull.update(SCREEN.width, SCREEN.height);
    expect(cull.measured).toBe(1);
  });

  it('leaves the layer in its order, so depth sorting across chunk edges is untouched', () => {
    const rng = new Rng(4),
      { root, layer } = world(rng, 300);
    layer.sortChildren();
    const order = [...layer.children];
    const cull = new ChunkCull(layer);
    for (let i = 0; i < 10; i++) {
      aim(rng, root);
      cull.update(SCREEN.width, SCREEN.height);
    }
    expect(layer.children).toEqual(order);
    expect(layer.cullableChildren).toBe(false);
  });

  it('tests a child with a cull area by that area, and one with children by them all', () => {
    const root = new Container(),
      layer = root.addChild(new Container()),
      cull = new ChunkCull(layer);
    // a block of ground: its area reaches the screen though its one sprite does not
    const block = layer.addChild(new Container({ cullable: true }));
    block.cullableChildren = false;
    block.addChild(new Sprite({ texture: TEXTURES[0], x: 3000, y: 3000 }));
    block.cullArea = new Rectangle(-50, -50, 3100, 3100);
    // a bridge: a container of meshes and graphics, its children move it
    const bridge = layer.addChild(new Container({ cullable: true }));
    const part = bridge.addChild(new Graphics().rect(0, 0, 20, 20).fill(0xffffff));
    part.position.set(5000, 5000);
    cull.update(SCREEN.width, SCREEN.height);
    expect(block.culled).toBe(false);
    expect(bridge.culled).toBe(true);
    part.position.set(100, 100);
    cull.update(SCREEN.width, SCREEN.height);
    expect(bridge.culled).toBe(false);
  });

  it('shows a child again when it leaves the layer', () => {
    const root = new Container(),
      layer = root.addChild(new Container()),
      cull = new ChunkCull(layer);
    const far = layer.addChild(new Sprite({ texture: TEXTURES[0], cullable: true, x: 9000 }));
    cull.update(SCREEN.width, SCREEN.height);
    expect(far.culled).toBe(true);
    root.addChild(far);
    expect(far.culled).toBe(false);
  });

  describe('with a stencil held elsewhere in the layer', () => {
    /** A moved root, a layer, and a mask in a holder that is not the masked child's parent. */
    function masked() {
      const stage = new Container(),
        root = stage.addChild(new Container()),
        layer = root.addChild(new Container()),
        holder = layer.addChild(new Container()),
        mask = holder.addChild(new Graphics().rect(-20, -400, 420, 800).fill(0xffffff));
      holder.includeInBuild = false;
      holder.measurable = false;
      holder.position.set(0, 0);
      mask.position.set(4000, 2000);
      return { root, layer, mask, cull: new ChunkCull(layer) };
    }
    it('measures a masked sprite by itself, and warns of nothing', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined),
        { root, layer, mask, cull } = masked(),
        car = new Sprite({ texture: TEXTURES[0], cullable: true, x: 4016, y: 2008 });
      car.anchor.set(0.5);
      layer.addChild(car);
      root.position.set(10 - car.x, 360 - car.y);
      cull.update(SCREEN.width, SCREEN.height);
      car.mask = mask;
      car.x += 0.5;
      cull.update(SCREEN.width, SCREEN.height);
      expect(car.culled).toBe(false);
      // and all round the screen: the box is the car's, not one crossed with the mask's
      for (const [x, y] of [
        [SCREEN.width - 10, 360],
        [640, 10],
        [640, SCREEN.height - 10],
      ]) {
        root.position.set(x - car.x, y - car.y);
        car.x += 0.5;
        cull.update(SCREEN.width, SCREEN.height);
        expect(car.culled).toBe(false);
      }
      root.position.set(-9000, 360 - car.y);
      cull.update(SCREEN.width, SCREEN.height);
      expect(car.culled).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
    it('measures a masked child inside a container as well, as the bogies stand', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined),
        { root, layer, mask, cull } = masked(),
        under = layer.addChild(new Container({ cullable: true })),
        bogie = under.addChild(new Sprite({ texture: TEXTURES[0], x: 4016, y: 2008 }));
      bogie.mask = mask;
      root.position.set(40 - bogie.x, 360 - bogie.y);
      cull.update(SCREEN.width, SCREEN.height);
      expect(under.culled).toBe(false);
      root.position.set(-9000, 360 - bogie.y);
      cull.update(SCREEN.width, SCREEN.height);
      expect(under.culled).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
    it('takes the cull area of a masked container, and leaves it unmeasured', () => {
      const { layer, mask, cull } = masked(),
        throat = layer.addChild(new Container({ cullable: true }));
      throat.addChild(new Sprite({ texture: TEXTURES[0], x: 9000 }));
      throat.cullArea = new Rectangle(100, 100, 50, 50);
      throat.mask = mask;
      cull.update(SCREEN.width, SCREEN.height);
      expect(throat.culled).toBe(false);
      cull.update(SCREEN.width, SCREEN.height);
      expect(cull.measured).toBe(0);
    });
  });

  it('culls as the root renders, from the screen the renderer draws', () => {
    const root = new Container(),
      a = root.addChild(new Container()),
      b = root.addChild(new Container());
    const near = a.addChild(new Sprite({ texture: TEXTURES[0], cullable: true, x: 100, y: 100 })),
      far = b.addChild(new Sprite({ texture: TEXTURES[0], cullable: true, x: 9000, y: 100 }));
    const culls = cullByChunk(root, [a, b]);
    expect(culls).toHaveLength(2);
    root.onRender!({ screen: new Rectangle(0, 0, SCREEN.width, SCREEN.height) } as never);
    expect(near.culled).toBe(false);
    expect(far.culled).toBe(true);
    // the camera moves the root: what comes into view shows
    root.position.x = -8800;
    root.onRender!({ screen: new Rectangle(0, 0, SCREEN.width, SCREEN.height) } as never);
    expect(near.culled).toBe(true);
    expect(far.culled).toBe(false);
  });
});
