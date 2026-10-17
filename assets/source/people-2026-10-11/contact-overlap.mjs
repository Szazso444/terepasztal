import { box, resample } from './pose-png.mjs';

// Align centre columns and actual soles. Normalize resolution, never body height or width.
export function contactOverlap(reference, candidate, referenceBody, candidateBody) {
  const scale = reference.width / candidate.width;
  const normalized =
    scale === 1
      ? candidate
      : resample(
          candidate,
          reference.width,
          Math.round(candidate.height * scale),
          scale,
          [0, 0],
          [0, 0],
          { cleanAlpha: false },
        );
  function mask(png, body, factor) {
    const bounds = box(png);
    const sole =
      body?.soleRow === undefined
        ? bounds.y + bounds.height - 1
        : Math.round(body.soleRow * factor);
    const hat = body?.hatTop === undefined ? bounds.y : body.hatTop * factor;
    const height = sole - hat + 1;
    const top = Math.ceil(sole + 1 - height * 0.4);
    const pixels = new Set();
    for (let y = top; y <= sole; y++) {
      for (let x = 0; x < png.width; x++) {
        if (png.data[(y * png.width + x) * 4 + 3] > 128)
          pixels.add((y - sole) * reference.width * 4 + x - png.width / 2 + reference.width * 2);
      }
    }
    return { pixels, sole, hat, height, cropTop: top };
  }
  const a = mask(reference, referenceBody, 1);
  const b = mask(normalized, candidateBody, scale);
  let intersection = 0;
  for (const key of a.pixels) if (b.pixels.has(key)) intersection++;
  const union = a.pixels.size + b.pixels.size - intersection;
  return {
    intersection,
    union,
    iou: union ? intersection / union : 0,
    threshold: 0.45,
    pass: union > 0 && intersection / union < 0.45,
    resolutionScale: scale,
    reference: {
      soleRow: a.sole,
      hatTop: a.hat,
      figureHeight: a.height,
      cropTop: a.cropTop,
      pixels: a.pixels.size,
    },
    candidate: {
      soleRow: b.sole,
      hatTop: b.hat,
      figureHeight: b.height,
      cropTop: b.cropTop,
      pixels: b.pixels.size,
    },
    method:
      'Original alpha>128, lowest40% of each body height; candidate uniformly scaled to reference resolution, centre columns and measured soles aligned; no silhouette recentering or body-height normalization',
  };
}
