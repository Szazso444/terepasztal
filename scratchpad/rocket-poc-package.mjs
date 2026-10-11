import fs from 'node:fs';
const root='G:/DEV/Terepasztal/poc/rocket-original-v1';
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rocket · original-art reconstruction proof</title>
<style>body{margin:0;background:#19201f;color:#eee9db;font:16px/1.5 system-ui}main{max-width:1180px;margin:auto;padding:32px}h1{font-size:30px}h2{font-size:19px}.intro{max-width:850px;color:#c4cabc}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.card{background:#252e2c;padding:20px;border-radius:10px}img{width:100%;height:400px;object-fit:contain;background:#e9e8e3}canvas{width:100%;background:#303b34;border-radius:6px}.small{font-size:13px;color:#bdc8bc}button,input{margin:8px;padding:5px}table{border-collapse:collapse;width:100%}td,th{padding:9px;text-align:left;border-bottom:1px solid #49524c}code{color:#e5c989}.warning{border-left:4px solid #d4ac5e;padding-left:14px}@media(max-width:720px){.grid{grid-template-columns:1fr}}</style>
<main><p class="small">TEREPASZTAL / ENGINEERING PROOF / ORIGINAL ART PRESERVED</p><h1>One source. A measured camera. An honest fit check.</h1>
<p class="intro">The approved original is reconstructed by the user's local Pixal3D workflow. The render camera is then fixed numerically. This experiment tests the reconstruction; it is not an accepted replacement for the original artwork.</p>
<div class="grid"><section class="card"><h2>Approved source · unchanged</h2><img src="original.png"><p class="small">No new tender, repaint, AI redraw or bitmap distortion. Its exact source camera is unknown.</p></section><section class="card"><h2>Reconstruction · controlled source view</h2><img src="renders/source-camera-35-25.png"><p class="small">Orthographic camera: 35° around from side, elevation 25°. This is a render of the inferred model, not evidence that the original image used that camera.</p></section></div>
<section class="card" style="margin-top:20px"><h2>Game camera · rail and human ruler</h2><label>Facing <input id="angle" type="range" min="0" max="47" step="1" value="0"><output id="heading"></output></label><label><input type="checkbox" id="model" checked>Show reconstruction</label><label><input type="checkbox" id="marks" checked>Show footprint</label><canvas id="scene" width="1120" height="560"></canvas><p class="small">64×32 logical tiles, 0.32-tile rail-centre spacing, fixed 4× display enlargement. The yellow ruler is 11 logical pixels tall, representative of the existing 10–12 px people. The locomotive is uniformly normalized to one tile in length. Its width and height are not stretched to force a pass.</p><p class="warning">Exact camera: checked mathematically. Wheel contact, wheel gauge, reconstructed proportions and style: inspect and measure before acceptance. A rail beneath an image does not prove the wheels fit.</p></section>
<div class="grid" style="margin-top:20px"><section class="card"><h2>Side view · wheel centres and level</h2><img src="renders/side.png"></section><section class="card"><h2>Front view · wheel gauge</h2><img src="renders/front.png"></section><section class="card"><h2>Top view · straightness and proportions</h2><img src="renders/top.png"></section><section class="card"><h2>Repository contract</h2><table><tr><td>Projection</td><td>45° azimuth / 30° elevation</td></tr><tr><td>Rail centres</td><td>±0.16 tiles</td></tr><tr><td>Rocket body</td><td>1 tile, rigid; fixed wheels</td></tr><tr><td>Coupler gap</td><td>0.2 tiles outside body length</td></tr><tr><td>Facing system</td><td>48 headings / 25 drawn</td></tr><tr><td>Atlas resolution</td><td>4 texels per logical pixel</td></tr><tr><td>Metres per tile</td><td>Not specified by game</td></tr></table><p><a href="README.md" style="color:#e5c989">Research and acceptance criteria</a></p><p id="status" class="small"></p></section></div></main>
<script>const c=document.getElementById('scene'),ctx=c.getContext('2d'),ims={};const drawn=Array.from({length:48},(_,f)=>f).filter(f=>f<=((12-f+48)%48));for(const f of drawn){const im=new Image;im.onload=draw;im.src='renders/game-f'+f+'.png';ims[f]=im}const angle=document.getElementById('angle');for(const id of ['angle','model','marks'])document.getElementById(id).oninput=draw;
function draw(){const f=+angle.value,a=f*Math.PI/24,mirror=((12-f)%48+48)%48,fi=ims[f]?f:mirror;document.getElementById('heading').value=(f*7.5)+'°';ctx.clearRect(0,0,c.width,c.height);ctx.save();ctx.translate(530,315);ctx.scale(4,4);const p=(x,y,z=0)=>[(x-y)*32,(x+y)*16-z],v=(l,w)=>p(Math.cos(a)*l-Math.sin(a)*w,Math.sin(a)*l+Math.cos(a)*w);function line(points,color,width=1){ctx.beginPath();points.forEach((q,i)=>i?ctx.lineTo(...q):ctx.moveTo(...q));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke()}for(let t=-1.6;t<1.65;t+=.14)line([v(t,-.235),v(t,.235)],'#816b50',2.5);for(const w of [-.16,.16]){line([v(-1.65,w),v(1.65,w)],'#161b19',2);line([v(-1.65,w),v(1.65,w)],'#b8c0b8',.9)}if(document.getElementById('marks').checked){line([v(-.5,-.5),v(.5,-.5),v(.5,.5),v(-.5,.5),v(-.5,-.5)],'#c5a36b',.5);line([[-3,0],[3,0]],'#f0776a',.7);line([[0,-3],[0,3]],'#f0776a',.7)}const im=ims[fi];if(document.getElementById('model').checked&&im?.complete&&im.naturalWidth){ctx.save();if(fi!==f)ctx.scale(-1,1);ctx.drawImage(im,-48,-69.12,96,96);ctx.restore()}const [hx,hy]=p(-.55,.65);line([[hx,hy],[hx,hy-11]],'#ead27c',1);line([[hx-2,hy],[hx+2,hy]],'#ead27c',.7);line([[hx-2,hy-11],[hx+2,hy-11]],'#ead27c',.7);ctx.font='3px system-ui';ctx.fillStyle='#ead27c';ctx.fillText('11 px person ruler',hx+3,hy-4);ctx.restore()}draw();fetch('render-metadata.json').then(r=>r.json()).then(m=>document.getElementById('status').textContent='Alignment score '+m.alignmentScore.toFixed(3)+' (threshold 0.70). Reconstructed dimensions: '+m.dimensionsTiles.map(n=>n.toFixed(3)).join(' × ')+' tiles.');</script></html>`;
const readme=`# Original Rocket reconstruction proof of concept

## Scope and status
Use original.png as the art authority. The three newly generated Rocket attempts were rejected by the user; none is accepted or installed. This proof reconstructs the original unchanged through the user's Pixal3D workflow, then renders an exact camera. It does not claim to recover historically correct or otherwise unseen geometry. Do not mass-generate until this reconstruction passes visual review and wheel measurements.

## Findings from the repository and live pipeline

- src/engine/iso.ts: logical tile 64x32, x=(tx-ty)*32, y=(tx+ty)*16. Final camera is orthographic 45° azimuth / 30° elevation. The 35°/25° source view from the brief is a different camera, not a final sprite camera.
- src/art/track.ts and src/art/trackIllustrated.ts: rail centres at ±0.16 tiles; gauge is 0.32 tile. Track normal offsets, not sprite bounding boxes, define wheel contact.
- src/sim/body.ts: small/medium/large lengths 1/2/3 tiles; coupling gap 0.2 tile is separate. Rocket is small and rigid in src/data/locomotives.json. A newly invented tender conflicts with that runtime body plan. Keep it out of this repository-compatible proof.
- src/art/people.ts: figures occupy roughly 10–12 logical pixels. There is NO shared metres-per-tile contract in the game. 1.8 m people and 2.1 m doors are design assumptions, not existing engine constants. Existing art even uses pixel z heights and a 1.3 lateral exaggeration in rolling.Frame.along; do not treat all old art as a true-scale engineering reference.
- pipeline.toml currently sets tile_m=8 and tile_px=128. Its implied rail-centre spacing at the game's gauge is 2.56 m. A 1.8 m figure would project to about 8.82 logical pixels at 64px tile width. Global human/vehicle/building metre calibration needs an explicit design contract; a PNG's pixel dimensions cannot provide it.
- The pipeline's vehicle size compression subtracts 0.4 m inside a tile slot, whereas the simulation uses a 0.2-tile gap outside the body length. Do not apply both silently.
- The pipeline produces 8 vehicle headings. Runtime uses 48 at 7.5° intervals, with 25 drawn facings and mirrored partners. This proof exports all 25 drawn facings at a fixed 4x resolution. It does not install an atlas.
- Blender Y maps to NEGATIVE game ty. Render heading f at Blender yaw -f*7.5°. The first axis projects down-right; the second game axis projects down-left. An unadapted positive-yaw sequence runs in the wrong order.
- postprocess.py writes a frame array with anchor_px. AtlasRegistry expects globally named frame objects with ax/ay and a resolution field. An adapter is required before integration; renaming files alone is insufficient.
- blender_stage.py joins mesh pieces. That loses independent engine/tender/bogie semantics. Small Rocket has baked wheels; larger stock must be segmented before animation. A reconstructed complete locomotive cannot simply occupy every body-part frame.
- Live /object_info/Pixal3DConditioning documents camera_angle_x as horizontal FIELD OF VIEW, not azimuth or elevation. The recovered workflow estimates that via MoGe. This pipeline does not enforce the brief's source pose by itself. A requested camera in an AI prompt is not a camera measurement.

## This proof

Original source copied byte-for-byte from C:/Users/Zso/terepasztal/assets/source/base-v1/loco-rocket.png. The successful local workflow was recovered from ComfyUI history 1cb7d367-11f9-441f-8758-c4329a49ad07, with Pixal3D retained, texture 2048 instead of 4096, and output decimation 100k faces instead of 700k. UI-only output branches are excluded. Exact submitted workflow and history are saved locally.

The reconstruction uses the pipeline's Manhattan alignment, then a UNIFORM scale to one tile of total X extent. No x/y-only warping is used. This is a game-length trial, not physical scale certification. Texture emission preserves baked illustrated colours without double-lighting them. Source-view render: orthographic 35° around from side / 25° elevation. Game render: 45° / 30°, 4 texels per logical pixel, rail-plane anchor fixed across all facings. index.html compares the original, the reconstructed view, a rail overlay, and the existing human-height ruler.

## Acceptance gate before expanding

1. Original design and restrained illustrated shading survive reconstruction. No invented crown, extra tender, inflated wheel sizes or softened toy-like silhouette beyond the original.
2. Inspect side/front/top: upright, nose toward +X, chassis level. Alignment score >=0.70 is only a diagnostic, not a geometric guarantee.
3. Mark actual left/right WHEEL TREAD contact points, not maximum body width. At rest they must meet rails at ±0.16 tile and z=0. Measure axle spacing too. A single uniform scale must satisfy the selected size policy; report conflict rather than stretch.
4. Compare reconstructed chimney/body and doors in later building tests to the SAME human-height ruler. Do not independently fill each thumbnail to the same size.
5. Validate several headings and permitted curves against poseSegment. A straight rail overlay alone does not validate curve motion. The current proof is not curve-certified or integrated.
6. For further source images, use approved artwork as identity/style references and the same calibrated source-view guide. Do not claim exact camera from prompting alone; verify perspective against measured features or re-render a reviewed 3D model.

## Files

- original.png — untouched approved source
- raw.glb — inferred mesh from local ComfyUI
- workflow-api.json / history.json — exact reconstruction provenance
- rocket-poc.blend — isolated inspection scene
- renders/ — orthographic diagnostics, fixed source view, 25 game facings
- render-metadata.json — scale, alignment, cameras, anchors
- index.html — local interactive visual comparison

Production assets.csv and the game repository are not changed by this proof.
`;
fs.writeFileSync(root+'/index.html',html);
fs.writeFileSync(root+'/README.md',readme);
const resume='G:/DEV/Terepasztal/assets/source/base-v1/RESUME.md';
const marker='## Original-art Rocket POC';
const addition='\n'+marker+'\n\nThe user rejected all new Rocket redraws, requested repository research, uniform camera/human scale, rail fit and one proof of concept. See ../../../poc/rocket-original-v1/README.md (G:/DEV/Terepasztal/poc/rocket-original-v1). The POC reconstructs the original unchanged. Generation of the 63-image batch is paused for this superseding POC request. Source camera 35/25 and game camera 45/30 are distinct. Do not assume physical scale or rail fit from image framing.\n';
if(!fs.readFileSync(resume,'utf8').includes(marker))fs.appendFileSync(resume,addition);
console.log('POC review page and research saved.');
