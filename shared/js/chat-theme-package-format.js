/* MAOMAO Chat Theme Package Format v1 — ZIP reader, schema validation and CSS scoping. */
(function(root,factory){
  var api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.MAOMAOChatThemeFormat=api;
})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  var FORMAT="MAOMAO_CHAT_THEME",VERSION=1,MAX=48*1024*1024,MAX_FILE=16*1024*1024;
  var COMPONENTS={
    chatList:["statusBar","listHeader","coverSpacer","profileStage","musicCard","conversationList","bottomNav"],
    chatDetail:["detailStatus","detailHeader","detailMenu","messageStage","timeSeparator","receivedBubble","sentBubble","avatar","quoteBar","inputDock","morePanel"]
  };
  var RULES={
    "nav-collapse-scroll":1,"nav-hide-scroll":1,"nav-elastic-tap":1,
    "message-enter":1,"sheet-rise":1,"bubble-press":1
  };
  var PROPS={
    background:1,color:1,opacity:1,blur:1,radius:1,padding:1,margin:1,gap:1,height:1,width:1,
    fontSize:1,fontWeight:1,lineHeight:1,fontFamily:1,letterSpacing:1,textAlign:1,borderWidth:1,
    borderColor:1,borderStyle:1,zIndex:1,transform:1,display:1,position:1,order:1,shadow:1
  };
  var TARGETS={
    statusBar:".status-bar",listHeader:".chat-theme-header,.wechat-home-header",coverSpacer:".cover-spacer",
    profileStage:".white-profile-stage",musicCard:".floating-music-card",conversationList:"#chatListContainer",
    bottomNav:".floating-nav",detailStatus:".status-bar",detailHeader:".chat-header",detailMenu:".chat-header-actions",
    messageStage:"#chat-messages",timeSeparator:".message-time",receivedBubble:".msg-row.received .msg-bubble",
    sentBubble:".msg-row.sent .msg-bubble",avatar:".msg-avatar",quoteBar:"#quoteBar",inputDock:".input-dock,.input-capsule",
    morePanel:".plus-panel-sheet"
  };
  var enc=typeof TextEncoder!=="undefined"?new TextEncoder():null;
  var dec=typeof TextDecoder!=="undefined"?new TextDecoder("utf-8",{fatal:true}):null;
  function fail(message){throw new Error(message)}
  function own(o,k){return Object.prototype.hasOwnProperty.call(o,k)}
  function crc32(bytes){var c=0xffffffff;for(var i=0;i<bytes.length;i++){c^=bytes[i];for(var j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
  function parseStoredZip(input){
    var bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.length>MAX)fail("主题包超过 48 MB。");
    if(bytes.length<22)fail("文件不是有效的主题 ZIP 包。");
    var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=Object.create(null),offset=0,total=0,count=0;
    while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
      var flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true),crc=view.getUint32(offset+14,true);
      var size=view.getUint32(offset+18,true),rawSize=view.getUint32(offset+22,true),nameLen=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
      if(flags&1)fail("不支持加密 ZIP。");
      if(flags&8)fail("ZIP 文件尺寸信息不完整。");
      if(flags&~0x0800)fail("ZIP 标志不受支持。");
      if(method!==0||size!==rawSize)fail("请使用工作台导出的标准主题包。");
      if(rawSize>MAX_FILE)fail("单个主题文件超过 16 MB。");
      var nameStart=offset+30,dataStart=nameStart+nameLen+extra,dataEnd=dataStart+size;
      if(!nameLen||dataEnd>bytes.length)fail("主题 ZIP 内容不完整。");
      var name;try{name=dec?dec.decode(bytes.subarray(nameStart,nameStart+nameLen)):String.fromCharCode.apply(null,bytes.subarray(nameStart,nameStart+nameLen))}catch(e){fail("主题文件名编码错误。")}
      if(name.charAt(0)==="/"||name.indexOf("\\")>=0||name.split("/").indexOf("..")>=0||/^[A-Za-z]:/.test(name))fail("主题包包含不安全路径。");
      var data=bytes.slice(dataStart,dataEnd);
      if(crc32(data)!==crc)fail("主题文件校验失败："+name);
      if(name.slice(-1)!=="/"){if(own(files,name))fail("主题包存在重复文件："+name);files[name]=data;total+=data.length;count++;if(total>MAX||count>120)fail("主题文件数量或体积超出限制。")}
      offset=dataEnd;
    }
    if(!count)fail("没有读取到主题文件。");
    return files;
  }
  function text(bytes,label){try{return dec?dec.decode(bytes):String.fromCharCode.apply(null,bytes)}catch(e){fail((label||"文件")+"不是有效 UTF-8。")}}
  function safeAssetPath(path){return typeof path==="string"&&/^assets\/[A-Za-z0-9_.\-\u4e00-\u9fff ]{1,150}$/.test(path)&&path.indexOf("..")<0}
  function validateCss(css){
    css=String(css||"");
    if(enc&&enc.encode(css).length>512*1024)fail("CSS 超过 512 KB。");
    var bad=[/@import\b/i,/expression\s*\(/i,/javascript\s*:/i,/(?:^|[;{\s])behavior\s*:/i,/-moz-binding\s*:/i,/url\s*\(\s*["']?\s*(?:https?:|\/\/|file:|blob:|filesystem:)/i,/@namespace\b/i,/(?:^|[;{\s])position\s*:\s*fixed\b/i];
    if(bad.some(function(re){return re.test(css)}))fail("CSS 包含不允许的远程引用或危险声明。");
    var depth=0,quote="",comment=false,escape=false;
    for(var i=0;i<css.length;i++){var c=css.charAt(i),n=css.charAt(i+1);
      if(comment){if(c==="*"&&n==="/"){comment=false;i++}continue}
      if(!quote&&c==="/"&&n==="*"){comment=true;i++;continue}
      if(escape){escape=false;continue}if(c==="\\"){escape=true;continue}
      if(quote){if(c===quote)quote="";continue}if(c==='"'||c==="'"){quote=c;continue}
      if(c==="{")depth++;if(c==="}")depth--;if(depth<0)fail("CSS 花括号不匹配。")
    }
    if(depth!==0||quote||comment)fail("CSS 结构不完整。");
    var re=/url\s*\(\s*(["']?)(.*?)\1\s*\)/gi,m;
    while((m=re.exec(css))){var u=String(m[2]||"").trim();if(!safeAssetPath(u)&&!/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(u))fail("CSS 图片与字体只能引用主题 assets/ 素材。")}
    return css;
  }
  function cleanValue(v){if(typeof v==="number")return Number.isFinite(v)?v:null;if(typeof v==="boolean")return v;var s=String(v==null?"":v).trim();if(!s||/[;{}<>]|url\s*\(|expression\s*\(|javascript\s*:/i.test(s))return null;return s.slice(0,220)}
  function clamp(v,min,max,fb){var n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fb}
  function declarations(style){
    var out=[];
    Object.keys(PROPS).forEach(function(k){if(style[k]==null)return;var v=cleanValue(style[k]);if(v==null)return;
      if(k==="opacity")v=String(clamp(v,0,100,100)>1?clamp(v,0,100,100)/100:clamp(v,0,1,1));
      if(k==="blur")v="blur("+clamp(v,0,80,0)+"px)";
      if(["radius","padding","margin","gap","height","fontSize","borderWidth","letterSpacing"].indexOf(k)>=0&&typeof v==="number")v+= "px";
      if(k==="width"&&typeof v==="number")v+="%";
      if(k==="order")v=String(clamp(v,-100,100,0));
      if(k==="position"&&v==="fixed")return;
      if(k==="shadow"){var shadows={soft:"0 2px 12px rgba(0,0,0,.06)",medium:"0 5px 18px rgba(0,0,0,.10)",deep:"0 10px 28px rgba(0,0,0,.16)"};if(shadows[v])out.push("box-shadow:"+shadows[v]+" !important");return}
      var map={blur:"backdrop-filter"};var prop=map[k]||k.replace(/[A-Z]/g,function(c){return"-"+c.toLowerCase()});out.push(prop+":"+v+" !important");
    });
    return out.join(";");
  }
  function scopeCss(css,prefix){
    css=validateCss(css);
    return css.replace(/(^|[{}])(\s*)([^@{}][^{}]*)\{/g,function(all,close,space,selectors){
      var list=selectors.split(",").map(function(sel){
        sel=sel.trim();if(!sel)return"";
        if(/^(from|to|\d+(?:\.\d+)?%)$/.test(sel))return sel;
        if(/^(html|body|:root)\b/.test(sel))sel=sel.replace(/^(html|body|:root)/,prefix);
        else if(sel.indexOf(prefix)!==0)sel=prefix+" "+sel;
        return sel;
      });
      return close+space+list.join(",")+"{";
    });
  }
  function stylesToCss(theme){
    var out=[],prefix='.phone-mockup[data-maomao-chat-theme-active="1"]';
    ["chatList","chatDetail"].forEach(function(page){
      var styles=theme.styles&&theme.styles[page]||{},blocks=Array.isArray(theme.blocks&&theme.blocks[page])?theme.blocks[page]:[];
      Object.keys(styles).forEach(function(id){
        var decl=declarations(styles[id]||{}),sel=TARGETS[id]||'[data-maomao-theme-block="'+id+'"]';
        if(decl)out.push(sel.split(",").map(function(x){return prefix+" "+x.trim()}).join(",")+"{"+decl+"}");
      });
      (Array.isArray(theme.layerOrder&&theme.layerOrder[page])?theme.layerOrder[page]:[]).forEach(function(id,i){
        var sel=TARGETS[id]||'[data-maomao-theme-block="'+id+'"]';
        out.push(sel.split(",").map(function(x){return prefix+" "+x.trim()}).join(",")+"{order:"+i+" !important}");
      });
      blocks.forEach(function(block,i){
        if(block&&typeof block.id==="string")out.push(prefix+' [data-maomao-theme-block="'+block.id+'"]{order:'+i+' !important}');
      });
    });
    return out.join("\n");
  }
  function normalize(theme,files,manifest){
    if(!theme||theme.format!==FORMAT||theme.schemaVersion!==VERSION||theme.target!=="maomao-chat")fail("theme.json 格式或目标不兼容。");
    if(typeof theme.name!=="string"||!theme.name||theme.name.length>80)fail("主题名称无效。");
    if(!theme.pages||!Array.isArray(theme.pages.chatList)||!Array.isArray(theme.pages.chatDetail))fail("主题必须同时包含聊天列表和聊天详情布局。");
    var assets=Object.create(null),paths=[];
    if(theme.assetIndex!=null&&!Array.isArray(theme.assetIndex))fail("主题素材清单格式无效。");
    (Array.isArray(theme.assetIndex)?theme.assetIndex:[]).forEach(function(a){if(!a||!safeAssetPath(a.path)||!files[a.path]||own(assets,a.path))fail("主题素材缺失或路径无效。");
      if(!/^(image\/(png|jpeg|webp|gif)|font\/(woff|woff2|ttf|otf)|application\/octet-stream)$/i.test(a.mimeType||""))fail("主题素材类型不支持。");
      assets[a.path]={bytes:files[a.path],name:String(a.name||a.path.split("/").pop()),mimeType:a.mimeType,type:a.type||"file"};paths.push(a.path)
    });
    Object.keys(files).forEach(function(p){if(p.indexOf("assets/")===0&&!own(assets,p))fail("存在未登记素材："+p);if(["manifest.json","theme.json","custom.css"].indexOf(p)<0&&p.indexOf("assets/")!==0)fail("未知主题文件："+p)});
    var cleanPages={chatList:[],chatDetail:[]},ids={chatList:[],chatDetail:[]};
    ["chatList","chatDetail"].forEach(function(page){cleanPages[page]=theme.pages[page].slice(0,80).filter(function(x){var ok=x&&typeof x.id==="string"&&(COMPONENTS[page].indexOf(x.id)>=0||x.id.indexOf("custom-")===0);if(ok&&!ids[page].includes(x.id))ids[page].push(x.id);return ok}).map(function(x){return{id:x.id,name:String(x.name||x.id).slice(0,80),type:COMPONENTS[page].indexOf(x.id)>=0?"core":"custom",visible:x.visible!==false}});
      (Array.isArray(theme.blocks&&theme.blocks[page])?theme.blocks[page]:[]).forEach(function(b){if(b&&typeof b.id==="string"&&!ids[page].includes(b.id))ids[page].push(b.id)})
    });
    var clean={format:FORMAT,schemaVersion:VERSION,target:"maomao-chat",id:String(theme.id||"chat-theme").slice(0,120),name:theme.name,version:String(theme.version||"1.0.0"),pages:cleanPages,styles:{chatList:{},chatDetail:{}},blocks:{chatList:[],chatDetail:[]},layerOrder:{chatList:[],chatDetail:[]},motions:[],assetIndex:[]};
    ["chatList","chatDetail"].forEach(function(page){Object.keys(theme.styles&&theme.styles[page]||{}).forEach(function(id){if(!ids[page].includes(id))return;var st={};Object.keys(PROPS).forEach(function(k){var v=cleanValue(theme.styles[page][id][k]);if(v!==null&&v!==undefined)st[k]=v});clean.styles[page][id]=st});
      clean.blocks[page]=(Array.isArray(theme.blocks&&theme.blocks[page])?theme.blocks[page]:[]).slice(0,40).filter(function(b){return b&&typeof b.id==="string"&&ids[page].includes(b.id)}).map(function(b){var t=["card","text","image","divider"].indexOf(b.type)>=0?b.type:"card";return{id:b.id,type:t,title:String(b.title||"").slice(0,160),text:String(b.text||"").slice(0,2000),assetPath:paths.indexOf(b.assetPath)>=0?b.assetPath:"",slot:String(b.slot||"").slice(0,40),visible:b.visible!==false}});
      clean.layerOrder[page]=(Array.isArray(theme.layerOrder&&theme.layerOrder[page])?theme.layerOrder[page]:[]).filter(function(id){return ids[page].includes(id)}).slice(0,120)
    });
    var seen={};clean.motions=(theme.motions||[]).slice(0,20).filter(function(m){return m&&RULES[m.id]&&!seen[m.id]&&(seen[m.id]=1)}).map(function(m){return Object.assign({},m,{enabled:m.enabled===true,duration:clamp(m.duration,80,1600,260),threshold:clamp(m.threshold,0,240,20),compactScale:clamp(m.compactScale,.55,1,.86),compactHeight:clamp(m.compactHeight,24,72,38),scale:clamp(m.scale,.75,1.3,1.1),lift:clamp(m.lift,0,16,4),distance:clamp(m.distance,0,40,8)})});
    clean.assetIndex=paths.map(function(p){var a=assets[p];return{path:p,name:a.name,mimeType:a.mimeType,type:a.type}});
    return{manifest:manifest,theme:clean,customCss:validateCss(files["custom.css"]?text(files["custom.css"],"custom.css"):""),assets:assets};
  }
  function readPackage(files){
    if(!files["manifest.json"]||!files["theme.json"])fail("主题包必须包含 manifest.json 与 theme.json。");
    var manifest,theme;try{manifest=JSON.parse(text(files["manifest.json"],"manifest.json"));theme=JSON.parse(text(files["theme.json"],"theme.json"))}catch(e){fail("主题清单格式错误。")}
    if(!manifest||manifest.format!==FORMAT||manifest.schemaVersion!==VERSION||manifest.target!=="maomao-chat")fail("该主题包不适用于 MAOMAO 聊天模块。");
    return normalize(theme,files,manifest);
  }
  function buildScopedCss(theme,css){return stylesToCss(theme)+"\n"+scopeCss(css||" ",'.phone-mockup[data-maomao-chat-theme-active="1"]')}
  return{FORMAT:FORMAT,VERSION:VERSION,COMPONENTS:COMPONENTS,MOTION_RULES:RULES,parseStoredZip:parseStoredZip,readPackage:readPackage,validateCss:validateCss,scopeCss:scopeCss,stylesToCss:stylesToCss,buildScopedCss:buildScopedCss,safeAssetPath:safeAssetPath};
});
