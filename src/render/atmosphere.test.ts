import { describe, expect, it } from 'vitest';
import { Container, Sprite } from 'pixi.js';
import { AtmosphereTint, multiplyTint, setOwnTint } from './atmosphere';
import { Rng } from '../engine/rng';

const makeRng = (seed: number) => {
  const rng = new Rng(seed);
  return () => rng.next();
};

/** The pass as it was before #555: every object, every call. */
class FullPass {
  private tints = new WeakMap<Container, { base: number; applied: number }>();
  constructor(readonly layer: Container) {}
  apply(color: number) {
    for (const object of this.layer.children) {
      if (object.label === 'emissive') continue;
      const previous = this.tints.get(object);
      const base = previous && object.tint === previous.applied ? previous.base : object.tint;
      let applied = 0;
      for (const shift of [0, 8, 16])
        applied |= Math.round((((base >> shift) & 255) * ((color >> shift) & 255)) / 255) << shift;
      object.tint = applied;
      this.tints.set(object, { base, applied });
    }
  }
}

const colour = (r: () => number) => Math.floor(r() * 0x1000000);

describe('multiplyTint', () => {
  it('multiplies each channel, rounded, as the full pass did', () => {
    const r = makeRng(7);
    for (let i = 0; i < 2000; i++) {
      const a = colour(r),
        b = colour(r);
      let want = 0;
      for (const shift of [0, 8, 16])
        want |= Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255) << shift;
      expect(multiplyTint(a, b)).toBe(want);
    }
    expect(multiplyTint(0x123456, 0xffffff)).toBe(0x123456);
    expect(multiplyTint(0x123456, 0)).toBe(0);
  });
});

describe('AtmosphereTint', () => {
  it('tints exactly as the full pass did, through adds, own tints, removals and colours', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = makeRng(seed);
      const ours = new Container(),
        theirs = new Container();
      const atmosphere = new AtmosphereTint(ours),
        full = new FullPass(theirs);
      const pairs: [Sprite, Sprite][] = [];
      let night = 0xffffff;
      for (let step = 0; step < 400; step++) {
        const op = r();
        if (op < 0.3 || !pairs.length) {
          // a new object, with a tint of its own set before or after it joins the layer
          const base = colour(r),
            emissive = r() < 0.1,
            a = new Sprite({ label: emissive ? 'emissive' : undefined }),
            b = new Sprite({ label: emissive ? 'emissive' : undefined });
          if (r() < 0.5) {
            a.tint = b.tint = base;
            ours.addChild(a);
            theirs.addChild(b);
          } else {
            ours.addChild(a);
            theirs.addChild(b);
            setOwnTint(a, base);
            b.tint = base;
          }
          pairs.push([a, b]);
        } else if (op < 0.5) {
          // a renderer gives one a new tint of its own (a season, a train's highlight)
          const [a, b] = pairs[Math.floor(r() * pairs.length)];
          const base = colour(r);
          setOwnTint(a, base);
          b.tint = base;
        } else if (op < 0.58) {
          const k = Math.floor(r() * pairs.length),
            [a, b] = pairs[k];
          pairs.splice(k, 1);
          if (r() < 0.5) {
            a.destroy();
            b.destroy();
          } else {
            a.removeFromParent();
            b.removeFromParent();
          }
        } else if (op < 0.66) night = r() < 0.3 ? 0xffffff : colour(r);
        // a frame: the colour is handed over again, the same or a new one
        atmosphere.apply(night);
        full.apply(night);
        for (const [a, b] of pairs) expect(a.tint).toBe(b.tint);
      }
    }
  });

  it('tints an object added after the colour was set, at the next frame', () => {
    const layer = new Container(),
      atmosphere = new AtmosphereTint(layer);
    atmosphere.apply(0x5c6bad);
    const late = layer.addChild(new Sprite());
    late.tint = 0xffffff;
    atmosphere.apply(0x5c6bad);
    expect(late.tint).toBe(0x5c6bad);
    // and one given its own tint as it joins shows it under the night at once
    const own = layer.addChild(new Sprite());
    setOwnTint(own, 0x808080);
    expect(own.tint).toBe(multiplyTint(0x808080, 0x5c6bad));
    atmosphere.apply(0x5c6bad);
    expect(own.tint).toBe(multiplyTint(0x808080, 0x5c6bad));
    // back to day: each object shows its own tint again
    atmosphere.apply(0xffffff);
    expect(late.tint).toBe(0xffffff);
    expect(own.tint).toBe(0x808080);
  });

  it('tints an object the moment it joins, as a frame may add to the layer after its own pass', () => {
    const layer = new Container(),
      atmosphere = new AtmosphereTint(layer),
      night = 0x5c6bad;
    atmosphere.apply(night);
    // nothing runs between this and the frame being drawn: it must not stand there bright
    const late = new Sprite();
    late.tint = 0xccddaa;
    layer.addChild(late);
    expect(late.tint).toBe(multiplyTint(0xccddaa, night));
    // one with no tint of its own, and an emissive one, which keeps its own
    const plain = layer.addChild(new Sprite()),
      lamp = layer.addChild(new Sprite({ label: 'emissive' }));
    expect(plain.tint).toBe(night);
    expect(lamp.tint).toBe(0xffffff);
    // a tint set straight on a new object after it joined shows under the night at the next frame
    plain.tint = 0x808080;
    atmosphere.apply(night);
    expect(plain.tint).toBe(multiplyTint(0x808080, night));
    // and nothing is multiplied twice, by the colour kept or by one that ends
    atmosphere.apply(night);
    expect(late.tint).toBe(multiplyTint(0xccddaa, night));
    atmosphere.apply(0xffffff);
    expect([late.tint, plain.tint]).toEqual([0xccddaa, 0x808080]);
  });

  it('leaves the window lights at their own tint', () => {
    const layer = new Container(),
      atmosphere = new AtmosphereTint(layer);
    const light = layer.addChild(new Sprite({ label: 'emissive' }));
    light.tint = 0xffeeaa;
    atmosphere.apply(0x404080);
    atmosphere.apply(0x404080);
    expect(light.tint).toBe(0xffeeaa);
    setOwnTint(light, 0xffffff);
    expect(light.tint).toBe(0xffffff);
  });

  it('does not walk the layer while the colour stays', () => {
    const layer = new Container(),
      atmosphere = new AtmosphereTint(layer);
    const objects = Array.from({ length: 5000 }, () => layer.addChild(new Sprite()));
    atmosphere.apply(0x808080);
    atmosphere.apply(0x808080);
    const last = objects[objects.length - 1];
    expect(last.tint).toBe(0x808080);
    // a tint set straight on an object far down the layer is not seen by the next frame...
    last.tint = 0x00ff00;
    atmosphere.apply(0x808080);
    expect(last.tint).toBe(0x00ff00);
    // ...but the sweep finds it within a pass over the layer, and takes it as the object's own
    for (let i = 0; i < Math.ceil(objects.length / 128) + 1; i++) atmosphere.apply(0x808080);
    expect(last.tint).toBe(multiplyTint(0x00ff00, 0x808080));
    atmosphere.apply(0xffffff);
    expect(last.tint).toBe(0x00ff00);
  });

  it('tints straight in a layer without an atmosphere', () => {
    const layer = new Container(),
      s = layer.addChild(new Sprite());
    setOwnTint(s, 0x123456);
    expect(s.tint).toBe(0x123456);
    const loose = new Sprite();
    setOwnTint(loose, 0x654321);
    expect(loose.tint).toBe(0x654321);
  });
});
