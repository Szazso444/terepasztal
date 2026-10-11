// Trains driving over raised bridges with the simulation stepping: a long engine with coaches
// over the ramp to height 4 and back, and through a curve carried by platforms at height 2.
// Checks every frame that a vehicle is drawn either whole or in slices that add up to it, and
// that nothing throws; shoots a film strip to look at.
//   node scratchpad/bridges/decks-run.mjs [label=after] [axis=x]
import { launch } from '../runtime.mjs';
import { mkdirSync } from 'node:fs';
const [label = 'after', axis = 'x'] = process.argv.slice(2);
const out = `scratchpad/bridges/renders-${label}/`;
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push('console: ' + m.text()));
await page.goto(`http://127.0.0.1:5183/scratchpad/bridges/decks.html?axis=${axis}`);
await page.waitForFunction(() => window.qa, null, { timeout: 240000 });

/** What the train renderer holds for every vehicle: whole sprites or slices, never both. */
const audit = () =>
  page.evaluate(() => {
    const r = qa.g.trainRenderer,
      out = { vehicles: 0, sliced: 0, whole: 0, bad: [] };
    for (const [id, cars] of r.cars)
      cars.forEach((c, i) => {
        out.vehicles++;
        const body = c.parts[0],
          shown = c.slices.filter((s) => s.visible);
        if (!body.visible) return;
        if (!body.renderable) {
          out.sliced++;
          // The slices of the body add up to its width, side by side.
          const mine = shown.filter((s) => s.texture.source === body.texture.source && s.label === body.label && Math.abs(s.texture.frame.y - body.texture.frame.y) < 1e-6 && s.texture.frame.x >= body.texture.frame.x - 1e-6 && s.texture.frame.x + s.texture.frame.width <= body.texture.frame.x + body.texture.frame.width + 1e-6);
          const width = mine.reduce((a, s) => a + s.texture.frame.width, 0);
          if (!shown.length) out.bad.push(`${id}/${i}: hidden body without slices`);
          if (c.parts.length === 1 && !c.bogies.length && !c.load?.visible && Math.abs(width - body.texture.frame.width) > 0.01)
            out.bad.push(`${id}/${i}: slices cover ${width} of ${body.texture.frame.width}`);
        } else {
          out.whole++;
          if (shown.length) out.bad.push(`${id}/${i}: drawn whole and in ${shown.length} slices`);
        }
      });
    return out;
  });

// ---- 1. the ramp: approach track on both sides, then a long engine with three coaches across.
// (The timber bridge carries 180 t: an articulated engine of three bodies instead of the Big Boy.)
for (const [id, loco] of [
  ['RAMP-stone', 'big_boy'],
  ['RAMP-wood', 'crocodile'],
]) {
  const setup = await page.evaluate(([id, loco]) => {
    const s = qa.sites.find((s) => s.id === id),
      g = qa.g,
      laid = [];
    // More approach track in front of and behind the site, laid as the scene lays it.
    for (const i of [-7, -6, -5, -4, -3, -2, -1, 15, 16, 17]) {
      const t = qa.T(s.l0 + i, s.w0);
      for (const r of [0, 1]) {
        if (g.track.has(t.x, t.y)) break;
        if (!g.builder.placeTrackKind(t.x, t.y, 'straight', r)) continue;
        const link = g.track.get(t.x, t.y).links[0],
          want = qa.axis === 'x' ? [1, 3] : [0, 2];
        if (want.every((d) => link.includes(d))) break;
        g.builder.removeTrack(t.x, t.y);
      }
      laid.push(g.track.has(t.x, t.y));
    }
    qa.clearTrains();
    const head = qa.T(s.l0 - 1, s.w0),
      target = qa.T(s.l0 + 17, s.w0);
    return { laid, train: qa.runTrain(loco, ['wooden_coach', 'steel_coach', 'wooden_coach'], head, qa.axis === 'x' ? 3 : 0, target) };
  }, [id, loco]);
  console.log(id, 'setup', JSON.stringify(setup));
  await page.evaluate(() => qa.settle());
  let frames = 0,
    slicedFrames = 0,
    bad = [];
  for (let k = 0; k < 60; k++) {
    const pos = await page.evaluate(
      ([id, text, k]) => {
        const s = qa.sites.find((s) => s.id === id),
          g = qa.g;
        qa.advance(20);
        const t = g.fleet.trains[0],
          p = t?.poses[0];
        if (!p) return null;
        const along = qa.axis === 'x' ? p.x : p.y,
          at = qa.T(Math.min(s.l0 + 13, Math.max(s.l0 + 1, along - 2)), s.w0 + 0.5);
        qa.view(at.x, at.y, 4, `${text} · frame ${k} · head at ${(along - s.l0).toFixed(2)} · ${t.state}`);
        return { along: along - s.l0, state: t.state, speed: t.speed };
      },
      [id, `${label} · ${axis} · ${id} · big engine and three coaches driving`, k],
    );
    if (!pos) break;
    const a = await audit();
    frames++;
    if (a.sliced) slicedFrames++;
    bad.push(...a.bad);
    if ([6, 12, 18, 24, 30, 36, 42].includes(k)) {
      await page.screenshot({ path: `${out}run-${axis}-${id}-${String(k).padStart(2, '0')}.png` });
      console.log('CAPTURED', `run-${axis}-${id}-${k}`, JSON.stringify(pos), JSON.stringify({ sliced: a.sliced, whole: a.whole }));
    }
    if (pos.state !== 'moving' && k > 5) break;
  }
  console.log(id, 'frames', frames, 'with slices', slicedFrames, 'bad', JSON.stringify([...new Set(bad)].slice(0, 6)));
}

// ---- 2. a curve carried by platforms at height 2: vehicles stand askew there and are drawn whole.
for (const [id, loco] of [
  ['CURVE2-stone', 'mav424'],
  ['CURVE2-wood', 'crocodile'],
  ['SWITCH2-stone', 'big_boy'],
]) {
  const setup = await page.evaluate(([id, loco]) => {
    const p = qa.pads.find((p) => p.id === id),
      g = qa.g,
      w = g.map.w,
      inside = new Set(p.footprint.map((t) => t.y * w + t.x));
    // The two ends of the track through the pad: walk out from the footprint along straights.
    const ends = [];
    for (const t of p.footprint)
      for (const link of g.track.get(t.x, t.y)?.links ?? [])
        for (const d of link) {
          let x = t.x + [0, 1, 0, -1][d],
            y = t.y + [-1, 0, 1, 0][d];
          if (inside.has(y * w + x) || !g.track.has(x, y)) continue;
          let n = 0;
          // Lay on past the end of the approach, so a long train has room.
          for (; n < 14; n++) {
            if (!g.track.has(x, y) && !g.builder.placeTrackKind(x, y, 'straight', d % 2 === 0 ? 0 : 1)) break;
            x += [0, 1, 0, -1][d];
            y += [-1, 0, 1, 0][d];
          }
          ends.push({ x: x - [0, 1, 0, -1][d], y: y - [-1, 0, 1, 0][d], d, n });
        }
    qa.clearTrains();
    const a = ends[0],
      b = ends[ends.length - 1],
      // Head a few tiles in from end a, facing the pad.
      head = { x: a.x - [0, 1, 0, -1][a.d] * 7, y: a.y - [-1, 0, 1, 0][a.d] * 7 };
    return { ends, train: qa.runTrain(loco, ['wooden_coach', 'steel_coach'], head, a.d, b), cx: p.cx, cy: p.cy };
  }, [id, loco]);
  console.log(id, 'setup', JSON.stringify(setup));
  await page.evaluate(() => qa.settle());
  let frames = 0,
    slicedFrames = 0,
    wholeOnDeck = 0,
    bad = [];
  for (let k = 0; k < 100; k++) {
    const pos = await page.evaluate(
      ([cx, cy, text, k]) => {
        qa.advance(20);
        const t = qa.g.fleet.trains[0],
          p = t?.poses[0];
        if (!p) return null;
        qa.view(cx, cy, 4, `${text} · frame ${k} · ${t.state}`);
        return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), state: t.state };
      },
      [setup.cx, setup.cy, `${label} · ${axis} · ${id} · train through a piece on platforms`, k],
    );
    if (!pos) break;
    const a = await audit();
    frames++;
    if (a.sliced) slicedFrames++;
    if (a.whole) wholeOnDeck++;
    bad.push(...a.bad);
    if ([24, 32, 38, 44, 50, 56, 64, 72].includes(k)) {
      await page.screenshot({ path: `${out}run-${axis}-${id}-${String(k).padStart(2, '0')}.png` });
      console.log('CAPTURED', `run-${axis}-${id}-${k}`, JSON.stringify(pos), JSON.stringify({ sliced: a.sliced, whole: a.whole }));
    }
    if (pos.state !== 'moving' && k > 5) break;
  }
  console.log(id, 'frames', frames, 'with slices', slicedFrames, 'bad', JSON.stringify([...new Set(bad)].slice(0, 6)));
}
console.log('page errors', JSON.stringify(errors));
await browser.close();
