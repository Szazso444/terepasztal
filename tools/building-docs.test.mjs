import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AGES, FOOTPRINTS, ROOT, loadInventory, pictures } from './building-kit.mjs';
import { FIT } from './building-fit.mjs';
import { STATUSES } from './building-queue.mjs';

const guide = readFileSync(`${ROOT}/GUIDE.md`, 'utf8');
const prompt = readFileSync(`${ROOT}/PROMPT.md`, 'utf8');
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
const ignored = readFileSync(`${ROOT}/.gitignore`, 'utf8');
const production = readFileSync('docs/art-direction/building-production.md', 'utf8');

describe('the guide for the artist agent', () => {
  it('names every building command, and package.json has them', () => {
    for (const tool of ['guides', 'queue', 'check', 'sheets', 'fit']) {
      expect(scripts[`art:buildings:${tool}`]).toBe(`node tools/building-${tool}.mjs`);
      expect(guide).toContain(`tools/building-${tool}.mjs`);
    }
    for (const command of [
      'next',
      'take',
      'show',
      'set',
      'keep',
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
    // the tools refuse it; the limit is the tools' own
    expect(guide).toContain(`more than ${FIT.camera}°`);
    expect(guide).not.toMatch(/the tools correct it, but/);
    // the tool keeps the refused attempt and hands the picture out again, painted from it
    expect(guide).toMatch(/run\s+`node tools\/building-queue\.mjs next`\s+again/);
    // after three attempts the tool keeps the closest itself: nothing to copy, add or choose
    expect(guide).toMatch(/keeps the closest/);
    for (const gone of ['--keep', '.tries/']) {
      expect(guide, gone).not.toContain(gone);
      expect(prompt, gone).not.toContain(gone);
    }
    expect(guide).not.toMatch(/adding to the prompt/);
    // pictures made before go back in the queue and are painted again from their earlier selves
    expect(guide).toContain('.before.png');
    expect(guide).toMatch(/to paint again/);
    expect(guide).toMatch(/closes its gate again/);
    // a picture recorded as made that fails a later check is the user's to decide, not remade
    expect(guide).toMatch(/already recorded as made/);
    // too many pictures kept far off stop the work like too many lost ones
    expect(guide).toMatch(/kept with its camera off/);
    expect(guide).toContain(`more than ${FIT.near}°`);
    for (const kept of [
      '*.before.png',
      '*.before.*.png',
      '.tries/',
      '*.rejected.png',
      '*.rejected.*.png',
      '.fitted/',
    ])
      expect(ignored, kept).toContain(kept);
  });

  it('gives the agent a picture it can judge by eye, and a way to take one back', () => {
    // on grass and opaque: the colour under transparent pixels is not a glow round the building
    expect(guide).toContain('building-sheets.mjs --picture');
    expect(guide).toContain('.look/');
    expect(ignored).toContain('.look/');
    expect(guide).toMatch(/not in the picture/);
    // which wall the door and the portals belong to is drawn in, and the portals are checked
    expect(guide).toMatch(/yellow/);
    expect(guide).toMatch(/the portals are in the/);
    // the ground inside a depot's portals stays empty: the game's rails run through them
    expect(guide).toContain('the portals are not open to the ground');
    expect(guide).toMatch(/rails\s+are\s+drawn\s+in/);
    expect(production).toMatch(/open to the\s+ground/);
    // a recorded picture found faulty is taken back, never put back with everything built on it
    expect(guide).toContain('set <id> pending');
    expect(guide).toContain('--yes');
  });

  it('lets another session take the work over', () => {
    // the way of working is in the tool and in what `next` prints, not in one chat's memory
    for (const text of [guide, prompt, production])
      expect(text).toContain('node tools/building-queue.mjs take <id>');
    // a picture is taken as a file, never passed through the shell as text, nor saved by hand
    expect(guide).toMatch(/through the shell as text/);
    for (const text of [guide, prompt]) {
      expect(text).not.toMatch(/the file to save/);
      expect(text).toMatch(/[Dd]o not save (it|the picture)\s+yourself/);
    }
    // where the pictures are looked for, and how another place is named
    expect(guide).toContain('generated_images');
    expect(guide).toContain('--from');
    expect(guide).toMatch(/nothing new was made/);
    // the file the image tool reported is the surest; the tool does not guess between chats
    expect(guide).toContain('take <id> --from <file>');
    expect(guide).toMatch(/more than one chat's folder/);
    expect(prompt).toContain('take <id> --from <file>');
    // every answer `take` gives is named in the guide, and a picture is made one at a time
    for (const answer of [
      'no new picture: this is the one that was taken before',
      'was made before the last picture that was taken or recorded',
      "another chat's folder",
      'was refused by set',
      'was taken before',
      "does not know your chat's folder yet",
    ])
      expect(guide, answer).toContain(answer);
    expect(guide).toMatch(/one picture at a time/);
    expect(guide).toMatch(/15 minutes/);
    // what the tool keeps of a picture is had back by its name
    expect(guide).toMatch(/is had back by\s+naming that file/);
    // a rejection takes no count from the agent
    expect(guide).not.toMatch(/rejected --attempts/);
    expect(guide).not.toMatch(/where a copy takes one/);
    expect(guide).not.toMatch(/follows your chat/);
    expect(production).not.toMatch(/follows the chat/);
    // the count is the tool's: the plain form everywhere, a number only for what it never saw
    expect(guide).not.toMatch(/set <id> generated --attempts/);
    expect(prompt).not.toMatch(/--attempts/);
    expect(guide).toMatch(/never lower it/);
    // a picture is not given up while the tool holds an attempt of it that was right
    expect(guide).toContain('node tools/building-queue.mjs keep <id>');
    expect(prompt).toContain('node tools/building-queue.mjs keep <id>');
    expect(guide).toMatch(
      /[Rr]eject a\s+picture\s+only\s+when\s+none\s+of\s+its\s+attempts\s+was\s+right/,
    );
    expect(guide).toMatch(/another session/);
    expect(production).toMatch(/## Handing the work to another session/);
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

  it('has a document for whoever runs the work again, held to what the tools do', () => {
    for (const tool of ['kit', 'guides', 'queue', 'check', 'fit', 'sheets'])
      expect(production, tool).toContain(`tools/building-${tool}.mjs`);
    for (const file of ['families.json', 'GUIDE.md', 'PROMPT.md', 'queue.json', 'report.json'])
      expect(production, file).toContain(`${ROOT}/${file}`);
    for (const command of ['next', 'set <id> generated', 'approve-pilot', 'recheck', 'status'])
      expect(production, command).toContain(`building-queue.mjs ${command}`);
    expect(production).toContain('building-sheets.mjs --picture');
    // the limits it quotes are the tools' own
    expect(production).toContain(`more than ${FIT.camera}° off`);
    expect(production).toContain(`kept within ${FIT.near}°`);
    // and so are the numbers of the work
    const inventory = loadInventory();
    expect(production).toContain(`${inventory.length} kinds of building`);
    expect(production).toContain(`${pictures(inventory).length} pictures`);
    expect(guide).toContain(`${pictures(inventory).length} pictures in all`);
    // a building that is not modernised to the end is named with its last age
    expect(production).toContain('lastTier');
    for (const name of ['FIT', 'LIMIT', 'GATES', 'LOSS', 'ATTEMPTS'])
      expect(production, name).toContain(`\`${name}\``);
    // how to put a run back, and what is not built
    expect(production).toMatch(/git checkout <that commit> -- /);
    expect(production).toMatch(/## Not built yet/);
  });

  it('is what the prompt sends the agent to', () => {
    expect(prompt).toContain(`${ROOT}/GUIDE.md`);
    expect(prompt).toContain('node tools/building-queue.mjs next');
    expect(prompt).toMatch(/GATE/);
    expect(prompt).toMatch(/STOP/);
    expect(prompt).toContain('origin/buildings/art-package');
    // work in hand is committed before the tools are brought up to date, never stashed: a merge
    // over staged and unrecorded pictures had the agent juggling five stashes
    expect(prompt).toMatch(/commit\s+what\s+you\s+have/);
    expect(prompt).toMatch(/never\s+stash/);
    expect(guide).toMatch(/never\s+stash/);
    expect(production).toMatch(/never\s+stash/i);
    expect(prompt).not.toMatch(/delete it/i);
  });
});
