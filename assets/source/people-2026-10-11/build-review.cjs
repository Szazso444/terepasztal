const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = __dirname;
const escape = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{
  const files = fs.readdirSync(root).filter(f=>/-(front|back)-(walk|carry)\.png$/.test(f)).sort();
  const specs = [];
  const cols = 4, cardW = 230, cardH = 230;
  const layers = [], labels = [];
  for (let i=0;i<files.length;i++) {
    const file = files[i], meta = await sharp(path.join(root,file)).metadata();
    const cw=meta.width/4, fh=meta.width===768?360:720, base=meta.width===768?480:960;
    const x=(i%cols)*cardW, y=Math.floor(i/cols)*cardH;
    const label=file.replace('.png','');
    labels.push('<text x="'+(x+8)+'" y="'+(y+18)+'">'+escape(label)+'</text>');
    const first = await sharp(path.join(root,file)).extract({left:0,top:base-fh+1,width:cw,height:fh}).resize({height:120}).png().toBuffer();
    const fm=await sharp(first).metadata();
    layers.push({input:first,left:x+Math.round((cardW-fm.width)/2),top:y+25});
    for(let k=0;k<4;k++) {
      const tiny = await sharp(path.join(root,file)).extract({left:k*cw,top:base-fh+1,width:cw,height:fh}).resize({height:9}).png().toBuffer();
      const big = await sharp(tiny).resize({height:54,kernel:'nearest'}).png().toBuffer();
      layers.push({input:big,left:x+22+k*48,top:y+164});
    }
    specs.push({file,label,width:meta.width,height:meta.height,columnWidth:cw,figureHeight:fh,baseline:base});
  }
  const height=Math.ceil(files.length/cols)*cardH;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+(cols*cardW)+'" height="'+height+'"><rect width="100%" height="100%" fill="#78804C"/><g fill="#f4ead5" font-family="Arial" font-size="12">'+labels.join('')+'</g></svg>';
  const contactPath = path.join(root,'review','people-contact-sheet.png');
  await sharp({create:{width:cols*cardW,height,channels:4,background:'#78804C'}}).composite([{input:Buffer.from(svg),left:0,top:0},...layers]).png().toFile(contactPath);
  for (let y=0, i=1; y<height; y+=cardH*4, i++) {
    await sharp(contactPath).extract({left:0,top:y,width:cols*cardW,height:Math.min(cardH*4,height-y)}).png()
      .toFile(path.join(root,'review','people-sheet-'+String(i).padStart(2,'0')+'.png'));
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>People variations · issue 331</title>
<style>body{margin:0;background:#243a30;color:#e4d5b5;font:15px system-ui}header{padding:24px;position:sticky;top:0;background:#243a30;z-index:2}h1{margin:0 0 8px;font-size:24px}p{margin:4px 0}button,select{font:inherit;background:#e4d5b5;color:#294638;border:0;padding:6px 12px;border-radius:4px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;padding:20px}.card{background:#78804c;padding:14px;border-radius:8px;color:#fff5df}.card h2{font-size:14px;margin:0 0 6px}.big{width:192px;height:192px;display:block;margin:auto;image-rendering:pixelated}.native{width:64px;height:64px;image-rendering:pixelated}.nativebox{display:flex;gap:12px;align-items:center;font-size:12px}small{display:block;font-size:11px;margin-top:8px}label{margin-right:16px}</style>
<header><h1>People variations · animation draft</h1><p>Four frames per strip · native figure height 9, 18 or 36 px · large preview magnifies the selected pixels.</p><p>Cast review: some leg phases repeat and body anchors need refinement before production. Phase names below describe the requested cycle.</p>
<p><button id="pause">Pause</button> <label>View <select id="view"><option value="all">All</option><option>front</option><option>back</option></select></label>
<label>Pose <select id="pose"><option value="all">All</option><option>walk</option><option>carry</option></select></label>
<label>Resolution <select id="resolution"><option value="9">9 px</option><option value="18">18 px</option><option value="36" selected>36 px</option></select></label>
<label>Frame <select id="phase"><option value="animate">Animate</option><option value="0">Right contact</option><option value="1">Passing</option><option value="2">Left contact</option><option value="3">Passing</option></select></label></p></header><main id="cards"></main>
<script>const assets=${JSON.stringify(specs)};let paused=false,step=0;
const cards=assets.map(a=>{const el=document.createElement('article');el.className='card';el.innerHTML='<h2>'+a.label+'</h2><canvas class="big" width="64" height="64"></canvas><div class="nativebox"><canvas class="native" width="64" height="64"></canvas><span>36 px native</span></div><small>Painted source '+a.width+' × '+a.height+' RGBA</small>';document.getElementById('cards').append(el);const images={};for(const size of [9,18,36]){const image=new Image();image.src='../game-scale/'+size+'px/'+a.file;image.onload=draw;images[size]=image;}return{a,el,images,big:el.querySelector('.big'),native:el.querySelector('.native')};});
function draw(){const phase=document.getElementById('phase').value,frame=phase==='animate'?step%4:Number(phase),size=Number(document.getElementById('resolution').value),cell=size/18*32,baseline=size/18*28;for(const c of cards){const{a,big,native}=c,image=c.images[size];c.el.hidden=!(document.getElementById('view').value==='all'||a.label.includes('-'+document.getElementById('view').value+'-'))||!(document.getElementById('pose').value==='all'||a.label.endsWith('-'+document.getElementById('pose').value));c.el.querySelector('.nativebox span').textContent=size+' px native';const ctx=native.getContext('2d');ctx.clearRect(0,0,64,64);big.width=big.height=cell;const b=big.getContext('2d');if(!image.complete||!image.naturalWidth)continue;ctx.imageSmoothingEnabled=false;ctx.drawImage(image,frame*cell,0,cell,cell,(64-cell)/2,60-baseline,cell,cell);b.imageSmoothingEnabled=false;b.drawImage(image,frame*cell,0,cell,cell,0,0,cell,cell);}}
document.getElementById('pause').onclick=()=>{paused=!paused;document.getElementById('pause').textContent=paused?'Play':'Pause'};for(const id of ['view','pose','phase','resolution'])document.getElementById(id).onchange=draw;setInterval(()=>{if(!paused)step++;draw()},240);
</script></html>`;
  fs.writeFileSync(path.join(root,'review','index.html'),html);
  const cast=files.filter(f=>f.endsWith('-front-walk.png'));
  const castLayers=[],castLabels=[];
  for(let i=0;i<cast.length;i++){
    const x=i%5*200,y=Math.floor(i/5)*220;
    castLabels.push('<text x="'+(x+8)+'" y="'+(y+18)+'">'+escape(cast[i].replace('-front-walk.png',''))+'</text>');
    const first=await sharp(path.join(root,cast[i])).extract({left:0,top:121,width:192,height:360}).resize({height:120}).png().toBuffer();
    castLayers.push({input:first,left:x+68,top:y+30});
    const native=await sharp(first).resize({height:9}).png().toBuffer();
    const tiny=await sharp(native).resize({height:54,kernel:'nearest'}).png().toBuffer();
    castLayers.push({input:tiny,left:x+85,top:y+162});
  }
  const castSvg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="440"><rect width="100%" height="100%" fill="#78804C"/><g fill="#f4ead5" font-family="Arial" font-size="12">'+castLabels.join('')+'</g></svg>';
  await sharp(Buffer.from(castSvg)).composite(castLayers).png().toFile(path.join(root,'review','cast-overview.png'));
  console.log('Review built for '+files.length+' strips');
})().catch(e=>{console.error(e);process.exitCode=1});
