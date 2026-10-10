import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'file:///C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const b = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const report = { errors: [], music: [], copies: [], renderer: {} };
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', (e) => report.errors.push(e.message));
  await p.goto('http://127.0.0.1:5190/scratchpad/cozy-v3/');
  await p.waitForFunction(() => window.worldReview, null, { timeout: 120000 });
  assert(
    await p.evaluate(() => worldReview.g.audio.musicEl === null),
    'autoplay must wait for gesture',
  );
  await p.mouse.click(10, 10);
  for (let i = 0; i < 8; i++) {
    await p.waitForFunction(
      () => {
        const el = worldReview.g.audio.musicEl;
        return el && el.readyState >= 3 && !el.paused;
      },
      null,
      { timeout: 15000 },
    );
    report.music.push(
      await p.evaluate(() => {
        const a = worldReview.g.audio,
          e = a.musicEl;
        return {
          index: a.playlist.current,
          src: e.src.split('/').pop(),
          duration: e.duration,
          volume: e.volume,
        };
      }),
    );
    if (i < 7)
      await p.evaluate(() => worldReview.g.audio.musicEl.dispatchEvent(new Event('ended')));
  }
  assert.equal(report.music[0].index, 0);
  assert.equal(new Set(report.music.slice(0, 4).map((t) => t.index)).size, 4);
  report.music.forEach((t, i) => {
    assert(t.duration > 30);
    if (i) assert.notEqual(t.index, report.music[i - 1].index);
  });
  await p.evaluate(() => {
    const g = worldReview.g;
    g.audio.ambient = 0.35;
    g.audio.updateAmbience(0.6, 0);
    g.audio.master = 0;
    g.audio.applyMusic();
    g.audio.updateAmbience(0.6, 0);
  });
  await p.waitForFunction(() => worldReview.g.audio.ambience.master.gain.value < 0.001);
  assert(
    await p.evaluate(
      () => worldReview.g.audio.musicEl.paused && worldReview.g.audio.musicEl.volume === 0,
    ),
  );
  report.mute = { music: true, ambience: true };
  report.renderer = await p.evaluate(async () => {
    const g = worldReview.g;
    g.settings.edgeScroll = false;
    const before = g.world.landscape.paintCount;
    const times = [];
    for (let i = 0; i < 60; i++) {
      const t = performance.now();
      g.camera.x += 2;
      g.render(1, 1 / 60);
      g.app.renderer.render(g.app.stage);
      times.push(performance.now() - t);
      await new Promise(requestAnimationFrame);
    }
    const after = g.world.landscape.paintCount;
    return {
      chunks: g.world.landscape.chunks.size,
      paintBefore: before,
      paintAfter: after,
      medianSubmitMs: times.sort((a, b) => a - b)[30],
      maxSubmitMs: Math.max(...times),
      workerReady: g.world.landscape.ready,
    };
  });
  assert.equal(report.renderer.paintBefore, report.renderer.paintAfter);
  assert(report.renderer.workerReady);
  const mutation = await p.evaluate(() => {
    const g = worldReview.g;
    const k = g.map.terrain.findIndex((t, k) => t === 2 && !g.track.pieces.has(k));
    const x = k % g.map.w,
      y = Math.floor(k / g.map.w);
    const before = g.world.landscape.paintCount;
    g.world.setFlattened(x, y, true);
    g.world.animate(0);
    return { x, y, before, elevation: g.world.elevationOf(x, y) };
  });
  assert.equal(Math.abs(mutation.elevation), 0);
  await p.waitForFunction(() => worldReview.g.world.landscape.ready, null, { timeout: 15000 });
  mutation.repaints = await p.evaluate(
    (n) => worldReview.g.world.landscape.paintCount - n,
    mutation.before,
  );
  assert(mutation.repaints > 0 && mutation.repaints < 40);
  report.excavation = mutation;
  report.lights = await p.evaluate(() => {
    const g = worldReview.g;
    worldReview.render(worldReview.views[6]);
    const n = [...g.world.windowLights.values()].filter((s) => s.alpha > 0).length;
    const train = [...g.trainRenderer.windowLights.values()].filter((s) => s.alpha > 0).length;
    worldReview.render(worldReview.views[2]);
    const extinguished = [...g.world.windowLights.values()].every((s) => s.alpha === 0);
    return { buildings: n, vehicles: train, extinguished };
  });
  assert(report.lights.buildings > 0 && report.lights.vehicles > 0 && report.lights.extinguished);
  const q = await b.newPage();
  await q.route('**/assets/audio/music/*.mp3', (route) => route.abort());
  await q.goto('http://127.0.0.1:5190/scratchpad/cozy-v3/');
  await q.waitForFunction(() => window.worldReview, null, { timeout: 120000 });
  await q.mouse.click(10, 10);
  await q.waitForFunction(() => worldReview.g.audio.musicStatus === 'missing', null, {
    timeout: 15000,
  });
  report.missingTracksFallback = await q.evaluate(() => ({
    failed: worldReview.g.audio.unavailableMusic.size,
    synthTimer: worldReview.g.audio.synth.musicTimer > 0,
  }));
  assert.equal(report.missingTracksFallback.failed, 4);
  assert(report.missingTracksFallback.synthTimer);
  const files = [
    ['Pastoral Pulse(Genshin style).mp3', 'pastoral-pulse-genshin-style.mp3'],
    ['Pastoral Pulse(Chillstep).mp3', 'pastoral-pulse-chillstep.mp3'],
    ['Pastoral Pulse(Liquid dnb).mp3', 'pastoral-pulse-liquid-dnb.mp3'],
  ];
  for (const [source, destination] of files) {
    const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const original = hash('G:/Downloads/' + source),
      copy = hash('public/assets/audio/music/' + destination);
    assert.equal(original, copy);
    report.copies.push({ source, destination, sha256: copy });
  }
  assert.equal(report.errors.length, 0);
  fs.writeFileSync('scratchpad/cozy-v3/renders/verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await b.close();
}
