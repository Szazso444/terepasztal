import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {PNG} from 'pngjs';
import {trimSource,resample} from '../tools/illustrated-sprites.mjs';
const root='assets/source/current-grid-regeneration-v2',out='scratchpad/current-grid-assets';mkdirSync(`${out}/sprites`,{recursive:true});
const plan=JSON.parse(readFileSync(`${root}/generation-plan.json`)),pack=JSON.parse(readFileSync(`${root}/handoff/manifest.json`));
const prior=existsSync(`${out}/manifest.json`)?JSON.parse(readFileSync(`${out}/manifest.json`)).frames:{};
const frames={};
for(const task of plan.tasks){
 if(task.status!=='generated-candidate'||!existsSync(`${root}/${task.output}`))continue;
 const existingKey=`${task.key}-${task.rotation}`;
 if(prior[existingKey]?.sourceHash===task.sha256&&existsSync(`${out}/sprites/${existingKey}.png`)){frames[existingKey]=prior[existingKey];continue;}
 const raw=PNG.sync.read(readFileSync(`${root}/${task.output}`)),clean=trimSource(raw);
 // Conservative uniform fit for a review lot. Not an assertion of human-scale calibration.
 const scale=Math.min((task.tiles===1?88:142)/clean.width,190/clean.height);
 const w=Math.round(clean.width*scale*4),h=Math.round(clean.height*scale*4),key=`${task.key}-${task.rotation}`;
 writeFileSync(`${out}/sprites/${key}.png`,PNG.sync.write(resample(clean,w,h)));
 frames[key]={w:w/4,h:h/4,ax:w/8,ay:h/4-(task.tiles+1)*13*.80,tiles:task.tiles,source:`/${root}/${task.output}`,sourceHash:task.sha256,projectionVerified:false,scaleVerified:false,alphaPresent:task.validation?.alphaPresent};
}
writeFileSync(`${out}/manifest.json`,JSON.stringify({projection:plan.projection,assets:pack.assets,frames,completed:Object.keys(frames).length,total:plan.tasks.length},null,2));
console.log({previewFrames:Object.keys(frames).length,total:plan.tasks.length});
