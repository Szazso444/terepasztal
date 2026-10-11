import {launch} from '../../runtime.mjs';
const browser=await launch();
try {for(const id of process.argv.slice(2)) {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`http://127.0.0.1:5182/scratchpad/models/?rows=${id}&zoom=6`);
 await page.waitForFunction(()=>typeof window.qa?.shot==='function',null,{timeout:240000});
 await page.evaluate(async()=>{qa.shot(6);await qa.settle();});
 await page.screenshot({path:`scratchpad/models/handover-review/sw1-picture-v3/after/${id}-detail.png`,clip:{x:220,y:120,width:1000,height:720}});
 await page.close();console.log('Detail',id);
}} finally {await browser.close();}
