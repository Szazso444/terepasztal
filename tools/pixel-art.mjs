/**
 * Style pass for pixel-art sources: rounds their stair-stepped edges into the smooth painted
 * contours of the trains and buildings. The approved "both smooth" direction; see
 * docs/art-direction/README.md.
 */

/** 4 bits per channel, or 4096 for transparent (alpha below 128). */
const bucket = (d, k) =>
  d[k + 3] < 128 ? 4096 : ((d[k] >> 4) << 8) | ((d[k + 1] >> 4) << 4) | (d[k + 2] >> 4);

/**
 * Majority filter over a round window of radius `r`: each pixel takes the most common colour class
 * around it, averaging only that class's pixels (alpha included). Stair-steps and lone pixels
 * give way to smooth contours; flat regions and hard edges between colours are not blurred.
 * Returns a new RGBA array the size of `data`.
 */
export function smoothPixelArt(data, w, h, r) {
  const out = new Uint8ClampedArray(data.length),
    counts = new Uint16Array(4097),
    offsets = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) offsets.push(dx, dy);
  const ids = new Int32Array(offsets.length / 2),
    keys = new Int32Array(offsets.length / 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0,
        best = -1,
        most = 0;
      for (let i = 0; i < offsets.length; i += 2) {
        const xx = x + offsets[i],
          yy = y + offsets[i + 1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = (yy * w + xx) * 4,
          b = bucket(data, k);
        ids[n] = k;
        keys[n++] = b;
        if (++counts[b] > most) {
          most = counts[b];
          best = b;
        }
      }
      let r0 = 0,
        g0 = 0,
        b0 = 0,
        a0 = 0,
        m = 0;
      for (let i = 0; i < n; i++) {
        counts[keys[i]] = 0;
        if (keys[i] !== best) continue;
        r0 += data[ids[i]];
        g0 += data[ids[i] + 1];
        b0 += data[ids[i] + 2];
        a0 += data[ids[i] + 3];
        m++;
      }
      if (best === 4096) continue;
      const o = (y * w + x) * 4;
      out[o] = r0 / m;
      out[o + 1] = g0 / m;
      out[o + 2] = b0 / m;
      out[o + 3] = a0 / m;
    }
  return out;
}

/** smoothPixelArt on a pngjs image, in place. */
export function smoothPng(png, r) {
  png.data = Buffer.from(smoothPixelArt(png.data, png.width, png.height, r));
  return png;
}
