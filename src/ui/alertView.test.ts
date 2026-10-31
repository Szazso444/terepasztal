import { describe, expect, it } from 'vitest';
import { ALERT_TYPES, defaultAlertSettings, type AlertType } from '../sim/alerts';
import type { Notice, NoticeTarget } from '../sim/notices';
import { STR } from '../strings';
import {
  ALERT_ICON,
  MAX_ALERT_ICONS,
  alertGroups,
  alertIconSvg,
  alertTip,
  fitGroups,
  hiddenTip,
  nextInstance,
  noticeToastKind,
  noticeToastText,
  type AlertGroup,
} from './alertView';
import { blockText, type TipDoc } from './tooltipDoc';

const TILE: NoticeTarget = { kind: 'tile', x: 1, y: 2 };
const tipText = (doc: TipDoc) => doc.map(blockText);
function notice(key: string, type: AlertType, target: NoticeTarget = TILE): Notice {
  return { key, kind: 'bad', type, text: `says ${key}`, target };
}

describe('alertGroups', () => {
  const s = defaultAlertSettings();

  it('makes one icon per type with its instances, the worst first', () => {
    const list = [
      notice('a', 'slow'),
      notice('b', 'nofuel'),
      notice('c', 'jam'),
      notice('d', 'nofuel'),
    ];
    const groups = alertGroups(list, s);
    expect(groups.map((g) => g.type)).toEqual(['nofuel', 'jam', 'slow']);
    expect(groups[0].notices.map((n) => n.key)).toEqual(['b', 'd']);
    expect(groups[0].severity).toBe('critical');
    expect(groups[2].severity).toBe('info');
  });

  it('with the Group switch off gives each instance its own icon, the worst first', () => {
    const list = [notice('a', 'slow'), notice('b', 'nofuel'), notice('c', 'nofuel')];
    const groups = alertGroups(list, { ...s, group: false });
    expect(groups.map((g) => g.notices.map((n) => n.key))).toEqual([['b'], ['c'], ['a']]);
    expect(new Set(groups.map((g) => g.id)).size).toBe(3);
  });

  it('shows nothing for a type whose Alert icon is off', () => {
    const off = defaultAlertSettings();
    off.channels.jam.icon = false;
    expect(alertGroups([notice('a', 'jam')], off)).toEqual([]);
    // news the player did not ask to see in the bar stays out of it by default
    expect(alertGroups([notice('a', 'done'), notice('b', 'goal')], s)).toEqual([]);
  });

  it('is empty for an empty list', () => {
    expect(alertGroups([], s)).toEqual([]);
  });
});

describe('fitGroups', () => {
  const groups = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `g${i}` }) as unknown as AlertGroup);

  it('shows all that fit', () => {
    const { shown, hidden } = fitGroups(groups(MAX_ALERT_ICONS));
    expect(shown).toHaveLength(MAX_ALERT_ICONS);
    expect(hidden).toEqual([]);
  });

  it('gives the last slot to what is left over, so the bar never overflows', () => {
    const { shown, hidden } = fitGroups(groups(MAX_ALERT_ICONS + 3));
    expect(shown).toHaveLength(MAX_ALERT_ICONS - 1);
    expect(hidden).toHaveLength(4);
    expect(hidden[0].id).toBe(`g${MAX_ALERT_ICONS - 1}`);
  });
});

describe('nextInstance', () => {
  const group = (notices: Notice[]): AlertGroup => ({
    id: 'nofuel',
    type: 'nofuel',
    severity: 'critical',
    notices,
  });
  const three = group([notice('a', 'nofuel'), notice('b', 'nofuel'), notice('c', 'nofuel')]);

  it('starts at the first and names it with its place', () => {
    const n = nextInstance(three, null);
    expect(n?.notice.key).toBe('a');
    expect(n?.line).toBe('says a (1/3)');
  });

  it('cycles through them and wraps', () => {
    expect(nextInstance(three, 'a')?.line).toBe('says b (2/3)');
    expect(nextInstance(three, 'b')?.line).toBe('says c (3/3)');
    expect(nextInstance(three, 'c')?.line).toBe('says a (1/3)');
  });

  it('starts over when the last one it went to is gone', () => {
    expect(nextInstance(three, 'gone')?.notice.key).toBe('a');
  });

  it('gives no place for a single instance', () => {
    expect(nextInstance(group([notice('a', 'nofuel')]), null)?.line).toBe('says a');
  });

  it('skips a notice with no target and counts without it', () => {
    const mixed = group([
      notice('a', 'note', null),
      notice('b', 'note'),
      notice('c', 'note', null),
      notice('d', 'note'),
    ]);
    expect(nextInstance(mixed, null)?.line).toBe('says b (1/2)');
    expect(nextInstance(mixed, 'b')?.line).toBe('says d (2/2)');
  });

  it('is nothing when no instance has a target', () => {
    expect(nextInstance(group([notice('a', 'note', null)]), null)).toBeNull();
  });
});

describe('the tooltips', () => {
  const lines = (n: number): AlertGroup => ({
    id: 'nofuel',
    type: 'nofuel',
    severity: 'critical',
    notices: Array.from({ length: n }, (_, i) => notice(`t${i}`, 'nofuel')),
  });

  it('name the type and its severity, and each instance', () => {
    const text = tipText(alertTip(lines(2)));
    expect(text).toContain(STR.alerts.type.nofuel);
    expect(text).toContain(STR.alerts.severity.critical);
    expect(text).toContain('says t0');
    expect(text).toContain('says t1');
  });

  it('show a notice with no target too', () => {
    const g: AlertGroup = {
      id: 'note',
      type: 'note',
      severity: 'info',
      notices: [notice('save', 'note', null)],
    };
    expect(tipText(alertTip(g))).toContain('says save');
  });

  it('stop at a length that fits the screen and say how many more', () => {
    const text = tipText(alertTip(lines(30)));
    expect(text).toContain('says t9');
    expect(text).not.toContain('says t10');
    expect(text).toContain(STR.notice.more(20));
  });

  it('of the leftovers list what the bar has no room for', () => {
    const text = tipText(hiddenTip([lines(1), { ...lines(1), type: 'stuck', id: 'stuck' }]));
    expect(text).toContain(STR.alerts.hidden(2));
    expect(text).toContain('says t0');
  });
});

describe('the words and colour of a toast', () => {
  it('say what the notice says, unless it brought its own', () => {
    expect(noticeToastText(notice('a', 'ctfail'))).toBe('says a');
    expect(noticeToastText({ ...notice('a', 'ctfail'), toast: 'fined' })).toBe('fined');
  });

  it('are good news for the two that are, warnings for what is wrong, plain for the rest', () => {
    expect(noticeToastKind('done')).toBe('good');
    expect(noticeToastKind('goal')).toBe('good');
    expect(noticeToastKind('ctfail')).toBe('warn');
    expect(noticeToastKind('noroute')).toBe('warn');
    expect(noticeToastKind('jam')).toBe('warn');
    expect(noticeToastKind('note')).toBe('info');
    expect(noticeToastKind('offer')).toBe('info');
  });
});

describe('the icons', () => {
  it('has one for every type', () => {
    for (const t of ALERT_TYPES) {
      expect(ALERT_ICON[t], t).toBeTruthy();
      expect(alertIconSvg(ALERT_ICON[t], 18), t).toContain(ALERT_ICON[t]);
    }
  });

  it('draws in the colour of its text', () => {
    expect(alertIconSvg(ALERT_ICON.nofuel, 18)).toContain('stroke="currentColor"');
  });
});

describe('strings', () => {
  it('names every row, every severity and every channel', () => {
    for (const t of ALERT_TYPES) expect(STR.alerts.type[t], t).toBeTruthy();
    for (const k of ['critical', 'problem', 'attention', 'info'] as const)
      expect(STR.alerts.severity[k], k).toBeTruthy();
    for (const k of ['popup', 'pause', 'icon', 'pin', 'toast'] as const)
      expect(STR.alerts.channel[k], k).toBeTruthy();
  });
});
