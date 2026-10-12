import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { root, json, saveJson } from './pose-png.mjs';
const strips = Object.keys(json('pose-geometry.json').strips);
const hash = (p) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, p)))
    .digest('hex');
const statePath = path.join(root, 'redo-state.json');
function files(directory) {
  return fs
    .readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? files(directory + '/' + e.name) : [directory + '/' + e.name],
    );
}
if (process.argv[2] === 'init') {
  if (fs.existsSync(statePath))
    throw Error('Protection snapshot already exists; never replace its baseline');
  const protectedFiles = [
    ...files('inputs/variations'),
    ...files('review'),
    ...files('game-scale'),
    ...fs
      .readdirSync(root)
      .filter(
        (p) => /-(front|back)-(walk|carry)\.png$/.test(p) && !strips.some((s) => p === s + '.png'),
      ),
  ];
  const protectedHashes = Object.fromEntries(protectedFiles.map((p) => [p, hash(p)]));
  const originalStripHashes = Object.fromEntries(strips.map((s) => [s + '.png', hash(s + '.png')]));
  for (const strip of strips) {
    const raw = 'raw/' + strip + '-attempt-1.png';
    fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
    if (!fs.existsSync(path.join(root, raw)))
      fs.copyFileSync(path.join(root, strip + '.png'), path.join(root, raw));
    if (hash(raw) !== originalStripHashes[strip + '.png'])
      throw Error('Earlier strip backup mismatch: ' + strip);
  }
  saveJson('redo-state.json', {
    date: '2026-10-11',
    baseCommit: '3f5a4f7f',
    status:
      'Preparation complete; first painting call rejected by image-generation usage limit.0of9strips repainted.',
    order: strips,
    completed: [],
    firstStripGate:
      'pump-hand-back-walk must be fully checked and committed before painting strip2',
    toolBlock: {
      type: 'usage_limit_reached',
      resetsAtUnix: 1791831558,
      resetsAtToronto: '2026-10-12T14:59:18-04:00',
    },
    originalStripHashes,
    protectedHashes,
  });
  console.log(
    'Saved byte-identical backups for9strips and protection hashes for' +
      protectedFiles.length +
      'unchanged files.',
  );
} else if (process.argv[2] === 'check') {
  const state = json('redo-state.json');
  for (const [p, h] of Object.entries(state.protectedHashes))
    if (hash(p) !== h) throw Error('Protected file changed: ' + p);
  for (const [p, h] of Object.entries(state.originalStripHashes))
    if (hash('raw/' + p.replace('.png', '-attempt-1.png')) !== h)
      throw Error('Original strip backup changed: ' + p);
  console.log('All protected files and all9 original strip backups match their recorded bytes.');
} else throw Error('Use init once, then check before every strip commit');
