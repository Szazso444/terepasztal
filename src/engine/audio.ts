import { Synth } from './synth';
import { Ambience } from './ambience';
import { DEFAULT_VOLUMES, EVENT_GROUP, groupGain, musicGain, type SoundGroup } from './audioGroups';
import { MusicSelection, rememberPlayed, trackTitle, type MusicPlaylist } from './musicPlaylist';

/**
 * Sound bus. Every game event calls `sfx(name)`. If `/assets/audio/<name>.ogg` exists it is
 * played; otherwise the procedural synthesizer renders the event. Music plays the current age's
 * set (`setAge`, `musicForAge`), every age the eight tracks of the default set for now: Pastoral
 * Pulse once on opening the game, then shuffled rounds. When an age change switches the set, the
 * track playing fades out first and the new set's first track starts only once it has stopped, so
 * two music files never play together. If every file of the age's set fails, the default set
 * plays; if those fail too, the synthesized loop takes over. Volumes come from settings
 * (`audioGroups.ts`). The Web Audio context and the music element are both unlocked on the first
 * user gesture.
 *
 * Music can be held back: `hold()` keeps a gesture from starting it (sound effects still unlock),
 * `preload()` fetches the first track ahead so it can start at once, and `startMusic()` lets the
 * hold go. The title screen holds it, so nothing plays there until the player starts.
 *
 * The now-playing widget reads `view` and works `togglePause`, `back` and `forward`. Its pause is
 * the music's alone: it changes no volume and no setting, and ends with the page.
 */
export const SOUND_EVENTS = [
  'ui.click',
  'ui.open',
  'ui.close',
  'build.place',
  'build.remove',
  'build.invalid',
  'station.upgrade',
  'upgrade.done',
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

/**
 * How long the track playing takes to fade out when the set changes. The new set's first track
 * starts when it is over, so this is how long the player waits for the new music; keep it at 2 s
 * or less.
 */
export const MUSIC_FADE_MS = 1500;

/** What the now-playing widget shows. */
export interface MusicView {
  /** the title of the track; null when no file is left and the synthesized loop plays */
  title: string | null;
  /** the player paused the music */
  paused: boolean;
  /** nothing can be heard: Music is off or at 0, or Master is */
  silent: boolean;
  /** `hold()` is in force: nothing has started, and nothing can be heard */
  held: boolean;
  /** there is a track to go back to, and no age change is fading the music out */
  canGoBack: boolean;
  /** there is a track to go on to, and no age change is fading the music out */
  canGoForward: boolean;
}

class AudioBus {
  master = DEFAULT_VOLUMES.master;
  sfx = DEFAULT_VOLUMES.sfx;
  music = DEFAULT_VOLUMES.music;
  groups: Record<SoundGroup, number> = { ...DEFAULT_VOLUMES.soundGroups };
  private ambience = new Ambience();
  updateAmbience(rain: number, night: number) {
    this.listen();
    if (!this.unlocked) return;
    const ctx = this.synth.ensure();
    if (!ctx) return;
    const weather = groupGain(this, 'weather');
    this.ambience.update(ctx, weather, groupGain(this, 'environment'), rain, night);
  }
  debugLog = false;
  /** `silently` is running: no sound effect plays. */
  silent = false;
  readonly synth = new Synth();
  private files = new Map<string, FileState>();
  private unlocked = false;
  private musicEl: HTMLAudioElement | null = null;
  /**
   * The old track, while an age change waits for it to fade out. The new set is already selected,
   * but `applyMusic` starts nothing until the fade has stopped this one and ended the wait.
   */
  private fading: HTMLAudioElement | null = null;
  /** `hold()` is in force: no music starts, whatever gesture unlocks the bus. */
  private held = false;
  /** The player paused the music: it stands still, and every volume stays as it is. */
  private paused = false;
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
    el.volume = this.musicLevel;
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
    // a media key or a headset works the element and not the bus, and the widget stays true to it
    const follow = () => this.followElement(el);
    el.addEventListener('pause', follow);
    el.addEventListener('play', follow);
    this.musicEl = el;
    el.load();
    return el;
  }

  /**
   * The element paused or played. The bus's own stops do not count: a track it let go of, one that
   * came to its end (the browser pauses it first), and silence, which must not leave the track
   * paused for when Music comes back. Read from the element, as its event comes after the call.
   */
  private followElement(el: HTMLAudioElement) {
    if (this.musicEl === el && !el.ended && this.musicLevel > 0) this.paused = el.paused;
  }

  /** The element's level: an element refuses anything over 1. */
  private get musicLevel() {
    return Math.min(1, musicGain(this));
  }

  /** A track the bus is done with stops, and gives up the file the browser would hold on to. */
  private release(el: HTMLAudioElement) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  /** The file selected has changed: the old one stops, and the new one plays as the rest allows. */
  private changeTrack() {
    const old = this.musicEl;
    this.musicEl = null; // first: nothing the old element does from here on moves the music
    if (old) this.release(old);
    this.applyMusic();
    this.preload(); // a bus that cannot play yet still fetches the file that comes next
  }

  private advanceMusic(failed = false) {
    this.musicSets.next(failed);
    this.changeTrack();
  }

  /** On to the next track, as if this one had ended. An age change fading out comes first. */
  forward() {
    if (this.fading || this.musicSets.track === null) return;
    this.advanceMusic();
  }

  /** Back to the track played before this one; with none, nothing changes. */
  back() {
    if (this.fading || this.musicSets.back() === null) return;
    this.changeTrack();
  }

  /**
   * Pause the music, or let it play on from where it stood. No volume or setting changes. With
   * nothing to hear it does nothing: a pause no one could hear would hold the track back later.
   */
  togglePause() {
    if (this.musicLevel <= 0) return;
    this.paused = !this.paused;
    // at once, whatever keeps `applyMusic` back: a track fading out is the one to hear now
    if (this.paused) (this.fading ?? this.musicEl)?.pause();
    this.applyMusic();
  }

  /** What the now-playing widget shows. */
  get view(): MusicView {
    const track = this.musicSets.track;
    return {
      title: trackTitle(track),
      paused: this.paused,
      silent: this.musicLevel <= 0,
      held: this.held,
      canGoBack: !this.fading && this.musicSets.canGoBack,
      canGoForward: !this.fading && track !== null,
    };
  }

  /**
   * Keep the music from starting until `startMusic()`: a gesture still unlocks the sound effects
   * but starts no track and no synth loop, and `applyMusic` changes nothing. For the title screen,
   * before any music has started; music already playing is not stopped.
   */
  hold() {
    this.listen();
    this.held = true;
  }

  /**
   * Fetch the first track of the playlist now, without playing it, so it starts at once when the
   * music does. It needs no gesture. A track that fails is skipped and the next one is fetched in
   * its place. Does nothing outside a browser, with the music element already there, while an age
   * change fades the old track out (the end of the fade fetches the set selected last), or once
   * every file has failed.
   */
  preload() {
    this.listen();
    if (typeof Audio === 'undefined' || this.fading) return;
    const src = this.musicSets.track;
    if (src !== null) this.musicTrack(src);
  }

  /**
   * Let the music begin: end the `hold()`. It plays the first track at once when a gesture has
   * unlocked the bus, and on the first gesture otherwise (browsers refuse audio before one). With
   * no hold it changes nothing, so a second call neither restarts nor doubles the track.
   */
  startMusic() {
    this.listen();
    if (!this.held) return;
    this.held = false;
    this.applyMusic();
  }

  /**
   * Play the music without waiting for a gesture, where the browser lets this page play already:
   * Chrome does when a click on the page before this one, on the same site, led here (a menu, a
   * save slot or the world's growth reloads the page). The track is tried; if it plays, the bus
   * unlocks as a gesture would, and if the browser refuses, nothing changes and the first gesture
   * starts it. Does nothing while the music is held, at no music volume or with no file to try.
   */
  tryUnlock() {
    this.listen();
    if (this.unlocked || this.held || this.paused) return;
    if (this.fading || typeof Audio === 'undefined') return;
    const v = this.musicLevel;
    const src = this.musicSets.track;
    if (src === null || v <= 0) return;
    const el = this.musicTrack(src);
    el.volume = v;
    // refused (no click to carry over), or the file failed: its own error event moves it on
    void el.play().then(
      () => {
        this.started(el, src);
        this.unlock();
      },
      () => {},
    );
  }

  /** A file is playing: this tab now remembers it, unless the bus has already let go of it. */
  private started(el: HTMLAudioElement, src: string) {
    if (this.musicEl === el) rememberPlayed(src);
  }

  /**
   * The player is in this age (an id of `src/data/ages.json`). When its set differs from the one
   * playing, the current track fades out over `MUSIC_FADE_MS` and the new set starts with its first
   * track in the step that stops the old one, never before. Nothing audible means no wait: before
   * the first gesture this only selects the set, and with no track or no music volume the new set
   * starts at once. A further change during the wait only selects again; the one start that
   * follows the fade is the set selected last.
   */
  setAge(id: string) {
    if (!this.musicSets.setAge(id)) return;
    if (this.fading) return;
    const old = this.musicEl;
    this.musicEl = null; // the old track's own events no longer move the music on
    if (!old || old.paused) {
      // nothing audible to fade out: a file fetched ahead is let go for the new set's first track
      if (old) {
        this.release(old);
        this.preload();
      }
      this.applyMusic();
      return;
    }
    this.fading = old;
    this.fadeOut(old, () => {
      this.fading = null;
      this.applyMusic();
    });
  }

  /**
   * Lower a track the bus has let go of to silence, then stop it and call `done`. Nothing to fade
   * (no music volume) stops it and calls `done` at once.
   */
  private fadeOut(el: HTMLAudioElement, done: () => void) {
    const from = this.musicLevel > 0 ? el.volume : 0;
    const start = performance.now();
    const step = () => {
      const left = 1 - (performance.now() - start) / MUSIC_FADE_MS;
      if (left <= 0 || from <= 0) {
        this.release(el);
        done();
        return;
      }
      el.volume = from * left;
      setTimeout(step, 50);
    };
    step();
  }

  /**
   * Start, stop or re-level the music for the current master and music volumes and the pause. It
   * does nothing before the first gesture, while the music is held, or while an age change waits
   * for the old track to fade out: the handover ends with its own call.
   */
  applyMusic() {
    this.listen();
    if (!this.unlocked || this.held || this.fading) return;
    const v = this.musicLevel;
    const src = this.musicSets.track;
    if (src !== null) {
      const el = this.musicTrack(src);
      el.volume = v;
      if (v <= 0 || this.paused) el.pause();
      // every gesture comes through here: a track that plays already is left alone
      else if (el.paused) {
        // autoplay is allowed here: applyMusic only runs after a gesture unlocked the bus
        void el.play().then(
          () => this.started(el, src),
          (error: DOMException) => {
            // playback refused (no gesture yet, or an undecodable file): keep the synth loop
            if (
              this.musicEl !== el ||
              error.name === 'NotAllowedError' ||
              error.name === 'AbortError'
            )
              return;
            this.advanceMusic(true);
          },
        );
      }
      this.synth.setMusicVolume(0);
      return;
    }
    if (v > 0 && !this.paused) {
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
    if (this.silent) return;
    const vol = groupGain(this, EVENT_GROUP[name]);
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
/** Run `fn` with no sound effects: what the game lays by itself at the start makes no noise. */
export function silently<T>(fn: () => T): T {
  audio.silent = true;
  try {
    return fn();
  } finally {
    audio.silent = false;
  }
}
