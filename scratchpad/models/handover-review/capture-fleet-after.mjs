import {launch} from '../../runtime.mjs';
import {mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
const out='scratchpad/models/handover-review/fleet-painted/after';mkdirSync(out,{recursive:true});
const ids=process.argv.slice(2);if(!ids.length)ids.push(...JSON.parse(readFileSync('src/data/locomotives.json','utf8')).filter(x=>!x.retired&&x.id!=='c50').map(x=>x.id));
const browser=await launch();const errors=[],records=[];
try{
for(const id of ids){
 const reviewMarker=`${out}/${id}-reviewed.txt`;if(existsSync(reviewMarker))unlinkSync(reviewMarker);
 const bundleKey=JSON.parse(readFileSync('../terepasztal-local/assets/source/fleet-painted-2026-10-07/installed.json','utf8'))[id].key;
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(`${id}: ${e.message}`));
 await page.goto(`http://127.0.0.1:5182/scratchpad/models/?rows=${id}&zoom=3`);
 await page.waitForFunction(()=>typeof window.qa?.shot==='function',null,{timeout:240000});
 const result=await page.evaluate(()=>qa.shot(3));await page.evaluate(()=>qa.settle());
 const clip={x:360,y:240,width:720,height:480};await page.screenshot({path:`${out}/${id}-straight.png`,clip});
 const completeness=await page.evaluate(id=>{const d=qa.defOf(id),missing=[];for(const [part,w] of Object.entries(d.wheels??{}))for(let f=0;f<96;f++)for(let p=0;p<w.phases;p++)if(!qa.g.atlas.has(`rolling/loco_${id}_${part}_w${p}_f${f}`))missing.push([part,p,f]);return {facings:d.spriteFacings,missing};},id);
 if(completeness.facings!==96||completeness.missing.length)throw Error(`${id}: incomplete frames`);
 await page.evaluate(id=>{const {L}=qa.start(id,[],0);return qa.start(id,[],17.5+L/2);},id);await page.mouse.move(8,990);await page.evaluate(()=>qa.roll(0,3));await page.evaluate(()=>qa.settle());
 const frames=[];
 for(let n=0;n<32;n++){frames.push(await page.evaluate(()=>qa.roll(8,3)));await page.screenshot({path:`${out}/${id}-${String(n).padStart(3,'0')}.png`,clip});}
 await page.evaluate(()=>qa.roll(0,3));const stopped=await page.screenshot({clip});await page.evaluate(()=>qa.roll(0,3));const frozen=stopped.equals(await page.screenshot({clip}));if(!frozen)errors.push(`${id}: stationary frame changed`);
 await page.evaluate(()=>{const t=qa.g.fleet.trains[0];t.reversed=true;t.updatePoses();qa.roll(0,3);});await page.screenshot({path:`${out}/${id}-reversed.png`,clip});
 await page.evaluate(()=>{qa.g.clock.time=1;qa.g.clock.time=(23/24)/qa.g.clock.dayFraction;qa.roll(0,3,0,1);qa.roll(0,3,0,1);});await page.screenshot({path:`${out}/${id}-night.png`,clip});
 records.push({id,bundleKey,...result,completeness,frozen,frames});writeFileSync(`${out}/${id}-report.json`,JSON.stringify(records.at(-1),null,2));await page.close();console.log('Captured',id);
}
}finally{await browser.close();}
writeFileSync(`${out}/report-${ids.join('-')}.json`,JSON.stringify({errors,records},null,2));if(errors.length)throw Error(JSON.stringify(errors));

