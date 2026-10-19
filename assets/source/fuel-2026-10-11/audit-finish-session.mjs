import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = 'assets/source/fuel-2026-10-11';
const hash = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');
const baseline = 'b26ccab3';
const lines = execFileSync('git', ['ls-tree', '-r', baseline, '--', root], { encoding: 'utf8' })
  .trim()
  .split('\n');
let protectedCount = 0;
for (const line of lines) {
  const [header, path] = line.split('\t');
  if (!path.endsWith('.png')) continue;
  const bytes = readFileSync(path);
  const blob = Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]);
  if (hash(blob, 'sha1') !== header.split(' ')[2])
    throw Error(`Existing painting changed: ${path}`);
  protectedCount++;
}
const p = JSON.parse(readFileSync(`${root}/prompts.json`, 'utf8'));
const attempts = p.attempts.filter(
  (a) => (a.view === 'r2' && a.attempt >= 7) || (a.view === 'r3' && a.attempt >= 15),
);
for (const a of attempts) {
  const metadata = JSON.parse(readFileSync(`${root}/${a.view}-${a.attempt}-metadata.json`, 'utf8'));
  const bytes = readFileSync(`${root}/${a.file}`);
  if (hash(bytes) !== hash(readFileSync(a.source))) throw Error(`Raw copy differs: ${a.file}`);
  if (
    a.prompt !== metadata.prompt ||
    JSON.stringify(a.references) !== JSON.stringify(metadata.references)
  )
    throw Error('Prompt/reference record differs');
  const correctionCount = (a.prompt.match(/Correction:/g) ?? []).length;
  if (correctionCount > 1) throw Error('Too many corrections');
  if (a.view === 'r2') {
    for (const t of [p.verbatim.shared, p.verbatim.views.r2, p.verbatim.age])
      if (!a.prompt.includes(t)) throw Error('Verbatim text missing');
    if (a.references.length !== 4 || !a.references[0].endsWith('guides/fuel_pump-r2.png'))
      throw Error('Wrong r2 references');
  } else if (
    a.references.length !== 2 ||
    !a.references[0].endsWith('raw/fuel_pump-a1-r3-attempt-7.png')
  )
    throw Error('Wrong r3 references');
  const m = a.measured;
  m.testResults = {
    plan: m.planPass,
    height: m.height.pass,
    camera: m.camera.by !== null && m.camera.by <= (a.view === 'r2' ? 2 : 2.5),
    light: m.light.pass,
    crane: m.crane.pass,
    ...(a.view === 'r3' ? { footprint: m.footprint.pass } : {}),
  };
  m.failedTests = Object.entries(m.testResults)
    .filter(([, pass]) => !pass)
    .map(([test]) => test);
  if (m.accepted !== Object.values(m.testResults).every(Boolean))
    throw Error('Acceptance differs from tests');
}
const r0Hash = hash(readFileSync(`${root}/fuel_pump-a1-r0.png`));
if (r0Hash !== 'c2ef828ed902b68daa5ef6849d149eb7bb204abe20706a60a281ac83c6d053f0')
  throw Error('Master hash mismatch');
const r1Identical =
  hash(readFileSync(`${root}/fuel_pump-a1-r1.png`)) ===
  hash(readFileSync(`${root}/raw/fuel_pump-a1-r1-attempt-12.png`));
if (!r1Identical) throw Error('Accepted r1 differs');
p.qa.finish20261019.integrity = {
  baseline,
  protectedPngCount: protectedCount,
  allExistingPngsUnchanged: true,
  allNewRawByteIdentical: true,
  r0Hash,
  r1Attempt12Identical: r1Identical,
  promptsAndOrderedReferencesVerified: true,
};
p.qa.finish20261019.date = '2026-10-19';
p.qa.finish20261019.outcome = 'partial';
p.qa.finish20261019.r3Step1 = {
  attempts: [15, 16, 17],
  passed: false,
  closest: 17,
  reason:
    'Attempt17 passes plan2.628, height range0.393 and camera1.8 degrees, but ground corners moved69-75px down, crane post stays at x493 rather than562, beam crosses tank, hose653/914 misses required box, left light127.053 is8.325 above source.',
};
p.qa.finish20261019.r3Step2 = {
  run: false,
  passed: false,
  widenedHouse: null,
  reason: 'Not run because no S1 passed. No step2 image exists, so step2 did not widen the house.',
};
p.qa.finish20261019.lightBaseline = {
  measured: [118.7276, 117.8576],
  nominalInBrief: [119, 121],
  boxes: [
    [400, 880, 530, 1000],
    [850, 760, 1000, 860],
  ],
  boxesMoved: false,
  note: 'Compared with source attempt7 recomputed by light-check; both actual medians recorded.',
};
p.qa.finish20261019.verification.scopedFormatting =
  'Passed using existing Prettier installation from another worktree; no dependency or configuration changes.';
p.selection.r3Closest = 17;
p.selection.r3Step1 = null;
p.selection.policy =
  '2026-10-19 continuation: all three new r2 attempts7-9 and all three r3 step1 attempts15-17 rejected. Closest9 and17 retained raw only. No S1, no step2. All canonical PNGs unchanged; r1 remains accepted attempt12.';
p.qa.readiness =
  'Partial: r2 not accepted, r3 step1 failed, step2 not run. All original paintings and canonical assets unchanged.';
p.qa.repaint = p.qa.finish20261019;
p.qa.remainingIssues = [
  p.qa.finish20261019.r2.reason,
  p.qa.finish20261019.r3Step1.reason,
  'No S1 passed; step2 not run.',
];
const rows = attempts.map((a) => {
  const m = a.measured;
  const camera =
    m.camera.by === null ? `fail; left slope ${m.camera.slope}` : `${m.camera.by} degrees`;
  return `| ${a.view}${a.view === 'r3' ? ' step1' : ''} / ${a.attempt} | ${m.plan.longToShort.toFixed(3)} | ${m.height.ratio.toFixed(3)} | ${camera} | ${m.light.walls.map((w) => w.median.toFixed(2)).join('/')} | ${m.failedTests.join(', ')} |`;
});
const corners = attempts
  .filter((a) => a.view === 'r3')
  .map(
    (a) =>
      `- Attempt ${a.attempt}: ${Object.entries(a.measured.plan.used)
        .map(([k, v]) => `${k}(${v.map((n) => Math.round(n)).join(',')})`)
        .join(
          ', ',
        )}; width ${a.measured.height.houseWidth}px; jib ${a.measured.crane.horizontalReach}px; hose (${a.measured.crane.hoseEnd.join(',')}).`,
  );
writeFileSync(
  `${root}/result-2026-10-19.md`,
  '# Fuel Pump continuation, 2026-10-19\n\nBranch: art/325-fuel-pump. Built-in imagegen edits requested1024x1024; every output returned1254x1254 and is saved byte-for-byte in raw/. Full exact prompts and ordered reference lists are in prompts.json and each metadata file. No source painting was transformed.\n\nR2 was not accepted. R3 step1 failed. No accepted S1: step2 was not run and therefore did not widen the house. Canonical r0/r1/r2/r3 remain unchanged. R1 is byte-identical to raw attempt12.\n\n| View / attempt | Long/short | Height/width | Camera | Brick luma L/R | Failed tests |\n| --- | ---: | ---: | --- | --- | --- |\n' +
    rows.join('\n') +
    '\n\nR3 source corners: w(381,1009), s(562,1107), e(1057,846), width676.\n\n' +
    corners.join('\n') +
    "\n\nClosest r2 attempt9 is retained raw only: plan and light pass, height0.423 below0.43, lower-left slope0.639, jib235px versus169px short side. Closest r3 attempt17 is retained raw only: plan, height range and camera pass; footprint and crane fail, left light exceeds unchanged-source tolerance by0.3254. Its height remains slightly below source's approximate0.40. No new canonical image was kept.\n\nCrane checks: each r2 has one post/jib at right but an oversized jib(244/259/235px versus short side182/178/169px). Each r3 has one post/jib but the post remains left of the near corner and the beam crosses the tank. R3 hose ends(683,936),(681,916),(653,914) all miss x700-790/y800-880.\n\nR3 light uses unchanged boxes(400,880,530,1000),(850,760,1000,860). Source medians recomputed118.7276/117.8576; nominal brief119/121 also recorded. Every attempt has a grass review and native measurement grid in review/. All grass reviews were visually inspected.\n\nVerification: all original PNGs checked against starting commit b26ccab3; every new raw PNG matches its tool output SHA256. Exact prompts, permitted ordered references and one-Correction maximum verified. Art scope passed. Standard repository typecheck/lint/test/build/format were attempted but unavailable because their local executables are absent. Scoped formatting passes through existing external Prettier.\n",
);
writeFileSync(`${root}/prompts.json`, JSON.stringify(p, null, 2) + '\n');
console.log(JSON.stringify(p.qa.finish20261019.integrity, null, 2));
