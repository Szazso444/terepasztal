import fs from 'node:fs';import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/Zso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
try{const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:5190/scratchpad/asset-qa/');await p.waitForFunction(()=>window.qa?.advanceTo,null,{timeout:90000});
await p.evaluate(()=>qa.advanceTo(38.5,'cozy-forward'));
const reversal=await p.evaluate(()=>qa.reverse());
await p.evaluate(()=>qa.advanceTo(37.5,'cozy-reverse'));
const coverage=await p.evaluate(()=>qa.coverage);assert.equal(coverage.facings.length,48);assert(coverage.trackKinds.includes('curve')&&coverage.trackKinds.includes('switch'));assert(reversal.reversalError<.1);assert.equal(errors.length,0);
const report={scope:'existing real Fleet.tick fixture with production renderer changes; Rocket candidate remains QA-only',coverage,reversal,errors};fs.writeFileSync('scratchpad/cozy-v3/renders/motion.json',JSON.stringify(report,null,2));console.log(JSON.stringify({samples:coverage.samples,facings:coverage.facings.length,trackKinds:coverage.trackKinds,reversalError:reversal.reversalError,errors}));}finally{await b.close();}
