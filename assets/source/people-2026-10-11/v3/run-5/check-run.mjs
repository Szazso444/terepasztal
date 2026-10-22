import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {evaluate} from '../measure-v3.mjs';import {read,PNG} from '../pose-png.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));const pose=Number(process.argv[2]),attempt=Number(process.argv[3]);
const file=`raw/lumberjack-back-walk-f${pose-1}-attempt-${attempt}.png`;const record=JSON.parse(fs.readFileSync(path.join(root,'prompts.json')));const prior={};for(const [p,a] of Object.entries(record.selection))prior[p]=path.join(root,a.file);
const result=evaluate(path.join(root,file),pose,prior);const png=read(path.join(root,file));let haze=0;for(let i=3;i<png.data.length;i+=4)if(png.data[i]>=1&&png.data[i]<=15)haze++;
result.tests[6].haze=haze;result.tests[6].status='report only';delete result.tests[6].pass;
const visualFile=path.join(root,`checks/p${pose}-attempt-${attempt}-visual.json`);if(fs.existsSync(visualFile)){result.tests[5].visualReview=JSON.parse(fs.readFileSync(visualFile));result.tests[5].pass=result.tests[5].visualReview.pass;}
result.failedTests=Object.entries(result.tests).filter(([,v])=>v.pass===false).map(([k])=>Number(k));result.unresolvedTests=result.tests[5].pass===null?[5]:[];result.pass=!result.failedTests.length&&!result.unresolvedTests.length;
fs.writeFileSync(path.join(root,`checks/p${pose}-attempt-${attempt}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
const guide=read(path.resolve(root,`../../../people-v3-guides/back-shoulder-p${pose}.png`));const sheet=new PNG({width:1536,height:900});for(let j=0;j<900;j++)for(let i=0;i<768;i++)for(const [n,p]of [[0,guide],[1,png]]){const x=i+128,y=j+250;if(x<p.width&&y<p.height)p.data.copy(sheet.data,(j*1536+n*768+i)*4,(y*p.width+x)*4,(y*p.width+x+1)*4);}fs.writeFileSync(path.join(root,`checks/p${pose}-attempt-${attempt}-shoulders.png`),PNG.sync.write(sheet));
