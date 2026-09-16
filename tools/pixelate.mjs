/**
 * Turn a smooth Blender render into pixel art in the game's own medium.
 *
 * The game is hard-edged, palette-limited pixel art (see docs/art-direction). A raw Cycles render
 * is smooth and full-colour, so it clashes. This bands the 3D light into pixel-art shading while
 * keeping the form and occlusion the render gives, hardens the alpha, then lays the soft ground
 * shadow the procedural generators draw under every prop. Run in place on a rendered PNG before
 * packing.
 *
 * A pixel's material comes from the companion index pass, never from its colour. Nearest-colour
 * matching over the whole palette is what turns a sunlit leaf into cream and a shadowed limestone
 * wall into slate -- the failure docs/art-pipeline.md records from the spike. With the material
 * known, only its own light steps are reachable, so the palette holds by construction and the
 * render decides one thing: which step.
 *
 * The palette comes in from `art-src/render_asset.py` too, so there is one palette in the pipeline
 * and no second copy here to drift out of step with `art-src/kit.py`.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

// a few light steps per base give the pixel-art shading bands the light falls into. The top step
// stays near 1: pushing it past ~1.1 chalks limestone and trim out to a washed grey in the render.
const STEPS = [1.1, 0.98, 0.84, 0.7, 0.58];
// the ground shadow of src/art/props.ts: a green-grey, never black, and never fully opaque
const SHADOW = [30, 40, 30];

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * The material at (x, y) in the index pass, repaired from its neighbours where the pass has no
 * answer.
 *
 * Coincident faces leave the odd isolated pixel shaded by neither of them, a handful per render.
 * Those sit inside a run of one material, so the surrounding majority is the right answer; a
 * pixel with no valid neighbour at all is a real failure and returns undefined for the caller
 * to report.
 */
function materialAt(ids, materials, x, y) {
  const at = (px, py) => {
    const o = (py * ids.width + px) * 4;
    return ids.data[o + 3] ? materials[ids.data[o]] : undefined;
  };
  const here = at(x, y);
  if (here) return here;
  const votes = new Map();
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= ids.width || ny >= ids.height) continue;
      const n = at(nx, ny);
      if (n) votes.set(n, (votes.get(n) ?? 0) + 1);
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
 * The shade of `base` whose step best matches how brightly this pixel rendered.
 *
 * The ratio is measured against the material's own base colour, so each material keeps its place
 * in the scene: a lit slate roof lands on slate's top step and still reads far darker than
 * limestone's, which is the rule the art direction states and the reason this is not normalised
 * per material.
 */
function stepOf(base, r, g, b) {
  const bl = lum(base[0], base[1], base[2]);
  const ratio = bl > 0 ? lum(r, g, b) / bl : 1;
  let best = STEPS[0];
  let bd = Infinity;
  for (const s of STEPS) {
    const d = Math.abs(s - ratio);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return [clamp(base[0] * best), clamp(base[1] * best), clamp(base[2] * best)];
}

/**
 * Soft ground shadow ellipse, the same one `groundShadow` in src/art/props.ts draws: laid only
 * where nothing else is, so it never darkens the asset, and left translucent so it sits on
 * whatever terrain the tile happens to be.
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
      data[o] = SHADOW[0];
      data[o + 1] = SHADOW[1];
      data[o + 2] = SHADOW[2];
      data[o + 3] = Math.round(alpha * (1 - d * 0.6));
    }
}

/**
 * Band the render into the game's medium and harden its alpha, then add `shadow` if one is given,
 * writing the PNG back in place.
 *
 * `palette` maps a material name to its sRGB `[r, g, b]`; `materials` maps the index encoded in
 * the red channel of `idPath` to that name; `shadow` is `{ cx, cy, rx, alpha, scale }` in pixels
 * of this render.
 */
export function pixelate(path, { palette, materials, idPath, alphaCut = 140, shadow } = {}) {
  if (!palette || !materials || !idPath) {
    throw new Error('pixelate: palette, materials and idPath are all required');
  }
  const png = PNG.sync.read(readFileSync(path));
  const ids = PNG.sync.read(readFileSync(idPath));
  if (ids.width !== png.width || ids.height !== png.height) {
    throw new Error(`pixelate: ${idPath} is not the same size as ${path}`);
  }
  const { data, width, height } = png;
  const unknown = new Set();
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < alphaCut) {
      data[o + 3] = 0;
      continue;
    }
    const x = i % width;
    const y = (i - x) / width;
    const base = palette[materialAt(ids, materials, x, y)];
    if (!base) {
      // The index pass is rendered without filtering or dithering and isolated gaps are repaired
      // above, so this should not happen; fail loudly rather than quietly painting the pixel some
      // other material's colour.
      unknown.add(`${ids.data[o]}@${x},${y}`);
      continue;
    }
    const c = stepOf(base, data[o], data[o + 1], data[o + 2]);
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  }
  if (unknown.size) {
    throw new Error(
      `pixelate: ${unknown.size} pixel(s) of ${path} carry no known material, e.g. ` +
        [...unknown].slice(0, 5).join(' '),
    );
  }
  if (shadow?.rx > 0) groundShadow(png, shadow);
  writeFileSync(path, PNG.sync.write(png));
}
