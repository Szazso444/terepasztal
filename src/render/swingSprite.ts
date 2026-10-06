import { Mesh, MeshGeometry, Texture } from 'pixi.js';
import type { FrameInfo } from '../engine/atlas';
import { swingMesh, SWING_FAN, SWING_FANS, SWING_VERTS, type PartBox } from '../sim/body';

/** The fans of triangles over the mesh's fixed points: the same for every swing sprite. */
const INDICES = (() => {
  const out: number[] = [];
  for (let fan = 0; fan < SWING_FANS; fan++)
    for (let i = 1; i + 1 < SWING_FAN; i++)
      out.push(fan * SWING_FAN, fan * SWING_FAN + i, fan * SWING_FAN + i + 1);
  return new Uint32Array(out);
})();

const src = new Float32Array(SWING_VERTS * 2);

/**
 * A vehicle sprite that can be swung between two drawn facings (body.ts swingMesh): the picture of
 * one facing, laid over the three seen faces of the part's box and drawn as that box looks at the
 * exact heading. Placed and tinted like a sprite; its anchor is the frame's own.
 */
export class SwingSprite extends Mesh<MeshGeometry> {
  private readonly pos: Float32Array;
  private readonly uv: Float32Array;
  constructor(label?: string) {
    const pos = new Float32Array(SWING_VERTS * 2),
      uv = new Float32Array(SWING_VERTS * 2);
    super({
      geometry: new MeshGeometry({ positions: pos, uvs: uv, indices: INDICES }),
      texture: Texture.EMPTY,
    });
    this.pos = pos;
    this.uv = uv;
    this.cullable = true;
    if (label) this.label = label;
  }

  /**
   * Show `frame`, mirrored when `flip` (its twin facing is the drawn one). With a `box`, the picture
   * (drawn for the tile-space heading `drawn`) is swung to `angle`; without one it is shown as it is.
   */
  show(frame: FrameInfo, flip: boolean, box: PartBox | null, drawn = 0, angle = 0) {
    this.texture = frame.texture;
    const ax = frame.anchorX * frame.w,
      ay = frame.anchorY * frame.h,
      left = flip ? ax - frame.w : -ax,
      rect = [left, -ay, left + frame.w, frame.h - ay] as const,
      { pos, uv } = this;
    if (box) swingMesh(box, drawn, angle, rect, src, pos);
    else {
      // one fan over the whole picture, the others empty
      const q = [rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]];
      for (let i = 0; i < SWING_VERTS; i++) {
        const k = i < SWING_FAN ? Math.min(i, 3) : 3;
        src[2 * i] = pos[2 * i] = q[2 * k];
        src[2 * i + 1] = pos[2 * i + 1] = q[2 * k + 1];
      }
    }
    for (let i = 0; i < SWING_VERTS; i++) {
      const u = (src[2 * i] - left) / frame.w;
      uv[2 * i] = flip ? 1 - u : u;
      uv[2 * i + 1] = (src[2 * i + 1] + ay) / frame.h;
    }
    this.geometry.positions = pos;
    this.geometry.uvs = uv;
  }
}
