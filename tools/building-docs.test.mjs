import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AGES, FOOTPRINTS, ROOT } from './building-kit.mjs';
import { FIT } from './building-fit.mjs';
import { STATUSES } from './building-queue.mjs';

const guide = readFileSync(`${ROOT}/GUIDE.md`, 'utf8');
const prompt = readFileSync(`${ROOT}/PROMPT.md`, 'utf8');
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
const ignored = readFileSync(`${ROOT}/.gitignore`, 'utf8');

describe('the guide for the artist agent', () => {
  it('names every building command, and package.json has them', () => {
    for (const tool of ['guides', 'queue', 'check', 'sheets', 'fit']) {
      expect(scripts[`art:buildings:${tool}`]).toBe(`node tools/building-${tool}.mjs`);
      expect(guide).toContain(`tools/building-${tool}.mjs`);
    }
    for (const command of [
      'next',
      'show',
      'set',
      'status',
      'recheck',
      'redo',
      'accept',
      'approve-pilot',
    ])
      expect(guide).toContain(`building-queue.mjs ${command}`);
  });

  it('states the conventions as the tools have them', () => {
    for (const fp of Object.values(FOOTPRINTS))
      expect(guide, fp.id).toContain(`${fp.canvas[0]} x ${fp.canvas[1]}`);
    for (const a of AGES) expect(guide).toContain(`\`${a.tag}\``);
    for (const r of ['r0', 'r1', 'r2', 'r3']) expect(guide).toContain(`\`${r}\``);
    for (const s of STATUSES) expect(guide).toContain(`\`${s}\``);
    // what `next` answers with
    for (const code of ['0', '2', '3', '4']) expect(guide).toMatch(new RegExp(`exit code ${code}`));
  });

  it('asks only for what an image generator can keep', () => {
    // the pilot: the generator fills the canvas and picks its size; the tools measure the picture
    expect(guide).toMatch(/measure/);
    expect(guide).toContain('768');
    expect(guide).not.toMatch(/never resize, crop or move/i);
    expect(guide).not.toMatch(/fixed\s+pixel/i);
    expect(guide).not.toMatch(/magenta/i);
    expect(guide).not.toMatch(/delete the file/i);
  });

  it('keeps the camera from drifting', () => {
    // later pictures are shown earlier ones laid onto their footprint, and the angles are watched
    expect(guide).toContain('.fitted/');
    expect(guide).toContain('-angles.png');
    expect(guide).toMatch(/camera off/);
    expect(guide).toMatch(/parallel to the plinth/);
  });

  it('has a picture painted again when its camera is off', () => {
    // the tools refuse it and say what to add to the prompt; the limit is the tools' own
    expect(guide).toContain(`more than ${FIT.camera}°`);
    expect(guide).toMatch(/adding to the prompt/);
    expect(guide).not.toMatch(/the tools correct it, but/);
    // the closest of three attempts is kept, and marked for the user
    expect(guide).toContain('--keep');
    expect(guide).toContain('.tries/');
    expect(prompt).toContain('--keep');
    // pictures made before go back in the queue and are painted again from their earlier selves
    expect(guide).toContain('.before.png');
    expect(guide).toMatch(/to paint again/);
    // the earlier self counts when the closest attempt is chosen
    expect(guide).toMatch(/earlier self counts/);
    // the tool counts the attempts it refused; the user sees a gate family again
    expect(guide).toMatch(/counts the attempts it refused/);
    expect(guide).toMatch(/closes its gate again/);
    // a picture recorded as made that fails a later check is the user's to decide, not remade
    expect(guide).toMatch(/already recorded as made/);
    // too many kept pictures stop the work like too many lost ones
    expect(guide).toMatch(/kept with its camera off/);
    for (const kept of ['*.before.png', '.tries/', '*.rejected.png', '.fitted/'])
      expect(ignored, kept).toContain(kept);
  });

  it('holds the gates and the limits on failure', () => {
    expect(guide).toMatch(/GATE/);
    expect(guide).toMatch(/STOP/);
    expect(guide).toMatch(/depot/);
    expect(guide).toMatch(/station/);
    expect(guide).toContain('approve-pilot');
    expect(guide).toMatch(/three attempts/);
    expect(guide).toMatch(/quarter/);
    expect(guide).toContain('families.json');
    // the repository's general note about progress files does not apply to this work
    expect(guide).toContain('RESUME.md');
  });

  it('is what the prompt sends the agent to', () => {
    expect(prompt).toContain(`${ROOT}/GUIDE.md`);
    expect(prompt).toContain('node tools/building-queue.mjs next');
    expect(prompt).toMatch(/GATE/);
    expect(prompt).toMatch(/STOP/);
    expect(prompt).toContain('origin/buildings/art-package');
    expect(prompt).not.toMatch(/delete it/i);
  });
});
