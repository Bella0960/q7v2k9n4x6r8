/**
 * Desktop widget catalog real-browser regression. Synthetic context only.
 * Cover all 18 widget types, per-widget add/remove persistence, and failed writes.
 * Do not touch production, paid APIs, users' data, or deployment credentials.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {chromium} from 'playwright';

const root=resolve('.');
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try{
    let name=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
    if(name==='/')name='/index.html';
    if(name==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=resolve(root,'.'+name);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    let data=await readFile(file);
    if(extname(file)==='.html')data=Buffer.from(data.toString().replaceAll('%BASE_URL%','/'));
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(data);
  }catch{res.writeHead(404).end('Not Found');}
});
await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const catalog=['postcard','image','clock','clock-lg','polaroid','dialog','duo','triple','photowall','ins','profile','stack','music','todo','calendar','countdown','note','social'];
let stage='init',passed=0;
const readLayout=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('ds_layout_v14')));
const visit=async(page,path)=>{
  const response=await page.goto(origin+path,{waitUntil:'load',timeout:30000});
  assert.equal(response?.status(),200);
};
const report=name=>{passed++;console.log('WIDGET_CATALOG_PASS '+name);};
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',deviceScaleFactor:2});
  const page=await context.newPage();
  await visit(page,'/index.html');
  const original=await readLayout(page);
  assert.ok(original&&original.v===14&&original.pages.length>=3);
  await visit(page,'/desktop/widgets.html');
  assert.equal(await page.locator('#widgetList .widget-item').count(),catalog.length,'catalog size changed');
  const originalIds=original.pages.flat().filter(id=>id.startsWith('app_')).sort();
  for(let i=0;i<catalog.length;i++){
    const id=catalog[i];
    stage='widget_'+id;
    await page.evaluate(layout=>localStorage.setItem('ds_layout_v14',JSON.stringify(layout)),original);
    await page.reload({waitUntil:'load'});
    const row=page.locator('#widgetList .widget-item').nth(i);
    const initiallyOn=original.pages.some(p=>p.includes(id));
    assert.equal(await row.locator('button.w-btn').innerText(),initiallyOn?'移除':'添加','catalog state mismatch '+id);
    if(initiallyOn){
      await row.locator('button.w-btn').click();
      const afterRemove=await readLayout(page);
      assert.ok(!afterRemove.pages.some(p=>p.includes(id))&&afterRemove.removed.includes(id));
    }
    await row.locator('button.w-btn').click();
    const afterAdd=await readLayout(page);
    assert.equal(afterAdd.pages.flat().filter(x=>x===id).length,1,'duplicate or missing '+id);
    assert.ok(!afterAdd.removed.includes(id),'added widget still removed '+id);
    assert.ok(afterAdd.pages.length<=4,'page count exceeded '+id);
    assert.deepEqual(afterAdd.pages.flat().filter(x=>x.startsWith('app_')).sort(),originalIds,'app tiles modified '+id);
    await visit(page,'/index.html');
    assert.equal(await page.locator('.desktop-grid > [data-drag="'+id+'"]').count(),1,'rendered widget missing '+id);
    const renderState=await readLayout(page);
    assert.equal(renderState.pages.flat().filter(x=>x===id).length,1,'reload lost widget '+id);
    await visit(page,'/desktop/widgets.html');
    await row.locator('button.w-btn').click();
    const removed=await readLayout(page);
    assert.ok(!removed.pages.some(p=>p.includes(id))&&removed.removed.includes(id),'remove after reload failed '+id);
    assert.deepEqual(removed.pages.flat().filter(x=>x.startsWith('app_')).sort(),originalIds,'remove touched app placement '+id);
    report(id);
  }
  stage='save_failure';
  await page.evaluate(layout=>localStorage.setItem('ds_layout_v14',JSON.stringify(layout)),original);
  await page.reload({waitUntil:'load'});
  const before=await page.evaluate(()=>localStorage.getItem('ds_layout_v14'));
  await page.evaluate(()=>{
    const save=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){
      if(k==='ds_layout_v14')throw new DOMException('QuotaExceededError','QuotaExceededError');
      return save.call(this,k,v);
    };
  });
  const row=page.locator('#widgetList .widget-item').nth(catalog.indexOf('polaroid'));
  await row.locator('button.w-btn').click();
  const after=await page.evaluate(()=>({saved:localStorage.getItem('ds_layout_v14'),status:document.querySelector('.page-note')?.textContent||'',button:document.querySelectorAll('#widgetList .widget-item')[4]?.querySelector('.w-btn')?.textContent}));
  assert.equal(after.saved,before,'failed write replaced persisted layout');
  assert.ok(after.status.includes('保存失败'),'failure was not disclosed');
  assert.equal(after.button,'添加','widget falsely shown as added');
  report('quota_failure_keeps_existing_layout');
  await context.close();
  console.log('WIDGET_CATALOG_ALL_PASS checks='+passed);
}catch(error){
  console.log('WIDGET_CATALOG_FAIL stage='+stage+' kind='+String(error.name||'Error').replace(/[^a-zA-Z]/g,''));
  throw error;
}finally{
  await browser.close();
  await new Promise(done=>server.close(done));
}
