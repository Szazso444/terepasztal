// node scratchpad/perf/frames.mjs <profile.cpuprofile>: frame timings plus a CPU profile of them.
import fs from 'node:fs';
// PLAYWRIGHT: path to a playwright(-core) index.mjs; CHROME: a Chromium binary (optional).
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright-core');
const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://127.0.0.1:5190/scratchpad/perf/');
await page.waitForFunction(() => !!window.bench, null, { timeout: 600000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const timing = await page.evaluate(() => window.bench.frames(200));
const { profile } = await cdp.send('Profiler.stop');
fs.writeFileSync(process.argv[2], JSON.stringify(profile));
console.log(JSON.stringify(timing));
await browser.close();
