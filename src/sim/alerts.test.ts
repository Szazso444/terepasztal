import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_CHANNELS,
  ALERT_DEFS,
  ALERT_TYPES,
  AlertTracker,
  alertOn,
  alertSettingsFrom,
  contractAtRisk,
  defaultAlertSettings,
  type AlertChannel,
  type AlertSettings,
  type AlertType,
} from './alerts';
import { DEFAULT_SETTINGS, SETTINGS_KEY, readSettings, writeSettings } from './save';
import type { Notice } from './notices';

/** A standing notice of a type, as `Notices.refresh` derives it. */
function standing(key: string, type: AlertType): Notice {
  return { key, kind: 'bad', type, text: key, target: null };
}
/** A pushed notice of a type: it carries its lifetime. */
function pushed(key: string, type: AlertType, more: Partial<Notice> = {}): Notice {
  return { ...standing(key, type), expires: 100, ...more };
}
/** A tracker past the first look, so that everything it is shown next is new. */
function running() {
  const t = new AlertTracker();
  t.update([], defaultAlertSettings());
  return t;
}
/** The defaults with the cells of one row set as given. */
function withRow(type: AlertType, on: AlertChannel[]): AlertSettings {
  const s = defaultAlertSettings();
  for (const c of ALERT_CHANNELS) s.channels[type][c] = on.includes(c);
  return s;
}

describe('the alert rows', () => {
  const on = (type: AlertType) =>
    ALERT_CHANNELS.filter((c) => alertOn(defaultAlertSettings(), type, c));

  it('gives every row a severity, critical first and info last', () => {
    const order = ['critical', 'problem', 'attention', 'info'];
    const ranks = ALERT_TYPES.map((t) => order.indexOf(ALERT_DEFS[t].severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks).not.toContain(-1);
  });

  it('leaves the two event rows out: the sim has no events yet', () => {
    expect(ALERT_TYPES).not.toContain('evchoice');
    expect(ALERT_TYPES).not.toContain('evnone');
    expect(ALERT_TYPES).toHaveLength(14);
  });

  it('starts every alert on the alert icon and the map pin, as the mock does', () => {
    for (const t of ['nofuel', 'stuck', 'noroute', 'full', 'starved', 'contract', 'jam'] as const)
      expect(on(t), t).toEqual(['icon', 'pin']);
    expect(on('ctfail')).toEqual(['icon', 'pin', 'toast']);
  });

  it('starts a note and a slow train on the alert icon alone', () => {
    expect(on('note')).toEqual(['icon']);
    expect(on('slow')).toEqual(['icon']);
  });

  it('starts the rows that are not alerts where the mock starts them', () => {
    expect(on('done')).toEqual(['toast']);
    expect(on('offer')).toEqual(['icon', 'toast']);
    expect(on('goal')).toEqual(['popup', 'pause', 'toast']);
    expect(on('arrived')).toEqual([]);
  });
});

describe('what a new instance triggers (AlertTracker)', () => {
  const s = defaultAlertSettings();

  it('fires once per new key, never on each refresh', () => {
    const t = running();
    const list = [standing('t1:fuel', 'nofuel')];
    expect(t.update(list, s)).toHaveLength(1);
    expect(t.update(list, s)).toEqual([]);
    expect(t.update(list, s)).toEqual([]);
  });

  it('does not pause again for the same one after a resume', () => {
    const t = running();
    const list = [standing('t1:stuck', 'stuck')];
    expect(t.update(list, s).map((f) => f.pause)).toEqual([true]);
    // the player resumes; the train is still stuck at the next refresh
    expect(t.update(list, s)).toEqual([]);
  });

  it('fires again after the instance went away and came back', () => {
    const t = running();
    const list = [standing('t1:fuel', 'nofuel')];
    expect(t.update(list, s)).toHaveLength(1);
    expect(t.update([], s)).toEqual([]);
    expect(t.update(list, s)).toHaveLength(1);
  });

  it('fires per instance, not per type', () => {
    const t = running();
    const fires = t.update([standing('a', 'nofuel'), standing('b', 'nofuel')], s);
    expect(fires.map((f) => f.notice.key)).toEqual(['a', 'b']);
    // one more of the same type is one more new key
    const more = [standing('a', 'nofuel'), standing('b', 'nofuel'), standing('c', 'nofuel')];
    expect(t.update(more, s).map((f) => f.notice.key)).toEqual(['c']);
  });

  it('counts the first look as what stands, not as news', () => {
    const t = new AlertTracker();
    expect(t.update([standing('t1:fuel', 'nofuel')], s)).toEqual([]);
    expect(t.update([standing('t1:fuel', 'nofuel')], s)).toEqual([]);
    // what stood at the first look fires when it comes back, like any other
    t.update([], s);
    expect(t.update([standing('t1:fuel', 'nofuel')], s)).toHaveLength(1);
  });

  it('counts what was pushed before the first look as news: an event happened', () => {
    const t = new AlertTracker();
    const row = withRow('note', ['toast']);
    const fires = t.update([standing('t1:fuel', 'nofuel'), pushed('save:pruned', 'note')], row);
    expect(fires.map((f) => f.notice.key)).toEqual(['save:pruned']);
  });

  it('reads each channel from the matrix', () => {
    for (const c of ['popup', 'pause', 'toast'] as const) {
      const row = withRow('jam', [c]);
      const [fire] = running().update([standing('j1', 'jam')], row);
      expect(fire, c).toEqual({
        notice: standing('j1', 'jam'),
        popup: c === 'popup',
        pause: c === 'pause',
        toast: c === 'toast',
      });
    }
  });

  it('leaves out an instance that triggers nothing, and has it fire nothing later', () => {
    const t = running();
    const list = [standing('n', 'note')];
    expect(t.update(list, s)).toEqual([]);
    expect(t.update(list, withRow('note', ['toast']))).toEqual([]);
  });

  it('pauses on a critical alert with the switch on, whatever the row says', () => {
    const row = withRow('nofuel', []);
    const fires = running().update([standing('a', 'nofuel')], row);
    expect(fires.map((f) => f.pause)).toEqual([true]);
  });

  it('with the switch off a critical alert pauses only if its row says so', () => {
    const off = { ...withRow('nofuel', []), criticalPause: false };
    expect(running().update([standing('a', 'nofuel')], off)).toEqual([]);
    const row = { ...withRow('nofuel', ['pause']), criticalPause: false };
    const fires = running().update([standing('a', 'nofuel')], row);
    expect(fires.map((f) => f.pause)).toEqual([true]);
  });

  it('the switch reaches critical alerts only', () => {
    expect(running().update([standing('a', 'noroute')], s)).toEqual([]);
    const row = withRow('noroute', ['pause']);
    const fires = running().update([standing('a', 'noroute')], row);
    expect(fires.map((f) => f.pause)).toEqual([true]);
  });

  it('the Group switch changes the icons, not what fires', () => {
    const list = [standing('a', 'stuck'), standing('b', 'stuck')];
    const off = { ...s, group: false };
    expect(running().update(list, off)).toEqual(running().update(list, s));
  });

  it('keeps the toast of an event that has its own', () => {
    const row = withRow('note', ['toast', 'popup']);
    const fires = running().update([pushed('upgrade:1,1', 'note', { toast: null })], row);
    expect(fires.map((f) => [f.toast, f.popup])).toEqual([[false, true]]);
  });

  it('fires nothing for a toast of its own and nothing else on', () => {
    const row = withRow('note', ['toast']);
    expect(running().update([pushed('upgrade:1,1', 'note', { toast: null })], row)).toEqual([]);
  });
});

describe('alert settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fills everything in for a settings file that has none', () => {
    expect(alertSettingsFrom(undefined)).toEqual(defaultAlertSettings());
    expect(alertSettingsFrom(null)).toEqual(defaultAlertSettings());
    expect(alertSettingsFrom('x')).toEqual(defaultAlertSettings());
  });

  it('starts with both switches on', () => {
    expect(defaultAlertSettings()).toMatchObject({ criticalPause: true, group: true });
  });

  it('keeps what is there and fills in a missing row, cell or switch', () => {
    const got = alertSettingsFrom({
      channels: { stuck: { popup: true }, jam: { pin: false } },
      group: false,
    });
    const want = defaultAlertSettings();
    want.channels.stuck.popup = true;
    want.channels.jam.pin = false;
    want.group = false;
    expect(got).toEqual(want);
  });

  it('takes a default for what is not a boolean', () => {
    const got = alertSettingsFrom({
      channels: { stuck: { popup: 'yes', pin: null }, jam: 3 },
      criticalPause: 0,
    });
    expect(got).toEqual(defaultAlertSettings());
  });

  it('drops a row it does not know', () => {
    const got = alertSettingsFrom({ channels: { evnone: { toast: true } } });
    expect(Object.keys(got.channels)).toEqual([...ALERT_TYPES]);
  });

  it('shares no object between two defaults', () => {
    const a = defaultAlertSettings();
    a.channels.stuck.popup = true;
    expect(defaultAlertSettings().channels.stuck.popup).toBe(false);
  });

  it('is filled in by readSettings for an older settings file, and travels with it', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => items.set(k, v),
    });
    const older: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS };
    delete older.alerts;
    items.set(SETTINGS_KEY, JSON.stringify(older));
    const read = readSettings();
    expect(read.alerts).toEqual(defaultAlertSettings());
    read.alerts.channels.note.toast = true;
    expect(DEFAULT_SETTINGS.alerts.channels.note.toast).toBe(false);
    writeSettings(read);
    expect(readSettings().alerts.channels.note.toast).toBe(true);
  });
});

describe('a contract at risk (contractAtRisk)', () => {
  it('is one with less than a quarter of its term left', () => {
    expect(contractAtRisk(0.2499, 0, 10)).toBe(true);
    expect(contractAtRisk(0, 0, 10)).toBe(true);
  });

  it('is not one with a quarter left, or more', () => {
    expect(contractAtRisk(0.25, 0, 10)).toBe(false);
    expect(contractAtRisk(0.2501, 0, 10)).toBe(false);
    expect(contractAtRisk(1, 0, 10)).toBe(false);
  });

  it('counts a part delivered as not delivered', () => {
    expect(contractAtRisk(0.1, 9.9, 10)).toBe(true);
  });

  it('is not one that is delivered', () => {
    expect(contractAtRisk(0.1, 10, 10)).toBe(false);
    // what the board counts as complete
    expect(contractAtRisk(0.1, 10 - 1e-7, 10)).toBe(false);
  });
});
