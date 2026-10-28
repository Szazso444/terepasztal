// The in-page half of the performance tools. It runs inside the game's page and hangs everything
// off `window.__perf`; tools/perf/cdp.mjs loads it (through `/__perf/harness.mjs`, which
// tools/perf/vite.perf.config.ts serves, or by evaluating this file when the server does not) and
// calls into it. It has no imports or exports on purpose, so that it can be evaluated as a plain
// script too. Measuring only reads and wraps members of `window.game`; the S3 builders change the
// world through the game's own builder and fleet.
//
//   __perf.ready()            boot to playable: the loop's first frames and "Click to begin"
//   __perf.begun()            waits until the loading screen is gone
//   __perf.instrument()       wraps the game's own methods with timers (once per page)
//   __perf.record(ms, opts)   frame times, heap churn and the method timers over `ms`
//   __perf.scene()            a census of the scene graph and the world
//   __perf.buildLines(opts)   S3: straight lines with depot, quarry, warehouse, signals, trains
//   __perf.addTrainPerLine()  S3: one more train on the line of each existing train
//   __perf.refuel()           S3: fills every train's coal and water
//   __perf.resolve(), aggregate(), flame()   the JS Self-Profiling trace of record({ profile })
//
// tools/perf/README.md says how the pieces fit together.

/* global window, document, location, requestAnimationFrame, Profiler, devicePixelRatio */

(() => {
  if (window.__perf?.instrument) return;
  const P = (window.__perf = window.__perf || {});
  const acc = new Map();
  P.acc = acc;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // every label wrapped so far, called yet or not
  const wrapped = new Set();

  /** Wrap obj[name] with a timer under `label`; false when it is missing or already wrapped. */
  function wrap(obj, name, label) {
    if (!obj) return false;
    const orig = obj[name];
    if (typeof orig !== 'function' || orig.__perfWrapped) return false;
    const f = function (...a) {
      const t = performance.now();
      try {
        return orig.apply(this, a);
      } finally {
        const d = performance.now() - t;
        let e = acc.get(label);
        if (!e) acc.set(label, (e = { t: 0, n: 0, max: 0 }));
        e.t += d;
        e.n++;
        if (d > e.max) e.max = d;
      }
    };
    f.__perfWrapped = true;
    f.__orig = orig;
    obj[name] = f;
    wrapped.add(label);
    return true;
  }
  P.wrap = wrap;

  /**
   * The timers. Labels sort into the frame's structure: A the simulation (`Game.update`, all sim
   * steps of one frame), B the game's per-frame JS (`Game.drawFrame`), C Pixi's render call.
   * Train methods are wrapped on the prototype, so they need one train to exist; call again after
   * adding the first train. Returns the labels wrapped so far, and which members were missing.
   */
  P.instrument = () => {
    const g = window.game;
    // members such as `hud` are getters onto the UI, which exists only once the game has booted
    if (!(g?.loop?.fps > 0)) throw new Error('the game has not booted yet: run `cdp.mjs ready`');
    const missing = [];
    const w = (o, n, l) => {
      if (!wrap(o, n, l) && !o?.[n]?.__perfWrapped) missing.push(l);
    };
    const proto = (o) => (o ? Object.getPrototypeOf(o) : null);
    w(g, 'update', 'A update (all sim steps of one frame)');
    w(g.sim, 'run', 'A.1 SimStep.run');
    w(g.fleet, 'tick', 'A.1.1 fleet.tick');
    w(proto(g.fleet), 'rebuildOccupancy', 'A.1.1.a fleet.rebuildOccupancy');
    w(proto(g.fleet), 'rebuildReservations', 'A.1.1.b fleet.rebuildReservations');
    w(proto(g.fleet), 'makeWay', 'A.1.1.c fleet.makeWay');
    w(proto(g.fleet?.signals), 'ahead', 'A.1.1.s Signals.ahead');
    w(proto(g.fleet?.signals), 'blockBeyond', 'Signals.blockBeyond (nested)');
    w(g.people, 'tick', 'A.1.2 people.tick');
    w(g.houses, 'tick', 'A.1.3 houses.tick');
    w(g.contracts, 'tick', 'A.1.4 contracts.tick');
    w(g.trade, 'tick', 'A.1.5 trade.tick');
    w(g.weather, 'tick', 'A.1.6 weather.tick');
    w(g.stock, 'tick', 'A.1.7 stock.tick');
    w(g, 'drawFrame', 'B drawFrame (all)');
    w(g, 'handleInput', 'B.1 handleInput');
    w(g.world, 'animate', 'B.2 world.animate');
    w(g.world, 'applyCamera', 'B.3 world.applyCamera');
    w(g, 'layoutViews', 'B.4 layoutViews');
    w(g.trainRenderer, 'update', 'B.5 trainRenderer.update');
    w(g, 'updateSignals', 'B.6 updateSignals (every 0.1 s)');
    w(g.groundLights, 'update', 'B.7 groundLights.update');
    w(g.glows, 'update', 'B.8 glows.update');
    w(g.smoke, 'update', 'B.9 smoke.update');
    w(g.peopleRenderer, 'update', 'B.10 peopleRenderer.update');
    w(g, 'updateFieldTrains', 'B.11 updateFieldTrains');
    w(g.build, 'update', 'B.12 build.update');
    w(g.hud, 'update', 'B.13 hud.update');
    w(g.resourceBar, 'update', 'B.14 resourceBar.update');
    w(g.notices, 'refresh', 'B.15 notices.refresh (every 0.5 s)');
    w(g.dayNight, 'update', 'B.16 dayNight.update');
    w(g.rain, 'update', 'B.17 rain.update');
    w(g.fog, 'update', 'B.18 fog.update');
    w(g.contractsSide, 'update', 'B.19 contractsSide.update');
    w(g.app?.renderer, 'render', 'C pixi renderer.render');
    const t0 = g.fleet?.trains[0];
    if (t0) {
      const tp = proto(t0);
      w(tp, 'tick', 'A.1.1.t Train.tick (all trains)');
      w(tp, 'pathTo', 'A.1.1.p Train.pathTo (findPath)');
      w(tp, 'refugePlan', 'A.1.1.r Train.refugePlan');
    }
    return { wrapped: wrapped.size, missing };
  };

  /** Frame times, long tasks, heap churn and the method timers over `ms`, timers reset first. */
  P.record = async (ms = 10000, opts = {}) => {
    acc.clear();
    const g = window.game;
    const frames = [];
    let last = performance.now();
    let heapPrev = performance.memory?.usedJSHeapSize ?? 0;
    let freed = 0;
    let gcDrops = 0;
    let allocated = 0;
    const longTasks = [];
    let po;
    try {
      po = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) longTasks.push(Math.round(e.duration));
      });
      po.observe({ type: 'longtask', buffered: false });
    } catch {
      // no long-task timing in this browser
    }
    let profiler = null;
    if (opts.profile && typeof Profiler === 'function')
      profiler = new Profiler({ sampleInterval: opts.sampleInterval ?? 1, maxBufferSize: 200000 });
    const simT0 = g.clock.time;
    const start = performance.now();
    let running = true;
    const onFrame = (now) => {
      if (!running) return;
      frames.push(now - last);
      last = now;
      const h = performance.memory?.usedJSHeapSize ?? 0;
      if (h < heapPrev) {
        freed += heapPrev - h;
        gcDrops++;
      } else allocated += h - heapPrev;
      heapPrev = h;
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    await sleep(ms);
    running = false;
    const wall = performance.now() - start;
    po?.disconnect();
    const trace = profiler ? await profiler.stop() : null;
    frames.shift();
    // no frame intervals: a hidden or throttled page draws none, and a short recording too few
    if (frames.length === 0)
      throw new Error(
        `no frames recorded in ${Math.round(wall)} ms: the page drew fewer than two ` +
          '(a hidden or throttled tab, or too short a recording)',
      );
    const sorted = [...frames].sort((a, b) => a - b);
    const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(2);
    const timers = {};
    for (const [k, e] of [...acc].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
      timers[k] = {
        msPerSec: +((e.t / wall) * 1000).toFixed(2),
        callsPerSec: +((e.n / wall) * 1000).toFixed(1),
        msPerCall: +(e.t / e.n).toFixed(3),
        maxMs: +e.max.toFixed(2),
      };
    const MB = 1048576;
    const out = {
      wallMs: Math.round(wall),
      frames: frames.length,
      fps: +((frames.length / wall) * 1000).toFixed(1),
      frameMs: {
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: +sorted[sorted.length - 1].toFixed(1),
      },
      over20ms: frames.filter((f) => f > 20).length,
      longTasks: {
        count: longTasks.length,
        totalMs: longTasks.reduce((a, b) => a + b, 0),
        max: Math.max(0, ...longTasks),
      },
      heap: {
        usedMB: +((performance.memory?.usedJSHeapSize ?? 0) / MB).toFixed(1),
        allocMBperSec: +((allocated / wall) * (1000 / MB)).toFixed(2),
        freedMBperSec: +((freed / wall) * (1000 / MB)).toFixed(2),
        gcDropsPerSec: +((gcDrops / wall) * 1000).toFixed(2),
      },
      gameSeconds: +(g.clock.time - simT0).toFixed(2),
      speed: g.clock.speed,
      trains: g.fleet.trains.length,
      signals: g.fleet.signals.count,
      map: `${g.map.w}x${g.map.h}`,
      screen: `${window.innerWidth}x${window.innerHeight}@${devicePixelRatio}`,
      timers,
    };
    P.lastTrace = trace;
    P.last = out;
    return out;
  };

  /**
   * Boot to playable, in ms since navigation start: `loopMs` when the game loop first reports a
   * frame rate (its first half second of frames: the 2026-10-27 report's "boot to playable"), and
   * `loadedMs` when the loading screen has finished and shows "Click to begin" (null when the boot
   * showed none). `readyMs` is the later of the two. Polls every 20 ms, so call it right after
   * navigating: called later, it reports the time it was called. The screen stays up; the caller
   * clicks it away (`cdp.mjs ready` does, with a real click) and `begun()` waits for it to go.
   */
  P.ready = async (timeoutMs = 120000) => {
    const t0 = performance.now();
    let loopMs = null;
    let loadedMs = null;
    const screen = () => document.getElementById('loading-screen');
    while (performance.now() - t0 < timeoutMs) {
      const now = Math.round(performance.now());
      if (loopMs == null && window.game?.loop?.fps > 0) loopMs = now;
      if (loadedMs == null && screen()?.classList.contains('ls-ready')) loadedMs = now;
      // done once the loop runs and the screen, if any, is either ready or gone
      if (loopMs != null && (loadedMs != null || !screen())) break;
      await sleep(20);
    }
    const g = window.game;
    const readyMs = Math.max(loopMs ?? Infinity, loadedMs ?? 0);
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return {
      ready: loopMs != null,
      readyMs: Number.isFinite(readyMs) ? readyMs : null,
      loopMs,
      loadedMs,
      clickToBegin: !!screen()?.classList.contains('ls-ready'),
      domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd ?? 0),
      lastResourceMs: Math.round(Math.max(0, ...res.map((r) => r.responseEnd))),
      resources: res.length,
      transferKB: Math.round(res.reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 1024),
      map: g?.map ? `${g.map.w}x${g.map.h}` : null,
      trains: g?.fleet?.trains.length ?? null,
      signals: g?.fleet?.signals.count ?? null,
      mode: g?.mode ?? null,
      speed: g?.clock?.speed ?? null,
      heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576),
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?',
      screen: `${window.innerWidth}x${window.innerHeight}@${devicePixelRatio}`,
      url: location.href,
    };
  };

  /** Wait until the loading screen is gone (after its click and reveal); the ms since navigation. */
  P.begun = async (timeoutMs = 30000) => {
    const t0 = performance.now();
    while (document.getElementById('loading-screen') && performance.now() - t0 < timeoutMs)
      await sleep(20);
    return document.getElementById('loading-screen') ? null : Math.round(performance.now());
  };

  /** The centre of the element `selector` in CSS pixels, for a real click from the driver. */
  P.centre = (selector) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  };

  /** A census of the scene graph and the world. */
  P.scene = () => {
    const g = window.game;
    let objects = 0;
    let visible = 0;
    let culled = 0;
    let leaves = 0;
    const walk = (c) => {
      objects++;
      if (c.visible) visible++;
      if (c.culled) culled++;
      if (!c.children?.length) leaves++;
      for (const ch of c.children ?? []) walk(ch);
    };
    walk(g.app.stage);
    return {
      objects,
      visible,
      culled,
      leaves,
      map: `${g.map.w}x${g.map.h}`,
      trains: g.fleet.trains.length,
      signals: g.fleet.signals.count,
      decor: g.builder.decor.size,
      stations: g.builder.stations.length,
      houses: g.houses.houses?.size ?? null,
      camera: { x: Math.round(g.camera.x), y: Math.round(g.camera.y), zoom: g.camera.zoom },
    };
  };

  /**
   * S3's network: up to `lines` straight single-track lines, one per `dy` rows from `y0`, each
   * with a depot at its west end, a quarry and a warehouse beside it, a signal every
   * `signalEvery` tiles (0 for none) and `trainsPerLine` trains between quarry and warehouse.
   * Placement is free while it builds. Trains need fuel: refuel() tops them up.
   */
  P.buildLines = (opts = {}) => {
    const o = {
      lines: 20,
      trainsPerLine: 2,
      signalEvery: 10,
      maxLen: 140,
      y0: 20,
      dy: 9,
      loco: 'mav375',
      wagon: 'wood_hopper',
      level: null,
      ...opts,
    };
    const g = window.game;
    const b = g.builder;
    const was = b.free;
    b.free = true;
    const item = { kind: 'straight', cls: 'regular', cls2: 'regular' };
    const made = { lines: 0, trains: 0, signals: 0, fails: [] };
    try {
      for (let y = o.y0; made.lines < o.lines && y < g.map.h - 4; y += o.dy) {
        let depot = null;
        for (let x0 = 4; x0 < g.map.w - 60 && !depot; x0++)
          depot = b.placeStation(x0, y, 'depot', 0);
        if (!depot) {
          made.fails.push(`row ${y}: no depot`);
          continue;
        }
        const x0 = depot.x;
        let x = x0 + 2;
        while (x < g.map.w - 3 && x - x0 < o.maxLen && b.placeTrack(x, y, item, 1)) x++;
        const xEnd = x - 1;
        if (xEnd - x0 < 40) {
          made.fails.push(`row ${y}: line of ${xEnd - x0}`);
          continue;
        }
        let q = null;
        let wh = null;
        for (let qx = x0 + 8; qx < x0 + 20 && !q; qx++) q = b.placeStation(qx, y - 1, 'quarry', 0);
        for (let wx = xEnd - 4; wx > xEnd - 20 && !wh; wx--)
          wh = b.placeStation(wx, y - 1, 'warehouse', 0);
        if (!q || !wh) {
          made.fails.push(`row ${y}: quarry ${!!q}, warehouse ${!!wh}`);
          continue;
        }
        q.store('stone', 400);
        if (o.signalEvery)
          for (let sx = x0 + 6; sx < xEnd - 2; sx += o.signalEvery)
            if (b.placeDecor(sx, y, 'signal', 1)) made.signals++;
        for (let t = 0; t < o.trainsPerLine; t++) {
          const loco = g.inventory.add(o.loco, 0);
          const wag = g.inventory.add(o.wagon, 0);
          const tr = g.fleet.create(
            [loco.uid],
            [wag.uid],
            [q.id, wh.id],
            undefined,
            'schedule',
            depot.id,
          );
          if (typeof tr === 'string') made.fails.push(`row ${y}: train: ${tr}`);
          else made.trains++;
        }
        made.lines++;
      }
    } finally {
      b.free = was;
    }
    g.fleet.signals.rebuild(b.decor.values());
    if (o.level) g.fleet.signals.level = o.level;
    return {
      ...made,
      signalPosts: g.fleet.signals.count,
      level: g.fleet.signals.level,
      totalTrains: g.fleet.trains.length,
      fails: made.fails.slice(0, 8),
    };
  };

  /** One more train on the line of each of the first `limit` trains: same stops, nearest depot. */
  P.addTrainPerLine = (opts = {}) => {
    const o = { limit: Infinity, loco: 'mav375', wagon: 'wood_hopper', ...opts };
    const g = window.game;
    const made = { ok: 0, fails: [] };
    const depots = g.builder.stations.filter((s) => s.def.id === 'depot');
    const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    for (const t of g.fleet.trains.slice(0, o.limit)) {
      const s0 = t.schedule[0];
      const first = g.builder.stationById(s0?.stationId ?? s0?.id ?? s0);
      const d =
        first && depots.length
          ? depots.reduce((a, b) => (dist(b, first) < dist(a, first) ? b : a))
          : null;
      const loco = g.inventory.add(o.loco, 0);
      const wag = g.inventory.add(o.wagon, 0);
      const stops = t.schedule.map((s) => (typeof s === 'object' ? { ...s } : s));
      const tr = g.fleet.create([loco.uid], [wag.uid], stops, undefined, 'schedule', d?.id ?? null);
      if (typeof tr === 'string') made.fails.push(tr.slice(0, 80));
      else made.ok++;
    }
    return { ...made, total: g.fleet.trains.length, fails: made.fails.slice(0, 4) };
  };

  /** Fill every train's coal and water, so a scripted network keeps moving. */
  P.refuel = () => {
    let n = 0;
    for (const t of window.game.fleet.trains) {
      if ('coalCap' in t) t.coal = t.coalCap;
      if ('water' in t) t.water = Math.max(t.water, 1000);
      n++;
    }
    return n;
  };

  // ---- the JS Self-Profiling trace of record({ profile: true }), resolved through source maps.
  // It needs the page served with `Document-Policy: js-profiling` (tools/perf/vite.perf.config.ts).

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const VAL = {};
  for (let i = 0; i < 64; i++) VAL[B64[i]] = i;
  function vlq(s) {
    const out = [];
    let v = 0;
    let sh = 0;
    for (let i = 0; i < s.length; i++) {
      const d = VAL[s[i]];
      v += (d & 31) << sh;
      if (d & 32) sh += 5;
      else {
        out.push(v & 1 ? -(v >> 1) : v >> 1);
        v = 0;
        sh = 0;
      }
    }
    return out;
  }
  const maps = new Map();
  async function loadMap(url) {
    if (maps.has(url)) return maps.get(url);
    let m = null;
    try {
      const r = await fetch(url + '.map');
      if (r.ok) {
        const sm = await r.json();
        const lines = [];
        let src = 0;
        let sl = 0;
        let nm = 0;
        for (const ln of sm.mappings.split(';')) {
          let col = 0;
          const segs = [];
          if (ln)
            for (const s of ln.split(',')) {
              const v = vlq(s);
              col += v[0];
              if (v.length > 1) {
                src += v[1];
                sl += v[2];
                let name = null;
                if (v.length > 4) {
                  nm += v[4];
                  name = sm.names[nm];
                }
                segs.push([col, src, sl, name]);
              }
            }
          lines.push(segs);
        }
        m = { sm, lines };
      }
    } catch {
      // no source map: the frame keeps its minified name
    }
    maps.set(url, m);
    return m;
  }
  function lookup(m, line, col) {
    // the trace's lines and columns are 1-based
    const segs = m.lines[line - 1];
    if (!segs || !segs.length) return null;
    let lo = 0;
    let hi = segs.length - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid][0] <= col - 1) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const s = segs[best];
    const file = m.sm.sources[s[1]]
      .split('\\')
      .join('/')
      .replace(/^(\.\.\/)+/, '')
      .replace(/^.*node_modules\//, 'npm:');
    return { file, line: s[2] + 1, name: s[3] };
  }

  /** Label every frame of the last trace, resolved through the bundle's source maps. */
  P.resolve = async () => {
    const t = P.lastTrace;
    if (!t) return null;
    const out = [];
    for (const f of t.frames) {
      const url = f.resourceId != null ? t.resources[f.resourceId] : '';
      let label = f.name || '(anonymous)';
      let file = url ? url.replace(location.origin, '') : '';
      if (url && /\/assets\/.*\.js$/.test(url) && f.line != null) {
        const m = await loadMap(url);
        const r = m && lookup(m, f.line, f.column);
        if (r) {
          file = `${r.file}:${r.line}`;
          if (r.name) label = r.name;
        }
      } else if (url && f.line != null) file = `${file.replace(/\?.*$/, '')}:${f.line}`;
      out.push({ label, file });
    }
    P.labels = out;
    return out.length;
  };

  /** Self and total time per function of the last trace, and its merged call tree. */
  P.aggregate = (top = 40) => {
    const t = P.lastTrace;
    const L = P.labels;
    if (!t || !L) return null;
    const key = (fi) => `${L[fi].label} ${L[fi].file}`;
    const self = new Map();
    const total = new Map();
    const root = { name: 'root', v: 0, c: new Map() };
    let idle = 0;
    let n = 0;
    const samples = t.samples;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      // a sample weighs the time to the next one, capped
      const dt = i + 1 < samples.length ? Math.min(samples[i + 1].timestamp - s.timestamp, 10) : 1;
      n += dt;
      if (s.stackId == null) {
        idle += dt;
        continue;
      }
      const chain = [];
      for (let sid = s.stackId; sid != null; sid = t.stacks[sid].parentId)
        chain.push(t.stacks[sid].frameId);
      chain.reverse();
      const seen = new Set();
      let node = root;
      root.v += dt;
      for (const fi of chain) {
        const k = key(fi);
        if (!seen.has(k)) {
          total.set(k, (total.get(k) ?? 0) + dt);
          seen.add(k);
        }
        let c = node.c.get(k);
        if (!c) node.c.set(k, (c = { name: k, v: 0, c: new Map() }));
        c.v += dt;
        node = c;
      }
      const sk = key(chain[chain.length - 1]);
      self.set(sk, (self.get(sk) ?? 0) + dt);
    }
    P.tree = root;
    const fmt = (m) =>
      [...m]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([k, v]) => [k, +v.toFixed(1), +((100 * v) / n).toFixed(1)]);
    return {
      sampledMs: Math.round(n),
      idleMs: Math.round(idle),
      busyPct: +((100 * (n - idle)) / n).toFixed(1),
      self: fmt(self),
      total: fmt(total),
    };
  };

  /** Draw the last call tree as an icicle graph over the page, for a screenshot; unflame() removes it. */
  P.flame = (opts = {}) => {
    const root = P.tree;
    if (!root) return;
    let base = root;
    if (opts.focus) {
      // the first node, breadth first, whose name starts with `focus`
      const q = [root];
      while (q.length) {
        const x = q.shift();
        if (x !== root && x.name.startsWith(opts.focus)) {
          base = x;
          break;
        }
        q.push(...x.c.values());
      }
    }
    P.unflame();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cv = document.createElement('canvas');
    cv.id = '__flame';
    cv.width = W * devicePixelRatio;
    cv.height = H * devicePixelRatio;
    Object.assign(cv.style, {
      position: 'fixed',
      inset: '0',
      width: W + 'px',
      height: H + 'px',
      zIndex: 99999,
      background: '#111',
    });
    document.body.appendChild(cv);
    const c = cv.getContext('2d');
    c.scale(devicePixelRatio, devicePixelRatio);
    const RH = 17;
    c.textBaseline = 'middle';
    c.fillStyle = '#eee';
    c.font = 'bold 13px system-ui, sans-serif';
    c.fillText(opts.title ?? '', 8, 12);
    c.font = '11px system-ui, sans-serif';
    const hue = (s) => {
      if (/src\/sim|src\/world/.test(s)) return 30;
      if (/src\/render|src\/art/.test(s)) return 200;
      if (/npm:pixi|pixi/.test(s)) return 280;
      if (/src\/ui/.test(s)) return 120;
      return 0;
    };
    const draw = (node, x, w, d) => {
      if (w < 0.6 || 26 + d * RH > H) return;
      const y = 26 + d * RH;
      if (node !== base || opts.focus) {
        const h = hue(node.name);
        c.fillStyle =
          h === 0 ? `hsl(0,0%,${45 + (d % 3) * 6}%)` : `hsl(${h},55%,${42 + (d % 3) * 6}%)`;
        c.fillRect(x, y, w - 0.5, RH - 1);
        if (w > 40) {
          c.fillStyle = '#fff';
          let txt = `${node.name} (${((100 * node.v) / base.v).toFixed(1)}%)`;
          while (c.measureText(txt).width > w - 6 && txt.length > 4) txt = txt.slice(0, -2);
          c.fillText(txt, x + 3, y + RH / 2);
        }
      }
      let cx = x;
      for (const ch of [...node.c.values()].sort((a, b) => b.v - a.v)) {
        const cw = (w * ch.v) / node.v;
        draw(ch, cx, cw, d + 1);
        cx += cw;
      }
    };
    draw(base, 0, W, 0);
  };
  P.unflame = () => document.getElementById('__flame')?.remove();
})();
