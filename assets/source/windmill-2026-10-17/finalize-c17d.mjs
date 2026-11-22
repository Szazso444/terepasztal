import fs from 'node:fs';
import crypto from 'node:crypto';
const p = 'assets/source/windmill-2026-10-17/';
const q = JSON.parse(fs.readFileSync(p + 'prompts.json'));
if (!q.some((r) => r.view === 2 && r.attempt === 3)) {
  const e = JSON.parse(fs.readFileSync(p + 'raw/r2-attempt-3-entry.json'));
  e.numbers = JSON.parse(fs.readFileSync(p + e.numbers));
  q.push(e);
}
const r0 = fs.readFileSync(p + 'windmill-a0-r0.png');
if (!r0.equals(fs.readFileSync(p + 'raw/windmill-a0-r0-attempt-3.png'))) throw Error('r0 changed');
const selected = { 3: 3, 1: 2, 2: 3 };
for (const v of [3, 1, 2]) {
  for (const e of q.filter((r) => r.view === v)) {
    e.numbers = JSON.parse(fs.readFileSync(p + `raw/r${v}-attempt-${e.attempt}-numbers.json`));
    e.kept = false;
    e.closest = e.attempt === selected[v];
    e.sha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(p + e.file))
      .digest('hex');
  }
  const e = q.find((r) => r.view === v && r.attempt === selected[v]);
  const n = e.numbers;
  if (v === 2) fs.copyFileSync(p + e.file, p + 'windmill-a0-r2.png');
  if (!fs.readFileSync(p + e.file).equals(fs.readFileSync(p + `windmill-a0-r${v}.png`)))
    throw Error('kept byte comparison failed');
  fs.writeFileSync(
    p + `hub-r${v}.json`,
    JSON.stringify(
      {
        view: v,
        picture: `windmill-a0-r${v}.png`,
        size: n.returned,
        box: n.box,
        footCentre: n.footCentre,
        footWidth: n.footWidth,
        footWidthR0: 415,
        hub: n.eye.hub,
        hubFromAnchorWorld: n.hubFromAnchorWorld,
        hubTarget: n.hubTarget,
        stubSlope: n.stubSlope,
        door: n.eye.door,
        apexTip: n.eye.apexTip,
        numbers: n,
        kept: false,
        closestAttempt: selected[v],
        failed: e.failed,
      },
      null,
      2,
    ) + '\n',
  );
}
fs.writeFileSync(p + 'prompts.json', JSON.stringify(q, null, 2) + '\n');
const rows = q
  .filter((r) => [1, 2, 3].includes(r.view))
  .map((e) => {
    const n = e.numbers,
      r = (v) => (typeof v === 'number' ? v.toFixed(4) : v);
    return `| r${e.view} | ${e.attempt} | ${n.returned.join(' x ')} | ${n.camera.ratio} / ${n.camera.by} | ${n.footCentre.map(r).join(', ')} | ${n.footWidth} / 415 | ${r(n.apexOverW)} | ${r(n.stubSlope)} | ${n.hubOffset.map(r).join(', ')} / ${r(n.hubDistance)} | ${n.doorPosition === null ? 'none' : r(n.doorPosition) + ' / ' + r(n.doorHeight)} | ${n.pixels.timber} / ${n.pixels.white} / ${n.pixels.amber} | ${e.closest ? 'closest, kept:false' : 'refused'} |`;
  });
const report = `# Windmill C17d — second queue run\n\nStep 0 adopted r0 attempt 3 accepted by Core review 1. Commit 9f336757a4ffaf9b4c9b503b52406641d959c477 changes only prompts.json. r0 PNG remains byte-identical to its raw attempt and r0 hub.json was not edited. r0 was never repainted.\n\nCompleted all three requested views, r3 then r1 then r2, using all 9 allowed calls (three per view). No new view passes every test. Closest r3#3, r1#2 and r2#3 are copied byte-for-byte to their view files and explicitly kept:false. No conditional stop fired: the best camera error per view is .4, .7 and .6 degrees, all below the >3 degree stop. No tenth call was made.\n\n| View | Attempt | Returned | Foot ratio / degrees off | Foot centre | W / r0 W | Cone tip / W | Stub slope | Hub offset / distance (game px) | Door position / height | Timber / white / amber | Decision |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nThe scaled guide foot centre is (627,979.6875), with tolerance14.6953125 returned px on both axes for1254 square returns. r3#1 fails foot position, door and timber; r3#2 fails door and timber; closest r3#3 passes all geometry but timber160>25. r1#1 fails hub and timber, with camera2.5 degrees; r1#2 fixes hub/timber but foot centreyc954.5 fails position, so its2.1-degree camera cannot be a near keeper; r1#3 fixes camera but footyc1014.25 and hub3.4689 game px fail. Closest r1#2 minimizes the remaining misses. r2#1 fails foot position, stub slope and timber; r2#2 fixes stub but foot position and timber fail; closest r2#3 fixes those but hub2.6453 game px exceeds2.\n\nEvery attempt carries a nonzero near-white count, which is waived only if it is the sole miss; none qualifies. Amber is zero in all9. checkFile is called as a library; its camera-only problems on r1#1 and#2 are preserved in the records. No global building report or queue tool was run.\n\nBy eye all returns are plain round smooth limestone towers with slate cones and plain tips, upper-left light, no sails, stocks, lattice, plinth, ground or loose objects. r3 alone has the door and narrow window on the lower-right face; r1/r2 have plain visible walls and the complete hub above the cap's far shoulder, with shaft roots hidden behind the cap. Door/window absence and whole unobscured plates are recorded by eye; coordinate readings and exact prompts are in prompts.json and raw/r*-attempt-*-eye.json. r2#1 stub inspection crop is a separate diagnostic, never a returned/kept painting.\n\nThe amended timber test excludes points at Euclidean distance<=3 from the opaque silhouette edge, within6 returned px of the read door box, and within60 returned px of the read hub centre. Rechecking accepted r0 with those explicit coordinate/mask choices gives18 vs Core's15; both pass25. Its old raw measurements and first-run report remain unchanged. The r3#1 count initially read385 before defining the edge from boundary pixels rather than background pixels; final count384 is recorded, while its already-sent Correction retains385 verbatim.\n\nAll raw returned PNGs are unmodified; their SHA256 values are in prompts.json. All kept copies compare byte-identically. Built-in imagegen used the exact required guide/board/shipped-windmill/accepted-r0 reference order on every call; no failed attempt or other turned view was attached. The tool saved autonomously to C: and bytes were copied to G: while leaving originals alone as the queue README directs. Every authored file and temp/cache stayed on G:.\n\nHub paths: hub-r3.json, hub-r1.json, hub-r2.json. All three describe closest refused pictures, not accepted art.\n`;
fs.writeFileSync(p + 'REPORT-C17d.md', report);
console.log('All nine raw records finalized; three kept copies byte-identical; r0 unchanged.');
