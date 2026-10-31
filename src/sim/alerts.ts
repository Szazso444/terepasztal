import type { Notice } from './notices';

/**
 * What the game tells the player and how. Every `Notice` has a type, one row of the Notifications
 * screen: the type sets its severity, and the player's settings say which of the five channels it
 * reaches. `Notices` stays the one source; this module only decides, so it runs under Node.
 */

/** The columns of the Notifications screen, in its order. */
export const ALERT_CHANNELS = ['popup', 'pause', 'icon', 'pin', 'toast'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_SEVERITIES = ['critical', 'problem', 'attention', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * The rows of the Notifications screen, in its order, which is also the alert bar's: the worst
 * first. The last four are not alerts: news the player may ask to hear of.
 */
export const ALERT_TYPES = [
  'nofuel',
  'stuck',
  'ctfail',
  'noroute',
  'full',
  'starved',
  'contract',
  'jam',
  'slow',
  'note',
  'done',
  'offer',
  'goal',
  'arrived',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

const MARKED: readonly AlertChannel[] = ['icon', 'pin'];

/** Each row's severity and the channels it starts on. */
export const ALERT_DEFS: Record<
  AlertType,
  { readonly severity: AlertSeverity; readonly start: readonly AlertChannel[] }
> = {
  nofuel: { severity: 'critical', start: MARKED },
  stuck: { severity: 'critical', start: MARKED },
  ctfail: { severity: 'critical', start: ['icon', 'pin', 'toast'] },
  noroute: { severity: 'problem', start: MARKED },
  full: { severity: 'problem', start: MARKED },
  starved: { severity: 'attention', start: MARKED },
  contract: { severity: 'attention', start: MARKED },
  jam: { severity: 'attention', start: MARKED },
  slow: { severity: 'info', start: ['icon'] },
  note: { severity: 'info', start: ['icon'] },
  done: { severity: 'info', start: ['toast'] },
  offer: { severity: 'info', start: ['icon', 'toast'] },
  goal: { severity: 'info', start: ['popup', 'pause', 'toast'] },
  arrived: { severity: 'info', start: [] },
};

export type AlertRow = Record<AlertChannel, boolean>;
/** The Notifications screen's choices; they travel with the settings, not the save. */
export interface AlertSettings {
  channels: Record<AlertType, AlertRow>;
  /** a critical alert pauses the game whatever its row says */
  criticalPause: boolean;
  /** one icon for each type; off, one for each instance */
  group: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Alert settings from what a settings file holds, which may be older than this build or nothing
 * at all: each row, cell or switch that is missing or is not a boolean takes its default.
 */
export function alertSettingsFrom(stored: unknown): AlertSettings {
  const s = isRecord(stored) ? stored : {};
  const rows = isRecord(s.channels) ? s.channels : {};
  const channels = {} as Record<AlertType, AlertRow>;
  for (const type of ALERT_TYPES) {
    const had = rows[type];
    const row = isRecord(had) ? had : {};
    const start = ALERT_DEFS[type].start;
    channels[type] = {} as AlertRow;
    for (const c of ALERT_CHANNELS) channels[type][c] = bool(row[c], start.includes(c));
  }
  return { channels, criticalPause: bool(s.criticalPause, true), group: bool(s.group, true) };
}
export function defaultAlertSettings(): AlertSettings {
  return alertSettingsFrom(undefined);
}
export function alertOn(s: AlertSettings, type: AlertType, channel: AlertChannel): boolean {
  return s.channels[type][channel];
}

/** What one new instance sets off, of the channels that act once. */
export interface AlertFire {
  notice: Notice;
  popup: boolean;
  pause: boolean;
  toast: boolean;
}

/**
 * Says what each new instance sets off. A channel fires once for a key while the instance lasts,
 * and again only after it went away and came back, so a resume does not pause for the same one
 * twice. What already stands at the first look (a game just opened) is not news; what was pushed by
 * then is, as it tells of something that happened.
 */
export class AlertTracker {
  private seen = new Set<string>();
  private first = true;

  update(list: readonly Notice[], s: AlertSettings): AlertFire[] {
    const fires: AlertFire[] = [];
    const now = new Set<string>();
    for (const n of list) {
      now.add(n.key);
      if (this.seen.has(n.key) || (this.first && n.expires === undefined)) continue;
      const row = s.channels[n.type];
      const critical = s.criticalPause && ALERT_DEFS[n.type].severity === 'critical';
      const fire = {
        notice: n,
        popup: row.popup,
        pause: row.pause || critical,
        toast: row.toast && n.toast !== null,
      };
      if (fire.popup || fire.pause || fire.toast) fires.push(fire);
    }
    this.seen = now;
    this.first = false;
    return fires;
  }
}

/** With less than this share of its term left, a contract is at risk. */
export const CONTRACT_RISK_SHARE = 0.25;
/** An active contract at risk: `remaining` is the share of its term left. */
export function contractAtRisk(remaining: number, delivered: number, amount: number): boolean {
  return remaining < CONTRACT_RISK_SHARE && delivered < amount - 1e-6;
}
