import { launch } from '../../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/models/handover-review/game-before';
mkdirSync(out,{recursive:true});
const browser=await launch();
const errors=[];
const records=[];
try {
  for (const id of ['c50','black_five','drg01','daylight']) {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',e=>errors.push(`${id}: ${e.message}`));
    await page.goto(`http://127.0.0.1:5182/scratchpad/models/?rows=${id}&zoom=3`);
    await page.waitForFunction(()=>typeof window.qa?.shot==='function',null,{timeout:240000});
    const result=await page.evaluate(()=>qa.shot(3));
    await page.evaluate(()=>qa.settle());
    await page.screenshot({path:`${out}/${id}-straight.png`,clip:{x:360,y:240,width:720,height:480}});
    await page.evaluate(id=>{const {L}=qa.start(id,[],0); return qa.start(id,[],17.5+L/2);},id);
    await page.mouse.move(8,990);
    await page.evaluate(()=>qa.roll(0,3));
    await page.evaluate(()=>qa.settle());
    const frames=[];
    for(let n=0;n<32;n++) {
      frames.push(await page.evaluate(()=>qa.roll(8,3)));
      await page.screenshot({path:`${out}/${id}-${String(n).padStart(3,'0')}.png`,clip:{x:360,y:240,width:720,height:480}});
    }
    records.push({id,...result,frames});
    await page.close();
    console.log(`Captured ${id}: straight + 32 frames`);
  }
} finally {await browser.close();}
writeFileSync(`${out}/report.json`,JSON.stringify({errors,records},null,2));
if(errors.length) throw new Error(JSON.stringify(errors));
