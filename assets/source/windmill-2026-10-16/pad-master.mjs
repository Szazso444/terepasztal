import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const master = PNG.sync.read(readFileSync('assets/source/base-v1/windmill.png'));
const out = new PNG({ width: 1576, height: 1050 });
PNG.bitblt(master, out, 0, 0, master.width, master.height, 39, 0);
writeFileSync(new URL('edit-input.png', import.meta.url), PNG.sync.write(out));
