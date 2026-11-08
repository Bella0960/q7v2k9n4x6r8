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
  var BLOCK_SLOTS={
    chatList:["top-of-content","after-header","above-profile","before-music","after-music","after-list","above-nav"],
    chatDetail:["before-header","after-header","before-messages","after-messages","before-input","after-input"]
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
  function encodeUtf8(value){
    var source=String(value);
    if(enc)return enc.encode(source);
    try{var encoded=unescape(encodeURIComponent(source)),out=new Uint8Array(encoded.length);for(var i=0;i<encoded.length;i++)out[i]=encoded.charCodeAt(i);return out}
    catch(e){fail("主题包文本包含无效 Unicode 字符。")}
  }
  function inputBytes(value){
    if(value instanceof Uint8Array)return value;
    if(typeof ArrayBuffer!=="undefined"&&value instanceof ArrayBuffer)return new Uint8Array(value);
    if(typeof ArrayBuffer!=="undefined"&&ArrayBuffer.isView&&ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    fail("主题素材必须提供二进制数据。")
  }
  function concatBytes(parts){
    var size=parts.reduce(function(total,part){return total+part.length},0),out=new Uint8Array(size),offset=0;
    parts.forEach(function(part){out.set(part,offset);offset+=part.length});
    return out;
  }
  function storedZip(entries){
    if(!Array.isArray(entries)||!entries.length||entries.length>120)fail("主题文件数量超出限制。");
    var names=Object.create(null),localParts=[],centralParts=[],offset=0,total=0;
    entries.forEach(function(entry){
      if(!entry||typeof entry.name!=="string"||!(entry.name==="manifest.json"||entry.name==="theme.json"||entry.name==="custom.css"||safeAssetPath(entry.name)))fail("主题包文件路径无效。");
      if(own(names,entry.name))fail("主题包存在重复文件："+entry.name);
      names[entry.name]=1;
      var name=encodeUtf8(entry.name),data=inputBytes(entry.data);
      if(name.length>65535)fail("主题文件名过长。");
      if(data.length>MAX_FILE)fail("单个主题文件超过 16 MB。");
      total+=data.length;if(total>MAX)fail("主题包超过 48 MB。");
      var crc=crc32(data),local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);lv.setUint16(8,0,true);
      lv.setUint16(10,0,true);lv.setUint16(12,0,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);
      lv.setUint16(26,name.length,true);lv.setUint16(28,0,true);local.set(name,30);
      var central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);
      cv.setUint16(10,0,true);cv.setUint16(12,0,true);cv.setUint16(14,0,true);cv.setUint32(16,crc,true);
      cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);
      cv.setUint16(30,0,true);cv.setUint16(32,0,true);cv.setUint16(34,0,true);cv.setUint16(36,0,true);
      cv.setUint32(38,0,true);cv.setUint32(42,offset,true);central.set(name,46);
      localParts.push(local,data);centralParts.push(central);offset+=local.length+data.length;
    });
    var centralSize=centralParts.reduce(function(n,part){return n+part.length},0),end=new Uint8Array(22),ev=new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);
    ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);ev.setUint32(12,centralSize,true);
    ev.setUint32(16,offset,true);ev.setUint16(20,0,true);
    var archive=concatBytes(localParts.concat(centralParts,[end]));
    if(archive.length>MAX)fail("导出的主题包超过 48 MB。");
    return archive;
  }
  function createPackage(theme,css,assetData){
    if(!theme||typeof theme!=="object")fail("主题数据无效。");
    assetData=assetData&&typeof assetData==="object"?assetData:{};
    var files=Object.create(null),manifest={format:FORMAT,schemaVersion:VERSION,target:"maomao-chat"};
    (Array.isArray(theme.assetIndex)?theme.assetIndex:[]).forEach(function(asset){
      if(!asset||!safeAssetPath(asset.path)||!own(assetData,asset.path))fail("导出主题缺少素材："+String(asset&&asset.path||""));
      files[asset.path]=inputBytes(assetData[asset.path]);
    });
    files["custom.css"]=encodeUtf8(css||"");
    var normalized=normalize(theme,files,manifest),entries=[
      {name:"manifest.json",data:encodeUtf8(JSON.stringify(manifest))},
      {name:"theme.json",data:encodeUtf8(JSON.stringify(normalized.theme))},
      {name:"custom.css",data:encodeUtf8(normalized.customCss)}
    ];
    normalized.theme.assetIndex.forEach(function(asset){entries.push({name:asset.path,data:normalized.assets[asset.path].bytes})});
    return storedZip(entries);
  }
  function parseStoredZip(input){
    var bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.length>MAX)fail("主题包超过 48 MB。");
    if(bytes.length<22)fail("文件不是有效的主题 ZIP 包。");
    var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    var minEocd=Math.max(0,bytes.length-22-0xffff),eocd=-1,zip64Eocd=-1;
    for(var scan=bytes.length-22;scan>=minEocd;scan--){
      if(view.getUint32(scan,true)===0x06054b50){
        var candidateComment=view.getUint16(scan+20,true);
        var candidateDiskCount=view.getUint16(scan+8,true),candidateCount=view.getUint16(scan+10,true);
        var candidateSize=view.getUint32(scan+12,true),candidateOffset=view.getUint32(scan+16,true);
        if(scan+22+candidateComment!==bytes.length)continue;
        if(candidateDiskCount===0xffff||candidateCount===0xffff||candidateSize===0xffffffff||candidateOffset===0xffffffff){
          if(zip64Eocd<0)zip64Eocd=scan;
          continue;
        }
        if(candidateOffset+candidateSize===scan){eocd=scan;break}
      }
    }
    if(eocd<0&&zip64Eocd>=0)eocd=zip64Eocd;
    if(eocd<0)fail("主题 ZIP 缺少结束记录。");
    var disk=view.getUint16(eocd+4,true),centralDisk=view.getUint16(eocd+6,true);
    var diskCount=view.getUint16(eocd+8,true),entryCount=view.getUint16(eocd+10,true);
    var centralSize=view.getUint32(eocd+12,true),centralOffset=view.getUint32(eocd+16,true);
    var commentLength=view.getUint16(eocd+20,true);
    if(eocd+22+commentLength!==bytes.length)fail("主题 ZIP 结束记录长度不正确。");
    if(disk!==0||centralDisk!==0||diskCount!==entryCount)fail("不支持分卷 ZIP。");
    if(entryCount===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff)fail("暂不支持 ZIP64 主题包。");
    if(entryCount>120)fail("主题文件数量或体积超出限制。");
    var centralEnd=centralOffset+centralSize;
    if(centralEnd!==eocd||centralEnd>bytes.length)fail("主题 ZIP 中央目录位置不正确。");
    var files=Object.create(null),seenNames=Object.create(null),entries=[],total=0,fileCount=0,pos=centralOffset;
    function readName(start,length,flags){
      if(!length||start+length>bytes.length)fail("主题 ZIP 文件名不完整。");
      var raw=bytes.subarray(start,start+length),name;
      if(!(flags&0x0800)){
        for(var k=0;k<raw.length;k++)if(raw[k]>0x7f)fail("主题文件名必须使用 UTF-8 编码。");
      }
      try{name=dec?dec.decode(raw):String.fromCharCode.apply(null,raw)}catch(e){fail("主题文件名编码错误。")}
      if(!name||name.indexOf("\u0000")>=0||name.charAt(0)==="/"||name.indexOf("\\")>=0||
        name.split("/").some(function(part){return part===".."||part==="."})||/^[A-Za-z]:/.test(name)){
        fail("主题包包含不安全路径。");
      }
      return name;
    }
    function validateFlags(flags){
      if(flags&1)fail("不支持加密 ZIP。");
      if(flags&8)fail("ZIP 文件尺寸信息不完整。");
      if(flags&~0x0800)fail("ZIP 标志不受支持。");
    }
    for(var index=0;index<entryCount;index++){
      if(pos+46>centralEnd||view.getUint32(pos,true)!==0x02014b50)fail("主题 ZIP 中央目录不完整。");
      var flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true);
      var crc=view.getUint32(pos+16,true),size=view.getUint32(pos+20,true),rawSize=view.getUint32(pos+24,true);
      var nameLen=view.getUint16(pos+28,true),extraLen=view.getUint16(pos+30,true),commentLen=view.getUint16(pos+32,true);
      var startDisk=view.getUint16(pos+34,true),localOffset=view.getUint32(pos+42,true);
      var recordEnd=pos+46+nameLen+extraLen+commentLen;
      if(recordEnd>centralEnd)fail("主题 ZIP 中央目录记录不完整。");
      validateFlags(flags);
      if(startDisk!==0)fail("不支持分卷 ZIP。");
      if(method!==0||size!==rawSize)fail("请使用工作台导出的标准主题包。");
      if(rawSize>MAX_FILE)fail("单个主题文件超过 16 MB。");
      var name=readName(pos+46,nameLen,flags);
      if(own(seenNames,name))fail("主题包存在重复文件："+name);
      seenNames[name]=true;
      if(localOffset+30>centralOffset||view.getUint32(localOffset,true)!==0x04034b50)fail("主题 ZIP 本地文件头无效。");
      var localFlags=view.getUint16(localOffset+6,true),localMethod=view.getUint16(localOffset+8,true);
      var localCrc=view.getUint32(localOffset+14,true),localSize=view.getUint32(localOffset+18,true);
      var localRawSize=view.getUint32(localOffset+22,true),localNameLen=view.getUint16(localOffset+26,true);
      var localExtraLen=view.getUint16(localOffset+28,true),localNameStart=localOffset+30;
      var dataStart=localNameStart+localNameLen+localExtraLen,dataEnd=dataStart+size;
      if(dataStart>centralOffset||dataEnd>centralOffset)fail("主题 ZIP 内容不完整。");
      validateFlags(localFlags);
      if(localFlags!==flags||localMethod!==method||localCrc!==crc||localSize!==size||localRawSize!==rawSize||
        localNameLen!==nameLen||dataStart-localNameStart-localExtraLen!==nameLen){
        fail("主题 ZIP 本地文件头与中央目录不一致。");
      }
      var localName=readName(localNameStart,localNameLen,localFlags);
      if(localName!==name)fail("主题 ZIP 本地文件名与中央目录不一致。");
      var data=bytes.slice(dataStart,dataEnd);
      if(crc32(data)!==crc)fail("主题文件校验失败："+name);
      var isDirectory=name.charAt(name.length-1)==="/";
      if(isDirectory&&rawSize!==0)fail("主题 ZIP 目录条目不能包含文件内容。");
      if(!isDirectory){files[name]=data;total+=data.length;fileCount++}
      if(total>MAX||fileCount>120)fail("主题文件数量或体积超出限制。");
      entries.push({offset:localOffset,end:dataEnd});
      pos=recordEnd;
    }
    if(pos!==centralEnd)fail("主题 ZIP 中央目录长度不正确。");
    entries.sort(function(a,b){return a.offset-b.offset});
    var expectedOffset=0;
    for(var entryIndex=0;entryIndex<entries.length;entryIndex++){
      if(entries[entryIndex].offset!==expectedOffset)fail("主题 ZIP 存在未登记、重叠或缺失的文件数据。");
      expectedOffset=entries[entryIndex].end;
    }
    if(expectedOffset!==centralOffset)fail("主题 ZIP 存在未登记的文件数据。");
    if(!fileCount)fail("没有读取到主题文件。");
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
  function validateCssAssetRefs(css,assets){
    var normalized=normalizeCssForSafety(String(css||""));
    var re=/url\s*\(\s*(?:\u0001(\d+)\u0002|([^)]*?))\s*\)/gi,match;
    while((match=re.exec(normalized.code))){
      var path=match[1]!==undefined?String(normalized.strings[Number(match[1])]||"").trim():String(match[2]||"").trim();
      if(path.indexOf("assets/")===0&&!own(assets,path))fail("CSS 引用了未登记的主题素材："+path);
    }
  }
  function quoteCssString(value){
    return "\""+String(value)
      .replace(/\\/g,"\\\\")
      .replace(/"/g,"\\\"")
      .replace(/[\u0000-\u001f\u007f]/g,function(ch){return "\\"+ch.charCodeAt(0).toString(16)+" "})+"\"";
  }
  function skipCssTrivia(css,index){
    while(index<css.length){
      if(/\s/.test(css.charAt(index))){index++;continue}
      if(css.charAt(index)==="/"&&css.charAt(index+1)==="*"){
        var close=css.indexOf("*/",index+2);
        if(close<0)return css.length;
        index=close+2;
        continue;
      }
      break;
    }
    return index;
  }
  function readCssIdentifier(css,start){
    var name="",index=start;
    while(index<css.length){
      var c=css.charAt(index);
      if(c==="/"&&css.charAt(index+1)==="*"){
        var close=css.indexOf("*/",index+2);
        if(close<0)return{name:name,end:css.length};
        index=close+2;
        continue;
      }
      if(c==="\\"){
        var escaped=decodeCssEscape(css,index);
        name+=escaped.value;
        index=escaped.next;
        continue;
      }
      if(/[A-Za-z0-9_-]/.test(c)||c.charCodeAt(0)>=128){name+=c;index++;continue}
      break;
    }
    return{name:name,end:index};
  }
  function readCssUrl(css,open){
    var index=skipCssTrivia(css,open+1),value="",quote=css.charAt(index)==="\""||css.charAt(index)==="'"?css.charAt(index):"";
    if(quote){
      index++;
      var closed=false;
      while(index<css.length){
        var c=css.charAt(index);
        if(c==="\\"){
          var escaped=decodeCssEscape(css,index);
          value+=escaped.value;
          index=escaped.next;
          continue;
        }
        if(c===quote){closed=true;index++;break}
        value+=c;
        index++;
      }
      if(!closed)return null;
      index=skipCssTrivia(css,index);
      if(css.charAt(index)!==")")return null;
      return{path:value.trim(),end:index+1};
    }
    while(index<css.length){
      var c=css.charAt(index);
      if(c===")")return{path:value.trim(),end:index+1};
      if(c==="/"&&css.charAt(index+1)==="*"){
        var close=css.indexOf("*/",index+2);
        if(close<0)return null;
        index=close+2;
        continue;
      }
      if(c==="\\"){
        var escaped=decodeCssEscape(css,index);
        value+=escaped.value;
        index=escaped.next;
        continue;
      }
      value+=c;
      index++;
    }
    return null;
  }
  function rewriteCssAssetUrls(css,assetUrls){
    css=String(css||"");
    var output="",index=0;
    while(index<css.length){
      var c=css.charAt(index);
      if(c==="/"&&css.charAt(index+1)==="*"){
        var commentEnd=css.indexOf("*/",index+2);
        var next=commentEnd<0?css.length:commentEnd+2;
        output+=css.slice(index,next);
        index=next;
        continue;
      }
      if(c==="\""||c==="'"){
        var quote=c,start=index++;
        while(index<css.length){
          c=css.charAt(index);
          if(c==="\\"){index=decodeCssEscape(css,index).next;continue}
          index++;
          if(c===quote)break;
        }
        output+=css.slice(start,index);
        continue;
      }
      if(/[A-Za-z_-]/.test(c)||c==="\\"||c.charCodeAt(0)>=128){
        var identifier=readCssIdentifier(css,index);
        var open=skipCssTrivia(css,identifier.end);
        if(identifier.name.toLowerCase()==="url"&&css.charAt(open)==="("){
          var parsed=readCssUrl(css,open);
          if(parsed){
            if(parsed.path.indexOf("assets/")===0){
              var resolved=assetUrls&&Object.prototype.hasOwnProperty.call(assetUrls,parsed.path)?assetUrls[parsed.path]:"";
              output+=resolved?"url("+quoteCssString(resolved)+")":"none";
            }else output+=css.slice(index,parsed.end);
            index=parsed.end;
            continue;
          }
        }
        output+=css.slice(index,identifier.end);
        index=identifier.end;
        continue;
      }
      output+=c;
      index++;
    }
    return output;
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
    if(!/@font-face\b/i.test(code))return css;
    var namespace=String(themeId||"package").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,48)||"package";
    function familyToken(family){
      return Array.from(family).map(function(ch){return ch.codePointAt(0).toString(16)}).join("_").slice(0,128)||"font";
    }
    var face=/@font-face\s*\{([^{}]*)\}/gi,match;
    while((match=face.exec(code))){
      var familyMatch=/font-family\s*:\s*(?:\u0001(\d+)\u0002|([A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*))\s*;/i.exec(match[1]);
      if(!familyMatch)fail("@font-face 必须指定有效的 font-family。");
      if((match[1].match(/font-family\s*:/gi)||[]).length!==1)fail("@font-face 只能声明一个 font-family。");
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
  function skipComment(index,limit){
    if(css.charAt(index)!=="/"||css.charAt(index+1)!=="*")return index;
    var end=css.indexOf("*/",index+2);
    return end<0?limit:Math.min(limit,end+2);
  }
  function skipString(index,limit){
    var quote=css.charAt(index),i=index+1;
    while(i<limit){
      var c=css.charAt(i);
      if(c==="\\"){i=decodeCssEscape(css,i).next;continue}
      i++;
      if(c===quote)break;
    }
    return i;
  }
  function skipTrivia(index,limit){
    while(index<limit){
      if(/\s/.test(css.charAt(index))){index++;continue}
      if(css.charAt(index)==="/"&&css.charAt(index+1)==="*"){index=skipComment(index,limit);continue}
      break;
    }
    return index;
  }
  function findBoundary(start,limit){
    var paren=0,bracket=0,i=start;
    while(i<limit){
      var c=css.charAt(i);
      if(c==="/"&&css.charAt(i+1)==="*"){i=skipComment(i,limit);continue}
      if(c==='"'||c==="'"){i=skipString(i,limit);continue}
      if(c==="\\"){i=decodeCssEscape(css,i).next;continue}
      if(c==="("){paren++;i++;continue}
      if(c===")"){paren=Math.max(0,paren-1);i++;continue}
      if(c==="["){bracket++;i++;continue}
      if(c==="]"){bracket=Math.max(0,bracket-1);i++;continue}
      if(paren===0&&bracket===0){
        if(c==="{")return{index:i,type:"block"};
        if(c==="}")return{index:i,type:"close"};
        if(c===";")return{index:i,type:"semicolon"};
      }
      i++;
    }
    return{index:limit,type:"end"};
  }
  function findMatchingBrace(open,limit){
    var depth=1,i=open+1;
    while(i<limit){
      var c=css.charAt(i);
      if(c==="/"&&css.charAt(i+1)==="*"){i=skipComment(i,limit);continue}
      if(c==='"'||c==="'"){i=skipString(i,limit);continue}
      if(c==="\\"){i=decodeCssEscape(css,i).next;continue}
      if(c==="{")depth++;
      else if(c==="}"&&--depth===0)return i;
      i++;
    }
    return limit;
  }
  function splitSelectors(prelude){
    var parts=[],start=0,paren=0,bracket=0,i=0;
    while(i<prelude.length){
      var c=prelude.charAt(i);
      if(c==="/"&&prelude.charAt(i+1)==="*"){
        var end=prelude.indexOf("*/",i+2);i=end<0?prelude.length:end+2;continue;
      }
      if(c==='"'||c==="'"){
        var quote=c;i++;
        while(i<prelude.length){
          c=prelude.charAt(i);
          if(c==="\\"){i=decodeCssEscape(prelude,i).next;continue}
          i++;
          if(c===quote)break;
        }
        continue;
      }
      if(c==="\\"){i=decodeCssEscape(prelude,i).next;continue}
      if(c==="("){paren++;i++;continue}
      if(c===")"){paren=Math.max(0,paren-1);i++;continue}
      if(c==="["){bracket++;i++;continue}
      if(c==="]"){bracket=Math.max(0,bracket-1);i++;continue}
      if(c===","&&paren===0&&bracket===0){parts.push(prelude.slice(start,i));start=i+1}
      i++;
    }
    parts.push(prelude.slice(start));
    return parts;
  }
  function scopeSelector(selector){
    var trimmed=selector.trim();
    if(!trimmed)return selector;
    var lead=skipTrivia(0,trimmed.length),head=trimmed.slice(lead);
    if(head.charAt(0)===":"){
      var pseudo=readCssIdentifier(trimmed,lead+1);
      if(pseudo.name.toLowerCase()==="root")return trimmed.slice(0,lead)+prefix+trimmed.slice(pseudo.end);
    }
    if(head.charAt(0)==="."){
      var className=readCssIdentifier(trimmed,lead+1);
      if(className.name==="phone-mockup")return trimmed.slice(0,lead)+prefix+trimmed.slice(className.end);
    }else{
      var tagName=readCssIdentifier(trimmed,lead);
      if(tagName.name.toLowerCase()==="html"||tagName.name.toLowerCase()==="body"){
        return trimmed.slice(0,lead)+prefix+trimmed.slice(tagName.end);
      }
    }
    return prefix+" "+trimmed;
  }
  function processRules(start,limit){
    var out="",cursor=start;
    while(cursor<limit){
      var boundary=findBoundary(cursor,limit);
      if(boundary.type==="end"||boundary.type==="close"){out+=css.slice(cursor,limit);break}
      if(boundary.type==="semicolon"){out+=css.slice(cursor,boundary.index+1);cursor=boundary.index+1;continue}
      var open=boundary.index,close=findMatchingBrace(open,limit);
      var prelude=css.slice(cursor,open),first=skipTrivia(0,prelude.length),atRuleName="";
      if(prelude.charAt(first)==="@"){
        var nameStart=skipTrivia(first+1,prelude.length);
        atRuleName=readCssIdentifier(prelude,nameStart).name.toLowerCase();
      }
      if(atRuleName==="media"||atRuleName==="supports"||atRuleName==="container"){
        out+=prelude+"{"+processRules(open+1,close)+"}";
      }else if(atRuleName){
        out+=css.slice(cursor,close+1);
      }else{
        out+=splitSelectors(prelude).map(scopeSelector).join(",")+"{"+css.slice(open+1,close)+"}";
      }
      cursor=close+1;
    }
    return out;
  }
  return processRules(0,css.length);
}  function themeBlockSelector(id,page){
    return '[data-maomao-theme-page="'+page+'"][data-maomao-theme-block="'+id+'"]';
  }
  function stylesToCss(theme){
    var out=[],prefix='.phone-mockup[data-maomao-chat-theme-active="1"]';
    ["chatList","chatDetail"].forEach(function(page){
      var styles=theme.styles&&theme.styles[page]||{},blocks=Array.isArray(theme.blocks&&theme.blocks[page])?theme.blocks[page]:[];
      (theme.pages&&theme.pages[page]||[]).forEach(function(item){
        if(item&&item.visible===false){
          var hidden=TARGETS[item.id]||themeBlockSelector(item.id,page);
          out.push(hidden.split(",").map(function(x){return prefix+" "+x.trim()}).join(",")+"{display:none !important}");
        }
      });
      Object.keys(styles).forEach(function(id){
        var decl=declarations(styles[id]||{}),sel=TARGETS[id]||themeBlockSelector(id,page);
        if(decl)out.push(sel.split(",").map(function(x){return prefix+" "+x.trim()}).join(",")+"{"+decl+"}");
      });
      (Array.isArray(theme.layerOrder&&theme.layerOrder[page])?theme.layerOrder[page]:[]).forEach(function(id,i){
        var sel=TARGETS[id]||themeBlockSelector(id,page);
        out.push(sel.split(",").map(function(x){return prefix+" "+x.trim()}).join(",")+"{order:"+i+" !important}");
      });
      blocks.forEach(function(block,i){
        if(block&&typeof block.id==="string")out.push(prefix+' '+themeBlockSelector(block.id,page)+'{order:'+i+' !important}');
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
      assets[a.path]={bytes:files[a.path],name:String(a.name||a.path.split("/").pop()),mimeType:a.mimeType,type:/^image\//i.test(a.mimeType)?"image":(/^font\//i.test(a.mimeType)?"font":"file")};paths.push(a.path)
    });
    Object.keys(files).forEach(function(p){if(p.indexOf("assets/")===0&&!own(assets,p))fail("存在未登记素材："+p);if(["manifest.json","theme.json","custom.css"].indexOf(p)<0&&p.indexOf("assets/")!==0)fail("未知主题文件："+p)});
    var cleanPages={chatList:[],chatDetail:[]},ids={chatList:[],chatDetail:[]};
    ["chatList","chatDetail"].forEach(function(page){
      var pageSeen=Object.create(null);
      cleanPages[page]=theme.pages[page].slice(0,80).filter(function(x){
        var ok=x&&typeof x.id==="string"&&(COMPONENTS[page].indexOf(x.id)>=0||safeCustomId(x.id));
        if(!ok||pageSeen[x.id])return false;
        pageSeen[x.id]=1;
        if(!ids[page].includes(x.id))ids[page].push(x.id);
        return true;
      }).map(function(x){return{id:x.id,name:String(x.name||x.id).slice(0,80),type:COMPONENTS[page].indexOf(x.id)>=0?"core":"custom",visible:x.visible!==false}});
      (Array.isArray(theme.blocks&&theme.blocks[page])?theme.blocks[page]:[]).forEach(function(b){if(b&&safeCustomId(b.id)&&!ids[page].includes(b.id))ids[page].push(b.id)})
    });
    var clean={format:FORMAT,schemaVersion:VERSION,target:"maomao-chat",id:String(theme.id||"chat-theme").slice(0,120),name:theme.name,version:String(theme.version||"1.0.0"),pages:cleanPages,styles:{chatList:{},chatDetail:{}},blocks:{chatList:[],chatDetail:[]},layerOrder:{chatList:[],chatDetail:[]},motions:[],assetIndex:[]};
    ["chatList","chatDetail"].forEach(function(page){Object.keys(theme.styles&&theme.styles[page]||{}).forEach(function(id){if(!ids[page].includes(id))return;var st={};Object.keys(PROPS).forEach(function(k){var v=cleanValue(theme.styles[page][id][k],k);if(v!==null&&v!==undefined)st[k]=v});clean.styles[page][id]=st});
      var blockSeen=Object.create(null);
      var pageBlocks=(Array.isArray(theme.blocks&&theme.blocks[page])?theme.blocks[page]:[]).slice(0,40);
      var uniqueBlocks=pageBlocks.filter(function(b){
        if(!b||!safeCustomId(b.id)||!ids[page].includes(b.id)||blockSeen[b.id])return false;
        blockSeen[b.id]=1;
        return true;
      });
      uniqueBlocks.forEach(function(b){
        if(b.type!=="image")return;
        var asset=assets[b.assetPath];
        if(!asset||!/^image\/(png|jpeg|webp|gif)$/i.test(asset.mimeType||"")){
          fail("图片组件必须引用已登记的图片素材："+String(b.id||""));
        }
      });
      clean.blocks[page]=uniqueBlocks.map(function(b){
        var t=["card","text","image","divider"].indexOf(b.type)>=0?b.type:"card";
        var slot=BLOCK_SLOTS[page].indexOf(b.slot)>=0?b.slot:(page==="chatList"?"top-of-content":"before-input");
        return{id:b.id,type:t,title:String(b.title||"").slice(0,160),text:String(b.text||"").slice(0,2000),
          assetPath:t==="image"?b.assetPath:"",slot:slot,visible:b.visible!==false};
      });
      var layerSeen=Object.create(null);
      clean.layerOrder[page]=(Array.isArray(theme.layerOrder&&theme.layerOrder[page])?theme.layerOrder[page]:[]).filter(function(id){if(!ids[page].includes(id)||layerSeen[id])return false;layerSeen[id]=1;return true}).slice(0,120)
    });
    var seen={};clean.motions=(theme.motions||[]).slice(0,20).filter(function(m){return m&&RULES[m.id]&&!seen[m.id]&&(seen[m.id]=1)}).map(function(m){return Object.assign({},m,{enabled:m.enabled===true,duration:clamp(m.duration,80,1600,260),threshold:clamp(m.threshold,0,240,20),compactScale:clamp(m.compactScale,.55,1,.86),compactHeight:clamp(m.compactHeight,24,72,38),scale:clamp(m.scale,.75,1.3,1.1),lift:clamp(m.lift,0,16,4),distance:clamp(m.distance,0,40,8)})});
    clean.assetIndex=paths.map(function(p){var a=assets[p];return{path:p,name:a.name,mimeType:a.mimeType,type:a.type}});
    var customCss=validateCss(files["custom.css"]?text(files["custom.css"],"custom.css"):"");
    validateCssAssetRefs(customCss,assets);
    return{manifest:manifest,theme:clean,customCss:customCss,assets:assets};
  }
  function readPackage(files){
    if(!files["manifest.json"]||!files["theme.json"])fail("主题包必须包含 manifest.json 与 theme.json。");
    var manifest,theme;try{manifest=JSON.parse(text(files["manifest.json"],"manifest.json"));theme=JSON.parse(text(files["theme.json"],"theme.json"))}catch(e){fail("主题清单格式错误。")}
    if(!manifest||manifest.format!==FORMAT||manifest.schemaVersion!==VERSION||manifest.target!=="maomao-chat")fail("该主题包不适用于 MAOMAO 聊天模块。");
    return normalize(theme,files,manifest);
  }
  function buildScopedCss(theme,css){var combined=stylesToCss(theme)+"\n"+scopeCss(css||" ",'.phone-mockup[data-maomao-chat-theme-active="1"]');return namespaceFontFamilies(combined,theme&&theme.id)}
  return{FORMAT:FORMAT,VERSION:VERSION,COMPONENTS:COMPONENTS,MOTION_RULES:RULES,parseStoredZip:parseStoredZip,readPackage:readPackage,createPackage:createPackage,validateCss:validateCss,scopeCss:scopeCss,stylesToCss:stylesToCss,buildScopedCss:buildScopedCss,safeAssetPath:safeAssetPath,rewriteCssAssetUrls:rewriteCssAssetUrls};
});
