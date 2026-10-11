import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root='assets/source/current-grid-regeneration-v2', pack=`${root}/handoff`;
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
for(const dir of ['originals','existing-facings','geometry','historical-prompts','prompts'])mkdirSync(`${pack}/${dir}`,{recursive:true});
const plan=json('assets/source/building-poc-v1/remaining-building-plan.json');
const entries=[
 {key:'station',id:'Passenger station',source:'station.png',proposedTiles:2},
 {key:'house',id:'Stone cottage',source:'house-cottage.png',proposedTiles:1},
 ...plan.assets,
];
// Latest user direction supersedes the earlier category-wide two-tile split.
const longBuildings=new Set(['station','stations-warehouse','stations-depot','works-power_plant','works-full-colliery','works-full-ironworks','works-full-diesel_refinery','works-full-wire_mill']);
for(const a of entries){
 a.proposedTiles=longBuildings.has(a.key)?2:1;
 a.footprintReason=longBuildings.has(a.key)?'Long station/warehouse/depot or multi-part factory: retain length and human scale.':'Original compact or predominantly vertical design: prefer one tile without shrinking doors or deforming the structure.';
}
const projection={name:'current-game-2:1-dimetric',azimuthDegrees:45,elevationDegrees:30,screenGroundSlopes:[.5,-.5],screenGroundAnglesDegrees:[26.565051177,-26.565051177],tilePixels:[64,32],verticals:'screen-vertical',parallelProjection:true};
const directions=[
 'Facing 0 (0 degrees): long FRONT facade on screen LEFT, right end wall on RIGHT; local long X axis slopes down-right (+0.5). Front entrance, loading face or canopy is visible.',
 'Facing 1 (90 degrees): rotate the actual structure 90 degrees in world space. Short end wall on screen LEFT, long REAR facade on RIGHT; long axis up-right (-0.5). Front equipment stays on the hidden opposite side, not duplicated on the rear.',
 'Facing 2 (180 degrees): long REAR facade on screen LEFT, opposite end wall on RIGHT; long axis down-right (+0.5). Render the genuine rear, retaining fixed chimney and machinery locations in world space.',
 'Facing 3 (270 degrees): opposite short end wall on screen LEFT, long FRONT facade on RIGHT; long axis up-right (-0.5). Entrance/canopy/loading equipment appears on the front right facade.',
];
const common=`Create ONE highly detailed illustrated railway-game building sprite. The camera is fixed for the entire asset library: ORTHOGRAPHIC 2:1 DIMETRIC, azimuth 45 degrees, elevation 30 degrees ABOVE HORIZONTAL. The current game tiles are 64x32. World-X horizontal lines have screen slope +0.5; world-Y horizontal lines have slope -0.5, with screen Y positive downward. Screen ground angles are +/-26.565051 degrees. Vertical edges stay exactly vertical and parallel lines stay parallel. This is NOT true isometric at 35.264 degrees, NOT lower dimetric, and NOT perspective. The GEOMETRY reference supplies the camera axes and occupied footprint. The ART references supply identity, proportions, materials, palette, craftsmanship and machinery. If their camera disagrees, correct it to the geometry reference. Every ground-level baseline, wall course, horizontal lintel, chimney cap, horizontal eave and horizontal roof ridge must obey the same world directions. Sloping gable/roof-pitch edges are genuinely sloped in 3D and must not be forced onto a ground axis. Reconstruct rigid geometry in the target camera, never bend a roof, skew/shear pixels, elongate heights, horizontally stretch a finished bitmap or rotate a flat PNG to fake the view. Preserve the subject's recognizable architectural design and high-detail painted-miniature quality. Keep proportions and common human scale: doors approximately 2.1m, people approximately 1.8m, slight consistent game readability exaggeration allowed. Do not shrink doors to squeeze an oversized building into a lot; simplify peripheral clutter if necessary. One whole isolated building centered with at least 8% margin. Soft even top-left lighting, no cast ground shadows. PNG with real alpha; alpha exactly zero outside the crisp object. No glow, colored haze, halo, vignette, gradient, floor, scenery, tile diamond, guides, grid, checkerboard, text, labels, watermark or border. Do not copy the calibration grid/axes into the output. The yard is a separate building-owned underlay clipped to the same occupied cells; do not bake a large ground slab or yard into this sprite. Output only the one requested facing, not a contact sheet.`;
const tasks=[],assets=[];
for(const a of entries){
 const original=`originals/${a.key}.png`;copyFileSync(`assets/source/base-v1/${a.source}`,`${pack}/${original}`);
 const existing=[];
 for(let r=0;r<4;r++){
  const old=['house','station'].includes(a.key)?`assets/source/building-poc-v1/${a.key}-${r}.png`:`assets/source/building-poc-v1/remaining/${a.key}-${r}.png`;
  if(existsSync(old)){const name=`existing-facings/${a.key}-${r}.png`;copyFileSync(old,`${pack}/${name}`);existing.push(name);}
 }
 const oldPrompts=['house','station'].includes(a.key)?'assets/source/building-poc-v1/prompts.json':`assets/source/building-poc-v1/remaining/${a.key}.prompts.json`;
 if(existsSync(oldPrompts))copyFileSync(oldPrompts,`${pack}/historical-prompts/${a.key}.json`);
 assets.push({key:a.key,name:a.id,tiles:a.proposedTiles,footprintReason:a.footprintReason,original,existingFacings:existing,geometryRole:['house','station'].includes(a.key)?'Exact camera/footprint guide with representative building proportions; detailed source art remains identity authority.':'Axis and bounding-footprint calibration only; wireframe box is not a new architectural design.'});
 for(let r=0;r<4;r++){
  const geometry=['house','station'].includes(a.key)?`geometry/${a.key}-${r}.png`:`geometry/footprint-${a.proposedTiles}-${r}.png`;
  const identity=a.key==='station'?' Preserve THREE chimneys, cream sandstone, slate roof, terracotta pots, green joinery, front cream canopy on green supports, benches and lanterns. Rear views must not duplicate the front canopy.':a.key==='house'?' Preserve the one-chimney cream-stone cottage with slate roof and green joinery.':'';
  const footprint=a.proposedTiles===1?'1x1 tile':(r%2===0?'2x1 tiles':'1x2 tiles');
  const guideRole=['house','station'].includes(a.key)?'Match the building geometry guide camera and rigid roof silhouette; enrich it with the art reference details.':'The wireframe box is ONLY a camera, parallel-edge, and footprint ruler. DO NOT replace the source building with a plain box or imitate its wireframe appearance. Preserve its distinctive roof shape, towers, machinery, textures and architectural identity.';
  const prompt=`${common}\n\nSUBJECT: ${a.id} (${a.key}). Occupied footprint: ${footprint}, including all structure and overhangs. ${directions[r]} ${guideRole}${identity}\nReference order: image 1 = geometry/camera, image 2 = original art identity. If image 3 is present, it is the previous same-facing artwork, for details and facing continuity only; correct its camera. Generate this facing as the same physical structure as the other rotations, not a mirrored duplicate. Keep world-fixed features attached to the same wall. Ground and vertical scale must remain consistent across the set.`;
  const refs=[geometry,original]; const prior=`existing-facings/${a.key}-${r}.png`;if(existing.includes(prior))refs.push(prior);
  const task={key:a.key,rotation:r,tiles:a.proposedTiles,footprint,referencePaths:refs,prompt,output:`generated/${a.key}-${r}.png`,status:'pending',projectionVerified:false};
  tasks.push(task);writeFileSync(`${pack}/prompts/${a.key}-${r}.txt`,prompt+'\n');
 }
}
writeFileSync(`${pack}/manifest.json`,JSON.stringify({projection,assets,tasks},null,2));
writeFileSync(`${pack}/MASTER-PROMPT.txt`,common+'\n');
writeFileSync(`${root}/generation-plan.json`,JSON.stringify({projection,tasks},null,2));
copyFileSync('src/engine/iso.ts',`${pack}/geometry/game-iso.ts`);
const inventory=[];
for(const a of assets)for(const file of [a.original,...a.existingFacings]){
 const data=readFileSync(`${pack}/${file}`);inventory.push({path:file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
writeFileSync(`${pack}/source-inventory.json`,JSON.stringify(inventory,null,2));
console.log({buildings:assets.length,prompts:tasks.length,originals:assets.length,existingFacings:assets.reduce((n,a)=>n+a.existingFacings.length,0)});
