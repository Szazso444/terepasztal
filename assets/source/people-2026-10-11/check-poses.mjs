import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { root, read, write, json, saveJson, box, resample, PNG } from './pose-png.mjs';
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
  if (png.width * 3 !== png.height * 2) {
    e.measured = {
      ratioPass: false,
      box: actual,
      boxPass: false,
      reason: 'Returned canvas is not2:3; no comparison against the scaled guide.',
    };
    return e.measured;
  }
  const scaled = Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,v*s]));
  // Manual anatomical bounds exclude a carried load above the hat or outside the body.
  // Full silhouette is the conservative default; annotate anatomy after visual inspection when needed.
  const body = e.anatomy?.bodyBox ?? actual;
  const hatTop = e.anatomy?.hatTop ?? actual.y;
  const soleRow = e.anatomy?.soleRow ?? actual.y + actual.height - 1;
  const figureHeight = soleRow - hatTop + 1;
  const heightError = Math.abs(figureHeight / (1152*s) - 1);
  const bodyWidthRatio = body.width / scaled.width;
  if(e.measured && !e.measured.contractVersion) e.legacyMeasured = e.measured;
  e.measured = {contractVersion:'finish-2026-10-12',ratioPass:true,s,box:actual,
    guideBox:scaled, bodyBox:body,hatTop,soleRow,soleOffset:soleRow-1344*s,
    figureHeight,heightError,totalWidth:actual.width,bodyWidthRatio,
    anatomyMethod:e.anatomy?.note ?? 'Full alpha>128 silhouette; no load excluded',
    boxPass:heightError<=0.05 && bodyWidthRatio<=1.25};
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
  if (!Number.isInteger(a) || a < 1 || a > 3)
    throw Error('At most three new painting attempts per pose');
  e.file = 'raw/poses/' + id + '.png';
  fs.mkdirSync(path.join(root, 'raw', 'poses'), { recursive: true });
  if (fs.existsSync(path.join(root, e.file))) throw Error('Raw painting already exists');
  fs.copyFileSync(source, path.join(root, e.file));
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
  const e=entry(); e.anatomy=JSON.parse(args.join(' ')); measure(e); save(); console.log(JSON.stringify(e.measured));
} else if (command === 'measure') {
  const e = entry();
  measure(e);
  save();
  console.log(JSON.stringify(e.measured));
} else if (command === 'accept') {
  const e = entry();
  measure(e);
  const exhausted=calls.filter(p=>p.strip===e.strip&&p.frame===e.frame&&p.file).length>=3;
  if (!e.measured.boxPass && !(args.includes('--keep-best') && exhausted)) throw Error('Retry measurements, or keep best after three paintings');
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
    normalized.push(resample(p, 320, 480, 320 / p.width, [0, 0], [0, 0]));
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
    lowerBodyContactIoU: intersect / union,
    contactOverlay: 'checks/' + id + '-contact-overlay.png',
    passingBoxes: [left, right],
    requiresVisualChecks: [
      'f0/f2 opposite thigh overlap X',
      'f1/f3 opposite lifted foot',
      'play 9px four-frame sequence',
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
  if (option('inspected') !== 'yes')
    throw Error('Inspect the offline 9px and 36px sheets first');
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
} else throw Error('Commands: record, error, measure, accept, backup, compare, cycle, status');
