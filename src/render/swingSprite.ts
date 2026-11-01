import { Mesh, MeshGeometry, Texture } from 'pixi.js';
import type { FrameInfo } from '../engine/atlas';

/**
 * An anchored vehicle image, drawn intact. The historical class name is retained
 * for callers; headings come from rendered frames, never from bending the image
 * over proxy box faces. Two triangles share one diagonal and cannot overlap.
 */
export class SwingSprite extends Mesh<MeshGeometry> {
  constructor(label?: string) {
    super({
      geometry: new MeshGeometry({
        positions: new Float32Array(8),
        uvs: new Float32Array(8),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      }),
      texture: Texture.EMPTY,
    });
    this.cullable = true;
    if (label) this.label = label;
  }

  /** Mirror around the ground anchor only when the atlas lacks the actual facing. */
  show(frame: FrameInfo, flip: boolean) {
    this.texture = frame.texture;
    const ax = frame.anchorX * frame.w;
    const ay = frame.anchorY * frame.h;
    const left = flip ? ax - frame.w : -ax;
    const right = left + frame.w;
    const top = -ay;
    const bottom = frame.h - ay;
    const pos = this.geometry.positions;
    pos.set([left, top, right, top, right, bottom, left, bottom]);
    this.geometry.positions = pos;
    const uv = this.geometry.uvs;
    uv.set(flip ? [1, 0, 0, 0, 0, 1, 1, 1] : [0, 0, 1, 0, 1, 1, 0, 1]);
    this.geometry.uvs = uv;
  }
}
