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
 new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
 fs.writeFileSync(path.join(__dirname,'export-validation.json'),JSON.stringify({stripCount:files.length,frameCount:files.length*4,reviewScriptSyntax:'passed',checks},null,2)+'\n');
 console.log('Validated '+files.length+' RGBA strips / '+files.length*4+' frames, transparent background, baseline480, margins and review script.');
})().catch(e=>{console.error(e);process.exitCode=1});
