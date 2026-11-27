/** Test IDB migration, upload ACK and rollback for desktop image/social widgets. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('.');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
const srv=createServer(async(req,res)=>{
  try{
    let name=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
    if(name==='/')name='/index.html';
    if(name==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=resolve(root,'.'+name);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    let body=await readFile(file);
    if(extname(file)==='.html')body=Buffer.from(body.toString().replaceAll('%BASE_URL%','/'));
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}).end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise((done,fail)=>{srv.once('error',fail);srv.listen(0,'127.0.0.1',done);});
const browser=await chromium.launch({headless:true});
const url='http://127.0.0.1:'+srv.address().port+'/index.html';
const photoIds=['avatar','p1','p2'];
let passed=0,stage='start';
const mark=s=>{passed++;console.log('PHOTO_SAFETY_PASS '+s);};
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(url,{waitUntil:'load'});
  assert.equal(response.status(),200);
  const originalLayout=await page.evaluate(()=>localStorage.getItem('ds_layout_v14'));
  const make=async(hex)=>page.evaluate(color=>{
    const c=document.createElement('canvas');c.width=24;c.height=24;
    const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,24,24);
    return c.toDataURL('image/png');
  },hex);
  const old=await make('#202020');
  stage='legacy-migration';
  await page.evaluate(image=>{
    const legacy={name:'QA-SOCIAL',city:'QA-CITY',temp:'12°',cond:'晴',friends:'9',followers:'8',likes:'7',avatar:image,p1:image,p2:image};
    localStorage.setItem('ds_social_v1',JSON.stringify(legacy));
    localStorage.setItem('ds_image_v1',JSON.stringify({img:image}));
  },old);
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(async()=>{
    const store=window.MAOMAOWallpaperStore;
    const keys=['home_widget_photo_v2_social_avatar','home_widget_photo_v2_social_p1','home_widget_photo_v2_social_p2','home_widget_photo_v2_image_single'];
    return (await Promise.all(keys.map(key=>store.getByKey(key)))).every(x=>x&&x.startsWith('data:image/'));
  },null,{timeout:15000});
  const legacy=await page.evaluate(()=>{
    const a=JSON.parse(localStorage.getItem('ds_social_v1')||'{}'),b=JSON.parse(localStorage.getItem('ds_image_v1')||'{}');
    return {text:a.name,city:a.city,images:[a.avatar,a.p1,a.p2].filter(Boolean).length,imageLegacy:!!b.img,style:document.querySelector('[data-drag="image"]').style.backgroundImage};
  });
  assert.equal(legacy.text,'QA-SOCIAL');
  assert.equal(legacy.city,'QA-CITY');
  assert.equal(legacy.images,0,'legacy photo data still bloats social metadata');
  assert.equal(legacy.imageLegacy,false,'legacy standalone image still bloats localStorage');
  assert.ok(legacy.style.includes('data:image'),'migrated image not displayed');
  mark('legacy_migrates_without_losing_text');
  stage='upload-success';
  const upload=await make('#b1b1b1');
  async function chooseSocial(id){
    await page.evaluate(async({id,image})=>{
      const blob=await (await fetch(image)).blob();
      const f=new File([blob],'synthetic.png',{type:'image/png'});
      const dt=new DataTransfer();dt.items.add(f);
      const selectors={avatar:'#scAvatar .sc-file',p1:'#scP1 .sc-file',p2:'#scP2 .sc-file'};
      const input=document.querySelector(selectors[id]);
      if(!input)throw new Error('Missing social upload input '+id);
      Object.defineProperty(input,'files',{configurable:true,value:dt.files});
      input.dispatchEvent(new Event('change',{bubbles:true}));
    },{id,image:upload});
  }
  async function chooseImage(){
    await page.evaluate(async(image)=>{
      const blob=await (await fetch(image)).blob();
      const f=new File([blob],'synthetic.png',{type:'image/png'});
      const dt=new DataTransfer();dt.items.add(f);
      let picker=null;const oldClick=HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click=function(){
        if(this.type==='file'){picker=this;return;}
        return oldClick.call(this);
      };
      try{document.querySelector('[data-drag="image"]').click();}
      finally{HTMLInputElement.prototype.click=oldClick;}
      if(!picker)throw new Error('Image widget did not open picker');
      Object.defineProperty(picker,'files',{configurable:true,value:dt.files});
      picker.dispatchEvent(new Event('change',{bubbles:true}));
    },upload);
  }
  for(const id of photoIds)await chooseSocial(id);
  await chooseImage();
  await page.waitForFunction(async()=>{
    const store=window.MAOMAOWallpaperStore;
    const ids=['home_widget_photo_v2_social_avatar','home_widget_photo_v2_social_p1','home_widget_photo_v2_social_p2','home_widget_photo_v2_image_single'];
    return (await Promise.all(ids.map(id=>store.getByKey(id)))).every(x=>x.startsWith('data:image/jpeg'));
  },null,{timeout:15000});
  const dataBefore=await page.evaluate(async()=>{
    const keys=['home_widget_photo_v2_social_avatar','home_widget_photo_v2_social_p1','home_widget_photo_v2_social_p2','home_widget_photo_v2_image_single'];
    return Promise.all(keys.map(key=>window.MAOMAOWallpaperStore.getByKey(key)));
  });
  await page.reload({waitUntil:'load'});
  const restored=await page.evaluate(()=>({
    card:[...document.querySelectorAll('#scAvatar .sc-photo-inner,#scP1 .sc-p-photo,#scP2 .sc-p-photo')].every(el=>el.style.backgroundImage.includes('data:image')),
    image:document.querySelector('[data-drag="image"]').style.backgroundImage.includes('data:image'),
    layout:localStorage.getItem('ds_layout_v14')
  }));
  assert.ok(restored.card&&restored.image,'uploaded photos did not survive reload');
  assert.equal(restored.layout,originalLayout,'photo upload mutated desktop layout');
  mark('four_uploads_stored_then_restored');
  stage='failed-save';
  await page.evaluate(()=>{
    const store=window.MAOMAOWallpaperStore;
    store.saveByKey=function(){return Promise.reject(new Error('Synthetic quota failure'));};
  });
  const styleBefore=await page.evaluate(()=>document.querySelector('#scAvatar .sc-photo-inner').style.backgroundImage);
  await chooseSocial('avatar');
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('照片保存失败'),null,{timeout:12000});
  const afterFailure=await page.evaluate(async()=>({
    image:await window.MAOMAOWallpaperStore.getByKey('home_widget_photo_v2_social_avatar'),
    style:document.querySelector('#scAvatar .sc-photo-inner').style.backgroundImage,
    layout:localStorage.getItem('ds_layout_v14')
  }));
  assert.equal(afterFailure.image,dataBefore[0],'failed write replaced authoritative photo');
  assert.equal(afterFailure.style,styleBefore,'failed write visually pretended success');
  assert.equal(afterFailure.layout,originalLayout);
  mark('quota_failure_retains_saved_photo_and_layout');
  assert.deepEqual(errors,[],'uncaught page errors');
  await context.close();
  console.log('PHOTO_SAFETY_ALL_PASS checks='+passed);
}catch(e){
  console.log('PHOTO_SAFETY_FAIL stage='+stage+' kind='+String(e.name||'Error').replace(/[^a-zA-Z]/g,''));
  throw e;
}finally{
  await browser.close();
  await new Promise(done=>srv.close(done));
}
