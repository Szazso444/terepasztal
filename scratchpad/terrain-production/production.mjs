import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const report={};
try {
 for(const fallback of [false,true]){
  const context=await b.newContext({viewport:{width:1440,height:900}}),p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  if(fallback)await p.route('**/assets/terrain-surfaces.png',route=>route.abort());
  await p.goto('http://127.0.0.1:5291/#seed=7412&new');
  await p.waitForFunction(f=>!!window.game?.world?.landscape&&(f?game.world.landscape.failed:game.world.landscape.ready&&game.world.landscape.active),fallback,{timeout:120000});
  const state=await p.evaluate(()=>({size:[game.map.w,game.map.h],active:game.world.landscape.active,failed:game.world.landscape.failed,nativeVisible:game.world.ground.visible,chunks:game.world.landscape.chunkCount}));
  assert.equal(state.failed,fallback);assert.equal(state.active,!fallback);assert.equal(state.nativeVisible,fallback);assert.equal(errors.length,0);
  if(!fallback)await p.screenshot({path:'scratchpad/terrain-production/renders/16-playable-build.png'});
  report[fallback?'fallback':'production']={...state,errors};await context.close();
 }
 fs.writeFileSync('scratchpad/terrain-production/renders/production.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally {await b.close();}
