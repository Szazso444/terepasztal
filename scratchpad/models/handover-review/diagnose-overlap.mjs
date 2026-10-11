import { launch } from '../../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out='scratchpad/models/handover-review/overlap';
mkdirSync(out,{recursive:true});
const browser=await launch();
const errors=[],records=[];
try {
  for(const id of ['c50','black_five','drg01','daylight']) {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',e=>errors.push(`${id}: ${e.message}`));
    await page.goto('http://127.0.0.1:5182/scratchpad/models/?rows=');
    await page.waitForFunction(()=>typeof window.qa?.start==='function',null,{timeout:240000});
    await page.evaluate(async id=>{
      const {SwingSprite}=await import('/src/render/swingSprite.ts');
      const original=SwingSprite.prototype.show;
      window.flat=false;
      SwingSprite.prototype.show=function(frame,flip,box,drawn,angle) {
        return original.call(this,frame,flip,window.flat?null:box,drawn,angle);
      };
      const {L}=qa.start(id,[],0);
      qa.start(id,[],17.5+L/2);
      qa.roll(0,5);
      await qa.settle();
    },id);
    await page.mouse.move(5,995);
    const frames=[];
    for(let i=0;i<16;i++) {
      frames.push(await page.evaluate(()=>{
        window.flat=false;
        const r=qa.roll(12,5);
        return {...r,angle:qa.g.fleet.trains[0].vehiclePoses[0].segments[0].angle};
      }));
      const shot={clip:{x:270,y:190,width:900,height:620}};
      await page.screenshot({...shot,path:`${out}/${id}-before-${String(i).padStart(2,'0')}.png`});
      await page.evaluate(()=>{window.flat=true;qa.roll(0,5);});
      await page.screenshot({...shot,path:`${out}/${id}-flat-${String(i).padStart(2,'0')}.png`});
    }
    records.push({id,frames});
    await page.close();
    console.log(`Compared ${id}: same pose, wheel phase, camera and atlas; only sprite warp disabled`);
  }
} finally {await browser.close();}
writeFileSync(`${out}/report.json`,JSON.stringify({errors,records},null,2));
if(errors.length) throw new Error(JSON.stringify(errors));
