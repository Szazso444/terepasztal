import fs from 'node:fs';
import path from 'node:path';
import { root, json, saveJson } from './pose-png.mjs';
const prompts = json('prompts.json');
const state = json('redo-state.json');
const calls = prompts['redo-2026-10-11'];
for (const [strip, record] of Object.entries(prompts.redoStrips ?? {})) {
  const hatRows = record.frames.map(frame => {
    const e = calls.findLast(e => e.strip === strip && e.frame === frame.frame && e.accepted);
    return 480 - (e.measured.soleRow - e.measured.hatTop) * frame.uniformScale;
  });
  record.groundedHatRows = hatRows;
  record.headBobRange = Math.max(...hatRows) - Math.min(...hatRows);
  record.headBobFraction = record.headBobRange / 360;
  record.headBobWithinTwoPercent = record.headBobFraction <= 0.02;
}
saveJson('prompts.json', prompts);
const report = {
  updatedAt: new Date().toISOString(),
  branch: 'art/331-people',
  brief: 'finish-brief-2026-10-12.txt',
  strips: state.order.map(strip => ({
    strip,
    acceptedAttempts: [0, 1, 2, 3].map(frame => {
      const e = calls.findLast(e => e.strip === strip && e.frame === frame && e.accepted);
      return e ? Number(e.id.match(/-attempt-(\d+)$/)[1]) : null;
    }),
    cycleReview: prompts.redoStrips?.[strip]?.visualCycleReview ?? 'not assembled',
    repeatedFrames: prompts.redoStrips?.[strip]?.visualFindings?.repeatedFrames ?? [],
    findings: prompts.redoStrips?.[strip]?.visualFindings?.note ?? null,
    headBobFraction: prompts.redoStrips?.[strip]?.headBobFraction ?? null,
    outputPaletteCheck: prompts.redoStrips?.[strip]?.outputPaletteCheck ?? null,
    rawPaletteExceptionsKept: calls.filter(e => e.strip === strip && e.accepted && e.keptStyleViolations).map(e => ({frame:e.frame,...e.keptStyleViolations})),
    measurementsKeptAfterThree: calls.filter(e => e.strip === strip && e.accepted && e.keptDespiteFailedMeasurements).map(e => e.frame),
  })),
};
saveJson('finish-report.json', report);
const current = '## Current continuation — 2026-10-12\n\n' +
  state.completed.length + '/9 requested strips checked. See finish-report.json for accepted attempts and observations, redo-state.json for progress, and finish-brief-2026-10-12.txt for the current authority. Canonical strips use uniform area averaging and individual measured sole rows. Offline checks are under checks/: <strip>-9px-6x.png and <strip>-36px.png. Carry columns are at least256px; walks expand only when needed. Original inputs, guides, refs, review and game-scale exports are preserved. Historical notes below record earlier rejected attempts and superseded rules.\n\n';
for (const file of ['README.md', 'redo-workflow.md']) {
  const target = path.join(root, file);
  const text = fs.readFileSync(target, 'utf8');
  const historical = text.indexOf('## Historical notes before Core acceptance');
  if (historical < 0) throw Error('Missing historical boundary in ' + file);
  fs.writeFileSync(target, current + text.slice(historical));
}
console.log(JSON.stringify(report));
