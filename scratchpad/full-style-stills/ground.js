// Still-preview extension of art-world/landscape.js. All material pixels come
// from the approved source art; one world-space field avoids lit diamond seams.
import { Sprite, Texture } from 'pixi.js';
const definitions = {
  grass: ['terrain-grass.png', 0.2, 0.15, 0.49],
  stone: ['people-road-stone.png', 0.2, 0.24, 0.5],
  dirt: ['people-path-dirt.png', 0.2, 0.17, 0.5],
  sand: ['terrain-sand.png', 0.2, 0.16, 0.46],
  water: ['terrain-water.png', 0.25, 0.16, 0.5],
};
const fract = (x) => x - Math.floor(x),
  mirror = (x) => 1 - Math.abs(fract(x / 2) * 2 - 1);
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
export async function installGround(g, mode, lots) {
  const theme = ['desert', 'taiga', 'wetlands'].includes(mode) ? mode : null;
  if (theme)
    definitions.grass = [
      theme === 'wetlands' ? 'terrain-swamp.png' : 'terrain-' + theme + '.png',
      0.2,
      0.15,
      0.49,
    ];
  const materials = {};
  for (const [name, [file]] of Object.entries(definitions)) {
    const im = new Image();
    im.src = '/assets/source/base-v1/' + file;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    materials[name] = ctx.getImageData(0, 0, c.width, c.height);
  }
  const sample = (name, x, y) => {
    const p = materials[name],
      [, sx, sy, cy] = definitions[name];
    const u = name === 'stone' ? fract(x * 3) : mirror(x * 2.1 + y * 0.13),
      v = name === 'stone' ? fract(y * 3) : mirror(y * 1.9 - x * 0.09);
    const px = Math.round(p.width * (0.5 + (u - v) * sx)),
      py = Math.round(p.height * (cy + (u + v - 1) * sy));
    const i = (py * p.width + px) * 4;
    return [p.data[i], p.data[i + 1], p.data[i + 2]];
  };
  const mix = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const c = document.createElement('canvas');
  c.width = 2816;
  c.height = 1920;
  const ctx = c.getContext('2d'),
    pixels = ctx.createImageData(c.width, c.height);
  for (let py = 0; py < c.height; py++)
    for (let px = 0; px < c.width; px++) {
      const wx = px / 2 - 704,
        wy = py / 2 + 320,
        x = (wx / 32 + wy / 16) / 2,
        y = (wy / 16 - wx / 32) / 2;
      const base =
        theme === 'desert'
          ? [185, 158, 102]
          : theme === 'taiga'
            ? [103, 124, 103]
            : theme === 'wetlands'
              ? [92, 111, 75]
              : [106, 121, 65];
      let color = mix(base, sample('grass', x, y), 0.42);
      // A shared path connects civic and residential fronts. Industrial yards use dirt.
      let distance = 99;
      if (mode === 'village')
        distance = Math.min(
          x > 19 && x < 32 ? Math.abs(y - 23.5) : 99,
          y > 19 && y < 26 ? Math.abs(x - 26) : 99,
        );
      if (mode === 'countryside')
        distance = Math.min(
          x > 22 && x < 30 ? Math.abs(y - 23.5) : 99,
          y > 21 && y < 26 ? Math.abs(x - 23) : 99,
        );
      if (distance < 0.4)
        color = mix(
          color,
          sample(mode === 'village' ? 'stone' : 'dirt', x, y),
          smooth((0.4 - distance) / 0.14),
        );
      for (const lot of lots) {
        const w = lot.id === 'townhouse' ? 1.05 : 1.65,
          h = lot.id === 'townhouse' ? 0.9 : 1.3;
        const d = Math.min(w - Math.abs(x - lot.x), h - Math.abs(y - lot.y - 0.2));
        if (d > -0.15) {
          const material = ['station', 'town', 'townhouse'].includes(lot.id) ? 'stone' : 'dirt';
          color = mix(
            color,
            sample(material, x, y),
            smooth((d + 0.12 + 0.025 * Math.sin(x * 19 + y * 11)) / 0.3),
          );
        }
      }
      if (['industry', 'countryside', 'wetlands'].includes(mode)) {
        const bank =
          mode === 'industry' ? 36 : mode === 'wetlands' ? 34.5 : 33 + Math.sin(y * 0.22) * 1.4;
        color = mix(color, sample('sand', x, y), smooth((x - bank + 0.5) / 0.7));
        color = mix(color, sample('water', x, y), smooth((x - bank - 0.3) / 0.7));
      }
      const i = (py * c.width + px) * 4;
      pixels.data[i] = color[0];
      pixels.data[i + 1] = color[1];
      pixels.data[i + 2] = color[2];
      pixels.data[i + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  const sprite = new Sprite(Texture.from(c));
  sprite.scale.set(0.5);
  sprite.position.set(-704, 320);
  // These composed shots cover a flat district; the material plate replaces
  // every flat tile, including water whose illustrated canvas has tall margins.
  g.world.ground.visible = false;
  g.world.root.addChildAt(sprite, g.world.root.getChildIndex(g.world.ground));
  return {
    sourceMaterials: Object.values(definitions).map((v) => v[0]),
    width: c.width,
    height: c.height,
  };
}
