import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root, read, write, json, saveJson, PNG } from './pose-png.mjs';
const p = json('prompts.json'),
  entries = p['redo-2026-10-11'].filter((e) => e.file),
  selected = json('checks/pump-hand-back-walk-candidate.json');
for (const e of entries) {
  const raw = fs.readFileSync(path.join(root, e.file));
  e.rawSha256 = crypto.createHash('sha256').update(raw).digest('hex');
  e.visualReview =
    e.frame === 0 && e.id.endsWith('attempt-2')
      ? 'accepted; box passes'
      : e.measured.boxPass
        ? 'box passes; visual review pending'
        : 'rejected by guide box test';
  if (e.frame === 2 && e.id.endsWith('attempt-1')) e.visualReview += '; repeats f0 contact pose';
  else if (e.frame === 1) e.visualReview += '; lifted left foot visible';
  else if (e.frame === 3) e.visualReview += '; lifted right foot visible';
  else if (e.frame === 2) e.visualReview += '; opposite contact pose visible';
}
const report = {
  completedStrips: 0,
  returnedPaintings: entries.length,
  acceptedFrames: [0],
  firstStrip: 'pump-hand-back-walk',
  exhaustedFrames: [1, 2, 3],
  attemptsPerFrame: [2, 3, 3, 3],
  selectedCandidate: selected.frames.map((e) => e.id),
  candidateOnly: true,
  measurements: selected.frames.map((e) => ({
    frame: Number(e.id.match(/-f(\d)/)[1]),
    widthErrorPercent: e.measured.widthError * 100,
    heightErrorPercent: e.measured.heightError * 100,
    centreDistance: e.measured.centreDistance,
    centreLimit: e.measured.centreLimit,
    boxPass: e.measured.boxPass,
  })),
  visualFindings: {
    oppositeContactThighOverlap: true,
    passingLeftThenRightLiftedFoot: true,
    fullSizeInspected: true,
    native9pxFramesInspected: true,
    playbackVerified: false,
    playbackBlock: 'Browser security policy rejects local file: URLs. No workaround attempted.',
  },
  decisionRequired:
    'May the best pose be retained after3attempts when guide-box measurements fail? No box exception authorized yet.',
  unchanged: ['all28 original source strips', 'inputs/variations/', 'game-scale/', 'review/'],
  next: 'Resolve first-strip acceptance and playback before painting strip2',
};
p.redoStatus.status =
  'First strip inspected; three poses exhausted3attempts and fail5percent box test. Waiting for author decision; no production strip replaced.';
p.redoStatus.diagnosticCandidate = 'checks/pump-hand-back-walk-candidate.html';
p.redoStatus.currentBlock = report.decisionRequired;
saveJson('prompts.json', p);
saveJson('checks/pump-hand-back-walk-redo-report.json', report);
const tiny = read('checks/pump-hand-back-walk-candidate-9px.png'),
  big = new PNG({ width: tiny.width * 6, height: tiny.height * 6 });
for (let y = 0; y < big.height; y++)
  for (let x = 0; x < big.width; x++) {
    const sp = (Math.floor(y / 6) * tiny.width + Math.floor(x / 6)) * 4,
      dp = (y * big.width + x) * 4,
      a = tiny.data[sp + 3] / 255;
    for (let c = 0; c < 3; c++)
      big.data[dp + c] = Math.round(tiny.data[sp + c] * a + [120, 128, 76][c] * (1 - a));
    big.data[dp + 3] = 255;
  }
write('checks/pump-hand-back-walk-candidate-9px-6x.png', big);
console.log(JSON.stringify(report));
