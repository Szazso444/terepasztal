// (2) IMPOSTOR: the 3D mesh is rendered into an offscreen texture that has a depth buffer, and an
// ordinary Sprite shows it (zIndex, tint, alpha, anchor all stay the 2D pipeline's).
import {
  CLEAR,
  Container,
  Rectangle,
  RenderContainer,
  RenderTarget,
  Sprite,
  Texture,
  TextureSource,
} from 'pixi.js';
import { HALF_H, HALF_W, UP_PX, makeTrainShader, makeTrainState, tileToWorld } from './train3d.js';
import { Mesh } from 'pixi.js';

/** Logical-pixel box round the origin that holds the part at any heading (and pitch up to maxPitch). */
export function impostorCell(model, scale = [1, 1, 1], { pad = 2, maxPitch = 0.3 } = {}) {
  const P = model.positions;
  let r2 = 0;
  let zLo = 0;
  let zHi = 0;
  let xMax = 0;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i] * scale[0];
    const y = P[i + 1] * scale[1];
    const z = P[i + 2] * scale[2];
    r2 = Math.max(r2, x * x + y * y);
    xMax = Math.max(xMax, Math.abs(x));
    if (z < zLo) zLo = z;
    if (z > zHi) zHi = z;
  }
  const r = Math.sqrt(r2);
  const lift = xMax * Math.sin(maxPitch); // a pitched body's ends rise and sink
  const halfW = Math.ceil(r * HALF_W * Math.SQRT2) + pad;
  const top = Math.ceil(r * HALF_H * Math.SQRT2 + UP_PX * (zHi + lift)) + pad;
  const bottom = Math.ceil(r * HALF_H * Math.SQRT2 + UP_PX * (-zLo + lift)) + pad;
  return { left: halfW, right: halfW, top, bottom, w: 2 * halfW, h: top + bottom, radius: r, zLo, zHi };
}

/** A texture + depth render target the 3D parts are drawn into, cut into equal cells. */
export class ImpostorAtlas {
  /**
   * @param renderer the app's renderer
   * @param o.cell logical box from impostorCell
   * @param o.pixelScale texels per logical pixel: zoom * renderer.resolution * supersample
   * @param o.count cells wanted
   * @param o.filter 'nearest' (1:1 texels) or 'linear' (supersampled, shown scaled down)
   */
  constructor(renderer, { cell, pixelScale, count, filter = 'nearest', maxSize = 4096, msaa = false }) {
    this.renderer = renderer;
    this.cell = cell;
    this.items = [];
    this.stage = new Container(); // never on the display list; rendered into the atlas only
    this.dirty = [];
    // clears the dirty cells inside the atlas pass: gl.clear ignores the viewport, only a scissor
    // confines it, and Pixi never enables the scissor test itself
    this.clearer = new RenderContainer({
      render: (r) => {
        const gl = r.gl;
        gl.enable(gl.SCISSOR_TEST);
        for (const it of this.dirty) {
          const f = it.frame;
          gl.scissor(f.x, f.y, f.width, f.height); // texture targets are not y-flipped: top-left origin
          r.renderTarget.clear(null, CLEAR.ALL, [0, 0, 0, 0]);
        }
        gl.disable(gl.SCISSOR_TEST);
      },
    });
    this.source = new TextureSource({
      width: 4,
      height: 4,
      resolution: 1,
      // antialias: true on the colour source = a 4x MSAA renderbuffer (colour + depth) that Pixi
      // resolves into the texture after every pass (WebGL2 only)
      antialias: msaa,
      scaleMode: filter,
      autoGenerateMipmaps: false,
      // contents are premultiplied (cleared to 0,0,0,0, the shader writes rgb * a)
      alphaMode: 'premultiply-alpha-on-upload',
    });
    this.texture = new Texture({ source: this.source });
    // the depth buffer: a RenderTarget with depth: true gets a DEPTH24_STENCIL8 renderbuffer in WebGL.
    // A RenderTexture passed straight to renderer.render gets a target WITHOUT depth.
    this.target = new RenderTarget({ colorTextures: [this.texture], depth: true });
    this.maxSize = maxSize;
    this.layout(pixelScale, count);
  }

  /** (Re)size the atlas for a pixel scale and cell count; every cell is dirty afterwards. */
  layout(pixelScale, count = this.count) {
    this.pixelScale = pixelScale;
    this.count = count;
    const cw = Math.ceil(this.cell.w * pixelScale);
    const ch = Math.ceil(this.cell.h * pixelScale);
    let size = 256;
    while (Math.floor(size / cw) * Math.floor(size / ch) < count && size < this.maxSize) size *= 2;
    this.cols = Math.floor(size / cw);
    this.capacity = this.cols * Math.floor(size / ch);
    if (this.capacity < count) throw new Error(`atlas ${size} holds ${this.capacity} cells of ${cw}x${ch}, ${count} wanted`);
    this.cw = cw;
    this.ch = ch;
    this.size = size;
    if (this.source.pixelWidth !== size) this.source.resize(size, size, 1);
    this.items.forEach((it, i) => this.place(it, i));
  }

  place(it, i) {
    const x = (i % this.cols) * this.cw;
    const y = Math.floor(i / this.cols) * this.ch;
    it.frame.x = x;
    it.frame.y = y;
    it.frame.width = this.cw;
    it.frame.height = this.ch;
    it.cellTexture.frame.copyFrom(it.frame);
    it.cellTexture.update();
    const s = this.pixelScale;
    // origin on a whole texel so texels map 1:1 onto screen pixels
    const ox = Math.round(this.cell.left * s);
    const oy = Math.round(this.cell.top * s);
    it.mesh.position.set(x + ox, y + oy);
    it.mesh.scale.set(s);
    it.sprite.anchor.set(ox / this.cw, oy / this.ch);
    it.sprite.scale.set(1 / s);
    it.dirty = true;
  }

  /** One part: its own Mesh (kept off the display list) and the Sprite that shows its cell. */
  add(geometry, texture, opts = {}) {
    if (this.items.length >= this.capacity) this.layout(this.pixelScale, this.items.length + 1);
    const shader = makeTrainShader(texture, opts);
    const mesh = new Mesh({ geometry, shader, state: makeTrainState(), roundPixels: false });
    const u = shader.resources.part.uniforms;
    // depth only has to order the part against itself: nearness spans about +-1.5 tiles
    u.uDepth[0] = 0;
    u.uDepth[1] = 0.5;
    const frame = new Rectangle();
    // dynamic: true, or a Sprite never hears the frame change that layout() makes (Sprite only
    // subscribes to a texture's 'update' event when texture.dynamic is set)
    const cellTexture = new Texture({ source: this.source, frame, dynamic: true });
    const sprite = new Sprite({ texture: cellTexture });
    const it = { mesh, sprite, frame, cellTexture, uniforms: u, dirty: true, heading: NaN, pitch: NaN };
    it.setPose = (tx, ty, heading, pitch = 0, h = 0) => {
      const w = tileToWorld(tx, ty);
      sprite.position.set(w.x, w.y - h * UP_PX);
      if (heading !== it.heading || pitch !== it.pitch) {
        it.heading = u.uYawPitch[0] = heading;
        it.pitch = u.uYawPitch[1] = pitch;
        it.dirty = true;
      }
    };
    this.items.push(it);
    this.place(it, this.items.length - 1);
    return it;
  }

  /** Re-render the dirty cells in ONE pass over the atlas. Returns how many were drawn. */
  refresh(all = false) {
    const dirty = this.items.filter((it) => all || it.dirty);
    if (!dirty.length) return 0;
    this.dirty = dirty;
    this.stage.removeChildren();
    this.stage.addChild(this.clearer);
    for (const it of dirty) {
      this.stage.addChild(it.mesh);
      it.dirty = false;
    }
    // clear: false, the clearer wipes only the dirty cells (colour AND depth)
    this.renderer.render({ container: this.stage, target: this.target, clear: false });
    return dirty.length;
  }

  /** The same, one renderer.render per cell with a scissor round it (for the cost comparison). */
  refreshEach(all = false, scissor = true) {
    const gl = this.renderer.gl;
    let n = 0;
    this.stage.removeChildren();
    for (const it of this.items) {
      if (!all && !it.dirty) continue;
      this.stage.addChild(it.mesh);
      if (scissor) {
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(it.frame.x, it.frame.y, it.frame.width, it.frame.height);
      }
      this.renderer.render({ container: this.stage, target: this.target, clear: true, clearColor: [0, 0, 0, 0] });
      gl.disable(gl.SCISSOR_TEST);
      this.stage.removeChildren();
      it.dirty = false;
      n++;
    }
    return n;
  }
}

/** The alternative: every part owns a small texture + depth target. */
export class SeparateImpostors {
  constructor(renderer, { cell, pixelScale, filter = 'nearest', depth = true, msaa = false }) {
    this.msaa = msaa;
    this.renderer = renderer;
    this.depth = depth;
    this.cell = cell;
    this.pixelScale = pixelScale;
    this.filter = filter;
    this.items = [];
  }

  add(geometry, texture, opts = {}) {
    const s = this.pixelScale;
    const cw = Math.ceil(this.cell.w * s);
    const ch = Math.ceil(this.cell.h * s);
    const source = new TextureSource({ width: cw, height: ch, resolution: 1, antialias: this.msaa, scaleMode: this.filter });
    const cellTexture = new Texture({ source });
    // depth: false here = what a bare Texture / RenderTexture target gets from Pixi
    const target = this.depth ? new RenderTarget({ colorTextures: [cellTexture], depth: true }) : cellTexture;
    const shader = makeTrainShader(texture, opts);
    const mesh = new Mesh({ geometry, shader, state: makeTrainState(), roundPixels: false });
    const holder = new Container();
    holder.addChild(mesh);
    const u = shader.resources.part.uniforms;
    u.uDepth[0] = 0;
    u.uDepth[1] = 0.5;
    const ox = Math.round(this.cell.left * s);
    const oy = Math.round(this.cell.top * s);
    mesh.position.set(ox, oy);
    mesh.scale.set(s);
    const sprite = new Sprite({ texture: cellTexture });
    sprite.anchor.set(ox / cw, oy / ch);
    sprite.scale.set(1 / s);
    const it = { mesh, holder, sprite, target, uniforms: u, dirty: true, heading: NaN, pitch: NaN };
    it.setPose = (tx, ty, heading, pitch = 0, h = 0) => {
      const w = tileToWorld(tx, ty);
      sprite.position.set(w.x, w.y - h * UP_PX);
      if (heading !== it.heading || pitch !== it.pitch) {
        it.heading = u.uYawPitch[0] = heading;
        it.pitch = u.uYawPitch[1] = pitch;
        it.dirty = true;
      }
    };
    this.items.push(it);
    return it;
  }

  refresh(all = false) {
    let n = 0;
    for (const it of this.items) {
      if (!all && !it.dirty) continue;
      this.renderer.render({ container: it.holder, target: it.target, clear: true, clearColor: [0, 0, 0, 0] });
      it.dirty = false;
      n++;
    }
    return n;
  }
}
