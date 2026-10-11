import { launch } from '../../runtime.mjs';
import { writeFileSync } from 'node:fs';
const out='scratchpad/models/handover-review/c50-handbuilt-game';
const b=await launch();const errors=[];
try {
 const p=await b.newPage({viewport:{width:1600,height:1000}});
 p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:5182/scratchpad/models/?rows=c50,black_five,drg01,daylight&ids=C50,Black%20Five,DRG01,Daylight&zoom=3');
 await p.waitForFunction(()=>typeof window.qa?.shot==='function',null,{timeout:240000});
 const lineup=await p.evaluate(async()=>{const r=qa.shot(3);await qa.settle();return r;});
 await p.screenshot({path:`${out}/fleet.png`});
 await p.evaluate(async()=>{qa.start('c50',[],10);qa.roll(0,7);await qa.settle();});
 await p.screenshot({path:`${out}/straight.png`,clip:{x:440,y:210,width:720,height:480}});
 writeFileSync(`${out}/fleet-report.json`,JSON.stringify({lineup,errors},null,2));
 if(errors.length)throw new Error(JSON.stringify(errors));
}finally{await b.close();}
