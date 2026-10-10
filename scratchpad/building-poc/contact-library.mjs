import {readFileSync,writeFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import {resample} from '../../tools/illustrated-sprites.mjs';
const root='scratchpad/building-poc/sprites',m=JSON.parse(readFileSync(`${root}/manifest.json`));
const buildings=m.buildings.filter(b=>!['house','station'].includes(b.key));
for(let start=0;start<buildings.length;start+=6){const batch=buildings.slice(start,start+6),sheet=new PNG({width:640,height:160*batch.length});
for(let i=0;i<sheet.data.length;i+=4)sheet.data.set([29,47,36,255],i);
for(let row=0;row<batch.length;row++)for(let r=0;r<4;r++){const p=PNG.sync.read(readFileSync(`${root}/${batch[row].key}-${r}.png`)),scale=Math.min(152/p.width,152/p.height),t=resample(p,Math.round(p.width*scale),Math.round(p.height*scale));
const ox=r*160+Math.round((160-t.width)/2),oy=row*160+156-t.height;
for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++){const a=(y*t.width+x)*4,o=((y+oy)*640+x+ox)*4,alpha=t.data[a+3]/255;for(let c=0;c<3;c++)sheet.data[o+c]=t.data[a+c]*alpha+sheet.data[o+c]*(1-alpha);}
}writeFileSync(`${root}/contact-${start/6}.png`,PNG.sync.write(sheet));console.log({page:start/6,rows:batch.map(b=>b.key)});}
