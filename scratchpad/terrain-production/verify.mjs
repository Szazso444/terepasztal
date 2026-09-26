import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const report={errors:[]};
try {
 const page=await browser.newPage({viewport:{width:1920,height:1200}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/');
 await page.waitForFunction(()=>!!window.worldReview,null,{timeout:120000});
 report.cache=await page.evaluate(async()=>{
  const g=worldReview.g,l=g.world.landscape,before=l.paintCount,times=[];
  for(let i=0;i<60;i++){
    const start=performance.now();g.camera.x+=2;g.render(1,0);g.app.renderer.render(g.app.stage);
    times.push(performance.now()-start);await new Promise(requestAnimationFrame);
  }
  return {chunks:l.chunkCount,before,after:l.paintCount,active:l.active,workerPaintMs:l.paintMilliseconds,medianRenderSubmitMs:times.sort((a,b)=>a-b)[30],terrainStartupMs:worldReview.report.terrainStartupMs};
 });
 assert.equal(report.cache.before,report.cache.after);assert(report.cache.active);assert.equal(report.cache.chunks,256);
 report.excavation=await page.evaluate(async()=>{
  const g=worldReview.g,w=g.world,l=w.landscape;
  const settled=async()=>{w.animate(0);while(!l.ready){if(l.failed)throw Error('Worker failed');await new Promise(r=>setTimeout(r,20));w.animate(0);}};
  let placed;
  for(let k=0;k<g.map.terrain.length;k++){
    const x=k%128,y=Math.floor(k/128);
    if(g.map.terrain[k]!==2||x<10||y<10||x>117||y>117||g.track.has(x,y)||w.elevationOf(x,y)>-5)continue;
    const z=w.elevationOf(x,y),paints=l.paintCount;
    if(g.builder.placeTrackKind(x,y,'straight',0)){placed={x,y,z,paints};break;}
  }
  if(!placed)throw Error('No test hill for real Builder excavation');
  const {x,y,z,paints}=placed;
  await settled();
  for(const dx of [-.49,0,.49])for(const dy of [-.49,0,.49])if(w.elevationOf(x+dx,y+dy)!==0)throw Error('Track footprint not flat');
  const s=w.trackSprites.get(y*128+x),p=w.surfacePoint(x,y);
  if(s.y!==p.y||s.x!==p.x)throw Error('Track not aligned');
  const picked=w.tileAtSurface(p.x,p.y);
  if(picked.x!==x||picked.y!==y)throw Error('Raised terrain pick failed');
  const repaint=l.paintCount-paints;
  g.builder.removeTrack(x,y);await settled();
  if(w.elevationOf(x,y)!==z)throw Error('Removing rail did not restore relief');
  // Force a new terrain edit while a worker job from the preceding edit is in flight.
  g.map.terrain[y*128+x]=0;w.retile(x,y);w.animate(0);
  g.map.terrain[y*128+x]=2;w.retile(x,y);w.animate(0);await settled();
  if(w.elevationOf(x,y)!==z)throw Error('Stale edit result won');
  return {tile:[x,y],originalHeight:z,flatFootprint:true,trackAligned:true,picking:true,localRepaintCount:repaint,restored:true,staleResultRejected:true};
 });
 assert(report.excavation.localRepaintCount<20);
 report.season=await page.evaluate(async()=>{
  const g=worldReview.g,w=g.world,l=w.landscape;
  function sample(k){
    const x=k%128,y=Math.floor(k/128),c=[...l.chunks.values()].find(c=>x>=c.x&&x<c.x+c.w&&y>=c.y&&y<c.y+c.h),p=w.surfacePoint(x,y);
    const canvas=c.sprite.texture.source.resource;
    return [...canvas.getContext('2d').getImageData(Math.round(p.x-c.sprite.x),Math.round(p.y-c.sprite.y),1,1).data];
  }
  const water=g.map.terrain.findIndex(t=>t===3),grass=g.map.terrain.findIndex(t=>t===0);
  const beforeWater=sample(water),beforeGrass=sample(grass);
  w.setSeasonTint(0xb2c6d9,0xc6d0df);w.animate(0);
  while(!l.ready){await new Promise(r=>setTimeout(r,25));w.animate(0);}
  const afterWater=sample(water),afterGrass=sample(grass);
  return {beforeWater,afterWater,beforeGrass,afterGrass};
 });
 assert.deepEqual(report.season.beforeWater,report.season.afterWater);assert.notDeepEqual(report.season.beforeGrass,report.season.afterGrass);
 await page.evaluate(()=>worldReview.g.world.landscape.root.destroy({children:true}));
 report.disposal=true;
 await page.goto('http://127.0.0.1:5190/scratchpad/terrain-production/detail.html');
 await page.waitForFunction(()=>!!window.terrainReview,null,{timeout:120000});
 const views=await page.evaluate(()=>terrainReview.views);
 for(const view of views){await page.evaluate(v=>terrainReview.render(v),view);await page.screenshot({path:`scratchpad/terrain-production/renders/${view.id}.png`});}
 await page.evaluate(()=>terrainReview.render(terrainReview.views[2]));
 await page.screenshot({path:'scratchpad/terrain-production/renders/15-foundation-closeup.png',clip:{x:620,y:280,width:640,height:500}});
 report.detailViews=views;
 assert.equal(report.errors.length,0);
 fs.writeFileSync('scratchpad/terrain-production/renders/verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await browser.close();}
