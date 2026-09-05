/**
 * Sound hooks. No assets ship yet: every game event calls `sfx(name)`; if `/assets/audio/<name>.ogg`
 * exists it plays, otherwise the call is a no-op (logged when debugging). Volumes come from settings.
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

class AudioBus {
  master = 0.8;
  sfx = 0.8;
  music = 0.5;
  debugLog = false;
  private cache = new Map<string, HTMLAudioElement | null>();

  play(name: SoundEvent) {
    if (this.debugLog) console.debug(`[sfx] ${name}`);
    const vol = this.master * this.sfx;
    if (vol <= 0) return;
    let a = this.cache.get(name);
    if (a === undefined) {
      a = new Audio(`/assets/audio/${name}.ogg`);
      a.addEventListener('error', () => this.cache.set(name, null), { once: true });
      this.cache.set(name, a);
    }
    if (!a) return;
    try {
      const inst = a.cloneNode() as HTMLAudioElement;
      inst.volume = Math.min(1, vol);
      void inst.play().catch(() => {});
    } catch {
      /* autoplay restrictions or missing file */
    }
  }
}
export const audio = new AudioBus();
export function sfx(name: SoundEvent) {
  audio.play(name);
}
