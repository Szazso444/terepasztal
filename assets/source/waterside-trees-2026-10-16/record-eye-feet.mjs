/**
 * Re-records the three anchors Core's art review of 2026-10-17 read by eye (finish F1), without
 * touching a painting. Run from the repository root:
 *
 *   node assets/source/waterside-trees-2026-10-16/record-eye-feet.mjs
 *
 * For each picture it runs check-tree.mjs with the eye foot and --record (which rewrites the
 * picture's trees.json entry and its checks/<name>-look.png), copies the printed measurement into
 * the selected attempt's `measured` record in prompts.json (verify-set.mjs asserts that the two
 * agree), keeps the automatic measurement it replaces under `automaticMeasurement`, and then runs
 * verify-set.mjs. A second run changes nothing.
 *
 * Why each foot moved:
 * - tree-mangrove-1, tree-mangrove-2: the automatic foot is the back root tip, because the root
 *   ring is about 3.6:1 rather than 2:1, so the anchor sat about 1.9 and 1.6 drawn px too high.
 *   The eye foot is the centre of the root-tip ellipse, under the trunk.
 * - tree-willow-3: the automatic foot is a front root leaning left, so the anchor sat about
 *   2.5 drawn px left of the trunk (x 648 to 657). The eye foot is on the trunk axis.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../../tools/is-main.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '../../..');
const REVIEW = "Core's art review of 2026-10-17 (finish F1)";

/** Picture, kind, drawn height and the foot read by eye, as the review gives them. */
export const EYE_FEET = [
  {
    file: 'tree-mangrove-1.png',
    kind: 'mangrove',
    height: 30,
    foot: [637, 1000],
    reason:
      'The automatic foot is the back root tip: the root ring is about 3.6:1, not 2:1, so the anchor sat about 50 px (1.9 drawn px) too high. The eye foot is the centre of the root-tip ellipse, under the trunk.',
  },
  {
    file: 'tree-mangrove-2.png',
    kind: 'mangrove',
    height: 38,
    foot: [640, 1032],
    reason:
      'The automatic foot is the back root tip: the root ring is flatter than 2:1, so the anchor sat about 37 px (1.6 drawn px) too high. The eye foot is the centre of the root-tip ellipse, under the trunk.',
  },
  {
    file: 'tree-willow-3.png',
    kind: 'willow',
    height: 54,
    foot: [652, 1211],
    reason:
      'The automatic foot is a front root leaning left, about 40 px (2.5 drawn px) left of the trunk, which stands at x 648 to 657. The eye foot is on the trunk axis.',
  },
];

/** The fields check-tree.mjs prints that are not about the picture as a whole. */
const PER_RUN = ['look'];

function check({ file, kind, height, foot }) {
  const out = execFileSync(
    process.execPath,
    [
      join(folder, 'check-tree.mjs'),
      relative(root, join(folder, file)),
      '--kind',
      kind,
      '--height',
      String(height),
      '--foot',
      foot.join(','),
      '--record',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  return JSON.parse(out.trim().split('\n').pop());
}

export function run() {
  const promptsPath = join(folder, 'prompts.json');
  const prompts = JSON.parse(readFileSync(promptsPath, 'utf8'));
  const results = [];
  for (const eye of EYE_FEET) {
    const result = check(eye);
    const selected = prompts.attempts.filter((a) => a.file === eye.file && a.selected);
    if (selected.length !== 1) throw new Error(`${eye.file}: expected one selected attempt`);
    const attempt = selected[0];
    const before = attempt.measured;
    // the automatic measurement, kept the first time only: a second run must not record the eye
    // measurement as the automatic one
    const automatic =
      before.automaticMeasurement ??
      Object.fromEntries(
        Object.entries(before).filter(
          ([k]) => !['footReadByEye', 'footReason', 'lookReview', 'failed'].includes(k),
        ),
      );
    const measured = Object.fromEntries(
      Object.entries(result).filter(([k]) => !PER_RUN.includes(k)),
    );
    attempt.measured = {
      ...measured,
      look: result.look,
      automaticMeasurement: automatic,
      footReadByEye: true,
      footReadBy: REVIEW,
      footReason: eye.reason,
      lookReview: before.lookReview,
      failed: before.failed ?? [],
    };
    results.push({
      file: eye.file,
      foot: result.foot,
      anchor: result.anchor,
      k: result.k,
      drawn: result.drawn,
    });
  }
  writeFileSync(promptsPath, JSON.stringify(prompts, null, 2) + '\n');
  const verified = execFileSync(process.execPath, [join(folder, 'verify-set.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  return { results, verified: JSON.parse(verified.trim().split('\n').pop()) };
}

if (isMain(import.meta.url)) console.log(JSON.stringify(run(), null, 2));
