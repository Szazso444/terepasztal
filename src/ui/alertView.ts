/**
 * What the alert bar shows, worked out from the notices: its icons, their tooltips, where a click
 * goes next. No DOM here, so it runs under Node; `alertBar.ts` draws it.
 */
import {
  ALERT_DEFS,
  ALERT_TYPES,
  alertOn,
  type AlertSettings,
  type AlertSeverity,
  type AlertType,
} from '../sim/alerts';
import type { Notice } from '../sim/notices';
import { STR } from '../strings';
import { dim, text, title, type Block, type TipDoc } from './tooltipDoc';

/** The inside of each icon the alert bar draws, on a 24 px grid: the workshop mock's set. */
const FUEL =
  '<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3.5 21h13M15 9h2a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8l-3-3M7.5 7h5"/>';
const TRAIN =
  '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10.5h14M8.5 21l2-4M15.5 21l-2-4"/><circle cx="9" cy="13.8" r=".6"/><circle cx="15" cy="13.8" r=".6"/>';
const SCROLL =
  '<path d="M7 3h11v14.5a3.5 3.5 0 0 1-3.5 3.5H7.5A3.5 3.5 0 0 1 4 17.5V17h10v.5a3.5 3.5 0 0 0 3.5 3.5M7 3a2.5 2.5 0 0 0-2.5 2.5V8H7M10 8h5M10 12h5"/>';
const RAIL = '<path d="M8.5 3L6 21M15.5 3L18 21M6.8 7.5h10.4M6.2 12h11.6M5.6 16.5h12.8"/>';
const STATION = '<path d="M3 10l9-6 9 6M5 10v10h14V10M10 20v-5h4v5M3 20h18"/>';
const FACTORY = '<path d="M3 21V10l5 3v-3l5 3V6h3l1-3h2l1 3v15zM3 21h18"/>';
const SIGNAL =
  '<rect x="9" y="2" width="6" height="12" rx="3"/><circle cx="12" cy="6" r="1"/><circle cx="12" cy="10" r="1"/><path d="M12 14v7M8 21h8"/>';
const CLOCK = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>';
const NOTE = '<path d="M4 4.5h16v11h-9l-4 4v-4H4z"/>';
const RIBBON = '<path d="M5 3.5h14v17l-7-4-7 4z"/><path d="M9 8.5h6M9 12h4"/>';
const UP = '<path d="M12 20V5M6 11l6-6 6 6"/>';

export const ALERT_ICON: Record<AlertType, string> = {
  nofuel: FUEL,
  stuck: TRAIN,
  ctfail: SCROLL,
  noroute: RAIL,
  trackbroken: RAIL,
  full: STATION,
  starved: FACTORY,
  contract: SCROLL,
  jam: SIGNAL,
  trackworn: RAIL,
  slow: CLOCK,
  note: NOTE,
  done: SCROLL,
  offer: RIBBON,
  goal: UP,
  arrived: STATION,
};
/** The bell of the button that opens the Notifications screen. */
export const BELL_ICON =
  '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10 20a2 2 0 0 0 4 0"/>';

/** An icon's inside as SVG markup, drawn in the colour of the text around it. */
export function alertIconSvg(inner: string, size: number): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${inner}</svg>`
  );
}

/** One icon of the bar: a type with all its instances, or with the Group switch off one of them. */
export interface AlertGroup {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  notices: Notice[];
}

/** The icons the Alert icon cells let through, the worst first. */
export function alertGroups(list: readonly Notice[], s: AlertSettings): AlertGroup[] {
  const out: AlertGroup[] = [];
  for (const type of ALERT_TYPES) {
    if (!alertOn(s, type, 'icon')) continue;
    const notices = list.filter((n) => n.type === type);
    if (!notices.length) continue;
    const { severity } = ALERT_DEFS[type];
    if (s.group) out.push({ id: type, type, severity, notices });
    else for (const n of notices) out.push({ id: n.key, type, severity, notices: [n] });
  }
  return out;
}

/** The icons that fit the bar's 360 px beside its button. */
export const MAX_ALERT_ICONS = 7;
/** The icons to draw; when they do not all fit, the last slot speaks for the rest. */
export function fitGroups(groups: AlertGroup[], max = MAX_ALERT_ICONS) {
  if (groups.length <= max) return { shown: groups, hidden: [] as AlertGroup[] };
  return { shown: groups.slice(0, max - 1), hidden: groups.slice(max - 1) };
}

/** The slot that speaks for the icons with no room, as one group its clicks go through. */
export function hiddenGroup(hidden: AlertGroup[]): AlertGroup {
  const { type, severity } = hidden[0];
  return { id: 'hidden', type, severity, notices: hidden.flatMap((g) => g.notices) };
}

/** Where a click cycle stands: the instance it went to, and its place among them then. */
export interface CyclePlace {
  key: string;
  at: number;
}

/**
 * Where a click on an icon goes after `last`, with its place and the line that names it: the next
 * instance with a target, around the end and back. When the last one has gone, the one that took
 * its place is the next. Null when none has a target.
 */
export function nextInstance(
  group: AlertGroup,
  last: CyclePlace | null,
): { notice: Notice; at: number; line: string } | null {
  const can = group.notices.filter((n) => n.target);
  if (!can.length) return null;
  const was = can.findIndex((n) => n.key === last?.key);
  const at = was >= 0 ? (was + 1) % can.length : (last?.at ?? 0) % can.length;
  const notice = can[at];
  const line = can.length > 1 ? STR.alerts.cycle(notice.text, at + 1, can.length) : notice.text;
  return { notice, at, line };
}

/** A tooltip lists this many instances at most. */
const TIP_LINES = 10;
function instanceLines(notices: Notice[]): Block[] {
  const lines = notices.slice(0, TIP_LINES).map((n) => text(n.text));
  if (notices.length > TIP_LINES) lines.push(dim(STR.notice.more(notices.length - TIP_LINES)));
  return lines;
}
/** An icon's tooltip: the type, its severity, and what each instance says. */
export function alertTip(g: AlertGroup): TipDoc {
  return [
    title(STR.alerts.type[g.type]),
    dim(STR.alerts.severity[g.severity]),
    ...instanceLines(g.notices),
  ];
}
/** The tooltip of the slot that speaks for the icons with no room. */
export function hiddenTip(hidden: AlertGroup[]): TipDoc {
  return [
    title(STR.alerts.hidden(hidden.length)),
    ...instanceLines(hidden.flatMap((g) => g.notices)),
  ];
}

/** What the Toast channel says for a notice. */
export function noticeToastText(n: Notice): string {
  return n.toast ?? n.text;
}
/** The colour of a type's toast. */
export function noticeToastKind(type: AlertType): 'info' | 'warn' | 'good' {
  if (type === 'done' || type === 'goal') return 'good';
  // what reaches a note's toast is a save warning: an upgrade has its own
  if (type === 'note') return 'warn';
  return ALERT_DEFS[type].severity === 'info' ? 'info' : 'warn';
}
