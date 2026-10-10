import { describe, expect, it } from 'vitest';
import { AutosavePause } from './autosavePause';

describe('AutosavePause', () => {
  it('allows every write before an error', () => {
    const pause = new AutosavePause();
    expect(pause.paused).toBe(false);
    expect(pause.allows('implicit')).toBe(true);
    expect(pause.allows('manual')).toBe(true);
  });

  it('refuses implicit writes from the first error on, and never a manual save', () => {
    const pause = new AutosavePause();
    pause.trip();
    expect(pause.paused).toBe(true);
    expect(pause.allows('implicit')).toBe(false);
    expect(pause.allows('manual')).toBe(true);
    // a manual save and a repeated error lift nothing
    pause.trip();
    expect(pause.allows('implicit')).toBe(false);
    expect(pause.allows('manual')).toBe(true);
    expect(pause.paused).toBe(true);
  });
});
