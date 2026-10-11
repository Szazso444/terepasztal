import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repo = 'C:/Users/Zso/terepasztal';
const root = 'G:/DEV/Terepasztal';
const briefPath = 'C:/Users/Zso/.codex/attachments/e43d0c2b-5367-4fd0-b80b-66baae2ff647/Pasted text.txt';
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
}
const coverage = JSON.parse(fs.readFileSync(`${repo}/assets/source/base-v1/coverage.json`));
const categories = new Map();
for (const [category, entries] of Object.entries(coverage.categories)) {
  for (const entry of entries) for (const filename of entry.generated ?? []) categories.set(filename, category);
}
const known = new Map();
for (const file of walk(`${repo}/assets/source`).filter(p => /\.png$/i.test(p))) {
  const digest = hash(file);
  const list = known.get(digest) ?? [];
  list.push(file); known.set(digest, list);
}
const inventory = fs.readdirSync(`${root}/Images`).filter(n => /\.png$/i.test(n)).map(name => {
  const source = `${root}/Images/${name}`;
  const sha256 = hash(source);
  const matches = (known.get(sha256) ?? []).sort((a,b) => a.length-b.length);
  const base = matches.find(p => path.dirname(p).replaceAll('\\','/') === `${repo}/assets/source/base-v1`);
  const identified = base ?? matches[0];
  let category = base ? categories.get(path.basename(base)) ?? 'studies' : 'studies';
  if (!identified) category = 'unidentified';
  const filename = identified ? path.basename(identified) : name;
  return { source, sha256, matches, category, filename, destination: `${root}/Images/organized/${category}/${path.parse(filename).name}--${sha256.slice(0,8)}.png` };
});
const brief = fs.readFileSync(briefPath,'utf8');
let category;
const tasks = [];
for (const line of brief.split(/\r?\n/)) {
  if (/^## (Locomotives|Wagons|Bogies|Buildings)$/.test(line)) category = line.slice(3).toLowerCase();
  const match = line.match(/^\| `([^`]+\.png)` \| ([^|]+)\|(?: ([^|]+)\|)?/);
  if (match) tasks.push({ filename: match[1], category, subject: match[2].trim(), notes: match[3]?.trim() ?? '', status: 'pending', destination: `input/${match[1]}` });
}
const report = { root, brief: briefPath, inventory, tasks, summary: { images: inventory.length, identified: inventory.filter(i=>i.matches.length).length, unidentified: inventory.filter(i=>!i.matches.length).length, requested: tasks.length } };
const reportPath = `${repo}/scratchpad/3d-source-library-plan.json`;
fs.writeFileSync(reportPath, JSON.stringify(report,null,2));
if (process.argv.includes('--apply')) {
  for (const item of inventory) {
    fs.mkdirSync(path.dirname(item.destination),{recursive:true});
    if (!fs.existsSync(item.destination)) fs.copyFileSync(item.source,item.destination,fs.constants.COPYFILE_EXCL);
    if (hash(item.destination) !== item.sha256) throw new Error(`Hash mismatch: ${item.destination}`);
  }
  fs.mkdirSync(`${root}/files/input`,{recursive:true});
  fs.mkdirSync(`${root}/assets/source/base-v1`,{recursive:true});
  fs.writeFileSync(`${root}/Images/organized/inventory.json`,JSON.stringify(inventory,null,2));
  if (!fs.existsSync(`${root}/files/image-generation-plan.json`)) fs.writeFileSync(`${root}/files/image-generation-plan.json`,JSON.stringify({tasks},null,2));
  fs.copyFileSync(briefPath,`${root}/files/IMAGE-BRIEF.md`);
  fs.writeFileSync(`${root}/assets/source/base-v1/RESUME.md`, '# Image-to-3D source preparation\n\nThe user selected G:/DEV/Terepasztal and supplied files/IMAGE-BRIEF.md. This supersedes the previous four-facing image-generation task. Generate one studio reference per subject; the pipeline creates the model and directional renders.\n\nOriginal Images/exec-*.png are preserved. Images/organized contains SHA-256 verified copies categorized using exact matches to the old repository; inventory.json records provenance. These legacy studies are references, not accepted new-brief inputs.\n\n63 requested images are tracked in files/image-generation-plan.json. Deliver reviewed images to files/input using exact brief filenames. Record prompts and review status.\n\nThe installed files/assets.csv currently contains only station_victorian and a commented loco_example, not the described roster. Physical dimensions must not be fabricated. The workflow JSON is also absent. Bogies have no dedicated pipeline class. Resolve these before running the 3D pipeline.\n');
}
console.log(JSON.stringify(report.summary));
console.log(JSON.stringify(Object.fromEntries([...new Set(inventory.map(i=>i.category))].map(c=>[c,inventory.filter(i=>i.category===c).length]))));
