import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AGES, FOOTPRINTS, ROOT } from './building-kit.mjs';
import { STATUSES } from './building-queue.mjs';

const guide = readFileSync(`${ROOT}/GUIDE.md`, 'utf8');
const prompt = readFileSync(`${ROOT}/PROMPT.md`, 'utf8');
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;

describe('the guide for the artist agent', () => {
  it('names every building command, and package.json has them', () => {
    for (const tool of ['guides', 'queue', 'check', 'sheets']) {
      expect(scripts[`art:buildings:${tool}`]).toBe(`node tools/building-${tool}.mjs`);
      expect(guide).toContain(`tools/building-${tool}.mjs`);
    }
    for (const command of ['next', 'show', 'set', 'status', 'approve-pilot'])
      expect(guide).toContain(`building-queue.mjs ${command}`);
  });

  it('states the conventions as the tools have them', () => {
    for (const fp of Object.values(FOOTPRINTS)) {
      expect(guide, fp.id).toContain(`${fp.canvas[0]} x ${fp.canvas[1]}`);
      expect(guide, fp.id).toContain(`(${fp.centre[0]}, ${fp.centre[1]})`);
    }
    for (const a of AGES) expect(guide).toContain(`\`${a.tag}\``);
    for (const r of ['r0', 'r1', 'r2', 'r3']) expect(guide).toContain(`\`${r}\``);
    for (const s of STATUSES) expect(guide).toContain(`\`${s}\``);
  });

  it('holds the gates and the limits on failure', () => {
    expect(guide).toMatch(/pilot/i);
    expect(guide).toContain('approve-pilot');
    expect(guide).toMatch(/three attempts/);
    expect(guide).toMatch(/quarter/);
    expect(guide).toContain('families.json');
  });

  it('is what the prompt sends the agent to', () => {
    expect(prompt).toContain(`${ROOT}/GUIDE.md`);
    expect(prompt).toContain('node tools/building-queue.mjs next');
    expect(prompt).toMatch(/pilot/i);
  });
});
