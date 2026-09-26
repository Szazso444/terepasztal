import { describe, it, expect } from 'vitest';
import { MusicPlaylist, MUSIC_TRACKS } from './musicPlaylist';
import { Rng } from './rng';

describe('Pastoral Pulse playlist', () => {
  it('starts with the original, then plays each mix before repeating', () => {
    const rng = new Rng(19),
      p = new MusicPlaylist(() => rng.next());
    expect(MUSIC_TRACKS[p.current]).toBe('/assets/audio/music/pastoral-pulse.mp3');
    expect(new Set([p.current, p.next(), p.next(), p.next()]).size).toBe(4);
    let previous = p.current;
    for (let round = 0; round < 100; round++) {
      const played = [];
      for (let i = 0; i < 4; i++) {
        const next = p.next();
        expect(next).not.toBe(previous);
        played.push(next);
        previous = next!;
      }
      expect(new Set(played).size).toBe(4);
    }
  });
  it('skips unavailable files and terminates if all files fail', () => {
    const p = new MusicPlaylist(() => 0.5),
      failed = new Set([1, 3]);
    for (let i = 0; i < 20; i++) expect([0, 2]).toContain(p.next(failed));
    failed.add(0);
    failed.add(2);
    expect(p.next(failed)).toBeNull();
  });
});
