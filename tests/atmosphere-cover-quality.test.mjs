import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const page=readFileSync(new URL('../chat/moments/my-moments.html',import.meta.url),'utf8');
const beginning=page.indexOf('    function compressCover(file, cb) {');
const ending=page.indexOf("    document.getElementById('coverInput').addEventListener",beginning);
assert.ok(beginning>0&&ending>beginning);
const source=page.slice(beginning,ending);

function fixture(preset,width=2400,outputSize=()=>120000){
 const calls=[],errors=[];
 const shell={getAttribute:key=>key==='data-chat-theme-preset'?preset:null};
 const doc={
  querySelector:q=>q==='.phone-mockup'?shell:null,
  createElement:tag=>{
   assert.equal(tag,'canvas');
   const canvas={width:0,height:0,getContext(){
    return {imageSmoothingEnabled:false,imageSmoothingQuality:'low',
     drawImage:(img,x,y,w,h)=>{calls.push({width:w,height:h,quality:null});}};
   },toDataURL(type,quality){
    assert.equal(type,'image/jpeg');
    const latest=calls[calls.length-1];latest.quality=quality;
    return 'data:image/jpeg;base64,'+'A'.repeat(outputSize(canvas.width,quality));
   }};
   return canvas;
  }
 };
 class Reader{readAsDataURL(){this.onload({target:{result:'data:image/png;base64,AAAA'}});}}
 class Image{
  constructor(){this.width=width;this.height=Math.round(width*2/3);}
  set src(v){this.onload();}
 }
 const encoder=runInNewContext('(function(){'+source+'return compressCover;})()',
  {document:doc,FileReader:Reader,Image,alert:msg=>errors.push(msg)});
 let data=null;
 encoder({type:'image/png'},result=>{data=result;});
 return {calls,errors,data};
}
test('atmosphere preferentially preserves 1280px cover clarity within budget',()=>{
 const h=fixture('atmosphere');
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].width,1280);
 assert.equal(h.calls[0].quality,0.86);
 assert.equal(h.calls[0].height,853);
 assert.ok(h.data.startsWith('data:image/jpeg;base64,'));
 assert.deepEqual(h.errors,[]);
});
test('large photo automatically steps down before storing oversized base64',()=>{
 const h=fixture('atmosphere',2400,w=>w>1024?670000:400000);
 assert.equal(h.calls.length,2);
 assert.deepEqual(h.calls.map(c=>c.width),[1280,1024]);
 assert.deepEqual(h.calls.map(c=>c.quality),[0.86,0.82]);
 assert.ok(h.data.length<=640000);
});
test('other themes preserve the original one-pass 600px JPEG .7 behavior',()=>{
 const h=fixture('wechat');
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].width,600);
 assert.equal(h.calls[0].quality,0.7);
 const fallback=fixture('default');
 assert.equal(fallback.calls.length,1);
 assert.equal(fallback.calls[0].width,600);
});
test('tiny photos are not artificially upscaled and separate cover storage is unchanged',()=>{
 const h=fixture('atmosphere',320);
 assert.equal(h.calls[0].width,320);
 assert.equal(h.calls[0].height,213);
 assert.match(page,/var MY_HOME_COVER_KEY = 'my_home_cover_v1'/);
 assert.match(page,/if \(!saveMyHomeCover\(dataUrl\)\) return;/);
 assert.doesNotMatch(source,/localStorage|indexedDB|myProfile\.cover/);
});
