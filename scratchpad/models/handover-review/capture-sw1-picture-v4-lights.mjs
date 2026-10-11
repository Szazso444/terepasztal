import {launch} from '../../runtime.mjs';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
const browser=await launch();const audit=[];
try {for(const id of process.argv.slice(2)) {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`http://127.0.0.1:5182/scratchpad/models/?rows=${id}&zoom=6&night=1`);
 await page.waitForFunction(()=>typeof window.qa?.shot==='function',null,{timeout:240000});
 await page.evaluate(async()=>{qa.shot(6);await qa.settle();});
 const lamps=await page.evaluate(id=>qa.defOf(id).lamps,id);
 if(!lamps?.length)throw Error(`${id}: missing model lamp anchors`);
 audit.push({id,lamps});
 await page.screenshot({path:`scratchpad/models/handover-review/sw1-picture-v4/after/${id}-lights.png`,clip:{x:220,y:120,width:1000,height:720}});
 await page.close();console.log('Lights',id);
}}finally{await browser.close();}
const path='scratchpad/models/handover-review/sw1-picture-v4/after/light-anchors.json';
const previous=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):[];
writeFileSync(path,JSON.stringify([...previous.filter(p=>!audit.some(a=>a.id===p.id)),...audit],null,2));
