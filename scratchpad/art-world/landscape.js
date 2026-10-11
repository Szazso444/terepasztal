// Preview material field. Sample in world coordinates so lot boundaries can cross tiles.
const definitions = {
  grass: ['terrain-grass.png', 0.34, 0.27, 0.49],
  stone: ['people-road-stone.png', 0.33, 0.4, 0.5],
  dirt: ['people-path-dirt.png', 0.28, 0.26, 0.5],
  gravel: ['people-path-dirt.png', 0.28, 0.26, 0.5],
  sand: ['terrain-sand.png', 0.3, 0.25, 0.46],
  water: ['terrain-water.png', 0.34, 0.2, 0.5],
};
const images = {};
export async function loadLandscape() {
  await Promise.all(
    Object.entries(definitions).map(async ([name, [file]]) => {
      const image = new Image();
      image.src = `/assets/source/base-v1/${file}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      images[name] = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }),
  );
}
const fract = (x) => x - Math.floor(x);
const mirror = (x) => 1 - Math.abs(fract(x / 2) * 2 - 1);
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
function color(name, x, y) {
  const p = images[name],
    [, sx, sy, cy] = definitions[name];
  const u = name === 'stone' ? fract(x / 1.75) : mirror(x * 0.69 + y * 0.07);
  const v = name === 'stone' ? fract(y / 1.75) : mirror(y * 0.73 - x * 0.03);
  const px = Math.max(0, Math.min(p.width - 1, Math.round(p.width * (0.5 + (u - v) * sx))));
  const py = Math.max(0, Math.min(p.height - 1, Math.round(p.height * (cy + (u + v - 1) * sy))));
  const i = (py * p.width + px) * 4;
  const rgb = [p.data[i], p.data[i + 1], p.data[i + 2]];
  if (name === 'gravel') {
    // Retain the source dirt's granular detail, tint to warm crushed limestone.
    const l = rgb[0] * 0.3 + rgb[1] * 0.5 + rgb[2] * 0.2;
    return [l * 0.88 + 8, l * 0.88 + 6, l * 0.85 + 3];
  }
  return rgb;
}
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
export function landscape(lots, yards = true) {
  const canvas = document.createElement('canvas');
  canvas.width = 1408;
  canvas.height = 768;
  const ctx = canvas.getContext('2d'),
    out = ctx.createImageData(canvas.width, canvas.height);
  for (let py = 0; py < 768; py++)
    for (let px = 0; px < 1408; px++) {
      const dx = (px / 2 - 352) / 32,
        dy = (py / 2 - 16) / 16;
      const x = (dx + dy) / 2,
        y = (dy - dx) / 2;
      if (x < -0.5 || y < -0.5 || x > 10.5 || y > 10.5) continue;
      let c = color('grass', x, y);
      // Same continuous field across grass/sand/water and across tile corners.
      const shore = 8.45 + 0.12 * Math.sin(y * 1.4) + 0.07 * Math.sin(y * 3.7);
      c = mix(c, color('sand', x, y), smooth((x - shore + 0.3) / 0.65));
      c = mix(c, color('water', x, y), smooth((x - shore - 0.6) / 0.55));
      if (yards)
        for (const lot of lots) {
          const d = Math.min(
            x - lot.x + lot.w / 2,
            lot.x + lot.w / 2 - x,
            y - lot.y + lot.h / 2,
            lot.y + lot.h / 2 - y,
          );
          if (d < -0.2) continue;
          const rough = 0.04 * Math.sin(x * 8.1 + y * 3.7) + 0.025 * Math.sin(x * 19 - y * 13);
          const t = smooth((d + rough + 0.12) / 0.3);
          if (t) c = mix(c, color(lot.material, x, y), t);
        }
      const i = (py * 1408 + px) * 4;
      for (let k = 0; k < 3; k++) out.data[i + k] = c[k];
      out.data[i + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
