import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const pngUrl = pathToFileURL(require.resolve('pngjs')).href;
registerHooks({ resolve(s, c, next) {
  return s === 'pngjs' ? { url: pngUrl, shortCircuit: true } : next(s, c);
} });
const { PNG } = require('pngjs');
const { pictureOf, checkFile } = await import('../../../../tools/building-check.mjs');
const { measureBase } = await import('../../../../tools/building-fit.mjs');

// Warehouse-specific checks: the concurrently used shared helper has other jobs' limits.
export function inspect(file, view, eye = null) {
  const png = PNG.sync.read(readFileSync(file)), b = measureBase(png);
  const { w, s, e } = eye?.corners ?? b;
  const width = e[0] - w[0], scale = png.width / 1024;
  let left = png.width, right = -1, top = png.height, bottom = -1;
  for (let y=0;y<png.height;y++) for (let x=0;x<png.width;x++) {
    if (png.data[(y*png.width+x)*4+3] <= 128) continue;
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  const r = { size:[png.width,png.height], picture:pictureOf(file),
    opaqueBox:{left,top,right,bottom}, automatic:{w:b.w,s:b.s,e:b.e,slopes:b.slopes,sure:b.sure},
    eye, corners:{w,s,e}, width, limits:[659*scale,694*scale,729*scale], tests:{} };
  r.tests.width = width >= r.limits[0] && width <= r.limits[2] ? 'PASS':'FAIL';
  if (r.tests.width === 'FAIL') { r.skipped=['plan','camera','height','highlights','visual'];return r; }
  r.feet=[s[0]-w[0],e[0]-s[0]];r.ratio=r.feet[0]/r.feet[1];
  r.slopes=[(s[1]-w[1])/r.feet[0],(s[1]-e[1])/r.feet[1]];
  r.slopeErrors=r.slopes.map(n=>Math.abs(n-.5));
  const target=view===2?2:.5;
  r.tests.plan=Math.abs(r.ratio/target-1)<=.15?'PASS':'FAIL';
  const c=checkFile(file,'t1',view);
  r.camera=c.camera;r.checkProblems=c.problems;
  r.tests.camera=r.slopeErrors.every(n=>n<=.03)&&c.ok?'PASS':'FAIL';
  const ref=JSON.parse(readFileSync(new URL('./prompts.json',import.meta.url))).r0Reference;
  r.height=eye?.eavesY==null?null:(s[1]-eye.eavesY)/width;
  r.tests.height=r.height==null?'UNMEASURED':Math.abs(r.height/ref.height-1)<=.15?'PASS':'FAIL';
  let nearWhite=0,nearAmber=0;
  for(let i=0;i<png.data.length;i+=4){const [red,g,blue,a]=png.data.subarray(i,i+4);if(a<=128)continue;
    if(red>=236&&g>=228&&blue>=208)nearWhite++;
    if(Math.hypot(red-232,g-170,blue-72)<=12)nearAmber++;}
  r.highlights={nearWhite,nearAmber};
  r.tests.highlights=nearWhite<=ref.highlights.nearWhite&&nearAmber<=ref.highlights.nearAmber?'PASS':'FAIL';
  r.tests.visual=eye?.visualPass==null?'UNMEASURED':eye.visualPass?'PASS':'FAIL';
  return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.log(JSON.stringify(inspect(process.argv[2],Number(process.argv[3]),JSON.parse(process.argv[4]??'null')),null,2));
}
