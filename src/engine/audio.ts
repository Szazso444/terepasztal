import { Synth } from './synth';

/**
 * Sound bus. Every game event calls `sfx(name)`. If `/assets/audio/<name>.ogg` exists it is
 * played; otherwise the procedural synthesizer renders the event. Music is generated at runtime.
 * Volumes come from settings. The Web Audio context is unlocked on the first user gesture.
 */
export const SOUND_EVENTS = [
  'ui.click',
  'ui.open',
  'ui.close',
  'build.place',
  'build.remove',
  'build.invalid',
  'station.upgrade',
  'train.dispatch',
  'train.whistle',
  'train.arrive',
  'contract.accept',
  'contract.done',
  'contract.fail',
  'gacha.pull',
  'gacha.reveal',
  'gacha.ssr',
  'tier.up',
] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

type FileState = { el: HTMLAudioElement; status: 'probing' | 'ready' | 'missing' };

class AudioBus {
  master = 0.8;
  sfx = 0.8;
  music = 0.5;
  debugLog = false;
  readonly synth = new Synth();
  private files = new Map<string, FileState>();
  private unlocked = false;
  /** Throttle identical events so bursts (drag-laying) do not stack. */
  private lastPlayed = new Map<string, number>();

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  unlock() {
    const ctx = this.synth.ensure();
    if (!ctx) return;
    this.synth.markGesture();
    if (!this.unlocked) {
      this.unlocked = true;
      this.applyMusic();
    }
  }

  applyMusic() {
    if (!this.unlocked) return;
    const v = this.master * this.music;
    if (v > 0) {
      this.synth.startMusic();
      this.synth.setMusicVolume(v);
    } else this.synth.setMusicVolume(0);
  }

  private probe(name: string): FileState {
    let f = this.files.get(name);
    if (f) return f;
    const el = new Audio(`/assets/audio/${name}.ogg`);
    f = { el, status: 'probing' };
    el.addEventListener('canplaythrough', () => (f!.status = 'ready'), { once: true });
    el.addEventListener('error', () => (f!.status = 'missing'), { once: true });
    el.load();
    this.files.set(name, f);
    return f;
  }

  play(name: SoundEvent) {
    if (this.debugLog) console.debug(`[sfx] ${name}`);
    const vol = this.master * this.sfx;
    if (vol <= 0) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? -1000;
    if (now - last < 45) return;
    this.lastPlayed.set(name, now);
    const f = this.probe(name);
    if (f.status === 'ready') {
      try {
        const inst = f.el.cloneNode() as HTMLAudioElement;
        inst.volume = Math.min(1, vol);
        void inst.play().catch(() => {});
        return;
      } catch {
        /* fall through to the synth */
      }
    }
    this.synth.play(name, vol);
  }
}
export const audio = new AudioBus();
export function sfx(name: SoundEvent) {
  audio.play(name);
}
