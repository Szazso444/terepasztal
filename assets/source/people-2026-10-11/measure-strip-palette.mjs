import { read, json, saveJson } from './pose-png.mjs';
const strip = process.argv[2], prompts = json('prompts.json');
if (!prompts.redoStrips?.[strip]) throw Error('Assemble a requested strip first');
const png = read(strip + '.png');
let white = 0, amber = 0, blank = 0, opaque = 0, edge = 0;
for (let p = 0; p < png.data.length; p += 4) {
  const [r,g,b,a] = png.data.subarray(p,p+4);
  if (a === 0) blank++;
  else if (a === 255) opaque++;
  else edge++;
  if (a > 128) {
    if (r >= 236 && g >= 228 && b >= 208) white++;
    if (r >= 232 && g >= 150 && g <= 190 && b <= 90 && r-b >= 150) amber++;
  }
}
const result = { rgba: true, alphaZeroPixels: blank, opaquePixels: opaque,
  antialiasedPixels: edge, cursorWhitePixels: white, strongAmberPixels: amber };
prompts.redoStrips[strip].outputPaletteCheck = result;
saveJson('prompts.json', prompts);
console.log(JSON.stringify({strip,...result}));
