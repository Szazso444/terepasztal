import { launch } from '../../runtime.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'scratchpad/models/handover-review/c50-corrected';
mkdirSync(out, { recursive: true });
const browser = await launch();
const errors = [], records = [];
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://127.0.0.1:5182/scratchpad/models/?rows=');
  await p.waitForFunction(() => typeof window.qa?.start === 'function', null, { timeout: 240000 });
  await p.evaluate(async () => {
    qa.start('c50', [], 10);qa.roll(0, 9);await qa.settle();
    const atlas = qa.g.atlas;
    for (let f=0;f<96;f++) for(let phase=0;phase<8;phase++) {
      if(!atlas.has(`rolling/loco_c50_body_w${phase}_f${f}`)) throw new Error('Missing wheel/facing render');
    }
    window.wheelState=()=>{
      const r=qa.g.trainRenderer,t=qa.g.fleet.trains[0];
      const s=r.cars.get(t.id)[0].parts[0];
      return {distance:t.distance,phase:Math.floor((r.spin.get(s)??0)*8),
        overlays:[...r.wheelLayers.values()].filter(o=>o.visible).length};
    };
  });
  for (let i=0;i<48;i++) {
    records.push(await p.evaluate(()=>{qa.roll(2,9);return wheelState();}));
    await p.screenshot({clip:{x:360,y:180,width:720,height:550},path:`${out}/wheel-${String(i).padStart(2,'0')}.png`});
  }
  const stopped=await p.evaluate(()=>{const a=wheelState();qa.roll(0,9);qa.roll(0,9);return {a,b:wheelState()};});
  if(JSON.stringify(stopped.a)!==JSON.stringify(stopped.b))throw new Error('Wheels moved without travel');
  if(new Set(records.map(r=>r.phase)).size<6||records.some(r=>r.overlays))throw new Error('Bad integrated wheel animation');
  writeFileSync(`${out}/wheel-report.json`,JSON.stringify({records,stopped,errors},null,2));
  if(errors.length)throw new Error(JSON.stringify(errors));
  console.log('96 headings x 8 wheel phases present; moving phases, stationary stop and no overlay verified.');
}finally{await browser.close();}
