import { afterEach, describe, expect, it, vi } from 'vitest';
// imported for real, with no vi.mock: loading the audio modules must not need a browser
import { audio, sfx, SOUND_EVENTS } from './audio';
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

/** A music element that loads and plays without a network. */
class FakeAudio {
  static made: FakeAudio[] = [];
  loop = true;
  preload = '';
  volume = 1;
  addEventListener = vi.fn();
  load = vi.fn();
  pause = vi.fn();
  play = vi.fn(() => Promise.resolve());
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

  it("plays the age's set: selected before the gesture, faded out when the set changes", async () => {
    const win = target();
    const { ctx } = fakeContext();
    vi.stubGlobal('window', {
      addEventListener: win.addEventListener,
      AudioContext: function () {
        return ctx;
      },
    });
    vi.stubGlobal('Audio', FakeAudio);
    vi.useFakeTimers();
    vi.resetModules();
    const sets = await import('./musicPlaylist');
    const fresh = await import('./audio');
    const steam = ['/assets/audio/music/steam/a.mp3', '/assets/audio/music/steam/b.mp3'];
    const diesel = ['/assets/audio/music/diesel/a.mp3'];
    sets.AGE_MUSIC.steam = steam;
    sets.AGE_MUSIC.diesel = diesel;
    const srcs = () => FakeAudio.made.map((el) => el.src);

    fresh.audio.applyMusic(); // what boot does
    fresh.audio.setAge('steam'); // what applySave does
    expect(FakeAudio.made).toHaveLength(0);
    win.fire('pointerdown');
    expect(srcs()).toEqual([steam[0]]);
    fresh.audio.setAge('steam');
    expect(srcs()).toEqual([steam[0]]);

    fresh.audio.setAge('diesel');
    expect(srcs()).toEqual([steam[0], diesel[0]]);
    expect(FakeAudio.made[1].play).toHaveBeenCalled();
    const old = FakeAudio.made[0];
    expect(old.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(old.pause).toHaveBeenCalled();
    expect(old.volume).toBeLessThan(fresh.audio.master * fresh.audio.music);

    // the old track's events no longer move the music on
    fire(old, 'ended');
    expect(srcs()).toHaveLength(2);
    // every diesel file fails: the default set takes over at its first track
    fire(FakeAudio.made[1], 'error');
    expect(srcs()).toEqual([steam[0], diesel[0], sets.MUSIC_TRACKS[0]]);
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
