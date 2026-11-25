import { describe, it, expect } from 'vitest';
import { content } from './content';
import { HU } from './strings.hu';
import { ENGLISH } from '../strings';

describe('landmark texts', () => {
  it('names and tells every landmark of the content, in both languages', () => {
    for (const lm of content.landmarks)
      for (const table of [ENGLISH, HU]) {
        expect(table.landmarks.names[lm.id], `${lm.id} name`).toBeTruthy();
        expect(table.landmarks.stories[lm.id], `${lm.id} story`).toBeTruthy();
      }
  });
});
