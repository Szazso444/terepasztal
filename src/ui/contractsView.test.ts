import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  LOW_TIME,
  activeByDeadline,
  contractTabs,
  deliveredShare,
  emptyKind,
  fmtDuration,
  payoutLost,
  pickTab,
  recentContracts,
  statusTone,
  timeIsLow,
} from './contractsView';

const c = (id: number, status: string, expires = 0) => ({ id, status, expires });

describe('what the Recent tab lists', () => {
  it('keeps the finished ones only: delivered, missed and cancelled', () => {
    const all = [c(1, 'offer'), c(2, 'active'), c(3, 'done'), c(4, 'expired'), c(5, 'failed')];
    expect(recentContracts(all).map((x) => x.id)).toEqual([5, 3]);
    expect(recentContracts([c(6, 'cancelled')]).map((x) => x.id)).toEqual([6]);
  });

  it('shows the newest first and keeps only the last twelve', () => {
    const all = Array.from({ length: 20 }, (_, i) => c(i + 1, 'done'));
    const shown = recentContracts(all);
    expect(shown).toHaveLength(HISTORY_LIMIT);
    expect(shown[0].id).toBe(20);
    expect(shown[HISTORY_LIMIT - 1].id).toBe(9);
  });

  it('leaves the list it is given as it was', () => {
    const all = [c(1, 'done'), c(2, 'done')];
    recentContracts(all);
    expect(all.map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('the Active tab', () => {
  it('puts the contract that runs out first on top, and leaves the board untouched', () => {
    const active = [c(1, 'active', 300), c(2, 'active', 100), c(3, 'active', 200)];
    expect(activeByDeadline(active).map((x) => x.id)).toEqual([2, 3, 1]);
    expect(active.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('calls the time low under a quarter of the deadline, and not at it', () => {
    expect(timeIsLow(LOW_TIME - 0.001)).toBe(true);
    expect(timeIsLow(LOW_TIME)).toBe(false);
    expect(timeIsLow(1)).toBe(false);
  });

  it('measures delivery as a share of the order, inside 0 to 1', () => {
    expect(deliveredShare({ delivered: 18, amount: 40 })).toBe(0.45);
    expect(deliveredShare({ delivered: 60, amount: 40 })).toBe(1);
    expect(deliveredShare({ delivered: -1, amount: 40 })).toBe(0);
    expect(deliveredShare({ delivered: 5, amount: 0 })).toBe(0);
  });
});

describe('a finished contract', () => {
  it('pays nothing when it was missed or cancelled', () => {
    expect(payoutLost('failed')).toBe(true);
    expect(payoutLost('cancelled')).toBe(true);
    expect(payoutLost('done')).toBe(false);
  });

  it('has a tone for its chip: good, bad, or dim', () => {
    expect(statusTone('done')).toBe('good');
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('cancelled')).toBe('dim');
    expect(statusTone('expired')).toBe('dim');
  });
});

describe('the tabs', () => {
  const labels = { offers: 'Offers', active: 'Active', history: 'Recent' };

  it('come in the order Offers, Active, Recent, each with its count', () => {
    expect(contractTabs({ offers: 5, active: 4, history: 12 }, labels)).toEqual([
      { id: 'offers', label: 'Offers', count: 5 },
      { id: 'active', label: 'Active', count: 4 },
      { id: 'history', label: 'Recent', count: 12 },
    ]);
  });

  it('leave the screen where it was for a tab that does not exist', () => {
    expect(pickTab('active', 'offers')).toBe('active');
    expect(pickTab('nope', 'history')).toBe('history');
  });
});

describe('an empty tab', () => {
  it('says why there are no offers: no stations that trade, or none yet', () => {
    expect(emptyKind('offers', true)).toBe('noOffers');
    expect(emptyKind('offers', false)).toBe('needStations');
    expect(emptyKind('active', true)).toBe('noActive');
    expect(emptyKind('history', false)).toBe('noHistory');
  });
});

describe('a duration as the game prints it', () => {
  it('is in days from a day up, and hours and minutes under it', () => {
    // a day is 240 s in the default rules
    expect(fmtDuration(240 * 4.1)).toBe('4.1d');
    expect(fmtDuration(240)).toBe('1.0d');
    expect(fmtDuration(240 * 0.5)).toBe('12h 00m');
    expect(fmtDuration(0)).toBe('0h 00m');
  });
});
