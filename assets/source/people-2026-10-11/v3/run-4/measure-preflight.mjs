import fs from 'node:fs';
import {guideSet} from '../measure-v3.mjs';
import {read} from '../pose-png.mjs';
const run=new URL('./',import.meta.url), guideRoot=new URL('../../../people-v3-guides/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',guideRoot)));
const entry=manifest.guides.find(g=>g.file==='back-shoulder-p1.png');
const result={backSwing:guideSet('swing'),backShoulder:guideSet('shoulder')};
const p=read(new URL(entry.file,guideRoot).pathname.replace(/^\//,''));
let lowestWide=-1;for(let y=0;y<p.height;y++){let n=0;for(let x=0;x<p.width;x++)if(p.data[(y*p.width+x)*4+3]>128)n++;if(n>=36)lowestWide=y;}
const check={manifestSoleRowPresent:Object.hasOwn(entry,'soleRow'),manifestSoleRow:entry.soleRow??null,expectedManifestSoleRow:1440,computedSoleRowAtLeast36OpaquePixels:lowestWide,lowestOpaqueRow:result.backShoulder.measurements[0].soleRow,expectedLowestOpaqueRange:[1440,1456],manifestEntry:entry,swingSlides:result.backSwing.slides,swingOverlaps:result.backSwing.overlaps};
fs.writeFileSync(new URL('checks/guide-measurements.json',run),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(new URL('checks/preflight.json',run),JSON.stringify(check,null,2)+'\n');console.log(JSON.stringify(check,null,2));
