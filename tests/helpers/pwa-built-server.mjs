import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// Local-only fixture emulates the deployed versioned public static asset
// contract. It deliberately does not simulate login or authorize private APIs.
export async function startPwaBuiltServer() {
  const root=path.resolve('dist');
  const release=JSON.parse(fs.readFileSync(path.join(root,'pwa-release.json'),'utf8')).release;
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff'};
  const server=http.createServer((req,res)=>{
    let url,pathname;
    try {url=new URL(req.url||'/','http://127.0.0.1');pathname=decodeURIComponent(url.pathname);}
    catch {res.writeHead(400).end();return;}
    if (pathname==='/')pathname='/index.html';
    const file=path.resolve(root,'.'+pathname);
    if (!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    const ext=path.extname(file).toLowerCase();
    const requested=url.searchParams.get('mao_rev');
    if (requested && /\.(?:js|mjs|css)$/.test(ext) && requested!==release) {
      res.writeHead(409,{'Cache-Control':'no-store'}).end();return;
    }
    fs.readFile(file,(error,bytes)=>{
      if(error){res.writeHead(error.code==='ENOENT'?404:500,{'Cache-Control':'no-store'}).end();return;}
      const headers={'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'};
      if(requested===release && /\.(?:js|mjs|css)$/.test(ext)) {
        headers['X-Mao-Release']=release;headers['Cache-Control']='public,max-age=31536000,immutable';
      }else if(pathname==='/account/index.html'||pathname==='/account/bootstrap.html'){
        headers['Cache-Control']='no-cache,must-revalidate';
      }
      res.writeHead(200,headers).end(bytes);
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:'http://127.0.0.1:'+server.address().port,release,close:()=>new Promise(resolve=>{
    server.close(resolve);server.closeAllConnections?.();
  })};
}
