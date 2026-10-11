import {launch} from '../../runtime.mjs';
const browser=await launch();
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:5182/scratchpad/models/?rows=c50,sw1&gap=2&zoom=4');
 await page.waitForFunction(()=>typeof window.qa?.shot==='function',null,{timeout:240000});
 await page.evaluate(async()=>{qa.shot(4);await qa.settle();});
 await page.screenshot({path:'scratchpad/models/handover-review/sw1-picture-v3/after/c50-sw1.png',clip:{x:170,y:120,width:1100,height:720}});
} finally {await browser.close();}
