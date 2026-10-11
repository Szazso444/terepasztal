import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {launch} from './runtime.mjs';
const root='assets/source/current-grid-regeneration-v2',out='scratchpad/current-grid-assets',m=JSON.parse(readFileSync(`${out}/manifest.json`)),pack=JSON.parse(readFileSync(`${root}/handoff/manifest.json`));
assert.equal(pack.assets.length,26);assert.equal(pack.tasks.length,104);assert.equal(pack.assets.filter(a=>a.tiles===1).length,18);
for(const task of pack.tasks)for(const ref of task.referencePaths)assert.ok(existsSync(`${root}/handoff/${ref}`),ref);
for(const entry of JSON.parse(readFileSync(`${root}/handoff/source-inventory.json`))){const bytes=readFileSync(`${root}/handoff/${entry.path}`);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);}
for(const [key,f]of Object.entries(m.frames)){
 const png=PNG.sync.read(readFileSync(`${out}/sprites/${key}.png`));assert.equal(png.width,Math.round(f.w*4));assert.equal(png.height,Math.round(f.h*4));assert.equal(f.alphaPresent,true,key);
}
if(process.argv.includes('--require-all'))assert.equal(m.completed,104);
mkdirSync(`${out}/review`,{recursive:true});
const browser=await launch();const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1680,height:1150}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/scratchpad/current-grid-assets/index.html');await page.waitForFunction(()=>window.currentGridReady);
 assert.equal(await page.locator('section.row').count(),26);assert.equal(await page.locator('canvas').count(),m.completed);
 for(const value of ['1','2']){await page.selectOption('#filter',value);assert.equal(await page.locator('section.row').count(),pack.assets.filter(a=>a.tiles===Number(value)).length);}
 await page.selectOption('#filter','ready');await page.uncheck('#axes');await page.check('#axes');
 for(const a of pack.assets){const row=page.locator(`section[data-key="${a.key}"]`);if(await row.count())await row.screenshot({path:`${out}/review/${a.key}.png`});}
 await page.setViewportSize({width:540,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 const report={buildingTypes:26,plannedFacings:104,completed:m.completed,oneTileTypes:18,twoTileTypes:8,allReferenceHashesMatch:true,alphaAndSpriteDimensions:true,filtersAndResponsiveLayout:true,errors,projectionCertified:false,scaleCertified:false};
 writeFileSync(`${out}/review/verification.json`,JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}
