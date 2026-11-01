import type { SoundEvent } from './audio';

/**
 * The volumes the player sets, as one group under another: Master over Music and Effects, Effects
 * over the groups here. Volumes multiply: master × effects × group, and master × music. A row
 * switched off counts 0 and keeps its level. Pure, so settings, the bus and the Audio screen share
 * it and Node tests read it.
 */

/** The kinds of sound under Effects: the two ambience beds, then the sound events' groups. */
export const SOUND_GROUPS = [
  'weather',
  'environment',
  'ui',
  'building',
  'trains',
  'events',
] as const;
export type SoundGroup = (typeof SOUND_GROUPS)[number];

/** Which group turns each sound event up or down. Ambience takes `weather` and `environment`. */
export const EVENT_GROUP: Record<SoundEvent, SoundGroup> = {
  'ui.click': 'ui',
  'ui.open': 'ui',
  'ui.close': 'ui',
  'build.place': 'building',
  'build.remove': 'building',
  'build.invalid': 'building',
  'train.dispatch': 'trains',
  'train.whistle': 'trains',
  'train.arrive': 'trains',
  'station.upgrade': 'events',
  'upgrade.done': 'events',
  'contract.accept': 'events',
  'contract.done': 'events',
  'contract.fail': 'events',
  // crafting: the events keep the names of the machine crafting replaced
  'gacha.pull': 'events',
  'gacha.reveal': 'events',
  'gacha.ssr': 'events',
  'tier.up': 'events',
};

/** A row of the Audio screen. `sfx` is Effects, under the name settings files have always had. */
export type VolumeKey = 'master' | 'music' | 'sfx' | SoundGroup;

/** The rows a row sits under: any of them off silences it. */
export function rowsOver(key: VolumeKey): readonly VolumeKey[] {
  if (key === 'master') return [];
  return key === 'music' || key === 'sfx' ? ['master'] : ['master', 'sfx'];
}

/** The part of the settings that holds the volumes. */
export interface Volumes {
  master: number;
  sfx: number;
  music: number;
  soundGroups: Record<SoundGroup, number>;
  /** the rows switched off; each keeps its level */
  soundOff: Partial<Record<VolumeKey, boolean>>;
}

/**
 * Ambience stood at master × 0.35 and passed by Effects, whose default is 0.8. It goes through
 * Effects now, so this is the level at which the wind and the birds come out as loud as they did.
 */
const AMBIENCE_DEFAULT = 0.35 / 0.8;

export const DEFAULT_VOLUMES: Volumes = {
  master: 0.8,
  sfx: 0.8,
  music: 0.5,
  soundGroups: {
    weather: AMBIENCE_DEFAULT,
    environment: AMBIENCE_DEFAULT,
    ui: 1,
    building: 1,
    trains: 1,
    events: 1,
  },
  soundOff: {},
};

/** A row's level, on or off. */
export function volumeLevel(v: Volumes, key: VolumeKey): number {
  return key === 'master' || key === 'sfx' || key === 'music' ? v[key] : v.soundGroups[key];
}

/** Set a row's level. */
export function setVolumeLevel(v: Volumes, key: VolumeKey, level: number) {
  if (key === 'master' || key === 'sfx' || key === 'music') v[key] = level;
  else v.soundGroups[key] = level;
}

/** The levels as they sound: a row switched off is 0. What the audio bus is given. */
export interface HeardVolumes {
  master: number;
  sfx: number;
  music: number;
  groups: Record<SoundGroup, number>;
}

export function heardVolumes(v: Volumes): HeardVolumes {
  const heard = (key: VolumeKey) => (v.soundOff[key] ? 0 : volumeLevel(v, key));
  return {
    master: heard('master'),
    sfx: heard('sfx'),
    music: heard('music'),
    groups: Object.fromEntries(SOUND_GROUPS.map((g) => [g, heard(g)])) as Record<
      SoundGroup,
      number
    >,
  };
}

/** How loud the music plays. */
export const musicGain = (v: HeardVolumes) => v.master * v.music;

/** How loud a group under Effects plays. */
export const groupGain = (v: HeardVolumes, group: SoundGroup) => v.master * v.sfx * v.groups[group];
