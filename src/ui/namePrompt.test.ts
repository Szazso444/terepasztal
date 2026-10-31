import { describe, it, expect } from 'vitest';
import { nameAnswer } from './namePrompt';

describe('what Enter answers in the name dialog', () => {
  it('is the name typed, trimmed', () => {
    expect(nameAnswer('  Szeged  ', false)).toBe('Szeged');
    expect(nameAnswer('42', true)).toBe('42');
  });

  it('is a dismissal for an empty name, as it was for a town and a save', () => {
    expect(nameAnswer('', false)).toBeNull();
    expect(nameAnswer('   ', false)).toBeNull();
  });

  it('is an answer for an empty name where that means something: a seed left empty is a random one', () => {
    expect(nameAnswer('', true)).toBe('');
    expect(nameAnswer('   ', true)).toBe('');
  });
});
