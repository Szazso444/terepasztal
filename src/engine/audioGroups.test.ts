import { describe, expect, it } from 'vitest';
import { SOUND_EVENTS } from './audio';
import {
  DEFAULT_VOLUMES,
  EVENT_GROUP,
  groupGain,
  heardVolumes,
  musicGain,
  rowsOver,
  setVolumeLevel,
  SOUND_GROUPS,
  volumeLevel,
  type Volumes,
} from './audioGroups';

const volumes = (over: Partial<Volumes> = {}): Volumes => ({
  ...DEFAULT_VOLUMES,
  soundGroups: { ...DEFAULT_VOLUMES.soundGroups },
  soundOff: {},
  ...over,
});

describe('the group table', () => {
  it('gives every sound event a group, and lists nothing else', () => {
    expect(Object.keys(EVENT_GROUP).sort()).toEqual([...SOUND_EVENTS].sort());
    for (const name of SOUND_EVENTS) expect(SOUND_GROUPS, name).toContain(EVENT_GROUP[name]);
  });

  it('puts each event where its name says, and the rest under Events', () => {
    for (const name of SOUND_EVENTS) {
      const want = name.startsWith('ui.')
        ? 'ui'
        : name.startsWith('build.')
          ? 'building'
          : name.startsWith('train.')
            ? 'trains'
            : 'events';
      expect(EVENT_GROUP[name], name).toBe(want);
    }
  });

  it('leaves Weather and Environment to the ambience', () => {
    const used = new Set(Object.values(EVENT_GROUP));
    expect(used.has('weather')).toBe(false);
    expect(used.has('environment')).toBe(false);
  });

  it('sets Music and Effects under Master, and the groups under Effects', () => {
    expect(rowsOver('master')).toEqual([]);
    expect(rowsOver('music')).toEqual(['master']);
    expect(rowsOver('sfx')).toEqual(['master']);
    for (const g of SOUND_GROUPS) expect(rowsOver(g)).toEqual(['master', 'sfx']);
  });
});

describe('the gains', () => {
  it('multiply: master × effects × group, and master × music', () => {
    const v = volumes({ master: 0.5, sfx: 0.4, music: 0.3 });
    v.soundGroups.trains = 0.25;
    const heard = heardVolumes(v);
    expect(groupGain(heard, 'trains')).toBeCloseTo(0.05, 12);
    expect(musicGain(heard)).toBeCloseTo(0.15, 12);
  });

  it('keep music out of Effects, and Effects out of music', () => {
    const noEffects = heardVolumes(volumes({ sfx: 0, master: 1, music: 0.5 }));
    expect(musicGain(noEffects)).toBe(0.5);
    for (const g of SOUND_GROUPS) expect(groupGain(noEffects, g)).toBe(0);
    const noMusic = heardVolumes(volumes({ music: 0 }));
    expect(musicGain(noMusic)).toBe(0);
    expect(groupGain(noMusic, 'ui')).toBeGreaterThan(0);
  });

  it('silences a row switched off and what is under it, and only that', () => {
    const off = (row: keyof Volumes['soundOff']) =>
      heardVolumes(volumes({ soundOff: { [row]: true } }));
    expect(groupGain(off('ui'), 'ui')).toBe(0);
    expect(groupGain(off('ui'), 'building')).toBeGreaterThan(0);
    for (const g of SOUND_GROUPS) expect(groupGain(off('sfx'), g)).toBe(0);
    expect(musicGain(off('sfx'))).toBeGreaterThan(0);
    expect(musicGain(off('music'))).toBe(0);
    expect(groupGain(off('music'), 'ui')).toBeGreaterThan(0);
    expect(musicGain(off('master'))).toBe(0);
    for (const g of SOUND_GROUPS) expect(groupGain(off('master'), g)).toBe(0);
  });

  it('keeps the level of a row switched off, for when it comes back on', () => {
    const v = volumes();
    setVolumeLevel(v, 'trains', 0.3);
    setVolumeLevel(v, 'music', 0.2);
    v.soundOff = { trains: true, music: true };
    const heard = heardVolumes(v);
    expect([heard.groups.trains, heard.music]).toEqual([0, 0]);
    expect([volumeLevel(v, 'trains'), volumeLevel(v, 'music')]).toEqual([0.3, 0.2]);
    v.soundOff = {};
    expect(heardVolumes(v).groups.trains).toBe(0.3);
  });
});

describe('the defaults', () => {
  const heard = heardVolumes(DEFAULT_VOLUMES);

  it('leave the wind and the birds as loud as master × 0.35 had them', () => {
    expect(groupGain(heard, 'weather')).toBeCloseTo(0.8 * 0.35, 12);
    expect(groupGain(heard, 'environment')).toBeCloseTo(0.8 * 0.35, 12);
  });

  it('leave every sound event as loud as master × sfx had it', () => {
    for (const name of SOUND_EVENTS)
      expect(groupGain(heard, EVENT_GROUP[name]), name).toBeCloseTo(0.8 * 0.8, 12);
  });

  it('leave the music where it was, every row on', () => {
    expect(musicGain(heard)).toBeCloseTo(0.8 * 0.5, 12);
    expect(DEFAULT_VOLUMES.soundOff).toEqual({});
  });
});
