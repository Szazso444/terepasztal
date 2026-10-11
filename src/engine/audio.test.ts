import { afterEach, describe, expect, it, vi } from 'vitest';
// imported for real, with no vi.mock: loading the audio modules must not need a browser
import { audio, MUSIC_FADE_MS, sfx, SOUND_EVENTS } from './audio';
import { Ambience } from './ambience';
import { Synth } from './synth';
import { MUSIC_TRACKS } from './musicPlaylist';

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
    vi.stubGlobal('window', {
      addEventListener: win.addEventListener,
      setInterval: () => 1, // the synth loop's scheduler, when every file has failed
      AudioContext: function () {
        return ctx;
      },
    });
    vi.stubGlobal('Audio', FakeAudio);
    vi.useFakeTimers();
    vi.resetModules();
    const playlist = await import('./musicPlaylist');
    const fresh = await import('./audio');
    Object.assign(playlist.AGE_MUSIC, sets);
    return {
      win,
      playlist,
      bus: fresh.audio,
      srcs: () => FakeAudio.made.map((el) => el.src),
      playing: () => FakeAudio.made.filter((el) => el.playing),
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
