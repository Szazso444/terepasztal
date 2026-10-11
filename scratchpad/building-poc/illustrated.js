import { dimensions } from '../grid-buildings/footprint.mjs';
const manifest = await (await fetch('./sprites/manifest.json')).json();
const images = {};
await Promise.all(
  Object.keys(manifest.frames).map(async (key) => {
    const i = new Image();
    i.src = `./sprites/${key}.png`;
    await i.decode();
    images[key] = i;
  }),
);
export function drawIllustrated(ctx, tiles, rotation, project, anchor, asset) {
  const requested = `${asset || (tiles === 1 ? 'house' : 'station')}-${rotation}`;
  const key = manifest.frames[requested]
      ? requested
      : `${tiles === 1 ? 'house' : 'station'}-${rotation}`,
    f = manifest.frames[key],
    image = images[key];
  const [w, h] = dimensions(tiles, rotation),
    [x, y] = project(anchor[0] + w / 2, anchor[1] + h / 2);
  const scale = (project(1, 0)[0] - project(0, 0)[0]) / 52;
  ctx.drawImage(image, x - f.ax * scale, y - f.ay * scale, f.w * scale, f.h * scale);
}
export const assetManifest = manifest;
