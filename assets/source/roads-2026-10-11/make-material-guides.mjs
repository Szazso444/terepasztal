import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.ROAD_TOOLING ? `${process.env.ROAD_TOOLING}/package.json` : import.meta.url);
const sharp = require('sharp');
const root = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(`${root}/guides/materials`, { recursive: true });
const project = (x, y) => [768 + 320 * (x - y), 512 + 160 * (x + y)];
const polygon = (points, colour) => `<polygon points="${points.map(p => project(...p).join(',')).join(' ')}" fill="${colour}"/>`;
const plane = polygon([[-1, -1], [1, -1], [1, 1], [-1, 1]], '#d2d2d2');
const guides = {
  'road-strip-x': polygon([[-1.8, -0.25], [1.8, -0.25], [1.8, 0.25], [-1.8, 0.25]], '#d2d2d2'),
  'road-strip-y': polygon([[-0.25, -1.8], [0.25, -1.8], [0.25, 1.8], [-0.25, 1.8]], '#d2d2d2'),
  'crossing-material-regular': plane + [-0.55, 0.55].map(x => polygon([[x - 0.06, -1], [x + 0.06, -1], [x + 0.06, 1], [x - 0.06, 1]], '#a0a0a0')).join(''),
  'crossing-material-narrow': plane,
};
for (const [id, shapes] of Object.entries(guides)) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">${shapes}</svg>`);
  await sharp(svg).png().toFile(`${root}/guides/materials/${id}.png`);
}
console.log('Wrote four material guides; final tile geometry belongs to the fitting script.');
