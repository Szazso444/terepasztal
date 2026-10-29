/**
 * The badge of a track line (specs/track-classes.md): the line's colour with one to three bars for
 * Branch, Main and Trunk Line, or an icon for a separate network. The same badge marks the line's
 * track pieces and every engine, wagon and train of the class that needs that line, so the player
 * matches stock to track at a glance. The colours echo each line's bed (warm stone, pale granite,
 * dark basalt) and live in style.css as `--line-<line>` and `--line-<line>-ink`.
 */
import type { TrainClass } from '../data/content';
import { CLASS_LINE } from '../sim/compat';
import { STR } from '../strings';
import { LINES, type TrackClass } from '../world/track';

export type BadgeIcon = 'rails' | 'wave' | 'ring';
export interface BadgeLook {
  line: TrackClass;
  /** bars for a standard line's size step, 0 for a separate network */
  bars: number;
  icon: BadgeIcon | null;
  /** the atom mark of the Carrier class */
  atom: boolean;
}

const ICON: Partial<Record<TrackClass, BadgeIcon>> = {
  narrow: 'rails',
  maglev: 'wave',
  hyperloop: 'ring',
};

export function badgeLook(line: TrackClass, atom = false): BadgeLook {
  const def = LINES[line];
  return {
    line,
    bars: def.network === 'standard' ? def.tier : 0,
    icon: ICON[line] ?? null,
    atom,
  };
}

/** The badge as SVG markup, 14 px tall; DOM-free so it runs under Node. */
export function badgeSvg(look: BadgeLook): string {
  const fill = `var(--line-${look.line})`,
    ink = `var(--line-${look.line}-ink)`;
  const w = look.atom ? 32 : 22;
  const parts: string[] = [];
  if (look.bars) {
    const span = look.bars * 3 + (look.bars - 1) * 2;
    const x0 = (22 - span) / 2;
    for (let i = 0; i < look.bars; i++)
      parts.push(`<rect x="${x0 + i * 5}" y="3" width="3" height="8" fill="${ink}"/>`);
  } else if (look.icon === 'rails') {
    parts.push(
      `<path d="M7 4h8M7 7h8M7 10h8" stroke="${ink}" stroke-width="1.2" opacity="0.7"/>`,
      `<path d="M9 2.5v9M13 2.5v9" stroke="${ink}" stroke-width="1.6"/>`,
    );
  } else if (look.icon === 'wave') {
    parts.push(
      `<path d="M4 9c2-4 4-4 6 0s4 4 6 0 2-2 2-2" fill="none" stroke="${ink}" stroke-width="1.6"/>`,
      `<path d="M5 4h12" stroke="${ink}" stroke-width="1.2" opacity="0.7"/>`,
    );
  } else if (look.icon === 'ring') {
    parts.push(
      `<circle cx="11" cy="7" r="4" fill="none" stroke="${ink}" stroke-width="1.6"/>`,
      `<circle cx="11" cy="7" r="1.2" fill="${ink}"/>`,
    );
  }
  if (look.atom)
    parts.push(
      `<g fill="none" stroke="${ink}" stroke-width="0.9">`,
      `<ellipse cx="26" cy="7" rx="4.2" ry="1.6"/>`,
      `<ellipse cx="26" cy="7" rx="4.2" ry="1.6" transform="rotate(60 26 7)"/>`,
      `<ellipse cx="26" cy="7" rx="4.2" ry="1.6" transform="rotate(-60 26 7)"/>`,
      `</g><circle cx="26" cy="7" r="1" fill="${ink}"/>`,
    );
  return (
    `<svg viewBox="0 0 ${w} 14" width="${w}" height="14" aria-hidden="true">` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="13" rx="3" fill="${fill}" ` +
    `stroke="var(--line-${look.line}-edge, var(--border-dark))"/>${parts.join('')}</svg>`
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

function badgeEl(look: BadgeLook, title: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'line-badge';
  s.title = title;
  s.innerHTML = badgeSvg(look);
  return s;
}

/** The badge of a track line. */
export function lineBadge(line: TrackClass): HTMLElement {
  return badgeEl(badgeLook(line), lineBadgeTitle(line));
}

/** The badge of a train class: its line's badge, the Carrier's with the atom mark. */
export function classBadge(tc: TrainClass): HTMLElement {
  return badgeEl(badgeLook(CLASS_LINE[tc], tc === 'carrier'), classBadgeTitle(tc));
}
