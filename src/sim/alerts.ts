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

/**
 * Each row's severity and the channels it starts on. An `event` tells of something that happened;
 * the other rows tell of a state, which the simulation finds again after a load.
 */
export const ALERT_DEFS: Record<
  AlertType,
  {
    readonly severity: AlertSeverity;
    readonly start: readonly AlertChannel[];
    readonly event?: true;
  }
> = {
  nofuel: { severity: 'critical', start: MARKED },
  stuck: { severity: 'critical', start: MARKED },
  ctfail: { severity: 'critical', start: ['icon', 'pin', 'toast'], event: true },
  noroute: { severity: 'problem', start: MARKED },
  full: { severity: 'problem', start: MARKED },
  starved: { severity: 'attention', start: MARKED },
  contract: { severity: 'attention', start: MARKED },
  jam: { severity: 'attention', start: MARKED },
  slow: { severity: 'info', start: ['icon'] },
  note: { severity: 'info', start: ['icon', 'toast'], event: true },
  done: { severity: 'info', start: ['toast'], event: true },
  offer: { severity: 'info', start: ['toast'], event: true },
  goal: { severity: 'info', start: ['popup', 'pause', 'toast'], event: true },
  arrived: { severity: 'info', start: [], event: true },
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

/** Game seconds an instance stays gone before its key can fire again: a flicker is no news. */
export const ALERT_REARM_SECONDS = 60;
/**
 * Game seconds after the first look in which a state is not news. A save does not hold what the
 * simulation works out as it runs (a stuck train takes it 30 s to see again, a works' reason one
 * step), so what it finds in this time was there before the load.
 */
export const ALERT_LOAD_QUIET_SECONDS = 60;

/**
 * Says what each new instance sets off, `now` being the game time. A channel fires once for a key
 * while the instance lasts, and again only once it has been gone for `ALERT_REARM_SECONDS`, so
 * neither a resume nor a flicker pauses for the same one twice. A game just opened has nothing new
 * to tell of itself: what stands at the first look fires nothing, nor does a state found in the
 * `ALERT_LOAD_QUIET_SECONDS` after it. An event still does, a warning the load pushed among them.
 */
export class AlertTracker {
  /** each key's last sighting, in game seconds, until it has been gone long enough to fire again */
  private seen = new Map<string, number>();
  /** the game time of the first look */
  private start: number | null = null;

  update(list: readonly Notice[], s: AlertSettings, now: number): AlertFire[] {
    const first = this.start === null;
    this.start ??= now;
    const quiet = now - this.start < ALERT_LOAD_QUIET_SECONDS;
    const fires: AlertFire[] = [];
    for (const n of list) {
      const last = this.seen.get(n.key);
      this.seen.set(n.key, now);
      if (last !== undefined && now - last < ALERT_REARM_SECONDS) continue;
      if (first && n.expires === undefined) continue;
      if (quiet && !ALERT_DEFS[n.type].event) continue;
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
    for (const [key, last] of this.seen)
      if (now - last >= ALERT_REARM_SECONDS) this.seen.delete(key);
    return fires;
  }
}

/** A good in a store counts as full from its cap until it falls below this share of it. */
export const STORE_FULL_CLEARS_BELOW = 0.95;
/** Whether a good is full now, `was` saying it was: at a cap it would flap with every unit. */
export function storeStaysFull(was: boolean, have: number, cap: number): boolean {
  return have >= (was ? cap * STORE_FULL_CLEARS_BELOW : cap - 1e-6);
}

/** With less than this share of its term left, a contract is at risk. */
export const CONTRACT_RISK_SHARE = 0.25;
/** An active contract at risk: `remaining` is the share of its term left. */
export function contractAtRisk(remaining: number, delivered: number, amount: number): boolean {
  return remaining < CONTRACT_RISK_SHARE && delivered < amount - 1e-6;
}
