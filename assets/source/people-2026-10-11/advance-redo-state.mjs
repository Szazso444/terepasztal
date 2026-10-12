import { json, saveJson } from './pose-png.mjs';
const p = json('prompts.json'),
  s = json('redo-state.json'),
  entries = p['redo-2026-10-11'] ?? [];
s.completed = s.order.filter((strip) =>
  ['passed', 'kept with two-phase fallback'].includes(p.redoStrips?.[strip]?.visualCycleReview),
);
s.lastUpdatedAt = new Date().toISOString();
s.status =
  process.argv.slice(2).join(' ') ||
  'Painting resumed; ' + s.completed.length + ' of9strips checked.';
if (entries.some((e) => e.file) && s.toolBlock) {
  s.toolBlockHistory = [...(s.toolBlockHistory ?? []), s.toolBlock];
  delete s.toolBlock;
}
s.poseProgress = s.order.map((strip) => ({
  strip,
  acceptedFrames: [0, 1, 2, 3].filter((frame) =>
    entries.some((e) => e.strip === strip && e.frame === frame && e.accepted),
  ),
  returnedPaintings: entries.filter((e) => e.strip === strip && e.file).length,
  cycleReview: p.redoStrips?.[strip]?.visualCycleReview ?? null,
}));
p.redoStatus.completedStripCount = s.completed.length;
p.redoStatus.status = s.status;
p.redoStatus.paintingCount = entries.filter((e) => e.file).length;
saveJson('redo-state.json', s);
saveJson('prompts.json', p);
console.log(s.status);
