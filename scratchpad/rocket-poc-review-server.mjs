import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('G:/DEV/Terepasztal/poc/rocket-original-v1');
http.createServer((req,res)=>{
 const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html';
 const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',({'.html':'text/html','.json':'application/json','.png':'image/png','.md':'text/plain'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
}).listen(5189,'127.0.0.1',()=>console.log('POC review: http://127.0.0.1:5189'));
