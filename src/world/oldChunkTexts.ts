import { PROP_KINDS, type ChunkPlanes } from './chunks';

/**
 * Chunk texts of versions 1 to 4, written from planes as the description in chunks.ts spells out
 * their bytes: an oracle for tests, kept apart from chunks.ts, which reads these versions and
 * writes none of them any more. Nothing in the game imports it.
 */

/** The versions a text here is written in. */
export type OldVersion = 1 | 2 | 3 | 4;

/** The bytes of a chunk text, and the text of bytes. */
export const bytesOf = (text: string) => Array.from(atob(text), (ch) => ch.charCodeAt(0));
export const textOf = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

function varint(out: number[], v: number) {
  for (; v >= 0x80; v = Math.floor(v / 0x80)) out.push((v % 0x80) | 0x80);
  out.push(v);
}

/** A plane of ids 0 to 15 as runs: id and length less one in a byte, 15 for 16 or more. */
function runs(out: number[], plane: ArrayLike<number>) {
  for (let i = 0; i < plane.length;) {
    let end = i + 1;
    while (end < plane.length && plane[end] === plane[i]) end++;
    const len = end - i;
    if (len < 16) out.push((plane[i] << 4) | (len - 1));
    else {
      out.push((plane[i] << 4) | 15);
      varint(out, len - 16);
    }
    i = end;
  }
}

/** An offset in 256ths of a tile, as a signed byte. */
const offsetByte = (v: number) => Math.max(-128, Math.min(127, Math.round(v * 256))) & 0xff;

/**
 * The text `version` writes for the rectangle and planes of `c`; the planes it does not hold are
 * left out (version 1 the climate, 1 and 2 the water planes, 1 to 3 the features).
 */
export function oldChunkText(c: Omit<ChunkPlanes, 'version'>, version: OldVersion): string {
  const n = c.w * c.h;
  const out = [version, c.x0, c.y0, c.w, c.h];
  runs(out, c.terrain);
  runs(out, c.biome);
  if (version >= 2) runs(out, c.climate);
  for (let i = 0; i < n; i += 4) {
    let b = 0;
    for (let k = 0; k < 4 && i + k < n; k++) b |= c.variant[i + k] << (2 * k);
    out.push(b);
  }
  const tiles = [...c.props].filter(([, list]) => list.length).sort((a, b) => a[0] - b[0]);
  varint(out, tiles.length);
  let last = -1;
  for (const [i, list] of tiles) {
    const more = Math.min(list.length - 1, 3);
    varint(out, (i - last - 1) * 4 + more);
    if (more === 3) varint(out, list.length - 4);
    for (const p of list) {
      const kind = PROP_KINDS.indexOf(p.kind);
      if (kind < 31 && p.variant < 8) out.push(kind | (p.variant << 5));
      else {
        out.push(31);
        varint(out, kind);
        varint(out, p.variant);
      }
      out.push(offsetByte(p.ox), offsetByte(p.oy));
    }
    last = i;
  }
  if (version >= 3) {
    runs(out, c.waterSurface);
    const rivers: number[] = [];
    for (let i = 0; i < n; i++) if (c.flowDir[i]) rivers.push(i);
    varint(out, rivers.length);
    last = -1;
    for (const i of rivers) {
      varint(out, i - last - 1);
      varint(out, c.flow[i] * 4 + c.flowDir[i] - 1);
      last = i;
    }
  }
  if (version >= 4) {
    const features: number[] = [];
    for (let i = 0; i < n; i++) if (c.feature[i]) features.push(i);
    varint(out, features.length);
    last = -1;
    for (const i of features) {
      varint(out, i - last - 1);
      out.push(c.feature[i]);
      last = i;
    }
  }
  return textOf(out);
}
