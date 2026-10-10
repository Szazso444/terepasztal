let manifest;const cache={};
function poly(c,p,color,stroke){c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=color;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=.8;c.stroke();}}
function line(c,a,b,color){c.beginPath();c.moveTo(...a);c.lineTo(...b);c.strokeStyle=color;c.lineWidth=1.5;c.stroke();}
async function draw(canvas,a,r,f){
 const c=canvas.getContext('2d'),p=(x,y)=>[160+(x-y)*52,235+(x+y)*26];
 c.fillStyle='#293f32';c.fillRect(0,0,320,310);
 if(document.querySelector('#neighbor').checked)for(let x=-3;x<3;x++)for(let y=-3;y<3;y++)poly(c,[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(q=>p(...q)),'#3d5741','#667b5c');
 const [w,h]=a.tiles===1?[1,1]:r%2?[1,2]:[2,1];
 poly(c,[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(q=>p(...q)),'#8b876a','#f1c96e');
 const key=`${a.key}-${r}`;
 if(!cache[key]){const img=new Image();img.src=`./sprites/${key}.png`;await img.decode();cache[key]=img;}
 c.drawImage(cache[key],160-f.ax,235-f.ay,f.w,f.h);
 if(document.querySelector('#axes').checked){line(c,p(-1.2,1.2),p(1.2,1.2),'#e6a084');line(c,p(1.2,-1.2),p(1.2,1.2),'#83bec7');}
}
async function render(){
 const filter=document.querySelector('#filter').value,root=document.querySelector('#library');root.replaceChildren();
 document.querySelector('#status').textContent=`${manifest.completed} / ${manifest.total} facings generated. ${manifest.assets.filter(a=>a.tiles===1).length} one-tile types; ${manifest.assets.filter(a=>a.tiles===2).length} two-tile types.`;
 const work=[];
 for(const a of manifest.assets){
  if(filter==='ready'&&!Object.keys(manifest.frames).some(k=>k.startsWith(a.key+'-')))continue;
  if(['1','2'].includes(filter)&&a.tiles!==Number(filter))continue;
  const row=document.createElement('section');row.className='row';row.dataset.key=a.key;
  const source=document.createElement('div');source.className='source';source.innerHTML=`<img loading="lazy" src="../../assets/source/current-grid-regeneration-v2/handoff/${a.original}"><div><h2>${a.name}</h2><p>${a.tiles===1?'1×1':'2×1 / 1×2'} · original reference</p><p>${a.footprintReason}</p></div>`;row.append(source);
  for(let r=0;r<4;r++){
   const f=manifest.frames[`${a.key}-${r}`],cell=document.createElement('div');cell.className='cell';
   if(f){cell.innerHTML=`<canvas width="320" height="310" aria-label="${a.key} facing ${r}"></canvas><p>${r*90}° · candidate · <a href="${f.source}">Full source PNG</a></p>`;work.push(draw(cell.querySelector('canvas'),a,r,f));}
   else cell.innerHTML=`<div class="empty">${r*90}° · pending generation</div>`;
   row.append(cell);
  }
  root.append(row);
 }
 await Promise.all(work);window.currentGridReady=true;
}
async function refresh(){manifest=await(await fetch('./manifest.json?t='+Date.now())).json();await render();}
document.querySelector('#refresh').onclick=refresh;
for(const c of document.querySelectorAll('select,input'))c.onchange=render;
await refresh();
