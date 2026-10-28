// A small DevTools-protocol driver for the game in a headless Chrome (tools/perf/README.md has the
// launch command). It drives the first page tab of the Chrome at PERF_CDP (default
// http://127.0.0.1:9333), loads the in-page harness (tools/perf/page/harness.mjs) when a command
// needs it, and prints JSON.
//
//   node tools/perf/cdp.mjs nav <url>                    navigate and wait for the load event
//   node tools/perf/cdp.mjs ready [url] [--stay]         boot to playable (navigates first if given),
//                                                        then clicks "Click to begin" (not --stay)
//   node tools/perf/cdp.mjs rec [ms] [--speed i] [--settle ms] [--out file.json]
//                                                        frame times and method timers; prints the
//                                                        headline (brief.mjs), --out keeps it all
//   node tools/perf/cdp.mjs scene                        scene graph and world census
//   node tools/perf/cdp.mjs eval <expr | @file.js>       evaluate in the page (await works): as an
//                                                        expression when it parses as one, else as
//                                                        a function body (print with `return`)
//   node tools/perf/cdp.mjs profile <ms> <out-prefix>    V8 CPU profile -> <out-prefix>.cpuprofile
//   node tools/perf/cdp.mjs trace <ms> <out-prefix>      GC and timeline totals ->
//                                                        <out-prefix>.trace.json
//   node tools/perf/cdp.mjs shot <out.png>               screenshot of the viewport

// WebSocket is global in Node 22 and later; the lint config's Node globals predate it
/* global WebSocket */
import { readFileSync, writeFileSync } from 'node:fs';
import { brief } from './brief.mjs';

const CDP = process.env.PERF_CDP ?? 'http://127.0.0.1:9333';
const HARNESS = new URL('./page/harness.mjs', import.meta.url);

const argv = process.argv.slice(2);
const cmd = argv[0];
/** Flags that take no value. */
const SWITCHES = new Set(['--stay']);
/** The value after `--name`, or `dflt` when the flag is absent; a flag with no value is an error. */
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  if (v == null || v.startsWith('--')) throw new Error(`--${name} needs a value`);
  return v;
};
/** `v` as a whole number of at least `min`, or an error naming `what`. */
const whole = (v, what, min = 0) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min)
    throw new Error(`${what} must be a whole number of at least ${min}, not "${v}"`);
  return n;
};
/** Positional arguments after the command, with flags and their values left out. */
const positional = argv
  .slice(1)
  .filter(
    (a, i, all) =>
      !a.startsWith('--') && !(all[i - 1]?.startsWith('--') && !SWITCHES.has(all[i - 1])),
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const USAGE =
  'usage: node tools/perf/cdp.mjs nav|ready|rec|scene|eval|profile|trace|shot … (see the file head)';
if (!cmd) {
  console.error(USAGE);
  process.exit(2);
}

let targets;
try {
  targets = await (await fetch(`${CDP}/json/list`)).json();
} catch {
  console.error(
    `no Chrome with remote debugging at ${CDP}; tools/perf/README.md has the launch command`,
  );
  process.exit(1);
}
let page = targets.find((t) => t.type === 'page');
if (!page) page = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    const { resolve, reject } = pending.get(d.id);
    pending.delete(d.id);
    if (d.error) reject(new Error(JSON.stringify(d.error)));
    else resolve(d.result);
  } else for (const l of listeners) l(d);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const once = (method, timeoutMs) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    listeners.push((d) => {
      if (d.method === method) {
        clearTimeout(t);
        resolve(d.params);
      }
    });
  });

/** Evaluate an expression in the page, awaiting a promise, and return its value. */
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 600000,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(d.exception?.description ?? d.text ?? JSON.stringify(d).slice(0, 2000));
  }
  return r.result.value;
}

/** Load the harness: from /__perf/ when the server serves it, else by evaluating the file. */
async function harness() {
  if (await evaluate('!!window.__perf?.instrument')) return;
  const served = await evaluate(
    `import('/__perf/harness.mjs').then(() => !!window.__perf?.instrument, () => false)`,
  );
  if (!served) await evaluate(readFileSync(HARNESS, 'utf8'));
  if (!(await evaluate('!!window.__perf?.instrument'))) throw new Error('the harness did not load');
}

/**
 * Load `url` afresh. The page goes to about:blank first: the game drops its `#seed=…&new` hash
 * at boot, so navigating to the same address with the hash again would only change the fragment
 * and not reload. sessionStorage (a staged tuning) survives, as in any navigation in one tab.
 */
async function navigate(url) {
  await send('Page.enable');
  await send('Page.setLifecycleEventsEnabled', { enabled: true });
  // the documents whose load event has fired, by loader: an earlier page's late event cannot
  // pass for the new one's
  const loadedBy = new Set();
  listeners.push((d) => {
    if (d.method === 'Page.lifecycleEvent' && d.params.name === 'load')
      loadedBy.add(d.params.loaderId);
  });
  for (const u of ['about:blank', url]) {
    const { loaderId, errorText } = await send('Page.navigate', { url: u });
    if (errorText) throw new Error(`${u}: ${errorText}`);
    const t0 = Date.now();
    while (!loadedBy.has(loaderId)) {
      if (Date.now() - t0 > 60000) throw new Error(`${u} did not load within 60 s`);
      await sleep(20);
    }
  }
}

const print = (v) => console.log(JSON.stringify(v, null, 1));

try {
  if (cmd === 'nav') {
    await navigate(positional[0]);
    print({ navigated: positional[0] });
  } else if (cmd === 'ready') {
    if (positional[0]) await navigate(positional[0]);
    await harness();
    const boot = await evaluate('window.__perf.ready()');
    if (boot.clickToBegin && !argv.includes('--stay')) {
      // a real click, as the player's: the loading screen reveals the game, the clock stays paused
      const at = await evaluate(`window.__perf.centre('#loading-screen')`);
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
      boot.begunMs = await evaluate('window.__perf.begun()');
    }
    print(boot);
  } else if (cmd === 'rec') {
    await harness();
    const ms = whole(positional[0] ?? 10000, 'the recording length in ms', 1);
    const speedArg = flag('speed');
    const speed = speedArg == null ? null : whole(speedArg, '--speed (an index into SPEEDS)');
    const settle = whole(flag('settle', 1500), '--settle');
    const out = flag('out');
    const inst = await evaluate('window.__perf.instrument()');
    if (speed != null) {
      // SPEEDS is not on window.game, and an index past its end leaves the clock with no speed
      const set = await evaluate(
        `(c => { const was = c.speedIndex; c.setSpeed(${speed}); ` +
          `if (typeof c.speed === 'number') return true; c.setSpeed(was); return false; })` +
          `(window.game.clock)`,
      );
      if (!set) throw new Error(`--speed ${speed} is not an index into SPEEDS (src/sim/time.ts)`);
    }
    await sleep(settle);
    const rec = await evaluate(`window.__perf.record(${ms})`);
    rec.instrumented = inst;
    if (out) writeFileSync(out, JSON.stringify(rec, null, 1));
    print(brief(rec));
    if (inst.missing.length) console.error('not wrapped (missing on window.game):', inst.missing);
  } else if (cmd === 'scene') {
    await harness();
    print(await evaluate('window.__perf.scene()'));
  } else if (cmd === 'eval') {
    const src = positional[0]?.startsWith('@')
      ? readFileSync(positional[0].slice(1), 'utf8')
      : positional[0];
    if (!src) throw new Error('eval needs an expression or @file');
    await harness();
    // an expression when it parses as one, its value printed; else a function body, what it
    // returns printed. Chrome compiles the expression form without running it to choose.
    const asExpression = `(async () => (\n${src}\n))()`;
    await send('Runtime.enable'); // compileScript needs it
    const parsed = await send('Runtime.compileScript', {
      expression: asExpression,
      sourceURL: 'perf-eval.js',
      persistScript: false,
    });
    print(await evaluate(parsed.exceptionDetails ? `(async () => {\n${src}\n})()` : asExpression));
  } else if (cmd === 'profile') {
    const [ms, prefix] = positional;
    if (!prefix) throw new Error('profile needs <ms> <out-prefix>');
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 200 });
    await send('Profiler.start');
    await sleep(Number(ms));
    const { profile } = await send('Profiler.stop');
    writeFileSync(`${prefix}.cpuprofile`, JSON.stringify(profile));
    print({
      written: `${prefix}.cpuprofile`,
      samples: profile.samples.length,
      next: `node tools/perf/summarize.mjs ${prefix}.cpuprofile dist`,
    });
  } else if (cmd === 'trace') {
    const [ms, prefix] = positional;
    if (!prefix) throw new Error('trace needs <ms> <out-prefix>');
    const events = [];
    listeners.push((d) => {
      if (d.method === 'Tracing.dataCollected') events.push(...d.params.value);
    });
    const done = once('Tracing.tracingComplete', 120000);
    await send('Tracing.start', {
      categories: 'devtools.timeline,v8,disabled-by-default-v8.gc,blink.user_timing',
      transferMode: 'ReportEvents',
    });
    await sleep(Number(ms));
    await send('Tracing.end');
    await done;
    const gc = {};
    const timeline = {};
    const TIMELINE = [
      'FunctionCall',
      'FireAnimationFrame',
      'RunTask',
      'Layout',
      'UpdateLayoutTree',
      'Paint',
      'MinorGC',
      'MajorGC',
      'V8.GC_SCAVENGER',
      'V8.GC_MARK_COMPACTOR',
    ];
    for (const e of events) {
      if (e.ph !== 'X' || !e.dur) continue;
      const ms1 = e.dur / 1000;
      if (/GC|Scavenge|MarkCompact|Sweep/i.test(e.name) && !/disabled/.test(e.cat)) {
        const g = (gc[e.name] ??= { n: 0, ms: 0, max: 0 });
        g.n++;
        g.ms += ms1;
        g.max = Math.max(g.max, ms1);
      }
      if (TIMELINE.includes(e.name)) {
        const t = (timeline[e.name] ??= { n: 0, ms: 0 });
        t.n++;
        t.ms += ms1;
      }
    }
    const round = (o) =>
      Object.fromEntries(
        Object.entries(o).map(([k, v]) => [
          k,
          Object.fromEntries(Object.entries(v).map(([a, b]) => [a, +b.toFixed(1)])),
        ]),
      );
    const out = {
      windowMs: Number(ms),
      events: events.length,
      gc: round(gc),
      timeline: round(timeline),
    };
    writeFileSync(`${prefix}.trace.json`, JSON.stringify(out, null, 1));
    print(out);
  } else if (cmd === 'shot') {
    if (!positional[0]) throw new Error('shot needs <out.png>');
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(positional[0], Buffer.from(r.data, 'base64'));
    print({ written: positional[0] });
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
