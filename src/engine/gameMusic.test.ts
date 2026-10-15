import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MUSIC_TRACKS } from './musicPlaylist';

// The title screen holds the music back (`audio.hold()` at the start of boot, see main.ts), and
// closing a menu is how the player leaves it: `closeMenus` in src/ui/panels.ts calls
// `Game.resumeGame`, which lets the music start. audio.test.ts pins the bus; this file pins that
// the game calls it. A `Game` cannot be constructed under Node (its `Toasts` build DOM), so its
// method runs on a stand-in that has the prototype and only the fields `resumeGame` reads, as
// gameSave.test.ts does for the save methods.

/** A music element that plays without a network, and records that it did. */
class FakeAudio {
  static made: FakeAudio[] = [];
  loop = true;
  preload = '';
  volume = 1;
  playing = false;
  get paused() {
    return !this.playing;
  }
  addEventListener = vi.fn();
  load = vi.fn();
  pause = vi.fn(() => {
    this.playing = false;
  });
  play = vi.fn(() => {
    this.playing = true;
    return Promise.resolve();
  });
  constructor(readonly src: string) {
    FakeAudio.made.push(this);
  }
}

/** Just enough of an AudioContext for the synth to build its master bus. */
function fakeContext() {
  const node = () => ({ gain: { value: 0, setTargetAtTime: vi.fn() }, connect: vi.fn() });
  return {
    state: 'running',
    currentTime: 1,
    destination: {},
    resume: () => Promise.resolve(),
    createGain: node,
  } as unknown as AudioContext;
}

/** The game and the audio bus it shares, from a fresh import, with a window to hear gestures. */
async function rig() {
  vi.resetModules();
  // imported before any global exists, as gameSave.test.ts imports it
  const { Game } = await import('../game');
  const { audio } = await import('./audio');
  const listeners: Record<string, (() => void)[]> = {};
  const ctx = fakeContext();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: () => void) => {
      listeners[type] = [...(listeners[type] ?? []), fn];
    },
    setInterval: () => 1,
    AudioContext: function () {
      return ctx;
    },
  });
  vi.stubGlobal('Audio', FakeAudio);
  return {
    Game,
    audio,
    gesture: () => (listeners.pointerdown ?? []).forEach((fn) => fn()),
    /** The files of the music that plays now. */
    playing: () => FakeAudio.made.filter((el) => el.playing).map((el) => el.src),
  };
}

/** A Game with the prototype's `resumeGame` and the fields it reads, and no DOM. */
function standIn(Game: { prototype: object }, paused: boolean) {
  const setSpeed = vi.fn();
  const game = Object.assign(Object.create(Game.prototype), {
    paused,
    mode: 'play',
    menuPausedSpeed: 3,
    clock: { setSpeed },
  }) as { paused: boolean; resumeGame(): void };
  return { game, setSpeed };
}

// the first import of the game transforms its whole module graph, about four seconds alone and
// several times that on a loaded machine; the tests re-import it fresh each, which is quick after
beforeAll(async () => {
  await import('../game');
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  FakeAudio.made = [];
});

describe('Game.resumeGame and the held music', () => {
  it.each([true, false])(
    'lets the music start that the title held back, with the clock paused: %s',
    async (paused) => {
      const { Game, audio, gesture, playing } = await rig();
      audio.hold(); // what boot does
      audio.preload();
      gesture(); // the player clicks on the title screen
      expect(playing()).toEqual([]);
      const { game, setSpeed } = standIn(Game, paused);
      game.resumeGame();
      expect(playing()).toEqual([MUSIC_TRACKS[0]]);
      // the clock is resumed as it was before the music was wired in
      expect(game.paused).toBe(false);
      expect(setSpeed.mock.calls).toEqual(paused ? [[3]] : []);
    },
  );

  it('neither restarts nor doubles the music when a menu closes again', async () => {
    const { Game, audio, gesture, playing } = await rig();
    audio.hold();
    audio.preload();
    gesture();
    const { game } = standIn(Game, true);
    game.resumeGame();
    game.resumeGame();
    expect(FakeAudio.made.map((el) => el.src)).toEqual([MUSIC_TRACKS[0]]);
    expect(FakeAudio.made[0].play).toHaveBeenCalledTimes(1);
    expect(playing()).toEqual([MUSIC_TRACKS[0]]);
  });

  it('starts nothing before a gesture, and plays on the first one', async () => {
    const { Game, audio, gesture, playing } = await rig();
    audio.hold();
    audio.preload();
    standIn(Game, true).game.resumeGame(); // a reload into a game: no gesture on this page yet
    expect(playing()).toEqual([]);
    gesture();
    expect(playing()).toEqual([MUSIC_TRACKS[0]]);
  });

  it("hands the title's Continue at boot to the boot once, which starts the music as its loading ends", async () => {
    const { Game, audio, gesture, playing } = await rig();
    audio.hold();
    audio.preload();
    gesture();
    const { game, setSpeed } = standIn(Game, true);
    const begin = vi.fn();
    Object.assign(game, { onTitleContinue: begin });
    game.resumeGame(); // Continue on the title the boot opened
    // the boot's loading screen starts the music, not the click on Continue; the clock resumes
    // as ever
    expect(begin).toHaveBeenCalledTimes(1);
    expect(playing()).toEqual([]);
    expect(setSpeed.mock.calls).toEqual([[3]]);
    // the hand-off is spent: a menu closed later lets the music start as before
    game.resumeGame();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(playing()).toEqual([MUSIC_TRACKS[0]]);
  });

  it('changes nothing for a bus nobody held: the first gesture starts the music, as before', async () => {
    const { Game, gesture, playing } = await rig();
    standIn(Game, true).game.resumeGame();
    expect(FakeAudio.made).toHaveLength(0);
    gesture();
    expect(playing()).toEqual([MUSIC_TRACKS[0]]);
  });
});
