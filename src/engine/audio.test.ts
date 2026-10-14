import { afterEach, describe, expect, it, vi } from 'vitest';
// imported for real, with no vi.mock: loading the audio modules must not need a browser
import { audio, MUSIC_FADE_MS, sfx, SOUND_EVENTS } from './audio';
import { Ambience } from './ambience';
import { Synth } from './synth';
import { AGE_MUSIC, MUSIC_TRACKS, musicForAge } from './musicPlaylist';
import { Rng } from './rng';
import { forAll, shrinkArray } from '../testing/property';

type Listener = () => void;

/** An event target that records its listeners by type. */
function target() {
  const listeners = new Map<string, Listener[]>();
  const addEventListener = vi.fn((type: string, fn: Listener) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  });
  const fire = (type: string) => (listeners.get(type) ?? []).forEach((fn) => fn());
  return { addEventListener, fire, types: () => addEventListener.mock.calls.map((c) => c[0]) };
}

/** Just enough of an AudioContext for the synth's master bus and the ambience beds. */
function fakeContext() {
  const gains: { gain: { setTargetAtTime: ReturnType<typeof vi.fn> } }[] = [];
  const param = () => ({
    value: 0,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({
    gain: param(),
    frequency: param(),
    Q: param(),
    pan: param(),
    type: '',
    buffer: null,
    loop: false,
    onended: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  });
  const ctx = {
    state: 'running',
    currentTime: 1,
    sampleRate: 16,
    destination: {},
    resume: () => Promise.resolve(),
    createGain: () => {
      const gain = node();
      gains.push(gain);
      return gain;
    },
    createBiquadFilter: node,
    createBufferSource: node,
    createOscillator: node,
    createStereoPanner: node,
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  };
  return { ctx: ctx as unknown as AudioContext, gains };
}

/**
 * A music element that loads and plays without a network. It counts as playing from its `play()`
 * call to its next `pause()`; a `play()` while another element is playing is recorded as an overlap.
 */
class FakeAudio {
  static made: FakeAudio[] = [];
  static overlaps = 0;
  loop = true;
  preload = '';
  volume = 1;
  playing = false;
  /** An element is paused until its `play()` and again after its next `pause()`. */
  get paused() {
    return !this.playing;
  }
  addEventListener = vi.fn();
  load = vi.fn();
  pause = vi.fn(() => {
    this.playing = false;
  });
  play = vi.fn(() => {
    if (FakeAudio.made.some((el) => el !== this && el.playing)) FakeAudio.overlaps++;
    this.playing = true;
    return Promise.resolve();
  });
  constructor(readonly src: string) {
    FakeAudio.made.push(this);
  }
}

/** Fire the listeners a fake element registered for an event. */
function fire(el: FakeAudio, type: string) {
  for (const [t, fn] of el.addEventListener.mock.calls as [string, Listener][])
    if (t === type) fn();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  FakeAudio.made = [];
  FakeAudio.overlaps = 0;
});

describe('audio outside a browser', () => {
  it('plays every event, applies the music and updates the ambience without a window', () => {
    // the point of the test: none of these exist under Node
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof Audio).toBe('undefined');
    expect(() => sfx('train.arrive')).not.toThrow();
    for (const name of SOUND_EVENTS) expect(() => sfx(name)).not.toThrow();
    expect(() => audio.applyMusic()).not.toThrow();
    expect(() => audio.updateAmbience(0, 0)).not.toThrow();
    expect(() => audio.updateAmbience(1, 1)).not.toThrow();
  });

  it('holds, preloads and starts the music without a window or Audio', async () => {
    vi.resetModules();
    const fresh = await import('./audio');
    expect(() => {
      fresh.audio.hold();
      fresh.audio.preload();
      fresh.audio.startMusic();
      fresh.audio.applyMusic();
    }).not.toThrow();
  });

  it('runs the ambience beds against a context with no document', () => {
    const { ctx, gains } = fakeContext();
    const ambience = new Ambience();
    expect(() => ambience.update(ctx, 0.5, 0, 0)).not.toThrow();
    // the master bed rises to the volume: nothing counts as hidden without a document
    expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 1, 0.2);
  });
});

describe('audio in a browser', () => {
  it('adds the gesture listeners once, on first use rather than at import', async () => {
    const win = target();
    vi.stubGlobal('window', { addEventListener: win.addEventListener });
    vi.resetModules();
    const fresh = await import('./audio');
    expect(win.addEventListener).not.toHaveBeenCalled();
    fresh.audio.applyMusic();
    expect(win.types()).toEqual(['pointerdown', 'keydown']);
    fresh.audio.applyMusic();
    fresh.audio.updateAmbience(0, 0);
    fresh.sfx('ui.click');
    expect(win.types()).toEqual(['pointerdown', 'keydown']);
  });

  it.each(['pointerdown', 'keydown'])(
    'the first %s after boot unlocks the bus and starts the music',
    async (gesture) => {
      const win = target();
      const { ctx } = fakeContext();
      vi.stubGlobal('window', {
        addEventListener: win.addEventListener,
        AudioContext: function () {
          return ctx;
        },
      });
      vi.stubGlobal('Audio', FakeAudio);
      vi.resetModules();
      const fresh = await import('./audio');
      fresh.audio.applyMusic(); // what boot does
      expect(FakeAudio.made).toHaveLength(0);
      win.fire(gesture);
      expect(FakeAudio.made.map((el) => el.src)).toEqual([MUSIC_TRACKS[0]]);
      expect(FakeAudio.made[0].play).toHaveBeenCalled();
    },
  );

  /** The bus after a fresh import, with `sets` as the ages' own sets and a fake music element. */
  async function musicBus(sets: Record<string, string[]>) {
    const win = target();
    const { ctx } = fakeContext();
    const setInterval = vi.fn(() => 1); // the synth loop's scheduler, when every file has failed
    vi.stubGlobal('window', {
      addEventListener: win.addEventListener,
      setInterval,
      AudioContext: function () {
        return ctx;
      },
    });
    vi.stubGlobal('Audio', FakeAudio);
    vi.useFakeTimers();
    // the playlist shuffles its rounds with Math.random: a fixed stream gives the same order on
    // every run (afterEach restores it)
    const shuffle = new Rng(285);
    vi.spyOn(Math, 'random').mockImplementation(() => shuffle.next());
    vi.resetModules();
    const playlist = await import('./musicPlaylist');
    const fresh = await import('./audio');
    Object.assign(playlist.AGE_MUSIC, sets);
    return {
      win,
      ctx,
      setInterval,
      playlist,
      bus: fresh.audio,
      sfx: fresh.sfx,
      srcs: () => FakeAudio.made.map((el) => el.src),
      playing: () => FakeAudio.made.filter((el) => el.playing),
      /** The music elements, which the sound-effect probes made through `Audio` are not. */
      music: () => FakeAudio.made.filter((el) => el.src.includes('/music/')),
    };
  }

  const steam = ['/assets/audio/music/steam/a.mp3', '/assets/audio/music/steam/b.mp3'];
  const diesel = ['/assets/audio/music/diesel/a.mp3', '/assets/audio/music/diesel/b.mp3'];
  const electric = ['/assets/audio/music/electric/a.mp3'];

  /** A bus that has been unlocked and plays the first steam track at the default volumes. */
  async function steamPlaying() {
    const rig = await musicBus({ steam, diesel, electric });
    rig.bus.applyMusic(); // what boot does
    rig.bus.setAge('steam'); // what applySave does
    rig.win.fire('pointerdown');
    expect(rig.srcs()).toEqual([steam[0]]);
    return { ...rig, old: FakeAudio.made[0] };
  }

  /** Move the clock on in `step` ms timer steps, running `check` after each one. */
  function run(ms: number, check: (elapsed: number) => void, step = 10) {
    for (let elapsed = step; elapsed <= ms; elapsed += step) {
      vi.advanceTimersByTime(step);
      check(elapsed);
    }
  }

  it('selects the age before the gesture and plays the same set on when it is chosen again', async () => {
    const { bus, win, srcs } = await musicBus({ steam, diesel });
    bus.applyMusic(); // what boot does
    bus.setAge('steam'); // what applySave does
    expect(FakeAudio.made).toHaveLength(0);
    win.fire('pointerdown');
    expect(srcs()).toEqual([steam[0]]);
    bus.setAge('steam');
    expect(srcs()).toEqual([steam[0]]);
    vi.advanceTimersByTime(MUSIC_FADE_MS * 2);
    expect(srcs()).toEqual([steam[0]]);
    expect(FakeAudio.made[0].pause).not.toHaveBeenCalled();
  });

  it('keeps the fade at two seconds or less', () => {
    expect(MUSIC_FADE_MS).toBeGreaterThan(0);
    expect(MUSIC_FADE_MS).toBeLessThanOrEqual(2000);
  });

  it("starts the new set's first track in the step that pauses the old one, not before", async () => {
    const { bus, old, srcs, playing } = await steamPlaying();
    const level = old.volume;
    expect(level).toBe(bus.master * bus.music);

    bus.setAge('diesel');
    let fell = false;
    run(MUSIC_FADE_MS * 2, (elapsed) => {
      expect(playing().length).toBeLessThanOrEqual(1);
      if (elapsed < MUSIC_FADE_MS) {
        // the wait is the fade: the old track plays on, quieter, and nothing else exists yet
        expect(old.pause).not.toHaveBeenCalled();
        expect(srcs()).toEqual([steam[0]]);
        if (old.volume < level) fell = true;
      }
      // the old track is paused exactly when the new one exists, and the new one plays at once
      expect(old.playing).toBe(FakeAudio.made.length === 1);
      if (old.pause.mock.calls.length) {
        expect(srcs()).toEqual([steam[0], diesel[0]]);
        expect(FakeAudio.made[1].playing).toBe(true);
      }
    });
    expect(fell).toBe(true);
    expect(old.pause).toHaveBeenCalledTimes(1);
    expect(old.volume).toBeLessThan(level);
    expect(srcs()).toEqual([steam[0], diesel[0]]);
    expect(FakeAudio.overlaps).toBe(0);
    expect(playing()).toEqual([FakeAudio.made[1]]);
    expect(bus.playlist.tracks).toEqual(diesel);
    expect(bus.playlist.current).toBe(0);
  });

  it('pauses the old track no earlier than the fade and starts the new one with no further delay', async () => {
    const { bus, old, srcs } = await steamPlaying();
    bus.setAge('diesel');
    vi.advanceTimersByTime(MUSIC_FADE_MS - 60);
    expect(old.pause).not.toHaveBeenCalled();
    expect(srcs()).toEqual([steam[0]]);
    // the step that lets the fade pass pauses the old track and starts the new one together
    vi.advanceTimersByTime(60);
    expect(old.pause).toHaveBeenCalledTimes(1);
    expect(srcs()).toEqual([steam[0], diesel[0]]);
    expect(FakeAudio.made[1].play).toHaveBeenCalled();
  });

  describe('while the handover waits', () => {
    it('does not start the new track, restart the old one or cut the fade short on applyMusic', async () => {
      const { bus, old, srcs, playing } = await steamPlaying();
      bus.setAge('diesel');
      const starts = old.play.mock.calls.length;
      run(MUSIC_FADE_MS - 50, (elapsed) => {
        // a settings change, a gesture and every event of the old track, at each step
        bus.music = elapsed % 20 === 0 ? 0.2 : 0.6; // dragging the slider
        bus.applyMusic();
        bus.unlock();
        fire(old, 'canplay');
        fire(old, 'ended');
        fire(old, 'error');
        expect(srcs()).toEqual([steam[0]]);
        expect(old.pause).not.toHaveBeenCalled();
        expect(old.play).toHaveBeenCalledTimes(starts);
        expect(playing()).toEqual([old]);
      });
      // the fade still ends on time and starts one new track
      vi.advanceTimersByTime(100);
      expect(old.pause).toHaveBeenCalledTimes(1);
      expect(srcs()).toEqual([steam[0], diesel[0]]);
      expect(FakeAudio.overlaps).toBe(0);
    });

    it('lets a mute during the wait run out the fade, then opens the new set silent', async () => {
      const { bus, old, srcs } = await steamPlaying();
      bus.setAge('diesel');
      vi.advanceTimersByTime(MUSIC_FADE_MS / 2);
      bus.music = 0;
      bus.applyMusic();
      expect(old.pause).not.toHaveBeenCalled();
      expect(srcs()).toEqual([steam[0]]);
      vi.advanceTimersByTime(MUSIC_FADE_MS / 2);
      expect(old.pause).toHaveBeenCalledTimes(1);
      expect(srcs()).toEqual([steam[0], diesel[0]]);
      // the new track is there for the volume to come back to, but is not playing
      expect(FakeAudio.made[1].playing).toBe(false);
      expect(FakeAudio.overlaps).toBe(0);
    });

    it('ends in one new track, the first of the set selected last, after a second age change', async () => {
      const { bus, old, srcs, playing } = await steamPlaying();
      bus.setAge('diesel');
      vi.advanceTimersByTime(500);
      bus.setAge('electric');
      run(MUSIC_FADE_MS * 3, (elapsed) => {
        expect(playing().length).toBeLessThanOrEqual(1);
        // the fade is not restarted by the second change: it ends 1.5 s after the first
        if (elapsed + 500 < MUSIC_FADE_MS) expect(srcs()).toEqual([steam[0]]);
      });
      expect(srcs()).toEqual([steam[0], electric[0]]);
      expect(old.pause).toHaveBeenCalledTimes(1);
      expect(playing()).toEqual([FakeAudio.made[1]]);
      expect(FakeAudio.overlaps).toBe(0);
      expect(bus.playlist.tracks).toEqual(electric);
    });

    it('fetches nothing on preload() during the wait, so the set selected last is the one that opens', async () => {
      const { bus, srcs, playing } = await steamPlaying();
      bus.setAge('diesel');
      vi.advanceTimersByTime(500);
      bus.preload();
      expect(srcs()).toEqual([steam[0]]);
      bus.setAge('electric');
      vi.advanceTimersByTime(MUSIC_FADE_MS * 2);
      expect(srcs()).toEqual([steam[0], electric[0]]);
      expect(playing()).toEqual([FakeAudio.made[1]]);
      expect(FakeAudio.overlaps).toBe(0);
    });

    it('opens the original set on its first track when the age changes back during the wait', async () => {
      const { bus, old, srcs, playing } = await steamPlaying();
      bus.setAge('diesel');
      vi.advanceTimersByTime(500);
      bus.setAge('steam');
      run(MUSIC_FADE_MS * 3, () => expect(playing().length).toBeLessThanOrEqual(1));
      // one start, after the fade: a fresh element for the first steam track
      expect(srcs()).toEqual([steam[0], steam[0]]);
      expect(FakeAudio.made[1]).not.toBe(old);
      expect(FakeAudio.made[1].playing).toBe(true);
      expect(old.playing).toBe(false);
      expect(FakeAudio.overlaps).toBe(0);
      expect(bus.playlist.tracks).toEqual(steam);
      expect(bus.playlist.current).toBe(0);
    });

    it('changes nothing when the set already waiting is chosen again', async () => {
      const { bus, old, srcs } = await steamPlaying();
      bus.setAge('diesel');
      vi.advanceTimersByTime(500);
      bus.setAge('diesel');
      bus.setAge('diesel');
      vi.advanceTimersByTime(MUSIC_FADE_MS - 500 - 50);
      expect(srcs()).toEqual([steam[0]]);
      vi.advanceTimersByTime(50);
      expect(srcs()).toEqual([steam[0], diesel[0]]);
      expect(old.pause).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(MUSIC_FADE_MS * 2);
      expect(srcs()).toEqual([steam[0], diesel[0]]);
      expect(FakeAudio.overlaps).toBe(0);
    });
  });

  describe('with nothing audible to wait for', () => {
    it.each(['master', 'music'] as const)(
      'starts the new set at once when %s is 0',
      async (knob) => {
        const { bus, old, srcs, playing } = await steamPlaying();
        bus[knob] = 0;
        bus.applyMusic(); // what applySettings does
        expect(old.pause).toHaveBeenCalled();
        bus.setAge('diesel');
        expect(srcs()).toEqual([steam[0], diesel[0]]);
        expect(old.playing).toBe(false);
        // volume back up: the new track plays, the old one does not come back
        bus[knob] = 0.5;
        bus.applyMusic();
        expect(playing()).toEqual([FakeAudio.made[1]]);
        expect(FakeAudio.overlaps).toBe(0);
      },
    );

    it('starts the new set at once when every file has failed and only the synth plays', async () => {
      const { bus, srcs, win } = await musicBus({ steam, diesel });
      bus.applyMusic();
      win.fire('pointerdown');
      // the default set: all four files fail, so there is no music element left
      for (let i = 0; i < 4; i++) fire(FakeAudio.made[FakeAudio.made.length - 1], 'error');
      expect(srcs()).toHaveLength(4);
      bus.setAge('diesel');
      expect(srcs()).toHaveLength(5);
      expect(srcs()[4]).toBe(diesel[0]);
      expect(FakeAudio.made[4].play).toHaveBeenCalled();
    });
  });

  describe("the faded track's events", () => {
    it('do not move the new set on, during the wait or after it', async () => {
      const { bus, old, srcs } = await steamPlaying();
      bus.setAge('diesel');
      vi.advanceTimersByTime(MUSIC_FADE_MS / 2);
      fire(old, 'ended');
      fire(old, 'error');
      expect(srcs()).toEqual([steam[0]]);
      vi.advanceTimersByTime(MUSIC_FADE_MS / 2);
      expect(srcs()).toEqual([steam[0], diesel[0]]);
      fire(old, 'ended');
      fire(old, 'error');
      fire(old, 'canplay');
      expect(srcs()).toEqual([steam[0], diesel[0]]);
      // the new set opens on its first track, and the old file has not been written off
      expect(bus.playlist.tracks).toEqual(diesel);
      expect(bus.playlist.current).toBe(0);
      fire(FakeAudio.made[1], 'ended');
      expect(srcs()).toEqual([steam[0], diesel[0], diesel[1]]);
      expect(FakeAudio.overlaps).toBe(0);
    });

    it('fall back to the default set when every file of the new set fails', async () => {
      const { bus, old, srcs, playlist } = await steamPlaying();
      bus.setAge('electric');
      vi.advanceTimersByTime(MUSIC_FADE_MS);
      fire(old, 'ended');
      expect(srcs()).toEqual([steam[0], electric[0]]);
      // every electric file fails: the default set takes over at its first track
      fire(FakeAudio.made[1], 'error');
      expect(srcs()).toEqual([steam[0], electric[0], playlist.MUSIC_TRACKS[0]]);
      expect(FakeAudio.overlaps).toBe(0);
    });
  });

  describe('held, preloaded and started music', () => {
    const first = MUSIC_TRACKS[0];
    const last = <T>(list: T[]) => list[list.length - 1];

    it('stays silent on a gesture while held, whatever the settings do, and leaves the effects alone', async () => {
      const { bus, win, ctx, music, srcs, sfx, setInterval } = await musicBus({});
      bus.hold();
      bus.applyMusic(); // what boot does
      for (const gesture of ['pointerdown', 'keydown']) win.fire(gesture);
      bus.music = 0.9; // a slider on the title screen
      bus.applyMusic();
      expect(srcs()).toEqual([]);
      expect(setInterval).not.toHaveBeenCalled();
      // the gesture unlocked the effects all the same
      const voices = vi.spyOn(ctx, 'createOscillator');
      sfx('ui.click');
      expect(voices).toHaveBeenCalled();
      expect(music()).toHaveLength(0);
    });

    it('fetches the first track without playing it, once, before any gesture', async () => {
      const { bus, music } = await musicBus({});
      bus.preload();
      bus.preload();
      expect(music().map((el) => el.src)).toEqual([first]);
      expect(music()[0].load).toHaveBeenCalledTimes(1);
      expect(music()[0].play).not.toHaveBeenCalled();
    });

    it('starts Pastoral Pulse first, from the file fetched ahead, exactly once', async () => {
      const { bus, win, music, playing } = await musicBus({});
      bus.hold();
      bus.preload();
      win.fire('pointerdown'); // the player clicks on the title screen
      expect(music()[0].play).not.toHaveBeenCalled();
      bus.startMusic();
      bus.startMusic();
      expect(music().map((el) => el.src)).toEqual([first]);
      expect(music()[0].load).toHaveBeenCalledTimes(1);
      expect(music()[0].play).toHaveBeenCalledTimes(1);
      expect(playing()).toEqual([music()[0]]);
      expect(FakeAudio.overlaps).toBe(0);
    });

    it('starts Pastoral Pulse first when nothing was fetched ahead', async () => {
      const { bus, win, music, playing } = await musicBus({});
      bus.hold();
      win.fire('pointerdown');
      expect(music()).toHaveLength(0);
      bus.startMusic();
      expect(music().map((el) => el.src)).toEqual([first]);
      expect(playing()).toEqual([music()[0]]);
    });

    it.each(['pointerdown', 'keydown'])(
      'called before any gesture, plays on the first %s and not before',
      async (gesture) => {
        const { bus, win, music, playing } = await musicBus({});
        bus.hold();
        bus.preload();
        bus.startMusic();
        expect(music()[0].play).not.toHaveBeenCalled();
        expect(playing()).toEqual([]);
        win.fire(gesture);
        expect(music().map((el) => el.src)).toEqual([first]);
        expect(music()[0].play).toHaveBeenCalledTimes(1);
        expect(playing()).toEqual([music()[0]]);
      },
    );

    it('called without a hold, changes nothing: the first gesture starts the music as before', async () => {
      const { bus, win, music, playing } = await musicBus({});
      bus.startMusic();
      expect(music()).toHaveLength(0);
      expect(win.types()).toEqual(['pointerdown', 'keydown']);
      win.fire('pointerdown');
      expect(music().map((el) => el.src)).toEqual([first]);
      expect(playing()).toEqual([music()[0]]);
    });

    describe('tryUnlock, as loading finishes on a page a click led to', () => {
      /** The browser refuses the element's next play: this page has had no gesture of its own. */
      const refuse = (el: FakeAudio) =>
        el.play.mockImplementationOnce(() =>
          Promise.reject(new DOMException('no gesture', 'NotAllowedError')),
        );

      it('plays at once where the browser lets the page play, and unlocks the bus', async () => {
        const { bus, ctx, music, playing } = await musicBus({});
        const beds = vi.spyOn(ctx, 'createBufferSource');
        bus.hold();
        bus.preload();
        bus.startMusic();
        bus.tryUnlock();
        await vi.advanceTimersByTimeAsync(0);
        expect(music().map((el) => el.src)).toEqual([first]);
        expect(playing()).toEqual([music()[0]]);
        expect(FakeAudio.overlaps).toBe(0);
        // unlocked as a gesture would: the ambience starts and the settings reach the track
        bus.updateAmbience(0, 0);
        expect(beds).toHaveBeenCalled();
        bus.music = 0;
        bus.applyMusic();
        expect(playing()).toEqual([]);
      });

      it('changes nothing where the browser refuses: the first gesture starts the music', async () => {
        const { bus, win, ctx, music, playing } = await musicBus({});
        const beds = vi.spyOn(ctx, 'createBufferSource');
        bus.hold();
        bus.preload();
        bus.startMusic();
        refuse(music()[0]);
        bus.tryUnlock();
        await vi.advanceTimersByTimeAsync(0);
        expect(playing()).toEqual([]);
        bus.updateAmbience(0, 0);
        expect(beds).not.toHaveBeenCalled();
        // the refused track is kept for the gesture, not skipped as a failed file
        win.fire('pointerdown');
        expect(music().map((el) => el.src)).toEqual([first]);
        expect(playing()).toEqual([music()[0]]);
      });

      it('tries nothing while the music is held, at no music volume, or once unlocked', async () => {
        const { bus, win, music } = await musicBus({});
        bus.hold();
        bus.preload();
        bus.tryUnlock(); // the title: the music stays back
        expect(music()[0].play).not.toHaveBeenCalled();
        bus.startMusic();
        bus.music = 0;
        bus.tryUnlock(); // nothing to hear, so nothing to try
        expect(music()[0].play).not.toHaveBeenCalled();
        bus.music = 0.5;
        win.fire('pointerdown');
        const plays = music()[0].play.mock.calls.length;
        bus.tryUnlock(); // a gesture unlocked it already
        expect(music()[0].play).toHaveBeenCalledTimes(plays);
      });
    });

    it('keeps the volumes: the track follows master and music, and music 0 pauses it', async () => {
      const { bus, win, music, playing } = await musicBus({});
      bus.hold();
      bus.preload();
      win.fire('pointerdown');
      bus.startMusic();
      expect(music()[0].volume).toBe(bus.master * bus.music);
      bus.music = 0.2;
      bus.applyMusic();
      expect(music()[0].volume).toBe(bus.master * 0.2);
      bus.music = 0;
      bus.applyMusic();
      expect(playing()).toEqual([]);
      bus.music = 0.5;
      bus.applyMusic();
      expect(playing()).toEqual([music()[0]]);
    });

    it('skips a track that fails, whether it fails while fetched ahead or while playing', async () => {
      const { bus, win, music, playing } = await musicBus({});
      bus.hold();
      bus.preload();
      fire(music()[0], 'error'); // the first file is missing: the next one is fetched in its place
      expect(music()).toHaveLength(2);
      expect(music()[1].src).not.toBe(first);
      win.fire('pointerdown');
      bus.startMusic();
      expect(music()[0].play).not.toHaveBeenCalled();
      expect(playing()).toEqual([music()[1]]);
      // a track that fails while playing is skipped too, and neither failure comes back
      fire(music()[1], 'error');
      for (let i = 0; i < 12; i++) fire(last(music()), 'ended');
      const srcs = music().map((el) => el.src);
      expect(srcs.slice(1)).not.toContain(first);
      expect(srcs.slice(2)).not.toContain(srcs[1]);
      expect(playing()).toEqual([last(music())]);
      expect(FakeAudio.overlaps).toBe(0);
    });

    it('lets the synth loop take over only when every file has failed', async () => {
      const { bus, win, music, playing, setInterval } = await musicBus({});
      bus.hold();
      bus.preload();
      win.fire('pointerdown');
      bus.startMusic();
      // all but the last file fail, one after the other: a file is always left to play
      for (let i = 0; i < MUSIC_TRACKS.length - 1; i++) {
        expect(playing()).toEqual([last(music())]);
        fire(last(music()), 'error');
        expect(setInterval).not.toHaveBeenCalled();
      }
      expect(music()).toHaveLength(MUSIC_TRACKS.length);
      expect(playing()).toEqual([last(music())]);
      expect(new Set(music().map((el) => el.src)).size).toBe(MUSIC_TRACKS.length);
      // the last one fails: now, and only now, the synth plays, and no file is tried again
      fire(last(music()), 'error');
      expect(setInterval).toHaveBeenCalledTimes(1);
      expect(playing()).toEqual([]);
      expect(music()).toHaveLength(MUSIC_TRACKS.length);
    });

    it('keeps the synth loop back while held, even when every file has failed', async () => {
      const { bus, win, music, playing, setInterval } = await musicBus({});
      bus.hold();
      bus.preload();
      win.fire('pointerdown');
      for (let i = 0; i < MUSIC_TRACKS.length; i++) fire(last(music()), 'error');
      expect(music()).toHaveLength(MUSIC_TRACKS.length);
      expect(setInterval).not.toHaveBeenCalled();
      bus.startMusic();
      expect(setInterval).toHaveBeenCalledTimes(1);
      expect(playing()).toEqual([]);
    });

    it('lets go of a file fetched ahead, without a fade, when the age brings another set', async () => {
      const { bus, win, music, playing } = await musicBus({ diesel });
      bus.hold();
      bus.preload(); // boot, before the save says which age it is
      bus.setAge('diesel'); // what applySave does
      // nothing was audible, so there is no fade to wait for: the new set's first track is fetched
      expect(music().map((el) => el.src)).toEqual([first, diesel[0]]);
      win.fire('pointerdown');
      bus.startMusic();
      expect(music()[0].play).not.toHaveBeenCalled();
      expect(playing()).toEqual([music()[1]]);
      expect(FakeAudio.overlaps).toBe(0);
    });

    it.each([0.2, 0])(
      'starts at the volume the sliders show when Play is pressed (music %s), not the one it was fetched at',
      async (level) => {
        const { bus, win, music, playing, setInterval } = await musicBus({});
        bus.hold();
        bus.preload();
        expect(music()[0].volume).toBe(bus.master * bus.music); // fetched at the default volume
        win.fire('pointerdown'); // the player clicks on the title screen
        bus.music = level; // and drags the music slider there
        bus.applyMusic();
        expect(playing()).toEqual([]);
        bus.startMusic();
        expect(music()[0].volume).toBe(bus.master * level);
        expect(playing()).toEqual(level > 0 ? [music()[0]] : []);
        expect(setInterval).not.toHaveBeenCalled(); // a muted file is not a failed one
        bus.music = 0.5;
        bus.applyMusic();
        expect(playing()).toEqual([music()[0]]);
        expect(music()).toHaveLength(1);
      },
    );

    it('lets the ambience beds start on a gesture while the music is held', async () => {
      const { bus, win, ctx, music } = await musicBus({});
      const beds = vi.spyOn(ctx, 'createBufferSource');
      bus.hold();
      bus.updateAmbience(0, 0);
      expect(beds).not.toHaveBeenCalled(); // nothing before a gesture, held or not
      win.fire('pointerdown');
      bus.updateAmbience(0, 0);
      expect(beds).toHaveBeenCalled();
      expect(music()).toHaveLength(0);
    });

    it.each(['hold', 'preload', 'startMusic'] as const)(
      'adds the gesture listeners once, however the calls come (%s first)',
      async (first) => {
        const { bus, win } = await musicBus({});
        expect(win.addEventListener).not.toHaveBeenCalled();
        bus[first]();
        // the call itself listens: nothing else is needed for a gesture to be heard
        expect(win.types()).toEqual(['pointerdown', 'keydown']);
        bus.hold();
        bus.preload();
        bus.startMusic();
        bus.hold();
        expect(win.types()).toEqual(['pointerdown', 'keydown']);
      },
    );
  });

  describe('under any order of calls', () => {
    // forAll runs a synchronous property, and the module exports no way to make a second bus, so
    // each case builds its own from the singleton's constructor
    const Bus = audio.constructor as unknown as new () => typeof audio;
    const pristine = { ...AGE_MUSIC };
    const AGES = ['steam', 'diesel', 'electric', 'nuclear']; // nuclear lists no files: the default

    type Step =
      | { op: 'hold' | 'preload' | 'start' | 'apply' | 'sfx' | 'fail' | 'end' | 'canplay' }
      | { op: 'gesture'; on: 'pointerdown' | 'keydown' }
      | { op: 'volume'; master: number; music: number }
      | { op: 'age'; id: string }
      | { op: 'tick'; ms: number }
      | { op: 'stale'; event: 'error' | 'ended' | 'canplay'; pick: number };
    /**
     * `ages` cases change the age and never fail or end the track playing (the age changes are what
     * they exercise); the rest never change the age, and fail and end the track playing.
     */
    interface Case {
      ages: boolean;
      shuffle: number;
      steps: Step[];
    }

    function genStep(rng: Rng, ages: boolean): Step {
      const level = () => (rng.chance(0.2) ? 0 : rng.pick([0.3, 0.6, 1]));
      const ops = [
        ...['gesture', 'gesture', 'gesture', 'start', 'start', 'start'],
        ...['hold', 'preload', 'apply', 'volume', 'volume', 'sfx', 'tick', 'tick', 'stale'],
        ...(ages ? ['age', 'age', 'age', 'age'] : ['fail', 'fail', 'end', 'end', 'end', 'canplay']),
      ] as Step['op'][];
      const op = rng.pick(ops);
      switch (op) {
        case 'gesture':
          return { op, on: rng.pick(['pointerdown', 'keydown'] as const) };
        case 'volume':
          return { op, master: level(), music: level() };
        case 'age':
          return { op, id: rng.pick(AGES) };
        case 'tick':
          return { op, ms: rng.pick([10, 50, 400, 1600]) };
        case 'stale':
          return {
            op,
            event: rng.pick(['error', 'ended', 'canplay'] as const),
            pick: rng.int(0, 5),
          };
        default:
          return { op };
      }
    }

    function genCase(rng: Rng, ages: boolean): Case {
      const steps: Step[] = [];
      // most cases open as the boot does; the rest start from a bus nobody held
      if (rng.chance(0.8)) steps.push({ op: 'hold' });
      if (rng.chance(0.5)) steps.push({ op: 'preload' });
      for (let n = rng.int(1, 30); n > 0; n--) steps.push(genStep(rng, ages));
      return { ages, shuffle: rng.int(1, 1_000_000), steps };
    }

    function* shrinkCase(c: Case): Iterable<Case> {
      for (const steps of shrinkArray(c.steps)) yield { ...c, steps };
    }

    /** Runs the steps on a fresh bus and checks every property after each one. */
    function run(c: Case) {
      FakeAudio.made = [];
      FakeAudio.overlaps = 0;
      const win = target();
      const { ctx } = fakeContext();
      const setInterval = vi.fn(() => 1);
      vi.stubGlobal('window', {
        addEventListener: win.addEventListener,
        setInterval,
        AudioContext: function () {
          return ctx;
        },
      });
      vi.stubGlobal('Audio', FakeAudio);
      vi.useFakeTimers();
      const shuffle = new Rng(c.shuffle);
      vi.spyOn(Math, 'random').mockImplementation(() => shuffle.next());
      Object.assign(AGE_MUSIC, { steam, diesel, electric });
      try {
        const bus = new Bus();
        const music = () => FakeAudio.made.filter((el) => el.src.includes('/music/'));
        const plays = () => music().reduce((n, el) => n + el.play.mock.calls.length, 0);
        const newest = () => music()[music().length - 1] as FakeAudio | undefined;
        // the model: what the calls so far should have done, written without the bus's internals
        let held = false;
        let unlocked = false;
        let now = 0;
        let settleAt = 0; // an age change may still be fading the old track out until then
        let selected: string | null = null;
        const failed = new Set<string>();
        const letGo = new Map<FakeAudio, number>(); // plays an element had when a newer one came

        const step = (s: Step) => {
          const cur = newest();
          switch (s.op) {
            case 'hold':
              bus.hold();
              held = true;
              break;
            case 'preload':
              bus.preload();
              break;
            case 'start':
              bus.startMusic();
              held = false;
              break;
            case 'gesture': {
              // the first call of the bus adds the listeners: a gesture before that is nobody's
              const heard = win.addEventListener.mock.calls.length > 0;
              win.fire(s.on);
              if (heard) unlocked = true;
              break;
            }
            case 'apply':
              bus.applyMusic();
              break;
            case 'volume': // what applySettings does
              bus.master = s.master;
              bus.music = s.music;
              bus.applyMusic();
              break;
            case 'sfx':
              bus.play('ui.click');
              break;
            case 'age':
              bus.setAge(s.id);
              selected = s.id;
              settleAt = now + MUSIC_FADE_MS + 100;
              break;
            case 'tick':
              vi.advanceTimersByTime(s.ms);
              now += s.ms;
              break;
            case 'fail':
              // the newest element is the bus's own, unless every file has failed already
              if (cur) failed.add(cur.src);
              if (cur) fire(cur, 'error');
              break;
            case 'end':
              if (cur?.playing) fire(cur, 'ended');
              break;
            case 'canplay':
              if (cur) fire(cur, 'canplay');
              break;
            case 'stale': {
              // an element that is not the newest is one the bus let go of: its events do nothing
              const old = music().slice(0, -1);
              if (!old.length) break;
              const n = music().length;
              const p = plays();
              const loops = setInterval.mock.calls.length;
              fire(old[s.pick % old.length], s.event);
              expect(music().length, 'a let-go track moved the music on').toBe(n);
              expect(plays(), 'a let-go track started a track').toBe(p);
              expect(setInterval.mock.calls.length, 'a let-go track started the synth').toBe(loops);
              break;
            }
          }
        };

        const verify = (where: string, before: { n: number; plays: number; loops: number }) => {
          const els = music();
          const top = newest();
          const fresh = els.slice(before.n);
          const v = Math.min(1, bus.master * bus.music);
          const loops = setInterval.mock.calls.length;
          const say = (what: string) => `${where}: ${what}`;

          // the title is silent: while held, a call starts no track and no synth loop
          if (held) {
            expect(plays(), say('a held bus played a track')).toBe(before.plays);
            expect(loops, say('a held bus started the synth loop')).toBe(before.loops);
          }
          // browsers refuse audio before a gesture: until one is heard, nothing is started
          if (!unlocked) {
            expect(plays(), say('a track played before any gesture')).toBe(0);
            expect(loops, say('the synth loop started before any gesture')).toBe(0);
          }
          // two tracks never play together
          expect(FakeAudio.overlaps, say('two tracks played together')).toBe(0);
          expect(els.filter((el) => el.playing).length, say('two tracks play')).toBeLessThan(2);
          // a track the bus has let go of is never played again
          for (const [el, n] of letGo)
            expect(el.play.mock.calls.length, say('a let-go track was played')).toBe(n);
          for (const el of els.slice(0, -1))
            if (!letGo.has(el)) letGo.set(el, el.play.mock.calls.length);
          // a call fetches at most one file, a file of the set that plays, never one that failed
          expect(fresh.length, say('a call fetched more than one file')).toBeLessThan(2);
          for (const el of fresh) {
            expect(failed.has(el.src), say(`a failed file was fetched again: ${el.src}`)).toBe(
              false,
            );
            if (c.ages)
              expect(el.src, say('not the first file of the age')).toBe(musicForAge(selected)[0]);
            else if (before.n === 0)
              expect(el.src, say('Pastoral Pulse is not first')).toBe(MUSIC_TRACKS[0]);
            else expect(MUSIC_TRACKS, say('a file of no set')).toContain(el.src);
          }
          // the synth loop stands in only when every file has failed, and then it does
          const every = failed.size === MUSIC_TRACKS.length;
          if (loops > 0) expect(every, say('the synth loop took over with a file left')).toBe(true);
          if (every && unlocked && !held && v > 0)
            expect(loops, say('every file failed and nothing plays')).toBeGreaterThan(0);
          // once a gesture has unlocked a released bus, it plays the newest file at the volumes
          if (unlocked && !held && now >= settleAt && !every) {
            expect(top, say('an unlocked, released bus has no track')).toBeDefined();
            expect(top!.volume, say('not at the volume of the sliders')).toBe(v);
            const playing = els.filter((el) => el.playing).map((el) => els.indexOf(el));
            const expected = v > 0 ? [els.length - 1] : [];
            expect(
              playing,
              say('playing tracks (by index) are not the newest, or not muted'),
            ).toEqual(expected);
            if (c.ages)
              expect(top!.src, say('not the first file of the age')).toBe(musicForAge(selected)[0]);
          }
        };

        c.steps.forEach((s, i) => {
          const before = {
            n: music().length,
            plays: plays(),
            loops: setInterval.mock.calls.length,
          };
          // These calls leave the music alone: a hold stops nothing that plays, a preload only
          // fetches (one file at most), and a start with no hold to end changes nothing.
          const inert = s.op === 'hold' || s.op === 'preload' || (s.op === 'start' && !held);
          const playingBefore = music().flatMap((el, at) => (el.playing ? [at] : []));
          step(s);
          const where = `step ${i + 1} ${JSON.stringify(s)}`;
          if (inert) {
            const playingNow = music().flatMap((el, at) => (el.playing ? [at] : []));
            expect(plays(), `${where}: it played a track`).toBe(before.plays);
            expect(playingNow, `${where}: it changed which tracks play`).toEqual(playingBefore);
            expect(setInterval.mock.calls.length, `${where}: it started the synth`).toBe(
              before.loops,
            );
            expect(music().length - before.n, `${where}: it fetched files`).toBeLessThanOrEqual(
              s.op === 'preload' ? 1 : 0,
            );
          }
          verify(where, before);
        });
        // let any fade run out, then check the end state once more
        const before = { n: music().length, plays: plays(), loops: setInterval.mock.calls.length };
        step({ op: 'tick', ms: MUSIC_FADE_MS + 100 });
        verify('after the last step and the fade', before);
      } finally {
        Object.assign(AGE_MUSIC, pristine);
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      }
    }

    it('keeps the title silent, one track playing and the synth for the last resort, whatever the calls', () => {
      forAll((rng) => genCase(rng, false), run, { shrink: shrinkCase });
    });

    it('keeps the same with age changes in the mix, and ends on the first file of the age selected last', () => {
      forAll((rng) => genCase(rng, true), run, { shrink: shrinkCase });
    });

    it('plays Pastoral Pulse first, then each variation once, then whole rounds, whatever the shuffle', () => {
      const ROUNDS = 3; // after the first round of Pastoral Pulse and the variations
      const sorted = (list: readonly string[]) => [...list].sort();
      forAll(
        (rng) => rng.int(1, 1_000_000),
        (shuffle) => {
          FakeAudio.made = [];
          FakeAudio.overlaps = 0;
          const win = target();
          const { ctx } = fakeContext();
          vi.stubGlobal('window', {
            addEventListener: win.addEventListener,
            setInterval: vi.fn(() => 1),
            AudioContext: function () {
              return ctx;
            },
          });
          vi.stubGlobal('Audio', FakeAudio);
          const stream = new Rng(shuffle);
          vi.spyOn(Math, 'random').mockImplementation(() => stream.next());
          try {
            const bus = new Bus();
            const music = () => FakeAudio.made.filter((el) => el.src.includes('/music/'));
            // what the game does: held and fetched ahead on the title, started with the first gesture
            bus.hold();
            bus.preload();
            win.fire('pointerdown');
            bus.startMusic();
            const tracks = MUSIC_TRACKS.length;
            const total = tracks + ROUNDS * tracks;
            // each track plays to its end
            while (music().length < total) {
              const n = music().length;
              fire(music()[n - 1], 'ended');
              expect(music().length, 'a track ended and the next one did not start').toBe(n + 1);
            }
            const srcs = music().map((el) => el.src);
            expect(srcs[0], 'Pastoral Pulse is not first').toBe(MUSIC_TRACKS[0]);
            expect(sorted(srcs.slice(1, tracks)), 'the first round misses a variation').toEqual(
              sorted(MUSIC_TRACKS.slice(1)),
            );
            for (let round = 1; round <= ROUNDS; round++)
              expect(
                sorted(srcs.slice(round * tracks, (round + 1) * tracks)),
                `round ${round} is not every file once: ${srcs.join(' ')}`,
              ).toEqual(sorted(MUSIC_TRACKS));
            for (let i = 1; i < srcs.length; i++)
              expect(srcs[i], `a file repeats at once at ${i}`).not.toBe(srcs[i - 1]);
            // one file plays at a time, the newest
            expect(FakeAudio.overlaps, 'two tracks played together').toBe(0);
            expect(music().filter((el) => el.playing)).toEqual([music()[music().length - 1]]);
          } finally {
            vi.unstubAllGlobals();
            vi.restoreAllMocks();
          }
        },
      );
    });
  });

  it('mutes the ambience while the tab is hidden, with one visibility listener', () => {
    const doc = { hidden: false, ...target() };
    vi.stubGlobal('document', doc);
    const { ctx, gains } = fakeContext();
    const ambience = new Ambience();
    expect(doc.addEventListener).not.toHaveBeenCalled();
    ambience.update(ctx, 0.5, 0, 0);
    ambience.update(ctx, 0.5, 0, 0);
    expect(doc.types()).toEqual(['visibilitychange']);
    const master = gains[0].gain.setTargetAtTime;
    doc.hidden = true;
    doc.fire('visibilitychange');
    expect(master).toHaveBeenLastCalledWith(0, 1, 0.15);
    doc.hidden = false;
    doc.fire('visibilitychange');
    expect(master).toHaveBeenLastCalledWith(0.5, 1, 0.15);
  });
});

describe('the synthesizer', () => {
  it('gives every sound event a voice of its own', () => {
    const { ctx } = fakeContext();
    vi.stubGlobal('window', {
      AudioContext: function () {
        return ctx;
      },
    });
    const synth = new Synth();
    synth.markGesture();
    const voices = vi.spyOn(ctx, 'createOscillator');
    // an event the synth has no case for plays silence wherever it has no sound file
    for (const name of SOUND_EVENTS) {
      voices.mockClear();
      synth.play(name, 1);
      expect(voices, name).toHaveBeenCalled();
    }
  });
});
