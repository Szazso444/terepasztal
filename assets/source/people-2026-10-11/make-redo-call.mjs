import fs from 'node:fs';
import path from 'node:path';
import { root, json, saveJson } from './pose-png.mjs';
const [strip, frameText, attemptText, ...correction] = process.argv.slice(2),
  frame = Number(frameText),
  attempt = Number(attemptText),
  geometry = json('pose-geometry.json'),
  spec = geometry.strips[strip];
if (
  !spec ||
  !Number.isInteger(frame) ||
  frame < 0 ||
  frame > 3 ||
  !Number.isInteger(attempt) ||
  attempt < 1 ||
  attempt > 3
)
  throw Error('make-redo-call <strip> <frame0..3> <attempt1..3> [correction]');
const id = strip + '-f' + frame + '-attempt-' + attempt,
  callFile = 'calls/' + id + '.json',
  history = json('prompts.json')['redo-2026-10-11'] ?? [];
if (history.some((e) => e.id === id && e.file))
  throw Error('Painting call already returned; never overwrite its prompt');
const refs = ['guides/' + strip + '-f' + frame + '.png'];
const profession = spec.profession;
if (profession === 'pump-hand')
  refs.push(
    strip === 'pump-hand-back-carry'
      ? 'poses/pump-hand-front-carry-f0.png'
      : 'refs/pump-hand-front-walk.png',
  );
else refs.push('refs/' + profession + '-front-' + (spec.carry ? 'carry' : 'walk') + '.png');
if (spec.view === 'back')
  refs.push(
    strip === 'pump-hand-back-carry'
      ? 'poses/pump-hand-back-walk-f0.png'
      : 'refs/' + strip + '-back.png',
  );
refs.push('reference-passenger.png');
if (frame) refs.push('poses/' + strip + '-f0.png');
for (const reference of refs)
  if (!fs.existsSync(path.join(root, reference)))
    throw Error('Missing required reference ' + reference);
const person = {
  'pump-hand':
    'older man, DEEP warm brown skin (base#754A32,light#96633F,shadow#4D3026), grey hair at temples, moss#78804C flat cap, rolled sleeves on muted dark slate-blue shirt(base#626B6C,shadow#414D53,light#7B858A), charcoal trousers, subdued BROWN boots(base#71503B,light#906C50), never orange boots or pale/light-blue shirt',
  lumberjack:
    'stocky adult man, fair warm skin, short auburn beard and brown hair, broad copper-and-moss checked shirt, forest-green felt hat, charcoal trousers and brown boots; SAME identity as front reference',
  'stone-mason':
    'adult woman with warm medium-brown skin and short dark hair, slate flat cap, ivory rolled-sleeve shirt, broad copper-brown leather apron with its back straps and ties, moss trousers and brown boots',
  farmer:
    'older woman, warm olive skin, grey-brown hair, broad straw hat, muted teal work smock, charcoal trousers, brown boots',
}[profession];
const load = spec.carry
  ? {
      'pump-hand':
        'a broad WOODEN YOKE ACROSS BOTH SHOULDERS, TWO full wooden buckets, one hanging at EACH end, thick short supports, water muted TEAL#477B82 not cyan; no spills; both buckets and yoke completely visible within guide load boxes',
      lumberjack:
        'ONE thick short bark-covered log on the SAME shoulder as front-carry reference, pale end grain, one hand bracing it, NO axe',
      'stone-mason':
        'ONE dressed pale limestone block held in BOTH arms, WIDER THAN HER BACK, so LEFT AND RIGHT stone ends SHOW BEYOND both sides of her body in BACK view; guide light-grey side blocks MUST remain visible, no hammer',
      farmer:
        'ONE broad tied SOFT GOLD wheat sheaf on the SAME shoulder as front-carry reference, broad clusters and binding, no pitchfork; muted gold well below selectionamber#E8AA48',
    }[profession]
  : {
      'pump-hand': 'EMPTY hands swinging, no tools',
      lumberjack:
        'stout axe over SAME shoulder as front-walk reference, BROAD slate head above that shoulder, short thick wooden shaft, no log',
      'stone-mason':
        'broad heavy masonry hammer in SAME hand as front-walk reference, short thick handle, large slate head, no stone block',
      farmer:
        'SHORT CHUNKY three-tine pitchfork in same hand as front reference; fork top NO HIGHER than HAT TOPy192, not the tall shaft of earlier drawing; no wheat',
    }[profession];
const direction =
  spec.view === 'back'
    ? 'BACK-RIGHT3/4 walking AWAY toward UPPER RIGHT, back of head/clothes and right side visible, NO face or front clothes'
    : 'FRONT-RIGHT3/4 walking toward LOWER RIGHT, face and front-right visible';
const phase = [
  'f0 CONTACT: near RIGHT leg reaches forward heel down, far LEFT leg trails toe touching ground; LEFT arm forward except bracing arm',
  'f1 PASSING: RIGHT leg PLANTED under hips, LEFT knee bent and LEFT foot LIFTED next to right shin; guide lifted boot position is mandatory',
  'f2 OPPOSITE CONTACT: far LEFT leg FORWARD, near RIGHT leg TRAILING; thighs overlap OPPOSITE way from f0, RIGHT arm forward except bracing arm. Do NOT repeat or mirror f0. Follow the new guide foot positions and occlusion',
  'f3 OPPOSITE PASSING: LEFT leg PLANTED, RIGHT knee bent and RIGHT foot LIFTED. Lift the OTHER foot from f1, preserve body facing, no mirroring',
][frame];
const b = spec.frames[frame].box;
const referenceRoles = refs
  .map(
    (r, i) =>
      'image' +
      (i + 1) +
      ': ' +
      (i === 0
        ? 'EDIT TARGET and EXACT pose/box authority'
        : i === 1
          ? 'IDENTITY/CLOTHES/LOAD ONLY, not pose'
          : r === 'reference-passenger.png'
            ? 'PAINTED STYLE ONLY, not its character'
            : r.startsWith('poses/') && r === 'poses/' + strip + '-f0.png'
              ? 'ACCEPTED f0: SAME head/outfit/body dimensions/colour/load ONLY, NEVER its legs or arm pose'
              : 'BACK CLOTHING ONLY, ignore its wrong legs'),
  )
  .join('; ');
const prompt =
  'Use case: sketch-to-render. EDIT image1 flat grey mannequin into ONE painted person, preserving its exact placement and limb pose. Canvas1024x1536 PORTRAIT, RGBA transparent. ' +
  referenceRoles +
  '.\nPERSON: ' +
  person +
  '. LOAD: ' +
  load +
  '.\nCAMERA: orthographic2:1 isometric30degrees DOWN, realistic adult7to7.5heads, ' +
  direction +
  '. Right leg is NEAR/DARK GREY leg; left is FAR/light grey leg. ' +
  phase +
  '. All limbs follow IMAGE1, never identity/style/f0 references. Copy the guide leg joints, planted sole, lifted boot and torso position exactly.\nGEOMETRY: hipsx512; HAT TOPy192, SOLE LINEy1344, bodyheight1152. Exact guide opaque box x' +
  b.x +
  '..' +
  (b.x + b.width - 1) +
  ',y' +
  b.y +
  '..' +
  (b.y + b.height - 1) +
  ',width' +
  b.width +
  ',height' +
  b.height +
  '. Keep painted silhouette within5% of this box and centre within5% of width. Preserve transparent margins, do not expand to fillcanvas, do not recenter the load instead of body. Head/outfit size stays identical to accepted f0, bob <=23px. Arms may grip load as guide shows, legs always perform specified phase.\nSTYLE: broad smooth PAINTED colour clusters,3or4 shades/material, ONE UPPER-LEFT light. Selective dark lower/side occluded rims ONLY. Upper-left cap, shoulder, arm and leg edges merge with the painted material without any dark drawn perimeter; NEVER a full dark/black outline. Subdued forest#294638,moss#78804C,oat#E4D5B5,limestone#BCA98B,slate#626B6C,teal#477B82,copper#A36B42. Warm natural skin/hair. No highlight at/abovecursorwhite#ECE4D0 and no orange/yellow as strong as selectionamber#E8AA48.\nAlpha0 outside silhouette, opaquefigure, clean smooth contours. NO ground,floor,cast/ground shadow,haze,glow,labels,text,numbers,borders,extraobjects,extraperson. Exactly ONE figure. Return exactly1024x1536.' +
  (correction.length ? '\nCORRECTION: ' + correction.join(' ') : '');
const entry = { id, strip, frame, prompt, references: refs };
saveJson(callFile, entry);
console.log(JSON.stringify(entry));
