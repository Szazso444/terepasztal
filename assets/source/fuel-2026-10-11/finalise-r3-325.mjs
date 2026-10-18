import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
const root='assets/source/fuel-2026-10-11';
const p=JSON.parse(readFileSync(root+'/prompts.json','utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const baseline={w:[381,1009],s:[562,1107],e:[1057,846]};
const crane={
 12:{postTop:[461,545],postBase:[450,849],jibEnd:[688,701],hoseEnd:[715,977],horizontalReach:227,onePost:false,beamOverTank:true,postAboveTank:false},
 13:{postTop:[490,461],postBase:[490,1056],jibEnd:[649,670],hoseEnd:[650,902],horizontalReach:159,onePost:true,beamOverTank:true,postAboveTank:false},
 14:{postTop:[480,453],postBase:[480,855],jibEnd:[710,640],hoseEnd:[713,873],horizontalReach:230,onePost:true,beamOverTank:true,postAboveTank:false}
};
for(const a of p.attempts.filter(x=>x.view==='r3'&&x.attempt>=12)){
 const m=a.measured;
 m.height.required=[.39,.47];m.height.pass=m.height.ratio>=.39&&m.height.ratio<=.47;
 m.houseWidthFraction=m.height.houseWidth/a.returned[0];
 m.step='r3 step 1';m.accepted=false;m.crane={...crane[a.attempt],readByEye:true,pass:false};
 m.footprint={baseline,corners:m.plan.used,width:m.height.houseWidth,widthDelta:m.height.houseWidth-676,delta:Object.fromEntries(Object.keys(baseline).map(k=>[k,m.plan.used[k].map((v,i)=>v-baseline[k][i])])),pass:false};
 m.light.directionalRatioPass=m.light.pass;
 m.light.referenceMedians=[118.7276,117.8576];
 m.light.deltas=m.light.walls.map((w,i)=>w.median-m.light.referenceMedians[i]);
 m.light.required='Each median within8 of attempt7; directional contrast is not a step1 test.';
 m.light.pass=m.light.deltas.every(v=>Math.abs(v)<=8);
 m.camera.required='at most2.5 degrees';
 const src=PNG.sync.read(readFileSync(root+'/'+a.file));const out=new PNG({width:src.width,height:src.height});
 for(let i=0;i<src.data.length;i+=4){const alpha=src.data[i+3]/255;for(let c=0;c<3;c++)out.data[i+c]=Math.round(src.data[i+c]*alpha+[109,133,73][c]*(1-alpha));out.data[i+3]=255;}
 writeFileSync(root+'/'+m.grassReview,PNG.sync.write(out));
 a.sha256=hash(root+'/'+a.file);
}
for(const a of p.attempts.filter(x=>x.view==='r2'&&x.attempt>=4))a.sha256=hash(root+'/'+a.file);
p.selection.r3Closest=14;
p.selection.r3Step1=null;
p.selection.policy='R0 master and accepted r1 attempt12 untouched. R2 closest attempt4 retained raw only: camera and jib fail; canonical r2 remains attempt2. R3 step1 closest attempt14 retained raw only: footprint, plan and crane fail; no accepted S1, no step2, canonical r3 remains attempt9.';
p.qa.repaint={date:'2026-10-18',outcome:'partial',order:['r2','r3 step1'],requestedSize:[1024,1024],returnedSize:[1254,1254],tool:'built-in image_gen edit',r2:{attempts:[4,5,6],accepted:false,closest:4,reason:'Attempt4 passes plan2.573, height.443, light119.35/68.84, but camera foot slope.636 and jib255px versus192px fail.'},r3Step1:{attempts:[12,13,14],passed:false,closest:14,reason:'Attempt14 passes height.395, camera1.5 degrees, unchanged light125.20/120.64 and hose713,873, but plan2.88, footprint displacement up to47px and crane placement/reach fail.'},r3Step2:{run:false,passed:false,widenedHouse:false,reason:'Not run: no S1 passed.'}};
p.qa.readiness='Partial: r2 not accepted; r3 step1 failed and step2 not run. Canonical r0/r1/r2/r3 remain unchanged.';
p.qa.remainingIssues=[p.qa.repaint.r2.reason,p.qa.repaint.r3Step1.reason,'No relight run; no S1 accepted. Art needs a crane edit that preserves attempt7 geometry.'];
p.qa.verification325={scope:'pass: all committed paths inside assets/source/fuel-2026-10-11/',typecheck:'unavailable: tsc executable absent in worktree',lint:'unavailable: eslint executable absent in worktree',test:'unavailable: vitest executable absent in worktree',build:'unavailable: tsc executable absent in worktree',format:'unavailable: prettier executable absent in worktree',imageMeasurements:'measure-plan, record-attempt/checkFile and light-check run for all6 attempts using existing read-only dependency resolver'};
const expected={r0:'c2ef828ed902b68daa5ef6849d149eb7bb204abe20706a60a281ac83c6d053f0',r1:'18767adf3e76cd96f1ddd872e84fbe6436e3f79dfe4d5accbe482a27e62a18f2',r2:'fb4c343628773ba6a9543ee922b99e0ed2c0dc0805dfc2eb0a8f9f3bf4afe52b',r3:'8ef80ceba09070b1d0db82c2d14484e7b3bba1e56991bb6c91649c5981621eb8'};
for(const [v,h]of Object.entries(expected))if(hash(root+'/fuel_pump-a1-'+v+'.png')!==h)throw Error('Canonical changed: '+v);
p.qa.canonicalIntegrity325={...expected,r1RawAttempt12Identical:hash(root+'/raw/fuel_pump-a1-r1-attempt-12.png')===expected.r1};
writeFileSync(root+'/prompts.json',JSON.stringify(p,null,2)+'\n');
const rows=p.attempts.filter(a=>(a.view==='r2'&&a.attempt>=4)||(a.view==='r3'&&a.attempt>=12)).map(a=>{const m=a.measured;return '|'+[a.view+(a.view==='r3'?' step1':''),a.attempt,m.plan.longToShort.toFixed(3),m.height.ratio.toFixed(3),m.camera.by===null?'Fail; left slope '+m.camera.slope:m.camera.by+' degrees',m.light.walls.map(w=>w.median.toFixed(2)).join('/'),JSON.stringify(m.plan.used)].join('|')+'|';});
const report='# Fuel Pump issue325 result\n\nBranch art/325-fuel-pump. Built-in imagegen edits requested1024x1024; all returned1254x1254. Every native PNG retained byte for byte. Exact prompts, ordered references, automated corners and eye-read corners, heights, light boxes and observations are in prompts.json and metadata files.\n\nR2 not accepted. Closest attempt4 retained raw only, camera and jib fail. R3 step1 failed; closest attempt14 retained raw only, footprint, plan and crane fail. R3 step2 was not run and therefore did not widen the house. Canonical r0,r1,r2,r3 remain unchanged; r1 remains byte-identical to raw attempt12.\n\n|View/step|Attempt|Plan|Height|Camera|Brick luma L/R|Eye-read corners|\n|---|---:|---:|---:|---|---|---|\n'+rows.join('\n')+'\n\nR3 fixed corners were w(381,1009), s(562,1107), e(1057,846), width676. Each new step1 attempt misses the10px corner tolerance. Attempt14 width679, height.395, camera1.5, hose(713,873); post remains at x480 and jib reach230 exceeds210. No accepted S1.\n\nR3 reference light measured118.7276/117.8576 with unchanged boxes(400,880,530,1000) and(850,760,1000,860); each attempt remains within8. No boxes moved.\n\nGrass sheets for all6 attempts are in review/. Do not treat the closest sheets as accepted assets.\n\nVerification: image measurements and canonical hashes checked; Art scope passed. Repository typecheck, lint, tests, build and format commands were attempted but cannot run because this worktree lacks tsc/eslint/vitest/prettier executables. No runtime code changed.\n';
writeFileSync(root+'/result-325.md',report);
console.log(report);

