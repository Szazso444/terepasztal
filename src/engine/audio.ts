import { Synth } from './synth';
import { Ambience } from './ambience';
import { MusicSelection, type MusicPlaylist } from './musicPlaylist';

/**
 * Sound bus. Every game event calls `sfx(name)`. If `/assets/audio/<name>.ogg` exists it is
 * played; otherwise the procedural synthesizer renders the event. Music plays the current age's
 * set (`setAge`, `musicForAge`): its first track, then shuffled rounds of all its tracks. If every
 * file of the age's set fails, the default Pastoral Pulse set plays; if those fail too, the
 * synthesized loop takes over. Volumes come from settings. The Web Audio context and the music
 * element are both unlocked on the first user gesture.
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

/** How long a track that is no longer wanted takes to fade out when the set changes. */
const MUSIC_FADE_MS = 1500;

class AudioBus {
  master = 0.8;
  sfx = 0.8;
  music = 0.5;
  ambient = 0.35;
  private ambience = new Ambience();
  updateAmbience(rain: number, night: number) {
    this.listen();
    if (!this.unlocked) return;
    const ctx = this.synth.ensure();
    if (ctx) this.ambience.update(ctx, this.master * this.ambient, rain, night);
  }
  debugLog = false;
  readonly synth = new Synth();
  private files = new Map<string, FileState>();
  private unlocked = false;
  private musicEl: HTMLAudioElement | null = null;
  /** Which set plays and which file; a null track means none is left and the synth loop plays. */
  private readonly musicSets = new MusicSelection();
  /** The playlist of the set playing now. */
  get playlist(): MusicPlaylist {
    return this.musicSets.playlist;
  }
  /** Throttle identical events so bursts (drag-laying) do not stack. */
  private lastPlayed = new Map<string, number>();
  private listening = false;

  /**
   * Unlock on the first user gesture. The listeners are added by the first call that needs
   * them (the boot's applyMusic) rather than at import, so the module loads without a window.
   */
  private listen() {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
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
    }
    this.applyMusic();
  }

  /** The element of the file playing now, created on first use. */
  private musicTrack(src: string): HTMLAudioElement {
    if (this.musicEl) return this.musicEl;
    const el = new Audio(src);
    el.loop = false;
    el.preload = 'auto';
    el.volume = Math.min(1, this.master * this.music);
    el.addEventListener('canplay', () => {
      if (this.musicEl !== el) return;
      // a synth loop may have been covering while the file loaded
      this.synth.stopMusic();
      this.applyMusic();
    });
    el.addEventListener('error', () => {
      if (this.musicEl === el) this.advanceMusic(true);
    });
    el.addEventListener('ended', () => {
      if (this.musicEl === el) this.advanceMusic();
    });
    this.musicEl = el;
    el.load();
    return el;
  }

  private advanceMusic(failed = false) {
    this.musicEl?.pause();
    this.musicEl = null;
    this.musicSets.next(failed);
    this.applyMusic();
  }

  /**
   * The player is in this age (an id of `src/data/ages.json`). When its set differs from the one
   * playing, the current track fades out and the new set starts with its first track; before the
   * first gesture this only selects the set.
   */
  setAge(id: string) {
    if (!this.musicSets.setAge(id)) return;
    if (this.musicEl) this.fadeOut(this.musicEl);
    this.musicEl = null;
    this.applyMusic();
  }

  /** Lower a track the bus has let go of to silence, then stop it. */
  private fadeOut(el: HTMLAudioElement) {
    const from = el.volume;
    const start = performance.now();
    const step = () => {
      const left = 1 - (performance.now() - start) / MUSIC_FADE_MS;
      if (left <= 0 || from <= 0) {
        el.pause();
        return;
      }
      el.volume = from * left;
      setTimeout(step, 50);
    };
    step();
  }

  /** Start, stop or re-level the music for the current master and music volumes. */
  applyMusic() {
    this.listen();
    if (!this.unlocked) return;
    const v = Math.min(1, this.master * this.music);
    const src = this.musicSets.track;
    if (src !== null) {
      const el = this.musicTrack(src);
      el.volume = v;
      if (v > 0) {
        // autoplay is allowed here: applyMusic only runs after a gesture unlocked the bus
        void el.play().catch((error: DOMException) => {
          // playback refused (no gesture yet, or an undecodable file): keep the synth loop
          if (
            this.musicEl !== el ||
            error.name === 'NotAllowedError' ||
            error.name === 'AbortError'
          )
            return;
          this.advanceMusic(true);
        });
      } else el.pause();
      this.synth.setMusicVolume(0);
      return;
    }
    if (v > 0) {
      this.synth.startMusic();
      this.synth.setMusicVolume(v);
    } else this.synth.setMusicVolume(0);
  }

  /** The event's sound file, or null outside a browser (no `Audio`), where the synth plays it. */
  private probe(name: string): FileState | null {
    let f = this.files.get(name);
    if (f) return f;
    if (typeof Audio === 'undefined') return null;
    const el = new Audio(`/assets/audio/${name}.ogg`);
    f = { el, status: 'probing' };
    el.addEventListener('canplaythrough', () => (f!.status = 'ready'), { once: true });
    el.addEventListener('error', () => (f!.status = 'missing'), { once: true });
    el.load();
    this.files.set(name, f);
    return f;
  }

  play(name: SoundEvent) {
    this.listen();
    if (this.debugLog) console.debug(`[sfx] ${name}`);
    const vol = this.master * this.sfx;
    if (vol <= 0) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? -1000;
    if (now - last < 45) return;
    this.lastPlayed.set(name, now);
    const f = this.probe(name);
    if (f?.status === 'ready') {
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
