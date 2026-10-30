/**
 * The labels of the track lines and the train classes (specs/track-classes.md). A line's label is
 * a piece of its track seen from above, standing upright in the line's colours, its bed wider for
 * a bigger line and with as many sleepers as its class's engine has driving wheels. It marks the line's
 * track pieces, and a vehicle carries one for every line it runs on. A class's label is a separate
 * icon, the same size for every class: a steam engine in the middle that grows in equal steps, from
 * a small tank engine for the Corvette to a big express engine for the Cruiser, over four pips of
 * which the class's step is filled. The line colours echo each line's bed (warm stone, pale
 * granite, dark basalt) and live in style.css as `--line-<line>`, `--line-<line>-sleeper` and
 * `--line-<line>-rail`, the icon's as `--class-*`.
 */
import type { TrainClass } from '../data/content';
import { CLASS_LINE, classRunsOn } from '../sim/compat';
import { STR } from '../strings';
import { TRACK_CLASSES, type TrackClass } from '../world/track';
import { el } from './dom';
import { ttDim, ttLabel, ttTitle } from './tooltip';

const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${body}</svg>`;

/** Every line's icon has this size. */
export const LINE_ICON = { w: 16, h: 20 };
/** A standard line or Narrow Gauge seen from above, in px across: bed, sleepers, rail to rail. */
const TRACKS: Partial<Record<TrackClass, { bed: number; sleeper: number; gauge: number }>> = {
  narrow: { bed: 7, sleeper: 5.2, gauge: 2.6 },
  branch: { bed: 9, sleeper: 7, gauge: 4 },
  main: { bed: 11, sleeper: 8, gauge: 4 },
  trunk: { bed: 13, sleeper: 8, gauge: 4 },
};
const LENGTH = LINE_ICON.h - 3;
const TOP = 1.5;

/** A piece of track standing upright in the middle of the icon, a sleeper per driving wheel. */
function trackSvg(line: TrackClass, bed: number, sleeper: number, gauge: number): string {
  const cx = LINE_ICON.w / 2;
  const left = cx - bed / 2;
  const strip = (x: number) =>
    `<rect x="${x}" y="${TOP}" width="1" height="${LENGTH}" fill="var(--line-trunk-edge)"/>`;
  let out = `<rect x="${left}" y="${TOP}" width="${bed}" height="${LENGTH}" fill="var(--line-${line})"/>`;
  // the Trunk Line's two pale cable troughs
  if (line === 'trunk') out += strip(left + 0.3) + strip(left + bed - 1.3);
  const ties = ENGINES[lineClass(line) as keyof typeof ENGINES].drivers[2];
  for (let i = 0; i < ties; i++) {
    const y = TOP + (LENGTH * (i + 0.5)) / ties - 0.8;
    out += `<rect class="tie" x="${cx - sleeper / 2}" y="${y}" width="${sleeper}" height="1.6" fill="var(--line-${line}-sleeper)"/>`;
  }
  for (const d of [-gauge / 2, gauge / 2])
    out += `<rect x="${cx + d - 0.5}" y="${TOP}" width="1" height="${LENGTH}" fill="var(--line-${line}-rail)"/>`;
  return out;
}

/** The fast lines seen end on: a car floating over its T beam, a pod inside its tube. */
function fastLineSvg(line: TrackClass): string {
  const cx = LINE_ICON.w / 2;
  const fill = (part: string) => `fill="var(--line-${line}${part})"`;
  if (line === 'hyperloop')
    return (
      `<circle cx="${cx}" cy="10" r="5.9" fill="none" stroke="var(--line-hyperloop)" stroke-width="2"/>` +
      `<rect x="${cx - 3}" y="7.8" width="6" height="4.4" rx="2" ${fill('-rail')}/>`
    );
  const wave = (y: number) =>
    `<path d="M${cx - 5} ${y}q1.7 -1.6 3.3 0t3.4 0t3.3 0" fill="none" stroke="var(--line-maglev-rail)" stroke-width="0.8"/>`;
  return (
    `<path d="M${cx - 5.5} 8.2V6c0 -2 2.4 -3.4 5.5 -3.4s5.5 1.4 5.5 3.4v2.2z" ${fill('')}/>` +
    wave(10) +
    wave(12) +
    `<rect x="${cx - 6}" y="13.4" width="12" height="1.6" ${fill('')}/>` +
    `<rect x="${cx - 1.6}" y="15" width="3.2" height="3.6" ${fill('')}/>`
  );
}

/** A line's icon as SVG markup: the same size for every line; DOM-free so it runs under Node. */
export function lineBadgeSvg(line: TrackClass): string {
  const t = TRACKS[line];
  return svg(
    LINE_ICON.w,
    LINE_ICON.h,
    `<rect x="0.5" y="0.5" width="${LINE_ICON.w - 1}" height="${LINE_ICON.h - 1}" rx="3" ` +
      `fill="var(--class-plate)" stroke="var(--class-edge)"/>` +
      (t ? trackSvg(line, t.bed, t.sleeper, t.gauge) : fastLineSvg(line)),
  );
}

/**
 * A steam engine side on, facing right, standing on y = 12.5: tender, cab, boiler with chimney
 * and dome, the driving wheels and the small leading and trailing wheels. All in px.
 */
export interface Engine {
  tender?: [x0: number, x1: number, top: number, axles: number];
  cab: [x0: number, x1: number, top: number];
  boiler: [x0: number, x1: number, top: number];
  chimney: [x: number, top: number];
  drivers: [first: number, pitch: number, count: number, r: number];
  pony?: number;
  trailing?: number;
}
/** Smallest to biggest: the engines of the classes of Narrow Gauge and the standard lines. */
export const ENGINES: Record<'corvette' | 'frigate' | 'destroyer' | 'cruiser', Engine> = {
  // a little narrow gauge tank engine, all cab and chimney
  corvette: {
    cab: [0.4, 4.4, 4.4],
    boiler: [4.4, 11.2, 6.2],
    chimney: [9.8, 3.4],
    drivers: [6, 3.4, 2, 1.45],
  },
  // a small six-coupled goods engine with a short tender
  frigate: {
    tender: [0, 4.4, 6.6, 2],
    cab: [4.9, 8.3, 4],
    boiler: [8.3, 16.9, 5.8],
    chimney: [15.4, 3],
    drivers: [9.9, 3, 3, 1.35],
  },
  // a mixed-traffic engine with four driving wheels and a three-axle tender
  destroyer: {
    tender: [0, 6.4, 6, 3],
    cab: [6.9, 10.5, 3.4],
    boiler: [10.5, 21.8, 5.4],
    chimney: [20.2, 2.6],
    drivers: [11.7, 2.5, 4, 1.2],
    pony: 21,
  },
  // a big express engine with five driving wheels and a long tender
  cruiser: {
    tender: [0, 8.8, 5.4, 4],
    cab: [9.3, 13.3, 2.8],
    boiler: [13.3, 28.4, 5],
    chimney: [26.8, 2.2],
    drivers: [15.2, 2.4, 5, 1.1],
    pony: 27,
    trailing: 12.9,
  },
};
/** How far an engine reaches, tender to buffer beam. */
export function engineReach(e: Engine): [x0: number, x1: number] {
  return [e.tender?.[0] ?? e.cab[0] - 0.3, Math.max(e.boiler[1] + 0.4, (e.pony ?? 0) + 0.8)];
}

/** Every class's icon has this size, whatever it shows. */
export const CLASS_ICON = { w: 38, h: 22 };
/** The step of a class on the standard lines' scale. */
export const CLASS_STEP: Partial<Record<TrainClass, number>> = {
  corvette: 1,
  frigate: 2,
  destroyer: 3,
  cruiser: 4,
  carrier: 4,
};
const STEPS = 4;
/** The engine's length in px at a step: every step adds the same. */
export const engineLength = (step: number) => 6 + 6 * step;

/** An engine in `--class-ink`, its cab window cut out in the plate's colour. */
function engineSvg(e: Engine): string {
  const ground = 12.6;
  const deck = 9.3;
  const r = (x0: number, x1: number, top: number, bottom: number, rx = 0) =>
    `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bottom - top}"${rx ? ` rx="${rx}"` : ''}/>`;
  const wheel = (cx: number, rad: number) => `<circle cx="${cx}" cy="${ground - rad}" r="${rad}"/>`;
  const parts: string[] = [];
  if (e.tender) {
    const [t0, t1, top, axles] = e.tender;
    parts.push(r(t0, t1, top, deck + 0.5, 0.5));
    const pitch = (t1 - t0 - 1.8) / Math.max(1, axles - 1);
    for (let i = 0; i < axles; i++) parts.push(wheel(t0 + 0.9 + i * pitch, 0.8));
  }
  const [c0, c1, cTop] = e.cab;
  // roof with its overhang, then the cab
  parts.push(r(c0 - 0.3, c1 + 0.2, cTop - 0.6, cTop + 0.1, 0.3), r(c0, c1, cTop, deck + 0.5));
  const [b0, b1, bTop] = e.boiler;
  parts.push(r(b0 - 0.2, b1, bTop, deck, Math.min(1.4, (deck - bTop) / 2)));
  const [chx, chTop] = e.chimney;
  parts.push(
    r(chx - 0.8, chx + 0.8, chTop, chTop + 0.6),
    r(chx - 0.55, chx + 0.55, chTop, bTop + 0.4),
  );
  parts.push(`<ellipse cx="${b0 + (b1 - b0) * 0.45}" cy="${bTop}" rx="0.9" ry="0.75"/>`);
  // running board and buffer beam
  parts.push(r(c0, b1 + 0.4, deck, deck + 0.6));
  const [d0, dp, dn, dr] = e.drivers;
  for (let i = 0; i < dn; i++) parts.push(wheel(d0 + i * dp, dr));
  if (e.pony !== undefined) parts.push(wheel(e.pony, 0.8));
  if (e.trailing !== undefined) parts.push(wheel(e.trailing, 0.8));
  const win = r(c0 + 0.7, c1 - 0.7, cTop + 0.9, cTop + 2.5, 0.2).replace(
    '/>',
    ' fill="var(--class-plate)"/>',
  );
  return `<g fill="var(--class-ink)">${parts.join('')}${win}</g>`;
}

/** An engine stretched to `length` px, in the middle of the icon. */
function placedEngine(e: Engine, length: number): string {
  const [x0, x1] = engineReach(e);
  const s = length / (x1 - x0);
  const x = (CLASS_ICON.w - length) / 2 - x0 * s;
  return `<g transform="translate(${x} -0.4) scale(${s} 1)">${engineSvg(e)}</g>`;
}

/** The scale under the engine: as many pips filled as the class's step, in the middle. */
function pips(step: number): string {
  const gap = 6;
  const x0 = CLASS_ICON.w / 2 - (gap * (STEPS - 1)) / 2;
  let out = '';
  for (let i = 0; i < STEPS; i++)
    out +=
      i < step
        ? `<circle class="pip on" cx="${x0 + i * gap}" cy="18.2" r="1.8" fill="var(--class-pip)"/>`
        : `<circle class="pip" cx="${x0 + i * gap}" cy="18.2" r="1.5" fill="none" stroke="var(--class-pip-off)" stroke-width="0.7"/>`;
  return out;
}

/** A long-nosed maglev train floating over its guideway, with a row of windows. */
function hydrofoilSvg(): string {
  const x = (CLASS_ICON.w - 30) / 2;
  const hole = 'fill="var(--class-plate)"';
  let windows = '';
  for (let i = 0; i < 5; i++)
    windows += `<rect x="${3 + i * 3.4}" y="7.4" width="2.2" height="1.9" rx="0.4" ${hole}/>`;
  return (
    `<g fill="var(--class-ink)" transform="translate(${x} 0)">` +
    `<path d="M0 13.4V7.6c0-1.6 1.1-2.6 2.8-2.6H17c4.4 0 9 2.6 13 7.4l0 1z"/>` +
    windows +
    // the driver's window, slanted with the nose
    `<path d="M20.2 7.4c1.8 0.4 3.5 1.2 5 2.3H20.2z" ${hole}/>` +
    `<rect y="11" width="26" height="0.6" ${hole}/>` +
    `<rect y="16" width="30" height="1.6" rx="0.4"/></g>`
  );
}

/** A hyperloop pod: a pointed rocket with tail fins and portholes. */
function submarineSvg(): string {
  const x = (CLASS_ICON.w - 30) / 2;
  const hole = 'fill="var(--class-plate)"';
  const portholes = [10, 14, 18].map((cx) => `<circle cx="${cx}" cy="11" r="1.2" ${hole}/>`);
  return (
    `<g fill="var(--class-ink)" transform="translate(${x} 0)">` +
    `<path d="M4 7.4H19c4.2 0 8.2 1.4 11 3.6c-2.8 2.2-6.8 3.6-11 3.6H4z"/>` +
    `<path d="M4 7.4L0.6 3.6H4.4L8.6 7.4z"/><path d="M4 14.6L0.6 18.4H4.4L8.6 14.6z"/>` +
    `<rect x="1.6" y="9" width="2.4" height="4" rx="0.5"/>` +
    portholes.join('') +
    `<path d="M23 9.6c1.4 0.3 2.6 0.8 3.6 1.4c-1 0.6-2.2 1.1-3.6 1.4z" ${hole}/></g>`
  );
}

/** A class's icon as SVG markup: the same size for every class, its picture in the middle. */
export function classBadgeSvg(tc: TrainClass): string {
  const step = CLASS_STEP[tc];
  const engine = ENGINES[tc === 'carrier' ? 'cruiser' : (tc as keyof typeof ENGINES)];
  const body =
    step === undefined
      ? tc === 'submarine'
        ? submarineSvg()
        : hydrofoilSvg()
      : placedEngine(engine, engineLength(step)) + pips(step);
  return svg(
    CLASS_ICON.w,
    CLASS_ICON.h,
    `<rect x="0.5" y="0.5" width="${CLASS_ICON.w - 1}" height="${CLASS_ICON.h - 1}" rx="3" ` +
      `fill="var(--class-plate)" stroke="var(--class-edge)"/>` +
      body,
  );
}

/** The class a line is the smallest home of (Branch Line: Frigate). */
function lineClass(line: TrackClass): TrainClass | undefined {
  return (Object.keys(CLASS_LINE) as TrainClass[]).find(
    (tc) => CLASS_LINE[tc] === line && tc !== 'carrier',
  );
}

/** What a line's tooltip says: the line, and the class it is built for. */
export function lineBadgeTip(line: TrackClass): [title: string, text: string] {
  const tc = lineClass(line);
  return [STR.toolbar.trackClass[line], tc ? STR.badge.line(STR.trainClass[tc]) : ''];
}
/** What a class's tooltip says: the class, its step on the scale, and the line it needs. */
export function classBadgeTip(tc: TrainClass): [title: string, text: string] {
  const line = STR.toolbar.trackClass[CLASS_LINE[tc]];
  const step = CLASS_STEP[tc];
  const text =
    step === undefined
      ? STR.badge.ownNetwork(line)
      : tc === 'carrier'
        ? STR.badge.carrier(step, STEPS, line)
        : STR.badge.step(step, STEPS, line);
  return [STR.badge.cls(STR.trainClass[tc]), text];
}

function label(markup: string, [title, text]: [string, string], cls: string): HTMLElement {
  const s = el('span', {});
  s.innerHTML = markup;
  return ttLabel(s, `line-badge ${cls}`, title, () => [ttTitle(title), ttDim(text)]);
}

/** The label of a track line: its letter plate. */
export function lineBadge(line: TrackClass): HTMLElement {
  return label(lineBadgeSvg(line), lineBadgeTip(line), 'line-plate');
}

/** The label of a train class: its icon. */
export function classBadge(tc: TrainClass): HTMLElement {
  return label(classBadgeSvg(tc), classBadgeTip(tc), 'class-badge');
}

/** The lines a class runs on, smallest first. */
export function linesOf(tc: TrainClass): TrackClass[] {
  return TRACK_CLASSES.filter((line) => classRunsOn(tc, line));
}

/** A label for every line a class runs on. */
export function trackBadges(tc: TrainClass): HTMLElement {
  return el('span', { class: 'track-badges' }, ...linesOf(tc).map(lineBadge));
}
