import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [indexText,source]=process.argv.slice(2),index=Number(indexText),root='assets/source/current-grid-regeneration-v2';
const plan=JSON.parse(readFileSync(`${root}/generation-plan.json`));
const task=plan.tasks[index];if(!task)throw Error('Unknown task index');
if(task.status==='generated-candidate')throw Error('Do not overwrite completed task');
mkdirSync(`${root}/generated`,{recursive:true});
const data=readFileSync(source),p=PNG.sync.read(data);let clear=0,solid=0,partial=0,edgeOpaque=0;
for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
 const a=p.data[(y*p.width+x)*4+3];if(a===0)clear++;else if(a>=240)solid++;else partial++;
 if((x===0||y===0||x===p.width-1||y===p.height-1)&&a>64)edgeOpaque++;
}
copyFileSync(source,`${root}/${task.output}`);
Object.assign(task,{status:'generated-candidate',generatedAt:new Date().toISOString(),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),validation:{width:p.width,height:p.height,clearPixels:clear,solidPixels:solid,partialPixels:partial,edgeOpaque,alphaPresent:clear>0&&solid>0},projectionVerified:false});
writeFileSync(`${root}/generation-plan.json`,JSON.stringify(plan,null,2));
writeFileSync(`${root}/handoff/progress.json`,JSON.stringify({updatedAt:new Date().toISOString(),completed:plan.tasks.filter(t=>t.status==='generated-candidate').map(t=>({key:t.key,rotation:t.rotation,output:t.output})),pending:plan.tasks.filter(t=>t.status!=='generated-candidate').map(t=>({key:t.key,rotation:t.rotation,output:t.output})),projectionVerified:false},null,2));
console.log(JSON.stringify({key:task.key,rotation:task.rotation,alphaPresent:task.validation.alphaPresent,edgeOpaque,completed:plan.tasks.filter(t=>t.status==='generated-candidate').length,total:plan.tasks.length}));
// Refresh the repo-local gallery after each complete four-facing set.
if(task.rotation===3)execFileSync(process.execPath,['scratchpad/build-current-grid-preview.mjs'],{stdio:'pipe',windowsHide:true});
