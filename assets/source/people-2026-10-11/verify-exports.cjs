const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp'),vm=require('node:vm');
(async()=>{
 const files=fs.readdirSync(__dirname).filter(f=>/-(front|back)-(walk|carry)\.png$/.test(f));
 if(files.length!==28)throw Error('Expected 28 strips, got '+files.length);
 const checks=[];
 for(const file of files){
 const {data,info}=await sharp(path.join(__dirname,file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==768||info.height!==512||info.channels!==4)throw Error(file+': canvas');
 const frames=[];
 for(let k=0;k<4;k++){
 let x0=192,y0=512,x1=-1,y1=-1,opaque=0;
 for(let y=0;y<512;y++)for(let x=0;x<192;x++){
 const p=(y*768+k*192+x)*4,alpha=data[p+3];
 if(alpha){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);if(alpha===255)opaque++}
 else if(data[p]||data[p+1]||data[p+2])throw Error(file+': nonzero hidden RGB');
 }
 if(y1!==480||x0<1||x1>=191||opaque<1000)throw Error(file+': baseline, clipping or empty frame');
 frames.push({frame:k,anchor:[96+k*192,480],bounds:[x0,y0,x1,y1],opaquePixels:opaque});
 }
 checks.push({file,canvas:[768,512],rgba:true,frames});
 }
 const html=fs.readFileSync(path.join(__dirname,'review','index.html'),'utf8');
 const scales=JSON.parse(fs.readFileSync(path.join(__dirname,'game-scale','manifest.json'),'utf8'));
 if(scales.assets.length!==84)throw Error('Expected 84 game-scale strips');
 for(const a of scales.assets){
  const {data,info}=await sharp(path.join(__dirname,'game-scale',a.file)).raw().toBuffer({resolveWithObject:true});
  if(info.channels!==4||info.width!==a.canvas[0]||info.height!==a.canvas[1])throw Error(a.file+': scale canvas');
  for(let k=0;k<4;k++){
   let top=info.height,bottom=-1,left=a.columnWidth,right=-1;
   for(let y=0;y<info.height;y++)for(let x=0;x<a.columnWidth;x++)if(data[(y*info.width+k*a.columnWidth+x)*4+3]){
    top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);
   }
   if(bottom-top+1!==a.figureHeight||bottom!==a.baseline||left<1||right>=a.columnWidth-1)throw Error(a.file+': size, baseline or clipping');
  }
 }
 new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
 fs.writeFileSync(path.join(__dirname,'export-validation.json'),JSON.stringify({stripCount:files.length,frameCount:files.length*4,gameScaleStripCount:scales.assets.length,gameScaleSizes:scales.sizes,gameScaleChecks:'RGBA dimensions, exact figure height, baseline and frame margins passed',reviewScriptSyntax:'passed',checks},null,2)+'\n');
 console.log('Validated '+files.length+' source strips and '+scales.assets.length+' game-scale strips at9/18/36px; exact heights, RGBA, baselines, margins and review script.');
})().catch(e=>{console.error(e);process.exitCode=1});
