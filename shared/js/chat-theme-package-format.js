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
  function safeCustomId(id){return typeof id==="string"&&/^custom-[A-Za-z0-9_-]{1,64}$/.test(id)}
  function safeAssetPath(path){return typeof path==="string"&&/^assets\/[A-Za-z0-9_.\-\u4e00-\u9fff ]{1,150}$/.test(path)&&path.indexOf("..")<0}
  function decodeCssEscape(css,index){
    var i=index+1;
    if(i>=css.length)fail("CSS 转义序列不完整。");
    var c=css.charAt(i);
    if(c==="\n")return{value:"",next:i+1};
    if(c==="\r")return{value:"",next:css.charAt(i+1)==="\n"?i+2:i+1};
    if(c==="\f")return{value:"",next:i+1};
    if(/[0-9a-f]/i.test(c)){
      var begin=i;
      while(i<css.length&&i-begin<6&&/[0-9a-f]/i.test(css.charAt(i)))i++;
      var point=parseInt(css.slice(begin,i),16);
      if(css.charAt(i)===" "||css.charAt(i)==="\t"||css.charAt(i)==="\n"||css.charAt(i)==="\r"||css.charAt(i)==="\f"){
        if(css.charAt(i)==="\r"&&css.charAt(i+1)==="\n")i+=2;
        else i++;
      }
      if(!point||point>0x10ffff||(point>=0xd800&&point<=0xdfff))point=0xfffd;
      if(point<=0xffff)return{value:String.fromCharCode(point),next:i};
      point-=0x10000;
      return{value:String.fromCharCode(0xd800+(point>>10),0xdc00+(point&1023)),next:i};
    }
    return{value:c,next:i+1};
  }
  function normalizeCssForSafety(css){
    var code="",strings=[],brace=0,paren=0,bracket=0,i=0;
    while(i<css.length){
      var c=css.charAt(i),n=css.charAt(i+1);
      if(c==="/"&&n==="*"){
        var close=css.indexOf("*/",i+2);
        if(close<0)fail("CSS 注释没有闭合。");
        i=close+2;
        continue;
      }
      if(c==="\""||c==="'"){
        var quote=c,value="",closed=false;
        i++;
        while(i<css.length){
          c=css.charAt(i);
          if(c==="\\"){
            var stringEscape=decodeCssEscape(css,i);
            value+=stringEscape.value;
            i=stringEscape.next;
            continue;
          }
          if(c===quote){closed=true;i++;break}
          if(c==="\n"||c==="\r"||c==="\f")fail("CSS 字符串包含未转义换行。");
          value+=c;
          i++;
        }
        if(!closed)fail("CSS 字符串没有闭合。");
        var token="\u0001"+strings.length+"\u0002";
        strings.push(value);
        code+=token;
        continue;
      }
      if(c==="\\"){
        var escaped=decodeCssEscape(css,i),decoded=escaped.value;
        if(decoded&&(!/^[A-Za-z0-9_-]$/.test(decoded)&&decoded.charCodeAt(0)<128||/\s/u.test(decoded))){
          fail("CSS 不允许用转义字符改写结构符号或分隔符。");
        }
        code+=decoded;
        i=escaped.next;
        continue;
      }
      if(c==="{"){brace++;code+=c;i++;continue}
      if(c==="}"){brace--;if(brace<0)fail("CSS 花括号不匹配。");code+=c;i++;continue}
      if(c==="("){paren++;code+=c;i++;continue}
      if(c===")"){paren--;if(paren<0)fail("CSS 圆括号不匹配。");code+=c;i++;continue}
      if(c==="["){bracket++;code+=c;i++;continue}
      if(c==="]"){bracket--;if(bracket<0)fail("CSS 方括号不匹配。");code+=c;i++;continue}
      code+=c;
      i++;
    }
    if(brace!==0||paren!==0||bracket!==0)fail("CSS 结构不完整或括号不匹配。");
    return{code:code,strings:strings};
  }
  function validateCss(css){
    css=String(css||"");
    if(enc&&enc.encode(css).length>512*1024)fail("CSS 超过 512 KB。");
    var normalized=normalizeCssForSafety(css);
    var code=normalized.code.replace(/\u0001\d+\u0002/g," ");
    var bad=[
      /@import\b/i,
      /expression\s*\(/i,
      /javascript\s*:/i,
      /(?:^|[;{])\s*behavior\s*:/i,
      /(?:^|[;{])\s*-moz-binding\s*:/i,
      /(?:^|[;{])\s*position\s*:\s*fixed\b/i,
      /@namespace\b/i,
      /@(?:-webkit-)?keyframes\b/i,
      /(?:-webkit-)?image-set\s*\(/i
    ];
    if(bad.some(function(re){return re.test(code)}))fail("CSS 包含不允许的远程引用或危险声明。");
    var atRule=/@([A-Za-z_-][A-Za-z0-9_-]*)/gi,atMatch,allowedAtRules={media:1,supports:1,container:1,"font-face":1};
    while((atMatch=atRule.exec(code))){
      if(!allowedAtRules[atMatch[1].toLowerCase()])fail("CSS at-rule 不在聊天主题安全白名单中："+atMatch[0]);
    }
    var re=/url\s*\(\s*(?:\u0001(\d+)\u0002|([^)]*?))\s*\)/gi,m;
    while((m=re.exec(normalized.code))){
      var u=m[1]!==undefined?String(normalized.strings[Number(m[1])]||"").trim():String(m[2]||"").trim();
      if(!safeAssetPath(u)&&!/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(u)){
        fail("CSS 图片与字体只能引用主题 assets/ 素材。");
      }
    }
    return css;
  }
  function cleanValue(v,propertyName){
    if(typeof v==="number")return Number.isFinite(v)?v:null;
    if(typeof v==="boolean")return v;
    var s=String(v==null?"":v).trim();
    if(!s||/[;{}<>]/.test(s))return null;
    var property=String(propertyName||"value").replace(/[A-Z]/g,function(c){return"-"+c.toLowerCase()});
    try{validateCss(".maomao-theme-value{"+property+":"+s+"}")}catch(e){return null}
    return s.slice(0,220)
  }
  function clamp(v,min,max,fb){var n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fb}
  function declarations(style){
    var out=[];
    Object.keys(PROPS).forEach(function(k){if(style[k]==null)return;var v=cleanValue(style[k],k);if(v==null)return;
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
  function quoteCssString(value){
    return "\""+String(value).replace(/\\/g,"\\\\").replace(/"/g,"\\\"").replace(/\n/g,"\\a ").replace(/\r/g,"\\d ").replace(/\f/g,"\\c ")+"\"";
  }
  function namespaceFontFamilies(css,themeId){
    var normalized=normalizeCssForSafety(String(css||"")),code=normalized.code,strings=normalized.strings,map=Object.create(null);
    if(!/@font-face\\b/i.test(code))return css;
    var namespace=String(themeId||"package").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,48)||"package";
    function familyToken(family){
      return Array.from(family).map(function(ch){return ch.codePointAt(0).toString(16)}).join("_").slice(0,128)||"font";
    }
    var face=/@font-face\s*\{([^{}]*)\}/gi,match;
    while((match=face.exec(code))){
      var familyMatch=/font-family\s*:\s*(?:\u0001(\d+)\u0002|([A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*))\s*;/i.exec(match[1]);
      if(!familyMatch)fail("@font-face 必须指定有效的 font-family。");
      if((match[1].match(/font-family\\s*:/gi)||[]).length!==1)fail("@font-face 只能声明一个 font-family。");
      var family=String(familyMatch[1]!==undefined?strings[Number(familyMatch[1])]:familyMatch[2]||"").trim();
      if(!family||family.length>100||/[,;{}]/.test(family))fail("@font-face 的 font-family 名称无效。");
      if(!own(map,family))map[family]="MAOMAOChatTheme_"+namespace+"_"+familyToken(family);
    }
    if(!Object.keys(map).length)return css;
    code=code.replace(/\bfont-family\s*:\s*([^;}]+)/gi,function(all,value){
      var important=/\s*!important\s*$/i.exec(value);
      var raw=important?value.slice(0,important.index):value;
      var parts=raw.split(",").map(function(part){
        var token=part.trim(),stringToken=/^\u0001(\d+)\u0002$/.exec(token);
        var family=String(stringToken?strings[Number(stringToken[1])]:token).trim();
        if(own(map,family)){
          if(stringToken)strings[Number(stringToken[1])]=map[family];
          else return map[family];
        }
        return token;
      });
      return "font-family:"+parts.join(", ")+(important?" !important":"");
    });
    return code.replace(/\u0001(\d+)\u0002/g,function(all,index){return quoteCssString(strings[Number(index)]||"")});
  }
  function scopeCss(css,prefix){
    css=validateCss(css);
    return css.replace(/(^|[{}])(\s*)([^@{}][^{}]*)\{/g,function(all,close,space,selectors){
      var list=selectors.split(",").map(function(sel){
        sel=sel.trim();if(!sel)return"";
        if(/^(from|to|\d+(?:\.\d+)?%)$/.test(sel))return sel;
        if(/^(html|body|:root)\b/.test(sel))sel=sel.replace(/^(html|body|:root)/,prefix);
        else if(sel.indexOf(".phone-mockup")===0)sel=sel.replace(/^\.phone-mockup/,prefix);
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
      (theme.pages&&theme.pages[page]||[]).forEach(function(item){
        if(item&&item.visible===false){
          var hidden=TARGETS[item.id]||'[data-maomao-theme-block="'+item.id+'"]';
          out.push(hidden.split(",").map(function(x){return prefix+" "+x.trim()}).join(",")+"{display:none !important}");
        }
      });
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
    ["chatList","chatDetail"].forEach(function(page){cleanPages[page]=theme.pages[page].slice(0,80).filter(function(x){var ok=x&&typeof x.id==="string"&&(COMPONENTS[page].indexOf(x.id)>=0||safeCustomId(x.id));if(ok&&!ids[page].includes(x.id))ids[page].push(x.id);return ok}).map(function(x){return{id:x.id,name:String(x.name||x.id).slice(0,80),type:COMPONENTS[page].indexOf(x.id)>=0?"core":"custom",visible:x.visible!==false}});
      (Array.isArray(theme.blocks&&theme.blocks[page])?theme.blocks[page]:[]).forEach(function(b){if(b&&safeCustomId(b.id)&&!ids[page].includes(b.id))ids[page].push(b.id)})
    });
    var clean={format:FORMAT,schemaVersion:VERSION,target:"maomao-chat",id:String(theme.id||"chat-theme").slice(0,120),name:theme.name,version:String(theme.version||"1.0.0"),pages:cleanPages,styles:{chatList:{},chatDetail:{}},blocks:{chatList:[],chatDetail:[]},layerOrder:{chatList:[],chatDetail:[]},motions:[],assetIndex:[]};
    ["chatList","chatDetail"].forEach(function(page){Object.keys(theme.styles&&theme.styles[page]||{}).forEach(function(id){if(!ids[page].includes(id))return;var st={};Object.keys(PROPS).forEach(function(k){var v=cleanValue(theme.styles[page][id][k],k);if(v!==null&&v!==undefined)st[k]=v});clean.styles[page][id]=st});
      clean.blocks[page]=(Array.isArray(theme.blocks&&theme.blocks[page])?theme.blocks[page]:[]).slice(0,40).filter(function(b){return b&&safeCustomId(b.id)&&ids[page].includes(b.id)}).map(function(b){var t=["card","text","image","divider"].indexOf(b.type)>=0?b.type:"card";return{id:b.id,type:t,title:String(b.title||"").slice(0,160),text:String(b.text||"").slice(0,2000),assetPath:paths.indexOf(b.assetPath)>=0?b.assetPath:"",slot:String(b.slot||"").slice(0,40),visible:b.visible!==false}});
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
  function buildScopedCss(theme,css){var combined=stylesToCss(theme)+"\n"+scopeCss(css||" ",'.phone-mockup[data-maomao-chat-theme-active="1"]');return namespaceFontFamilies(combined,theme&&theme.id)}
  return{FORMAT:FORMAT,VERSION:VERSION,COMPONENTS:COMPONENTS,MOTION_RULES:RULES,parseStoredZip:parseStoredZip,readPackage:readPackage,validateCss:validateCss,scopeCss:scopeCss,stylesToCss:stylesToCss,buildScopedCss:buildScopedCss,safeAssetPath:safeAssetPath};
});
