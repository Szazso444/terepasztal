// The headline numbers of a recording (`__perf.record`, saved by `cdp.mjs rec --out`): frame
// times, the three per-frame costs (simulation, the game's per-frame JS, Pixi's render call),
// the per-tick simulation costs and the five most expensive per-frame passes.
//
//   node tools/perf/brief.mjs <recording.json>
import { readFileSync } from 'node:fs';
import { isMain } from '../is-main.mjs';

/** The headline of one recording; per-frame values are ms per drawn frame. */
export function brief(rec) {
  const T = rec.timers ?? {};
  const get = (prefix) => Object.entries(T).find(([n]) => n.startsWith(prefix))?.[1];
  const fps = rec.frames / (rec.wallMs / 1000);
  const perFrame = (prefix) => {
    const e = get(prefix);
    return e ? +(e.msPerSec / fps).toFixed(3) : 0;
  };
  const sim = get('A.1 SimStep');
  // a timer's cost per simulation tick: its ms per second over the ticks per second
  const perTick = (prefix) => {
    const e = get(prefix);
    return e && sim ? +(e.msPerSec / sim.callsPerSec).toFixed(3) : 0;
  };
  const train = get('A.1.1.t');
  return {
    map: rec.map,
    trains: rec.trains,
    signals: rec.signals,
    speed: rec.speed,
    screen: rec.screen,
    fps: rec.fps,
    frameMs: rec.frameMs,
    heap: rec.heap,
    perFrameMs: {
      update: perFrame('A update'),
      drawFrame: perFrame('B drawFrame'),
      pixiRender: perFrame('C pixi'),
    },
    perTickMs: {
      simStep: sim?.msPerCall ?? 0,
      maxSimStep: sim?.maxMs ?? 0,
      fleetTick: get('A.1.1 fleet')?.msPerCall ?? 0,
      trainTicksPerSimTick: train && sim ? +(train.callsPerSec / sim.callsPerSec).toFixed(1) : 0,
      allTrainTicks: perTick('A.1.1.t'),
      signalsAhead: perTick('A.1.1.s'),
      pathTo: perTick('A.1.1.p'),
      people: get('A.1.2')?.msPerCall ?? 0,
    },
    topPerFrame: Object.entries(T)
      .filter(([k]) => k.startsWith('B.'))
      .sort((a, b) => b[1].msPerSec - a[1].msPerSec)
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${(v.msPerSec / fps).toFixed(3)} ms/frame (max ${v.maxMs})`),
  };
}

if (isMain(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/perf/brief.mjs <recording.json>');
    process.exit(2);
  }
  console.log(JSON.stringify(brief(JSON.parse(readFileSync(file, 'utf8'))), null, 1));
}
