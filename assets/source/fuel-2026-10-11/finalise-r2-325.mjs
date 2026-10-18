import {readFileSync,writeFileSync} from 'node:fs';
import {PNG} from 'pngjs';
const root='assets/source/fuel-2026-10-11';
const p=JSON.parse(readFileSync(root+'/prompts.json','utf8'));
for (const a of p.attempts.filter(x=>x.view==='r2'&&x.attempt>=4)) {
 a.measured.height.required=[0.43,0.47];a.measured.height.pass=a.measured.height.ratio>=.43&&a.measured.height.ratio<=.47;
 a.measured.houseWidthFraction=a.measured.height.houseWidth/a.returned[0];
 a.measured.accepted=false;
 const src=PNG.sync.read(readFileSync(root+'/'+a.file));const out=new PNG({width:src.width,height:src.height});
 for(let i=0;i<src.data.length;i+=4){const al=src.data[i+3]/255;for(let c=0;c<3;c++)out.data[i+c]=Math.round(src.data[i+c]*al+[109,133,73][c]*(1-al));out.data[i+3]=255;}
 writeFileSync(root+'/'+a.measured.grassReview,PNG.sync.write(out));
}
p.selection.policy='r0 master and r1 attempt12 remain unchanged. R2 attempts4-6 rejected: closest attempt4 retained as raw only (plan/height/light pass; camera and jib fail). Canonical r2 stays attempt2. R3 pending crane-only edit from attempt7.';
p.selection.r2Closest=4;
p.qa.repaint={date:'2026-10-18',outcome:'in progress',r2:{accepted:false,attempts:[4,5,6],closest:4,reason:'Attempt4 passes plan 2.573, height .443 and light 119.35/68.84; fails camera lower-left slope .636 and jib reach about255 versus192. No canonical replacement.'}};
p.qa.readiness='Partial: r2 rejected after three attempts; r3 crane/light pending. R0 and accepted r1 unchanged.';
p.referencePreparation+=' R1 attempt12 fitted for r2 at refs/fuel_pump-a1-r1-fitted.png; no r3 reference created.';
writeFileSync(root+'/prompts.json',JSON.stringify(p,null,2)+'\n');

