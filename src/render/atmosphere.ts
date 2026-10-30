import type { Container } from 'pixi.js';

/** `base` multiplied by `color`, channel by channel (0xRRGGBB, rounded). */
export function multiplyTint(base: number, color: number): number {
  let out = 0;
  for (let shift = 0; shift <= 16; shift += 8)
    out |= Math.round((((base >> shift) & 255) * ((color >> shift) & 255)) / 255) << shift;
  return out;
}

/** An object's own tint and the tint it shows, its own times the atmosphere's colour. */
interface Tinted {
  base: number;
  applied: number;
}

/**
 * How many objects a call with an unchanged colour checks for a tint changed behind its back,
 * from where the last call stopped. Every object is checked again within a few seconds.
 */
const SWEEP = 128;

/**
 * The night and season colour over the objects of one depth-sorted layer (`WorldRenderer.objects`):
 * each object shows its own tint multiplied by the colour, except an emissive one (window lights),
 * which shines at its own. The work follows what changed rather than the whole layer each frame:
 * a new colour retints every object, an object added since the last call is tinted as it comes,
 * and an object given a new tint of its own through `tint` (or `setOwnTint`) shows it at once.
 * A tint set straight on an object (`object.tint = ...`) is found by a slow sweep and taken as its
 * own from then on, as the full pass used to.
 */
export class AtmosphereTint {
  private color = 0xffffff;
  private tints = new WeakMap<Container, Tinted>();
  /** Objects added to the layer since the last `apply`. */
  private added = new Set<Container>();
  private cursor = 0;

  constructor(readonly layer: Container) {
    layer.on('childAdded', (child: Container) => this.added.add(child));
    atmospheres.set(layer, this);
  }

  /** The colour the objects are multiplied by now. */
  get current() {
    return this.color;
  }

  /** Give `object` (a child of the layer) the tint `base` of its own, shown under the colour. */
  tint(object: Container, base: number) {
    if (object.label === 'emissive') {
      object.tint = base;
      return;
    }
    const applied = multiplyTint(base, this.color),
      t = this.tints.get(object);
    if (t) {
      t.base = base;
      t.applied = applied;
    } else this.tints.set(object, { base, applied });
    object.tint = applied;
  }

  /** Tint the layer's objects by `color` (0xRRGGBB); white leaves their own tints. */
  apply(color: number) {
    if (color !== this.color) {
      this.color = color;
      this.added.clear();
      for (const object of this.layer.children) this.retint(object);
      return;
    }
    if (this.added.size) {
      for (const object of this.added)
        if (object.parent === this.layer && !object.destroyed) this.retint(object);
      this.added.clear();
    }
    this.sweep();
  }

  /** Multiply `object`'s own tint by the colour; a tint it was given since is its own now. */
  private retint(object: Container) {
    if (object.label === 'emissive') return;
    const t = this.tints.get(object),
      base = t && object.tint === t.applied ? t.base : object.tint;
    this.tint(object, base);
  }

  /** Check the next few objects for a tint set on them straight; such a tint is their own now. */
  private sweep() {
    const children = this.layer.children,
      n = children.length;
    if (!n) return;
    if (this.cursor >= n) this.cursor = 0;
    const end = Math.min(n, this.cursor + SWEEP);
    for (let i = this.cursor; i < end; i++) {
      const object = children[i];
      if (object.label === 'emissive') continue;
      const t = this.tints.get(object);
      if (!t || object.tint !== t.applied) this.retint(object);
    }
    this.cursor = end;
  }
}

/** The atmosphere over each layer that has one, so the renderers drawing into it can find it. */
const atmospheres = new WeakMap<Container, AtmosphereTint>();

/**
 * Give `object` the tint `base` of its own: under the atmosphere of the layer it is in, multiplied
 * by the colour there; in a layer without one, as it is.
 */
export function setOwnTint(object: Container, base: number) {
  const atmosphere = object.parent ? atmospheres.get(object.parent) : undefined;
  if (atmosphere) atmosphere.tint(object, base);
  else object.tint = base;
}
