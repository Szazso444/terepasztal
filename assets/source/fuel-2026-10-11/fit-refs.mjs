import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { fitPicture, normalisePicture } from '../../../tools/building-fit.mjs';

const [file, rotation, destination] = process.argv.slice(2);
if (!file || !/^[0-3]$/.test(rotation) || !destination) {
  throw new Error('Usage: node fit-refs.mjs <picture> <rotation> <destination>');
}
const png = PNG.sync.read(readFileSync(file));
const fit = fitPicture(png, 't1', Number(rotation), { fully: true });
if (!fit) throw new Error('Cannot fit an empty picture');
mkdirSync(dirname(resolve(destination)), { recursive: true });
writeFileSync(destination, PNG.sync.write(normalisePicture(png, fit, 't1')));
console.log(destination);
