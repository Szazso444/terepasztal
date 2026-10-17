import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { root, read, write, json, saveJson, box, resample, PNG } from './pose-png.mjs';
import { contactOverlap } from './contact-overlap.mjs';
const [command, id, ...args] = process.argv.slice(2),
  geometry = json('pose-geometry.json');
const prompts = json('prompts.json');
const calls = (prompts['redo-2026-10-11'] ??= []);
function entry() {
  const e = calls.findLast((e) => e.id === id && e.file);
  if (!e) throw Error('Unknown painting call ' + id);
  return e;
}
function save() {
  prompts['redo-2026-10-11'] = calls;
  saveJson('prompts.json', prompts);
}
function measure(e) {
  const png = read(e.file),
    s = png.width / 1024,
    expected = geometry.strips[e.strip].frames[e.frame].box,
    actual = box(png);
  e.returned = [png.width, png.height];
  const scaled = Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v * s]));
  // Manual anatomical bounds exclude a carried load above the hat or outside the body.
  // Full silhouette is the conservative default; annotate anatomy after visual inspection when needed.
  const body = e.anatomy?.bodyBox ?? actual;
  const hatTop = e.anatomy?.hatTop ?? actual.y;
  const soleRow = e.anatomy?.soleRow ?? actual.y + actual.height - 1;
  const figureHeight = soleRow - hatTop + 1;
  const heightError = Math.abs(figureHeight / (1152 * s) - 1);
  const bodyWidthRatio = body.width / scaled.width;
  if (e.measured && !e.measured.contractVersion) e.legacyMeasured = e.measured;
  e.measured = {
    contractVersion: 'finish-2026-10-12',
    ratioPass: png.width * 3 === png.height * 2,
    s,
    box: actual,
    guideBox: scaled,
    bodyBox: body,
    hatTop,
    soleRow,
    soleOffset: soleRow - 1344 * s,
    figureHeight,
    heightError,
    totalWidth: actual.width,
    bodyWidthRatio,
    anatomyMethod: e.anatomy?.note ?? 'Full alpha>128 silhouette; no load excluded',
    boxPass: png.width * 3 === png.height * 2 && heightError <= 0.05 && bodyWidthRatio <= 1.25,
  };
  if (e.repeatTest) {
    e.measured.repeatIoU = e.repeatTest.iou;
    e.measured.repeatPass = e.repeatTest.pass;
  }
  return e.measured;
}
if (command === 'record') {
  const fromIndex = args.indexOf('--from'),
    source = args[fromIndex + 1];
  if (fromIndex < 0 || !source) throw Error('record <call-id> --from <returned-png>');
  if (calls.some((e) => e.id === id && e.file))
    throw Error('Painting already recorded; paintings are never overwritten');
  const e = json('calls/' + id + '.json'),
    a = Number(id.match(/-attempt-(\d+)$/)?.[1]);
  const correction =
    e.strip === 'pump-hand-front-carry' &&
    e.frame === 2 &&
    e.revision === '2026-10-17-left-foot' &&
    a >= 4 &&
    a <= 6;
  if (!Number.isInteger(a) || a < 1 || (a > 3 && !correction))
    throw Error('At most three new painting attempts per pose');
  e.file = 'raw/poses/' + id + '.png';
  fs.mkdirSync(path.join(root, 'raw', 'poses'), { recursive: true });
  if (fs.existsSync(path.join(root, e.file))) throw Error('Raw painting already exists');
  fs.copyFileSync(source, path.join(root, e.file));
  e.rawSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, e.file)))
    .digest('hex');
  calls.push(e);
  measure(e);
  save();
  console.log(JSON.stringify({ id: e.id, returned: e.returned, measured: e.measured }));
} else if (command === 'error') {
  if (calls.some((e) => e.id === id && e.file)) throw Error('Painting already recorded');
  const e = json('calls/' + id + '.json');
  Object.assign(e, {
    file: null,
    returned: null,
    measured: { boxPass: false, toolError: args.join(' ') },
    toolRejected: true,
  });
  calls.push(e);
  save();
  console.log('Recorded tool rejection; no painting returned.');
} else if (command === 'anatomy') {
  const e = entry();
  e.anatomy = JSON.parse(args.join(' '));
  measure(e);
  save();
  console.log(JSON.stringify(e.measured));
} else if (command === 'measure') {
  const e = entry();
  measure(e);
  save();
  console.log(JSON.stringify(e.measured));
} else if (command === 'accept') {
  const e = entry();
  measure(e);
  if (e.revision === '2026-10-17-left-foot') {
    if (
      !e.repeatTest?.pass ||
      args.includes('--keep-best') ||
      !args.includes('--opposite-contact') ||
      args[args.indexOf('--opposite-contact') + 1] !== 'yes' ||
      !args.includes('--identity-match') ||
      args[args.indexOf('--identity-match') + 1] !== 'yes'
    )
      throw Error(
        'Correction requires IoU<0.45, opposite contact and f3 identity; no keep-best override',
      );
    const f3 = calls.findLast((p) => p.strip === e.strip && p.frame === 3 && p.accepted);
    const heightDelta = Math.abs(
      e.measured.figureHeight / e.measured.s - f3.measured.figureHeight / f3.measured.s,
    );
    if (heightDelta > 1152 * 0.02)
      throw Error('Grounded cap height differs from f3 by more than2%');
    e.correctionVisualReview = {
      oppositeContact: true,
      identityMatchesF3: true,
      groundedHatDelta: heightDelta,
      maxDelta: 1152 * 0.02,
    };
  }
  const exhausted =
    calls.filter((p) => p.strip === e.strip && p.frame === e.frame && p.file).length >= 3;
  if (!e.measured.boxPass && !(args.includes('--keep-best') && exhausted))
    throw Error('Retry measurements, or keep best after three paintings');
  e.keptDespiteFailedMeasurements = !e.measured.boxPass;
  const noteAt = args.indexOf('--note'),
    note = args[noteAt + 1];
  if (noteAt < 0 || !note) throw Error('Visual acceptance note required');
  const target = 'poses/' + e.strip + '-f' + e.frame + '.png';
  fs.mkdirSync(path.join(root, 'poses'), { recursive: true });
  if (fs.existsSync(path.join(root, target))) {
    const previous = calls.findLast(
      (p) => p.strip === e.strip && p.frame === e.frame && p.accepted,
    );
    if (
      !previous?.file ||
      !fs
        .readFileSync(path.join(root, target))
        .equals(fs.readFileSync(path.join(root, previous.file)))
    )
      throw Error('Earlier accepted painting has no matching raw backup');
    previous.accepted = false;
    previous.supersededBy = e.id;
  }
  fs.copyFileSync(path.join(root, e.file), path.join(root, target));
  e.accepted = true;
  e.visualNote = note;
  e.acceptedFile = target;
  save();
  console.log('Accepted ' + target);
} else if (command === 'repeat') {
  const e = entry();
  measure(e);
  const f0 = calls.findLast((p) => p.strip === e.strip && p.frame === 0 && p.accepted);
  if (!f0) throw Error('Missing accepted f0');
  e.repeatTest = contactOverlap(read(f0.acceptedFile), read(e.file), f0.measured, e.measured);
  e.measured.repeatIoU = e.repeatTest.iou;
  e.measured.repeatPass = e.repeatTest.pass;
  const overlay = new PNG({ width: 640, height: 512 });
  const layers = [f0, e].map((p) => {
    const png = read(p.acceptedFile && p === f0 ? p.acceptedFile : p.file);
    return resample(
      png,
      640,
      512,
      0.3125 / p.measured.s,
      [png.width / 2, p.measured.soleRow],
      [320, 480],
      { cleanAlpha: false },
    );
  });
  for (let p = 0; p < overlay.data.length; p += 4) {
    const a = layers[0].data[p + 3] / 510,
      b = layers[1].data[p + 3] / 255;
    const alpha = a + b * (1 - a);
    if (alpha)
      for (let n = 0; n < 3; n++)
        overlay.data[p + n] = Math.round(
          (layers[0].data[p + n] * a + layers[1].data[p + n] * b * (1 - a)) / alpha,
        );
    overlay.data[p + 3] = Math.round(alpha * 255);
  }
  const file = 'checks/' + e.id + '-f0-overlay.png';
  write(file, overlay);
  e.repeatTest.overlay = file;
  saveJson('checks/' + e.id + '-repeat.json', e.repeatTest);
  save();
  console.log(JSON.stringify(e.repeatTest));
} else if (command === 'backup') {
  if (!geometry.strips[id]) throw Error('Strip outside redo scope');
  const target = 'raw/' + id + '-attempt-1.png';
  fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
  if (!fs.existsSync(path.join(root, target)))
    fs.copyFileSync(path.join(root, id + '.png'), path.join(root, target));
  const digest = (p) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, p)))
      .digest('hex');
  console.log(
    JSON.stringify({
      file: target,
      sha256: digest(target),
      matchesCurrent: digest(target) === digest(id + '.png'),
    }),
  );
} else if (command === 'compare') {
  const strip = geometry.strips[id];
  if (!strip) throw Error('Strip outside redo scope');
  const normalized = [];
  for (let k = 0; k < 4; k++) {
    const p = read('poses/' + id + '-f' + k + '.png'),
      s = p.width / 1024;
    const accepted = calls.findLast((e) => e.strip === id && e.frame === k && e.accepted);
    normalized.push(
      resample(p, 320, 480, 320 / p.width, [512 * s, accepted.measured.soleRow], [160, 420]),
    );
  }
  const overlay = new PNG({ width: 320, height: 480 });
  let intersect = 0,
    union = 0;
  for (let p = 0; p < overlay.data.length; p += 4) {
    const f0 = normalized[0].data,
      f2 = normalized[2].data,
      a0 = f0[p + 3] / 510,
      a2 = f2[p + 3] / 255,
      alpha = a0 + a2 * (1 - a0);
    if (alpha) {
      for (let n = 0; n < 3; n++)
        overlay.data[p + n] = Math.round((f0[p + n] * a0 + f2[p + n] * a2 * (1 - a0)) / alpha);
      overlay.data[p + 3] = Math.round(alpha * 255);
    }
    if (Math.floor(p / 4 / 320) > 245) {
      const a = f0[p + 3] > 128,
        b = f2[p + 3] > 128;
      if (a || b) union++;
      if (a && b) intersect++;
    }
  }
  write('checks/' + id + '-contact-overlay.png', overlay);
  const [left, right] = [1, 3].map((k) => box(normalized[k]));
  const report = {
    alignment: 'Each portrait body x=512*s and measured sole row aligned to (160,420)',
    lowerBodyContactIoU: intersect / union,
    contactOverlay: 'checks/' + id + '-contact-overlay.png',
    passingBoxes: [left, right],
    requiresVisualChecks: [
      'f0/f2 opposite thigh overlap X',
      'f1/f3 opposite lifted foot',
      'inspect offline 9px-6x and 36px four-frame sheets',
    ],
  };
  saveJson('checks/' + id + '-pose-report.json', report);
  console.log(JSON.stringify(report));
} else if (command === 'cycle') {
  const record = prompts.redoStrips?.[id];
  if (!record) throw Error('Assemble the strip first');
  const option = (name) => {
    const index = args.indexOf('--' + name);
    return index < 0 ? undefined : args[index + 1];
  };
  if (option('inspected') !== 'yes') throw Error('Inspect the offline 9px and 36px sheets first');
  const contact = option('contact-x'),
    passing = option('passing-alternates'),
    note = option('note');
  if (!['yes', 'no'].includes(contact) || !['yes', 'no'].includes(passing) || !note)
    throw Error(
      'cycle <strip> --contact-x yes|no --passing-alternates yes|no --inspected yes --note <visual findings>',
    );
  for (const [answer, pair] of [
    [contact, [0, 2]],
    [passing, [1, 3]],
  ])
    if (
      answer === 'no' &&
      !pair.some(
        (frame) => calls.filter((e) => e.strip === id && e.frame === frame && e.file).length >= 3,
      )
    )
      throw Error('Keep a repeated pose only after three new painting attempts');
  record.visualCycleReview =
    contact === 'yes' && passing === 'yes' ? 'passed' : 'kept with two-phase fallback';
  record.visualFindings = {
    contactX: contact === 'yes',
    oppositeLiftedFoot: passing === 'yes',
    offline9pxAnd36pxInspected: true,
    browserPlayback: false,
    repeatedFrames: (option('repeated-frames') ?? '').split(',').filter(Boolean),
    note,
  };
  save();
  console.log(JSON.stringify(record.visualFindings));
} else if (command === 'status') {
  console.log(
    JSON.stringify(
      Object.keys(geometry.strips).map((strip) => ({
        strip,
        accepted: [0, 1, 2, 3].filter((frame) =>
          calls.some((e) => e.strip === strip && e.frame === frame && e.accepted),
        ),
        paintingAttempts: calls.filter((e) => e.strip === strip && e.file).length,
        toolRejections: calls.filter((e) => e.strip === strip && e.toolRejected).length,
      })),
    ),
  );
} else
  throw Error('Commands: record, error, measure, accept, repeat, backup, compare, cycle, status');
