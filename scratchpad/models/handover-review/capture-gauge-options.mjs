import {launch} from '../../runtime.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='scratchpad/models/handover-review/page/gauge-options';mkdirSync(out,{recursive:true});
const browser=await launch();const sections=[];
try {
for(const [gauge,label] of [[.16,'Jelenlegi wide sín'],[.14,'12,5%-kal keskenyebb'],[.12,'25%-kal keskenyebb']]) {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`http://127.0.0.1:5182/scratchpad/models/?rows=class08&gauge=${gauge}&zoom=5`);
 await page.waitForFunction(()=>typeof window.qa?.shot==='function',null,{timeout:240000});
 await page.evaluate(async()=>{qa.shot(5);await qa.settle();});
 await page.screenshot({path:`${out}/${gauge}-train.png`,clip:{x:360,y:240,width:720,height:480}});
 await page.evaluate(()=>qa.bare());
 await page.screenshot({path:`${out}/${gauge}-track.png`,clip:{x:360,y:240,width:720,height:480}});
 sections.push(`<section><h2>${label}</h2><img src="gauge-options/${gauge}-track.png"><img src="gauge-options/${gauge}-train.png"></section>`);
 await page.close();
}
} finally {await browser.close();}
writeFileSync('scratchpad/models/handover-review/page/gauge-options.html',`<!doctype html><html lang="hu"><meta charset="utf-8"><title>Wide sín — szélességváltozatok</title><style>body{background:#15211e;color:#eef3ec;font:16px/1.5 system-ui;margin:30px}main{max-width:1450px;margin:auto}img{width:49%}section{border-top:1px solid #668776;padding:15px 0}a{color:#a5dfc5}</style><main><h1>Wide sín — szélességváltozatok</h1><p>Itt csak a sín, az aljak és az ágyazat szélessége változik. A mozdony azonos méretű; a kerekei még a korábbi sínhez készültek. A kiválasztott sínhez külön igazítom a javított kerekeket.</p>${sections.join('')}</main></html>`);
console.log('Three gauge previews complete');
