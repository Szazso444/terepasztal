import {
  rowsOver,
  setVolumeLevel,
  SOUND_GROUPS,
  volumeLevel,
  type VolumeKey,
  type Volumes,
} from '../engine/audioGroups';
import { STR } from '../strings';
import { el } from './dom';
import { formRow, note, slider, toggleSwitch, well, type FootSpec } from './kit';
import type { Screen } from './modal';

interface VolumeRow {
  key: VolumeKey;
  label: string;
  covers?: string;
}

/** The rows top to bottom; each stands in as far as it has rows over it (`rowsOver`). */
const ROWS: VolumeRow[] = [
  { key: 'master', label: STR.settings.master },
  { key: 'music', label: STR.settings.music },
  { key: 'sfx', label: STR.settings.sfx },
  ...SOUND_GROUPS.map((key) => ({ key, ...STR.settings.soundGroups[key] })),
];

/**
 * The volumes, one group under another: Master over Music and Effects, Effects over the groups.
 * Each row has a slider and a switch, so a group can be turned off without losing its level.
 */
export class AudioScreen implements Screen {
  readonly id = 'audio';
  readonly title = STR.settings.audio;
  readonly frameSize = 'M';
  readonly icon = 'speaker';
  readonly formKeys = true;
  readonly root = el('div', { class: 'k-page' });
  private rows = new Map<VolumeKey, HTMLElement>();

  constructor(
    private readonly volumes: Volumes,
    private readonly onChange: () => void,
  ) {}

  onOpen() {
    this.root.replaceChildren(
      well(null, ...ROWS.map((r) => this.row(r)), note(STR.settings.audioNote)),
    );
    this.markSilenced();
  }
  frameFooter(): FootSpec {
    return { note: STR.settings.appliesAtOnce, done: true };
  }

  private row({ key, label, covers }: VolumeRow): HTMLElement {
    const v = this.volumes;
    const row = formRow(
      label,
      el(
        'span',
        { class: 'au-ctl' },
        slider({
          label,
          value: Math.round(volumeLevel(v, key) * 100),
          onInput: (level) => {
            setVolumeLevel(v, key, level / 100);
            this.onChange();
          },
        }),
        toggleSwitch(
          label,
          () => !v.soundOff[key],
          (on) => {
            v.soundOff[key] = !on;
            this.markSilenced();
            this.onChange();
          },
        ),
      ),
      covers,
    );
    row.classList.add(`au-depth${rowsOver(key).length}`);
    this.rows.set(key, row);
    return row;
  }

  /** A row under one that is off keeps its controls and reads as silent. */
  private markSilenced() {
    const off = this.volumes.soundOff;
    for (const [key, row] of this.rows)
      row.classList.toggle(
        'au-silenced',
        rowsOver(key).some((over) => off[over]),
      );
  }
}
