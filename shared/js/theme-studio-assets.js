/* THEME-STUDIO-002: image library adapter. Blobs live only in backed-up maomao-assets IDB.
   Values persisted in theme-studio v1 are validated assetIds (never base64/data URLs).
   Stable API: upload(file,slot), resolve(id), apply(shell,group,config); no cross-app effects. */
(function(global) {
  'use strict';
  var slots={
    'list.coverImage':{flag:'data-ts-list-cover',css:'--ts-list-cover-image'},
    'list.listImage':{flag:'data-ts-list-paper',css:'--ts-list-paper-image'},
    'detail.chatImage':{flag:'data-ts-detail-image',css:'--ts-detail-image'}
  };
  var leases=new WeakMap();
  var repo=null;
  function media(){
    if(!global.PhoneStorage || !global.PhoneStorage.MediaRepository) throw new Error('图片仓库未就绪');
    return repo || (repo=new global.PhoneStorage.MediaRepository());
  }
  function valid(id){return typeof id==='string'&&/^as_[A-Z2-7]{32}$/.test(id);}
  function decodeAndResize(file){
    return new Promise(function(resolve,reject){
      var src=URL.createObjectURL(file),img=new Image(),done=false;
      function close(){URL.revokeObjectURL(src);}
      img.onerror=function(){if(done)return;done=true;close();reject(new Error('图片无法读取，请换一张'));};
      img.onload=function(){
        if(done)return;done=true;close();
        try{
          var w=img.naturalWidth,h=img.naturalHeight;
          if(!w||!h||w*h>40000000)throw new Error('图片尺寸过大，请先缩小');
          var scale=Math.min(1,1600/Math.max(w,h));
          var canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
          var ctx=canvas.getContext('2d');
          if(!ctx)throw new Error('此浏览器暂不支持图片处理');
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          canvas.toBlob(function(blob){
            if(!blob||!blob.size||blob.size>3500000)reject(new Error('压缩图片失败或文件仍过大'));
            else resolve(blob);
          },'image/webp',.84);
        }catch(e){reject(e);}
      };
      img.src=src;
    });
  }
  function upload(file,slot){
    if(!slots[slot])return Promise.reject(new Error('未知的图片位置'));
    if(!file||!/^image\/(?:png|jpeg|webp)$/.test(file.type||''))return Promise.reject(new Error('请导入 PNG、JPG 或 WebP 图片'));
    if(file.size>8*1024*1024)return Promise.reject(new Error('原图片最多 8MB'));
    return decodeAndResize(file).then(function(blob){
      return media().putBlob(blob,{type:'image',mimeType:blob.type,
        ownerType:'theme-studio',ownerId:slot});
    }).then(function(result){
      if(!result || !result.ok || !valid(result.value && result.value.assetId))
        throw new Error('图片写入失败，请检查手机存储空间');
      return result.value.assetId;
    });
  }
  function resolve(id){
    if(!valid(id))return Promise.resolve(null);
    try{return media().toObjectUrl(id).then(function(result){
      return result && result.ok ? result.value : null;
    }).catch(function(){return null;});}
    catch(e){return Promise.resolve(null);}
  }
  function apply(shell,group,values){
    if(!shell||!shell.style)return;
    var map=leases.get(shell);
    if(!map){map={};leases.set(shell,map);}
    Object.keys(slots).forEach(function(slot){
      if(slot.indexOf(group+'.')!==0)return;
      var config=slots[slot],key=slot.split('.')[1],id=values&&values[key];
      var previous=map[slot];
      if(previous&&previous.id===id)return;
      if(previous&&previous.revoke)previous.revoke();
      var entry={id:id||'',generation:(previous?.generation||0)+1};
      map[slot]=entry;
      shell.removeAttribute(config.flag);
      shell.style.removeProperty(config.css);
      if(!valid(id))return;
      resolve(id).then(function(asset){
        if(map[slot]!==entry){if(asset)asset.revoke();return;}
        if(!asset)return;
        entry.revoke=asset.revoke;
        var safe=asset.url.replace(/["\\]/g,'');
        shell.style.setProperty(config.css,'url("'+safe+'")');
        shell.setAttribute(config.flag,'1');
      });
    });
  }
  global.MAOMAOThemeStudioAssets={SLOTS:slots,upload:upload,resolve:resolve,apply:apply,valid:valid};
})(window);
