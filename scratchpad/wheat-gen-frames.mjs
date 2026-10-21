// The generator's props atlas, run headless: bundles src/art/props.ts with esbuild, stubs the two
// browser classes AtlasBuilder needs (ImageData and a canvas that keeps putImageData's pixels), and
// hands back every frame as { w, h, ax, ay, data } so a contact sheet can be drawn without a browser.
//   import { generatorFrames } from './wheat-gen-frames.mjs'
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function generatorFrames(prefix = 'props/') {
  const entry = fileURLToPath(new URL('../src/art/props.ts', import.meta.url));
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'error',
    // atlas.ts imports pixi.js for its loader; the builder this needs does not touch it
    plugins: [
      {
        name: 'no-pixi',
        setup(b) {
          b.onResolve({ filter: /^pixi\.js$/ }, () => ({ path: 'pixi', namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents:
              'export const Texture = class {}, ImageSource = class {}, Rectangle = class {};',
          }));
        },
      },
    ],
  });
  const code = out.outputFiles[0].text;
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  class FakeImageData {
    constructor(a, b, c) {
      if (typeof a === 'number') {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      } else {
        this.data = a;
        this.width = b;
        this.height = c;
      }
    }
  }
  globalThis.ImageData = FakeImageData;
  globalThis.document = {
    createElement: () => {
      const c = {
        width: 0,
        height: 0,
        pixels: null,
        getContext() {
          return {
            putImageData: (img, x, y) => {
              c.pixels ??= new Uint8ClampedArray(c.width * c.height * 4);
              for (let yy = 0; yy < img.height; yy++)
                c.pixels.set(
                  img.data.subarray(yy * img.width * 4, (yy + 1) * img.width * 4),
                  ((y + yy) * c.width + x) * 4,
                );
            },
          };
        },
      };
      return c;
    },
  };
  try {
    const mod = await import(url);
    const atlas = mod.generatePropsAtlas();
    const frames = {};
    for (const [key, f] of Object.entries(atlas.frames)) {
      if (!key.startsWith(prefix)) continue;
      const data = new Uint8ClampedArray(f.w * f.h * 4);
      for (let y = 0; y < f.h; y++) {
        const from = ((f.y + y) * atlas.image.width + f.x) * 4;
        data.set(atlas.image.pixels.subarray(from, from + f.w * 4), y * f.w * 4);
      }
      frames[key] = { w: f.w, h: f.h, ax: f.ax, ay: f.ay, data };
    }
    return frames;
  } finally {
    delete globalThis.ImageData;
    delete globalThis.document;
  }
}
