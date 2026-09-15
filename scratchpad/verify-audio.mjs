// The looping music track and the menu volume sliders.
// Checks that the track is served, loops, advances, and that both menus' sliders drive the bus.
// usage: node scratchpad/verify-audio.mjs
import { launch, openGame } from './runtime.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const out = new URL('./shots/audio/', import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await launch();
try {
  const page = await openGame(browser, 'after', 900);
  const served = [];
  page.on('response', (r) => {
    if (r.url().includes('/assets/audio/')) served.push([r.url().split('/').pop(), r.status()]);
  });
  // a real gesture unlocks the audio bus, exactly as it does for a player
  await page.mouse.click(700, 500);
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => {
    // read the running game's own bus: a dynamic import can hand back a second module instance
    const audio = window.game.audio;
    // `new Audio()` elements are never attached to the DOM: read the bus's own element
    const el = audio.musicEl;
    return {
      master: audio.master,
      music: audio.music,
      status: audio.musicStatus,
      src: el?.getAttribute('src') ?? null,
      loop: el?.loop ?? null,
      paused: el?.paused ?? null,
      volume: el?.volume ?? null,
      currentTime: el?.currentTime ?? null,
      duration: el?.duration ?? null,
    };
  });
  console.log('music', state, served);
  assert.ok(state.src?.includes('/assets/audio/music/'), 'music element points at the track');
  assert.equal(state.loop, true, 'track loops');
  assert.equal(state.paused, false, 'track is playing');
  assert.ok(state.currentTime > 0, 'track is advancing');
  assert.ok(state.duration > 60, 'whole track decoded');
  assert.ok(
    served.some(([n, s]) => n.endsWith('.mp3') && (s === 200 || s === 206)),
    'track served over HTTP',
  );
  assert.ok(Math.abs(state.volume - state.master * state.music) < 1e-6, 'volume = master * music');

  // pause menu sliders
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const sliders = await page.$$('#pause-root .menu-volume');
  assert.equal(sliders.length, 2, 'pause menu has music and effects sliders');
  await sliders[0].fill('20');
  await sliders[0].dispatchEvent('input');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const audio = window.game.audio;
    return { music: audio.music, volume: audio.musicEl?.volume ?? null };
  });
  console.log('after slider', after);
  assert.ok(Math.abs(after.music - 0.2) < 1e-6, 'music setting followed the slider');
  assert.ok(Math.abs(after.volume - 0.2 * state.master) < 0.02, 'element volume followed it');
  await page.screenshot({ path: new URL('pause-menu.png', out).pathname });

  // the same block on the title screen
  await page.evaluate(() => window.game.openMainMenu());
  await page.waitForTimeout(400);
  assert.equal(
    (await page.$$('#menu-root .menu-volume')).length,
    2,
    'main menu has music and effects sliders',
  );
  await page.screenshot({ path: new URL('main-menu.png', out).pathname });

  // with the track gone the synthesized loop takes over, so a build without the asset has music
  const fallback = await page.evaluate(() => {
    const audio = window.game.audio;
    audio.musicStatus = 'missing';
    audio.musicEl.pause();
    audio.music = 0.5;
    audio.applyMusic();
    return { timer: audio.synth.musicTimer > 0, paused: audio.musicEl.paused };
  });
  console.log('synth fallback', fallback);
  assert.ok(fallback.timer, 'synth loop starts when the track is missing');
  assert.ok(fallback.paused, 'the missing track is not left playing');
  console.log('audio OK');
} finally {
  await browser.close();
}
