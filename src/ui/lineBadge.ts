/**
 * The badges of the track lines and the train classes (specs/track-classes.md). A line's badge is
 * a plate in the line's colour with its letter: N Narrow Gauge, B Branch, M Main, T Trunk Line,
 * Mg Maglev Guideway, H Hyperloop Tube. It marks the line's track pieces. A class's badge is the
 * same plate with the silhouette of a locomotive beside it that grows with the class (a small tank
 * engine for the Corvette up to a big express engine with a long tender for the Cruiser); it marks
 * every engine, wagon and train of that class, so the letter says which track it needs and the
 * engine how big it is. The colours echo each line's bed (warm stone, pale granite, dark basalt)
 * and live in style.css as `--line-<line>` and `--line-<line>-ink`.
 */
import type { TrainClass } from '../data/content';
import { CLASS_LINE } from '../sim/compat';
import { STR } from '../strings';
import type { TrackClass } from '../world/track';

export const LINE_LETTER: Record<TrackClass, string> = {
  narrow: 'N',
  branch: 'B',
  main: 'M',
  trunk: 'T',
  maglev: 'Mg',
  hyperloop: 'H',
};

const H = 14;
const plateWidth = (line: TrackClass) => (LINE_LETTER[line].length > 1 ? 18 : 14);
const plate = (line: TrackClass, w: number) =>
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${H - 1}" rx="3" fill="var(--line-${line})" ` +
  `stroke="var(--line-${line}-edge, var(--border-dark))"/>`;
const letter = (line: TrackClass, cx: number) => {
  const t = LINE_LETTER[line];
  return (
    `<text x="${cx}" y="10.6" text-anchor="middle" font-family="Verdana, sans-serif" ` +
    `font-weight="bold" font-size="${t.length > 1 ? 8 : 10.5}" fill="var(--line-${line}-ink)">${t}</text>`
  );
};
const svg = (w: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" aria-hidden="true">${body}</svg>`;

/** A line's badge as SVG markup, 14 px tall; DOM-free so it runs under Node. */
export function lineBadgeSvg(line: TrackClass): string {
  const w = plateWidth(line);
  return svg(w, plate(line, w) + letter(line, w / 2));
}

/**
 * A steam engine side on, facing right, standing on y = 12.5: tender, cab, boiler with chimney
 * and dome, the driving wheels and the small leading and trailing wheels. All in px.
 */
interface Engine {
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
  // a mixed-traffic 4-6-0 with a three-axle tender
  destroyer: {
    tender: [0, 6.4, 6, 3],
    cab: [6.9, 10.5, 3.4],
    boiler: [10.5, 21.8, 5.4],
    chimney: [20.2, 2.6],
    drivers: [12.2, 3.2, 3, 1.45],
    pony: 20.6,
  },
  // a big 4-8-4 express engine with a long tender
  cruiser: {
    tender: [0, 8.8, 5.4, 4],
    cab: [9.3, 13.3, 2.8],
    boiler: [13.3, 28.4, 5],
    chimney: [26.8, 2.2],
    drivers: [15.4, 2.9, 4, 1.35],
    pony: 27,
    trailing: 12.9,
  },
};
/** px the badge keeps for its engine: room for the biggest, so the engines line up by size */
const ENGINE_ROOM = 29;

/** An engine in `ink`; its cab window is cut out in `hole`, the badge's own colour. */
function engineSvg(e: Engine, ink: string, hole: string, x: number): string {
  const ground = 12.6;
  const deck = 9.3;
  const r = (x0: number, x1: number, top: number, bottom: number, rx = 0) =>
    `<rect x="${x + x0}" y="${top}" width="${x1 - x0}" height="${bottom - top}"${rx ? ` rx="${rx}"` : ''}/>`;
  const wheel = (cx: number, rad: number) =>
    `<circle cx="${x + cx}" cy="${ground - rad}" r="${rad}"/>`;
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
  parts.push(`<ellipse cx="${x + b0 + (b1 - b0) * 0.45}" cy="${bTop}" rx="0.9" ry="0.75"/>`);
  // running board and buffer beam
  parts.push(r(c0, b1 + 0.4, deck, deck + 0.6));
  const [d0, dp, dn, dr] = e.drivers;
  for (let i = 0; i < dn; i++) parts.push(wheel(d0 + i * dp, dr));
  if (e.pony !== undefined) parts.push(wheel(e.pony, 0.8));
  if (e.trailing !== undefined) parts.push(wheel(e.trailing, 0.8));
  const win = r(c0 + 0.7, c1 - 0.7, cTop + 0.9, cTop + 2.5, 0.2).replace('/>', ` fill="${hole}"/>`);
  return `<g fill="${ink}">${parts.join('')}${win}</g>`;
}

/** A streamlined car for the classes of the separate fast networks, which have no steam. */
function podSvg(tc: TrainClass, ink: string, x: number): string {
  if (tc === 'submarine')
    return `<g fill="${ink}"><rect x="${x + 2}" y="4.2" width="24" height="6.6" rx="3.3"/></g>`;
  return (
    `<g fill="${ink}"><path d="M${x + 1} 10.8V6.4c0-1.2 1-2 2.4-2h15.6c3.4 0 6.6 1.6 8.6 4.2l0.8 2.2z"/>` +
    `<rect x="${x + 1}" y="11.4" width="27" height="1.1"/></g>`
  );
}

const ATOM_ROOM = 9;
const atom = (ink: string, cx: number) =>
  `<g fill="none" stroke="${ink}" stroke-width="0.8">` +
  [0, 60, -60]
    .map((a) => `<ellipse cx="${cx}" cy="7" rx="3.4" ry="1.3" transform="rotate(${a} ${cx} 7)"/>`)
    .join('') +
  `</g><circle cx="${cx}" cy="7" r="0.9" fill="${ink}"/>`;

/** A class's badge as SVG markup: its line's letter plate and its engine beside it. */
export function classBadgeSvg(tc: TrainClass): string {
  const line = CLASS_LINE[tc];
  const lw = plateWidth(line);
  const w = lw + ENGINE_ROOM + 4 + (tc === 'carrier' ? ATOM_ROOM : 0);
  const ink = `var(--line-${line}-ink)`;
  const engine =
    tc === 'hydrofoil' || tc === 'submarine'
      ? podSvg(tc, ink, lw + 1.5)
      : engineSvg(ENGINES[tc === 'carrier' ? 'cruiser' : tc], ink, `var(--line-${line})`, lw + 2);
  return svg(
    w,
    plate(line, w) +
      letter(line, lw / 2) +
      `<path d="M${lw} 2.5v9" stroke="${ink}" stroke-width="0.6" opacity="0.5"/>` +
      engine +
      (tc === 'carrier' ? atom(ink, w - ATOM_ROOM / 2 - 1) : ''),
  );
}

/** The class a line is the smallest home of, for the badge's tooltip (Branch Line: Frigate). */
function lineClass(line: TrackClass): TrainClass | undefined {
  return (Object.keys(CLASS_LINE) as TrainClass[]).find(
    (tc) => CLASS_LINE[tc] === line && tc !== 'carrier',
  );
}

/** Tooltip of a line's badge: the line and the class it is built for. */
export function lineBadgeTitle(line: TrackClass): string {
  const tc = lineClass(line);
  const name = STR.toolbar.trackClass[line];
  return tc ? STR.badge.line(name, STR.trainClass[tc]) : name;
}
/** Tooltip of a class's badge: the class and the line it needs. */
export function classBadgeTitle(tc: TrainClass): string {
  return STR.badge.cls(STR.trainClass[tc], STR.toolbar.trackClass[CLASS_LINE[tc]]);
}

function badgeEl(markup: string, title: string, cls = 'line-badge'): HTMLElement {
  const s = document.createElement('span');
  s.className = cls;
  s.title = title;
  s.innerHTML = markup;
  return s;
}

/** The badge of a track line: its letter plate. */
export function lineBadge(line: TrackClass): HTMLElement {
  return badgeEl(lineBadgeSvg(line), lineBadgeTitle(line));
}

/** The badge of a train class: its line's letter and its engine, the Carrier's with the atom. */
export function classBadge(tc: TrainClass): HTMLElement {
  return badgeEl(classBadgeSvg(tc), classBadgeTitle(tc), 'line-badge class-badge');
}
