/**
 * Turn a smooth Blender render into pixel art in the game's own medium.
 *
 * The game is hard-edged, palette-limited pixel art (docs/art-direction/README.md): broad colour
 * clusters rather than per-pixel noise, three or four shades of one family per material under a
 * single upper-left light, and a selective contour that darkens lower and side rims. A raw Cycles
 * render is smooth and full-colour, so this rebuilds it in that medium: band the render's light
 * into the material's own shades, cluster the boundary so it reads as painted rather than faceted,
 * contour the silhouette, and lay the soft ground shadow underneath. Run in place on a rendered
 * PNG before packing.
 *
 * A pixel's material comes from the companion index pass, never from its colour. Nearest-colour
 * matching over the whole palette is what turns a sunlit leaf into cream and a shadowed limestone
 * wall into slate -- the failure docs/art-pipeline.md records from the spike. With the material
 * known, only its own shades are reachable, so the palette holds by construction and the render
 * decides one thing: which shade.
 *
 * The ramps come in from `art-src/render_asset.py`, so there is one palette in the pipeline and no
 * second copy here to drift out of step with `art-src/kit.py`.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

// The shade thresholds of `mass` in src/art/props.ts, on the same scale: above the first the top
// face, then the lit shade, then the base, and below the last the shadow. Matching them is what
// makes a baked frame band like a generated one.
const TOP = 0.4;
const LIT = 0.05;
const SHADOW_AT = -0.35;
// How far the render's own light is allowed to swing that scale. The render lights a face
// physically, so this maps its brightness either side of the material's base onto the same range
// the generators reach by hand.
const GAIN = 1.35;
// Cluster noise amplitude, as in `mass`: enough to break a band's edge, not enough to speckle.
const NOISE = 0.5;
// the ground shadow of src/art/props.ts: a green-grey, never black, and never fully opaque
const SHADOW_RGB = [30, 40, 30];

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const shade = (c, f) => [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f)];
const mix = (a, b, t) => [
  clamp(a[0] + (b[0] - a[0]) * t),
  clamp(a[1] + (b[1] - a[1]) * t),
  clamp(a[2] + (b[2] - a[2]) * t),
];

/** `hash2` from src/engine/rng.ts, so the cluster noise is the generators' own. */
function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The shade of `ramp` this pixel falls in.
 *
 * The ratio is measured against the material's own base shade, so each material keeps its place in
 * the scene: a lit slate roof lands on slate's top shade and still reads far darker than
 * limestone's, which is the rule the art direction states and the reason this is not normalised
 * per material. The noise is clustered 2x2, as in `mass`, so the band edges break into patches
 * instead of following the geometry's facets pixel for pixel.
 */
function shadeOf(ramp, r, g, b, x, y, seed) {
  const base = ramp[0];
  const bl = lum(base);
  const v =
    (bl > 0 ? lum([r, g, b]) / bl - 1 : 0) * GAIN + (hash2(x >> 1, y >> 1, seed) - 0.5) * NOISE;
  if (v > TOP) return ramp[3] ?? ramp[1];
  if (v > LIT) return ramp[1];
  if (v > SHADOW_AT) return base;
  return ramp[2];
}

/**
 * `PixelBuf.outline` from src/art/pixels.ts: a selective contour, not a box around everything.
 *
 * Lower and side rims darken to ground the sprite and mark the occluded edge; an upper rim only
 * takes a whisper of its neighbour's colour. Without it a baked sprite sits flat beside a
 * generated one, which is most of why the two media did not agree.
 */
function outline(png, c, a = 255) {
  const { data, width, height } = png;
  const at = (x, y) => data[(y * width + x) * 4 + 3] > 0;
  const rgb = (x, y) =>
    x < 0 || y < 0 || x >= width || y >= height || !at(x, y)
      ? undefined
      : [data[(y * width + x) * 4], data[(y * width + x) * 4 + 1], data[(y * width + x) * 4 + 2]];
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) mask[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  const put = (x, y, col, alpha) => {
    const o = (y * width + x) * 4;
    data[o] = col[0];
    data[o + 1] = col[1];
    data[o + 2] = col[2];
    data[o + 3] = alpha;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) continue;
      const below = y < height - 1 && mask[(y + 1) * width + x];
      const above = y > 0 && mask[(y - 1) * width + x];
      const left = x > 0 && mask[y * width + x - 1];
      const right = x < width - 1 && mask[y * width + x + 1];
      if (!(below || above || left || right)) continue;
      const n = rgb(x, y + 1) ?? rgb(x + 1, y) ?? rgb(x - 1, y) ?? rgb(x, y - 1) ?? c;
      if (below && !above) put(x, y, mix(shade(n, 0.8), c, 0.25), Math.round(a * 0.7));
      else if (above && !below) put(x, y, mix(c, shade(n, 0.45), 0.4), a);
      else put(x, y, mix(c, shade(n, 0.5), 0.5), Math.round(a * 0.9));
    }
}

/**
 * Soft ground shadow ellipse, the same one `groundShadow` in src/art/props.ts draws: laid after
 * the contour so it is never outlined, only where nothing else is, and left translucent so it sits
 * on whatever terrain the tile happens to be.
 */
function groundShadow(png, { cx, cy, rx, alpha = 64, scale = 1 }) {
  const { data, width, height } = png;
  const ry = Math.max(1.5 * scale, rx * 0.45);
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(width - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(height - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      const o = (y * width + x) * 4;
      if (d > 1 || data[o + 3] !== 0) continue;
      data[o] = SHADOW_RGB[0];
      data[o + 1] = SHADOW_RGB[1];
      data[o + 2] = SHADOW_RGB[2];
      data[o + 3] = Math.round(alpha * (1 - d * 0.6));
    }
}

/**
 * The material at (x, y) in the index pass, repaired from its neighbours where the pass has no
 * answer.
 *
 * Coincident faces leave the odd isolated pixel shaded by neither of them, a handful per render.
 * Those sit inside a run of one material, so the surrounding majority is the right answer; a pixel
 * with no valid neighbour at all is a real failure and returns undefined for the caller to report.
 */
function materialAt(ids, materials, x, y, radius = 2) {
  const at = (px, py) => {
    const o = (py * ids.width + px) * 4;
    return ids.data[o + 3] ? materials[ids.data[o]] : undefined;
  };
  const here = at(x, y);
  if (here) return here;
  const votes = new Map();
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= ids.width || ny >= ids.height) continue;
      const n = at(nx, ny);
      if (n)
        votes.set(n, (votes.get(n) ?? 0) + (radius + 1 - Math.max(Math.abs(dx), Math.abs(dy))));
    }
  let best;
  let bv = 0;
  for (const [n, v] of votes)
    if (v > bv) {
      bv = v;
      best = n;
    }
  return best;
}

/**
 * Rebuild the render in the game's medium and write the PNG back in place.
 *
 * `palette` is `{ ramps, outline }` from the kit; `materials` maps the index encoded in the red
 * channel of `idPath` to a ramp name; `seed` varies the cluster noise per frame; `shadow` is
 * `{ cx, cy, rx, alpha, scale }` in pixels of this render.
 */
export function pixelate(
  path,
  { palette, materials, idPath, alphaCut = 140, shadow, seed = 0, outline: contour = true } = {},
) {
  if (!palette?.ramps) throw new Error('pixelate: a palette is required');
  const png = PNG.sync.read(readFileSync(path));
  // A render has a material pass and uses it. A frame baked from a reference crop has no geometry
  // behind it and therefore no pass, so it matches the nearest shade in the palette instead --
  // weaker, and the reason this is a fallback rather than the default.
  const ids = idPath ? PNG.sync.read(readFileSync(idPath)) : null;
  const byColour = !ids || !materials;
  const flat = byColour ? Object.values(palette.ramps).flat() : null;
  if (ids && (ids.width !== png.width || ids.height !== png.height)) {
    throw new Error(`pixelate: ${idPath} is not the same size as ${path}`);
  }
  const { data, width, height } = png;
  let drawn = 0;
  let dropped = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < alphaCut) {
      data[o + 3] = 0;
      continue;
    }
    drawn++;
    const x = i % width;
    const y = (i - x) / width;
    if (byColour) {
      let best = flat[0];
      let bd = Infinity;
      for (const c of flat) {
        const d = (data[o] - c[0]) ** 2 + (data[o + 1] - c[1]) ** 2 + (data[o + 2] - c[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      data[o] = best[0];
      data[o + 1] = best[1];
      data[o + 2] = best[2];
      data[o + 3] = 255;
      continue;
    }
    const ramp = palette.ramps[materialAt(ids, materials, x, y)];
    if (!ramp) {
      // The index pass decides what the asset covers. The beauty pass is denoised and its filter
      // is wide, so it bleeds the odd pixel past a thin edge -- a reed blade, a frond tip -- that
      // the index pass, at one sample and no filter, does not reach. With no material within two
      // pixels there is nothing there, so drop it. A run of them would mean the two passes
      // genuinely disagree, which is the failure worth stopping for.
      data[o + 3] = 0;
      dropped++;
      continue;
    }
    const c = shadeOf(ramp, data[o], data[o + 1], data[o + 2], x, y, seed);
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  }
  if (dropped > Math.max(8, drawn * 0.005)) {
    throw new Error(
      `pixelate: ${dropped} of ${drawn} drawn pixels in ${path} carry no material. The beauty and ` +
        'index passes disagree about what this asset covers, which is not an edge artefact.',
    );
  }
  // Art cut from a board already carries its own edge treatment; adding the generators' contour
  // on top of it rings the sprite with a pale halo. Only a render, which has no edges of its own,
  // needs one.
  if (contour) outline(png, palette.outline, 170);
  if (shadow?.rx > 0) groundShadow(png, shadow);
  writeFileSync(path, PNG.sync.write(png));
}
