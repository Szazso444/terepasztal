// Pure pixel filters for the style previews; no imports, so node tools and the page share them.

/** 4 bits per channel, or 4096 for transparent (alpha below `cut`). */
const bucket = (d, k, cut) =>
  d[k + 3] < cut ? 4096 : ((d[k] >> 4) << 8) | ((d[k + 1] >> 4) << 4) | (d[k + 2] >> 4);

/**
 * Majority filter over a round window: each pixel takes the most common colour class around it
 * (averaging only that class). Rounds pixel stair-steps into smooth contours without blurring.
 */
export function smoothPixelArt(data, w, h, r, cut = 128) {
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
          b = bucket(data, k, cut);
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
      const o = (y * w + x) * 4;
      if (best === 4096) continue;
      out[o] = r0 / m;
      out[o + 1] = g0 / m;
      out[o + 2] = b0 / m;
      out[o + 3] = a0 / m;
    }
  return out;
}

/**
 * Snaps an image to a coarser pixel grid without averaging colours: each cell takes its dominant
 * colour class; silhouettes become hard, painted fades keep the alpha of the winning class. `cell` is source pixels per cell.
 */
export function snapToGrid(data, w, h, cell, cut = 128) {
  const W = Math.max(1, Math.round(w / cell)),
    H = Math.max(1, Math.round(h / cell)),
    out = new Uint8ClampedArray(W * H * 4),
    counts = new Uint16Array(4097),
    keys = [],
    ids = [];
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      keys.length = ids.length = 0;
      let best = -1,
        most = 0;
      for (let y = Math.floor(Y * cell); y < Math.min(h, Math.floor((Y + 1) * cell)); y++)
        for (let x = Math.floor(X * cell); x < Math.min(w, Math.floor((X + 1) * cell)); x++) {
          const k = (y * w + x) * 4,
            b = bucket(data, k, cut);
          keys.push(b);
          ids.push(k);
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
      keys.forEach((b, i) => {
        counts[b] = 0;
        if (b !== best) return;
        r0 += data[ids[i]];
        g0 += data[ids[i] + 1];
        b0 += data[ids[i] + 2];
        a0 += data[ids[i] + 3];
        m++;
      });
      const o = (Y * W + X) * 4;
      if (best === 4096 || !m) continue;
      out[o] = r0 / m;
      out[o + 1] = g0 / m;
      out[o + 2] = b0 / m;
      out[o + 3] = a0 / m;
    }
  return { data: out, w: W, h: H };
}
