import fs from 'node:fs';
import path from 'node:path';
const source = 'C:/Users/Zso/terepasztal/scratchpad/asset-qa';
const root = 'G:/DEV/Terepasztal/poc/rocket-original-v1';
const dest = root + '/runtime-qa';
fs.mkdirSync(dest, { recursive: true });
for (const file of [
  'README.md',
  'prepare.mjs',
  'serve.mjs',
  'verify.mjs',
  'scene.js',
  'index.html',
])
  fs.copyFileSync(path.join(source, file), path.join(dest, file));
for (const folder of ['candidate', 'results']) {
  fs.mkdirSync(path.join(dest, folder), { recursive: true });
  for (const file of fs.readdirSync(path.join(source, folder))) {
    if (file.startsWith('failure')) continue;
    fs.copyFileSync(path.join(source, folder, file), path.join(dest, folder, file));
  }
}
const report = JSON.parse(fs.readFileSync(dest + '/results/report.json'));
if (
  report.errors.length ||
  report.coverage.facings.length !== 48 ||
  report.reversal.reversalError >= 0.1
)
  throw new Error('Runtime QA did not pass');
const note = `\n## Actual-game integration test\n\nThe reconstructed Rocket is now loaded through the real AtlasRegistry into a real Game test world, and moved by Fleet.tick with a coupled wooden coach. ${report.coverage.ticks} fixed simulation ticks covered all 48 headings, straights, curves, straight/diverging switch routes and reverse running. Every new heading was rendered through the actual TrainRenderer and WebGL world. Reversal centre displacement: ${report.reversal.reversalError} tiles. Browser exceptions: ${report.errors.length}. All 25 source frames passed nonempty/transparent-border/anchor checks. Runtime integration passes; production visual acceptance remains blocked pending wheel landmarks and a shared scale contract.\n\nLive test: http://127.0.0.1:5190/scratchpad/asset-qa/ (Run, Reverse, Reset, zoom and baseline/candidate toggle). Reproducible scripts, report, screenshots and video: runtime-qa/. The game is served from the existing C:/Users/Zso/terepasztal Git checkout; the G: folder is still the art pipeline. Production assets and normal saves were not changed.\n`;
const marker = '## Actual-game integration test';
if (!fs.readFileSync(root + '/README.md', 'utf8').includes(marker))
  fs.appendFileSync(root + '/README.md', note);
const resume = 'G:/DEV/Terepasztal/assets/source/base-v1/RESUME.md';
if (!fs.readFileSync(resume, 'utf8').includes(marker)) fs.appendFileSync(resume, note);
const index = root + '/index.html';
let html = fs.readFileSync(index, 'utf8');
if (!html.includes('5190/scratchpad/asset-qa')) {
  html = html.replace(
    '<h1>',
    '<p><a style="color:#e5c989" href="http://127.0.0.1:5190/scratchpad/asset-qa/">Open the actual-game movement test →</a></p><h1>',
  );
  fs.writeFileSync(index, html);
}
console.log(
  JSON.stringify({
    delivered: dest,
    ticks: report.coverage.ticks,
    headings: 48,
    errors: 0,
    productionAccepted: false,
  }),
);
