import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_CHANNELS,
  ALERT_DEFS,
  ALERT_LOAD_QUIET_SECONDS,
  ALERT_REARM_SECONDS,
  ALERT_TYPES,
  AlertTracker,
  alertOn,
  alertSettingsFrom,
  contractAtRisk,
  defaultAlertSettings,
  storeStaysFull,
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
/** Game time well past the quiet after the load. */
const LATER = ALERT_LOAD_QUIET_SECONDS + 1000;
/** A tracker past the quiet after the load, so that what it is shown at `LATER` is new. */
function running() {
  const t = new AlertTracker();
  t.update([], defaultAlertSettings(), 0);
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
    expect(ALERT_TYPES).toHaveLength(16);
  });

  it('starts every alert on the alert icon and the map pin, and a critical pause says why', () => {
    for (const t of [
      'noroute',
      'trackbroken',
      'full',
      'starved',
      'contract',
      'jam',
      'trackworn',
    ] as const)
      expect(on(t), t).toEqual(['icon', 'pin']);
    expect(on('ctfail')).toEqual(['icon', 'pin', 'toast']);
    expect(on('nofuel')).toEqual(['icon', 'pin', 'toast']);
    expect(on('stuck')).toEqual(['icon', 'pin', 'toast']);
  });

  it('starts a slow train on the alert icon alone', () => {
    expect(on('slow')).toEqual(['icon']);
  });

  it('starts a note with a toast too, so a lost-ground warning is seen', () => {
    expect(on('note')).toEqual(['icon', 'toast']);
  });

  it('keeps the bar for what needs attention: an offer is a toast alone', () => {
    expect(on('offer')).toEqual(['toast']);
  });

  it('starts the other rows that are not alerts where the mock starts them', () => {
    expect(on('done')).toEqual(['toast']);
    expect(on('goal')).toEqual(['popup', 'pause', 'toast']);
    expect(on('arrived')).toEqual([]);
  });
});

describe('what a new instance triggers (AlertTracker)', () => {
  const s = defaultAlertSettings();

  it('fires once per new key, never on each refresh', () => {
    const t = running();
    const list = [standing('t1:fuel', 'nofuel')];
    expect(t.update(list, s, LATER)).toHaveLength(1);
    expect(t.update(list, s, LATER + 1)).toEqual([]);
    expect(t.update(list, s, LATER + 2)).toEqual([]);
  });

  it('does not pause again for the same one after a resume', () => {
    const t = running();
    const list = [standing('t1:stuck', 'stuck')];
    expect(t.update(list, s, LATER).map((f) => f.pause)).toEqual([true]);
    // the player resumes; the train is still stuck at the next refresh
    expect(t.update(list, s, LATER + 1)).toEqual([]);
  });

  it('stays quiet for a key that lasts far longer than the re-arm time', () => {
    const t = running();
    const list = [standing('t1:stuck', 'stuck')];
    expect(t.update(list, s, LATER)).toHaveLength(1);
    for (let at = 1; at < 300; at++) expect(t.update(list, s, LATER + at)).toEqual([]);
  });

  it('fires again once the instance has been gone for the re-arm time', () => {
    const t = running();
    const list = [standing('t1:stuck', 'stuck')];
    expect(t.update(list, s, LATER)).toHaveLength(1);
    t.update([], s, LATER + 1);
    expect(t.update(list, s, LATER + ALERT_REARM_SECONDS)).toHaveLength(1);
  });

  it('does not fire for a flicker: back within the re-arm time is the same one', () => {
    const t = running();
    const list = [standing('t1:stuck', 'stuck')];
    expect(t.update(list, s, LATER)).toHaveLength(1);
    let at = LATER;
    for (let i = 0; i < 20; i++) {
      at += ALERT_REARM_SECONDS / 2 - 1;
      t.update([], s, at);
      at += 1;
      expect(t.update(list, s, at), `back at ${at}`).toEqual([]);
    }
  });

  it('counts the 60 s from when it was last there, not from when it fired', () => {
    expect(ALERT_REARM_SECONDS).toBe(60);
    const t = running();
    const list = [standing('t1:stuck', 'stuck')];
    t.update(list, s, LATER);
    t.update(list, s, LATER + 100);
    t.update([], s, LATER + 101);
    expect(t.update(list, s, LATER + 100 + ALERT_REARM_SECONDS - 1)).toEqual([]);
    t.update([], s, LATER + 200);
    expect(t.update(list, s, LATER + 200 + ALERT_REARM_SECONDS)).toHaveLength(1);
  });

  it('fires per instance, not per type', () => {
    const t = running();
    const fires = t.update([standing('a', 'nofuel'), standing('b', 'nofuel')], s, LATER);
    expect(fires.map((f) => f.notice.key)).toEqual(['a', 'b']);
    // one more of the same type is one more new key
    const more = [standing('a', 'nofuel'), standing('b', 'nofuel'), standing('c', 'nofuel')];
    expect(t.update(more, s, LATER + 1).map((f) => f.notice.key)).toEqual(['c']);
  });

  it('reads each channel from the matrix', () => {
    for (const c of ['popup', 'pause', 'toast'] as const) {
      const row = withRow('jam', [c]);
      const [fire] = running().update([standing('j1', 'jam')], row, LATER);
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
    const list = [standing('n', 'slow')];
    expect(t.update(list, s, LATER)).toEqual([]);
    expect(t.update(list, withRow('slow', ['toast']), LATER + 1)).toEqual([]);
  });

  it('pauses on a critical alert with the switch on, whatever the row says', () => {
    const row = withRow('nofuel', []);
    const fires = running().update([standing('a', 'nofuel')], row, LATER);
    expect(fires.map((f) => f.pause)).toEqual([true]);
  });

  it('with the switch off a critical alert pauses only if its row says so', () => {
    const off = { ...withRow('nofuel', []), criticalPause: false };
    expect(running().update([standing('a', 'nofuel')], off, LATER)).toEqual([]);
    const row = { ...withRow('nofuel', ['pause']), criticalPause: false };
    const fires = running().update([standing('a', 'nofuel')], row, LATER);
    expect(fires.map((f) => f.pause)).toEqual([true]);
  });

  it('the switch reaches critical alerts only', () => {
    expect(running().update([standing('a', 'noroute')], s, LATER)).toEqual([]);
    const row = withRow('noroute', ['pause']);
    const fires = running().update([standing('a', 'noroute')], row, LATER);
    expect(fires.map((f) => f.pause)).toEqual([true]);
  });

  it('the Group switch changes the icons, not what fires', () => {
    const list = [standing('a', 'stuck'), standing('b', 'stuck')];
    const off = { ...s, group: false };
    expect(running().update(list, off, LATER)).toEqual(running().update(list, s, LATER));
  });

  it('keeps the toast of an event that has its own', () => {
    const row = withRow('note', ['toast', 'popup']);
    const fires = running().update([pushed('upgrade:1,1', 'note', { toast: null })], row, LATER);
    expect(fires.map((f) => [f.toast, f.popup])).toEqual([[false, true]]);
  });

  it('fires nothing for a toast of its own and nothing else on', () => {
    const row = withRow('note', ['toast']);
    const list = [pushed('upgrade:1,1', 'note', { toast: null })];
    expect(running().update(list, row, LATER)).toEqual([]);
  });
});

describe('after a load: the first 60 game seconds', () => {
  const s = defaultAlertSettings();
  /** A tracker that took its first look at game time `at`, the list given standing then. */
  function loaded(at = 5000, list: Notice[] = []) {
    const t = new AlertTracker();
    t.update(list, s, at);
    return t;
  }

  it('is 60 s, and outlasts how long the traffic takes to call a train stuck again', () => {
    expect(ALERT_LOAD_QUIET_SECONDS).toBe(60);
    const traffic = readFileSync(new URL('./traffic.ts', import.meta.url), 'utf8');
    const stuckAfter = Number(/const STUCK_AFTER = (\d+);/.exec(traffic)?.[1]);
    expect(stuckAfter).toBeLessThan(ALERT_LOAD_QUIET_SECONDS);
  });

  it('what stands at the first look fires nothing, then or later', () => {
    const list = [standing('t1:fuel', 'nofuel')];
    const t = new AlertTracker();
    expect(t.update(list, s, 5000)).toEqual([]);
    expect(t.update(list, s, 5001)).toEqual([]);
    for (let at = 5002; at < 5200; at += 10) expect(t.update(list, s, at), `${at}`).toEqual([]);
  });

  it('a stuck train found again 30 s in does not pause', () => {
    const t = loaded();
    const list = [standing('t7:stuck', 'stuck')];
    expect(t.update([], s, 5029)).toEqual([]);
    expect(t.update(list, s, 5030)).toEqual([]);
  });

  it('nor when it is still stuck after the 60 s', () => {
    const t = loaded();
    const list = [standing('t7:stuck', 'stuck')];
    t.update(list, s, 5030);
    for (let at = 5031; at < 5200; at += 10) expect(t.update(list, s, at), `${at}`).toEqual([]);
  });

  it('keeps every row the sim finds again quiet, on any channel', () => {
    const every = defaultAlertSettings();
    for (const type of ALERT_TYPES)
      for (const c of ['popup', 'pause', 'toast'] as const) every.channels[type][c] = true;
    const found = ['nofuel', 'stuck', 'noroute', 'full', 'starved', 'contract', 'jam', 'slow'];
    for (const type of found) {
      const t = loaded();
      const list = [standing('a', type as AlertType)];
      expect(t.update(list, every, 5001), type).toEqual([]);
    }
  });

  it('a junction alert is pushed, but it is found again like the rest', () => {
    const t = loaded();
    expect(t.update([pushed('j3', 'jam')], s, 5010)).toEqual([]);
  });

  it('counts game seconds: a stopped clock stays in the quiet', () => {
    const t = loaded();
    expect(t.update([standing('t7:stuck', 'stuck')], s, 5000)).toEqual([]);
  });

  it('ends at 60 s: what is new from then on is news', () => {
    const t = loaded();
    const list = [standing('t7:stuck', 'stuck')];
    expect(t.update(list, s, 5000 + ALERT_LOAD_QUIET_SECONDS - 1)).toEqual([]);
    const other = [...list, standing('t8:stuck', 'stuck')];
    const fires = t.update(other, s, 5000 + ALERT_LOAD_QUIET_SECONDS);
    expect(fires.map((f) => f.notice.key)).toEqual(['t8:stuck']);
  });

  it('a save warning pushed by the load still fires: something happened', () => {
    const t = new AlertTracker();
    const list = [standing('t1:fuel', 'nofuel'), pushed('save:ground', 'note')];
    const fires = t.update(list, s, 5000);
    expect(fires.map((f) => [f.notice.key, f.toast])).toEqual([['save:ground', true]]);
  });

  it('what happens in the quiet still fires: a contract fails, an age comes', () => {
    const t = loaded();
    const fires = t.update([pushed('c1', 'ctfail'), pushed('age:1', 'goal')], s, 5010);
    expect(fires.map((f) => f.notice.key)).toEqual(['c1', 'age:1']);
  });

  it('a new offer in the quiet is news; the ones the save held are not', () => {
    const t = loaded(5000, [standing('offer:1', 'offer')]);
    const list = [standing('offer:1', 'offer'), standing('offer:2', 'offer')];
    expect(t.update(list, s, 5010).map((f) => f.notice.key)).toEqual(['offer:2']);
  });

  it('every row is either found again or an event, by what it tells of', () => {
    const events = ALERT_TYPES.filter((t) => ALERT_DEFS[t].event);
    expect(events).toEqual(['ctfail', 'trackworn', 'note', 'done', 'offer', 'goal', 'arrived']);
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
    read.alerts.channels.slow.toast = true;
    expect(DEFAULT_SETTINGS.alerts.channels.slow.toast).toBe(false);
    writeSettings(read);
    expect(readSettings().alerts.channels.slow.toast).toBe(true);
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

describe('a store full of a good (storeStaysFull)', () => {
  it('becomes full at its cap, not before', () => {
    expect(storeStaysFull(false, 100, 100)).toBe(true);
    expect(storeStaysFull(false, 99.9, 100)).toBe(false);
  });

  it('stays full down to 95 percent, so it does not flap at the cap', () => {
    expect(storeStaysFull(true, 99, 100)).toBe(true);
    expect(storeStaysFull(true, 95, 100)).toBe(true);
  });

  it('clears below 95 percent', () => {
    expect(storeStaysFull(true, 94.9, 100)).toBe(false);
  });
});
