const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const root=__dirname;
(async()=>{
 const files=fs.readdirSync(root).filter(f=>/-(front|back)-(walk|carry)\.png$/.test(f)).sort();
 const manifest={sourceFigureHeight:360,sizes:[9,18,36],filter:'lanczos3 from painted source, not enlarged from 9px',assets:[]};
 const compare=[],labels=[],cw=260,ch=120;
 for(let i=0;i<files.length;i++){
  const file=files[i], source=path.join(root,file), frames=[];
  for(let k=0;k<4;k++){
   const {data,info}=await sharp(source).extract({left:k*192,top:0,width:192,height:512}).raw().toBuffer({resolveWithObject:true});
   let top=512,bottom=-1;
   for(let y=0;y<512;y++)for(let x=0;x<192;x++)if(data[(y*192+x)*4+3]){top=Math.min(top,y);bottom=Math.max(bottom,y)}
   frames.push(await sharp(data,{raw:info}).extract({left:0,top,width:192,height:bottom-top+1}).png().toBuffer());
  }
  for(const size of manifest.sizes){
   const cell=size/18*32, baseline=size/18*28, directory=path.join(root,'game-scale',size+'px');
   fs.mkdirSync(directory,{recursive:true});
   const layers=[];
   for(let k=0;k<4;k++){
    const png=await sharp(frames[k]).resize({height:size,kernel:'lanczos3'}).png().toBuffer();
    const m=await sharp(png).metadata();
    layers.push({input:png,left:k*cell+Math.round((cell-m.width)/2),top:baseline-size+1});
   }
   await sharp({create:{width:cell*4,height:cell,channels:4,background:'#00000000'}}).composite(layers).png().toFile(path.join(directory,file));
   manifest.assets.push({file:size+'px/'+file,figureHeight:size,canvas:[cell*4,cell],columnWidth:cell,baseline,anchors:Array.from({length:4},(_,k)=>[k*cell+cell/2,baseline])});
   const native=await sharp(layers[0].input).resize({height:size*2,kernel:'nearest'}).png().toBuffer();
   const m=await sharp(native).metadata(),x=i%4*cw,y=Math.floor(i/4)*ch;
   compare.push({input:native,left:x+30+manifest.sizes.indexOf(size)*78-Math.floor(m.width/2),top:y+108-size*2});
  }
  const x=i%4*cw,y=Math.floor(i/4)*ch;
  labels.push('<text x="'+(x+6)+'" y="'+(y+16)+'">'+file.replace('.png','')+'</text>');
  for(let n=0;n<3;n++)labels.push('<text x="'+(x+20+n*78)+'" y="'+(y+32)+'">'+manifest.sizes[n]+' px</text>');
 }
 fs.writeFileSync(path.join(root,'game-scale','manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+cw*4+'" height="'+Math.ceil(files.length/4)*ch+'"><rect width="100%" height="100%" fill="#78804C"/><g fill="#f4ead5" font-family="Arial" font-size="12">'+labels.join('')+'</g></svg>';
 await sharp(Buffer.from(svg)).composite(compare).png().toFile(path.join(root,'review','resolution-comparison.png'));
 console.log('Exported '+manifest.assets.length+' strips at 9,18,36px directly from painted sources.');
})().catch(e=>{console.error(e);process.exitCode=1});
