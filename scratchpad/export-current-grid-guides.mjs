import {launch} from './runtime.mjs';
const browser=await launch();
try{
const page=await browser.newPage({viewport:{width:768,height:768},deviceScaleFactor:1});
for(const tiles of [1,2])for(let r=0;r<4;r++)for(const kind of ['building','footprint']){
 await page.goto(`http://127.0.0.1:5173/scratchpad/current-grid-guide.html?tiles=${tiles}&rotation=${r}&kind=${kind}`);
 await page.waitForFunction(()=>window.guideReady);
 const key=kind==='building'?`${tiles===1?'house':'station'}-${r}`:`footprint-${tiles}-${r}`;
 await page.locator('canvas').screenshot({path:`assets/source/current-grid-regeneration-v2/handoff/geometry/${key}.png`,omitBackground:kind==='building'});
}
console.log('16 current-grid geometry guides saved.');
}finally{await browser.close();}
