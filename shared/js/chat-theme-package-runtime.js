/* MAOMAO Chat Theme Package Runtime v1. Applies package themes only to chat list/detail pages. */
(function(global){
  "use strict";
  var LIST="maomao_chat_theme_packages_v1",ACTIVE="maomao_chat_theme_active_v1",FORMAT=global.MAOMAOChatThemeFormat;
  var styleId="maomao-chat-theme-package-style",motionId="maomao-chat-theme-motion-style",media=null,assetUrls={},releases=[],signature="",generation=0;
  function list(){try{var a=JSON.parse(localStorage.getItem(LIST)||"[]");return Array.isArray(a)?a:[]}catch(e){return[]}}
  function active(){var id="";try{id=localStorage.getItem(ACTIVE)||""}catch(e){}return list().find(function(x){return x&&x.id===id})||null}
  function addStyle(id,css){var el=document.getElementById(id);if(!el){el=document.createElement("style");el.id=id;document.head.appendChild(el)}el.textContent=css}
  function releaseUrls(items){(items||[]).forEach(function(fn){try{if(typeof fn==="function")fn()}catch(e){}})}
  function revoke(){releaseUrls(releases);releases=[];assetUrls={}}
  function repo(){if(media)return Promise.resolve(media);var p=global.PhoneStorage&&PhoneStorage.repository;if(!p||!p.media)return Promise.reject(Error("MAOMAO 媒体仓储未加载"));media=p.media();return Promise.resolve(media)}
  function loadAssets(theme){
    var refs=theme.assetRefs||{},paths=Object.keys(refs),nextUrls={},nextReleases=[];
    if(!paths.length)return Promise.resolve({assetUrls:nextUrls,releases:nextReleases});
    return repo().then(function(r){
      var chain=Promise.resolve();
      paths.forEach(function(path){
        chain=chain.then(function(){
          return r.toObjectUrl(refs[path]).then(function(out){
            if(!out||!out.ok||!out.value||!out.value.url)throw Error("主题素材读取失败："+path);
            nextUrls[path]=out.value.url;
            if(typeof out.value.revoke==="function")nextReleases.push(out.value.revoke);
          });
        });
      });
      return chain;
    }).then(function(){return{assetUrls:nextUrls,releases:nextReleases}})
      .catch(function(error){releaseUrls(nextReleases);throw error});
  }
  function rewrite(css){return String(css||"").replace(/url\(\s*(['"]?)(assets\/[^'")]+)\1\s*\)/g,function(all,q,path){return assetUrls[path]?"url(\""+assetUrls[path]+"\")":"none"})}
  function cleanMotion(shell){
    if(shell.__chatThemeCleanup){shell.__chatThemeCleanup.forEach(function(fn){try{fn()}catch(e){}});shell.__chatThemeCleanup=[]}
    if(shell.__chatThemeObserver){shell.__chatThemeObserver.disconnect();shell.__chatThemeObserver=null}
    shell.classList.remove("maomao-theme-bubble-press","maomao-theme-sheet-rise");
    ["--maomao-theme-bubble-duration","--maomao-theme-bubble-easing","--maomao-theme-bubble-scale","--maomao-theme-sheet-duration","--maomao-theme-sheet-easing"].forEach(function(k){shell.style.removeProperty(k)});
    var nav=shell.querySelector(".floating-nav");
    if(nav){nav.classList.remove("maomao-theme-nav-compact","maomao-theme-nav-hidden");["--maomao-theme-motion-duration","--maomao-theme-motion-easing","--maomao-theme-motion-scale","--maomao-theme-motion-lift","--maomao-theme-motion-distance","--maomao-theme-motion-compact-height","--maomao-theme-motion-compact-scale","--maomao-theme-motion-hide-duration"].forEach(function(k){nav.style.removeProperty(k)})}
    shell.querySelectorAll(".maomao-theme-nav-compact,.maomao-theme-nav-hidden,.maomao-theme-nav-tapped,.maomao-theme-message-enter").forEach(function(n){n.classList.remove("maomao-theme-nav-compact","maomao-theme-nav-hidden","maomao-theme-nav-tapped","maomao-theme-message-enter");["--maomao-theme-motion-duration","--maomao-theme-motion-easing","--maomao-theme-motion-scale","--maomao-theme-motion-lift","--maomao-theme-motion-distance","--maomao-theme-motion-compact-height","--maomao-theme-motion-compact-scale"].forEach(function(k){n.style.removeProperty(k)})})
  }
  function removeCustomBlocks(shell){
    shell.querySelectorAll(".maomao-theme-custom-block").forEach(function(node){
      if(node&&typeof node.remove==="function")node.remove();
      else if(node&&node.parentNode)node.parentNode.removeChild(node);
    });
  }
  function cleanup(shell,fn){if(!shell.__chatThemeCleanup)shell.__chatThemeCleanup=[];shell.__chatThemeCleanup.push(fn)}
  function motion(shell,theme){
    cleanMotion(shell);var effects=(theme.motions||[]).filter(function(x){return x&&x.enabled});
    var collapse=effects.find(function(x){return x.id==="nav-collapse-scroll"}),hide=effects.find(function(x){return x.id==="nav-hide-scroll"}),nav=shell.querySelector(".floating-nav");
    var easing=["ease","ease-in","ease-out","ease-in-out","linear","cubic-bezier(.2,.75,.25,1)","cubic-bezier(.34,1.56,.64,1)"];
    function val(x,a,b,d){var n=Number(x);return Number.isFinite(n)?Math.max(a,Math.min(b,n)):d}
    if(nav&&(collapse||hide)){
      if(collapse){nav.style.setProperty("--maomao-theme-motion-duration",val(collapse.duration,80,1600,260)+"ms");nav.style.setProperty("--maomao-theme-motion-easing",easing.includes(collapse.easing)?collapse.easing:"ease-out");nav.style.setProperty("--maomao-theme-motion-compact-scale",val(collapse.compactScale,.55,1,.86));nav.style.setProperty("--maomao-theme-motion-compact-height",val(collapse.compactHeight,24,72,38)+"px")}
      var source=shell.querySelector(".main-stage");if(source){var last=source.scrollTop||0;var fn=function(){var y=source.scrollTop||0;if(collapse)nav.classList.toggle("maomao-theme-nav-compact",y>val(collapse.threshold,0,240,20));if(hide){if(y>last+2&&y>val(hide.threshold,0,240,18))nav.classList.add("maomao-theme-nav-hidden");else if(y<last-2||y<=val(hide.threshold,0,240,18))nav.classList.remove("maomao-theme-nav-hidden")}last=y};source.addEventListener("scroll",fn,{passive:true});cleanup(shell,function(){source.removeEventListener("scroll",fn)});fn()}
      if(hide)nav.style.setProperty("--maomao-theme-motion-hide-duration",val(hide.duration,80,1600,220)+"ms");
    }
    var tap=effects.find(function(x){return x.id==="nav-elastic-tap"});if(tap){var click=function(e){var t=e.target.closest&&e.target.closest(".floating-nav .nav-tab");if(!t)return;t.style.setProperty("--maomao-theme-motion-duration",val(tap.duration,80,1000,360)+"ms");t.style.setProperty("--maomao-theme-motion-easing",easing.includes(tap.easing)?tap.easing:"ease-out");t.style.setProperty("--maomao-theme-motion-scale",val(tap.scale,.75,1.3,1.12));t.style.setProperty("--maomao-theme-motion-lift",val(tap.lift,0,16,4)+"px");t.classList.add("maomao-theme-nav-tapped");setTimeout(function(){t.classList.remove("maomao-theme-nav-tapped")},val(tap.duration,80,1000,360))};shell.addEventListener("click",click,true);cleanup(shell,function(){shell.removeEventListener("click",click,true)})}
    var bubble=effects.find(function(x){return x.id==="bubble-press"});if(bubble){shell.classList.add("maomao-theme-bubble-press");shell.style.setProperty("--maomao-theme-bubble-duration",val(bubble.duration,80,1000,120)+"ms");shell.style.setProperty("--maomao-theme-bubble-easing",easing.includes(bubble.easing)?bubble.easing:"ease-out");shell.style.setProperty("--maomao-theme-bubble-scale",val(bubble.scale,.8,1,.985))}
    var sheet=effects.find(function(x){return x.id==="sheet-rise"});if(sheet){shell.classList.add("maomao-theme-sheet-rise");shell.style.setProperty("--maomao-theme-sheet-duration",val(sheet.duration,80,1600,300)+"ms");shell.style.setProperty("--maomao-theme-sheet-easing",easing.includes(sheet.easing)?sheet.easing:"ease-out")}
    var enter=effects.find(function(x){return x.id==="message-enter"}),stage=shell.querySelector("#chat-messages");
    if(enter&&stage&&global.MutationObserver){var ob=new MutationObserver(function(records){records.forEach(function(r){Array.prototype.forEach.call(r.addedNodes,function(n){if(!n||n.nodeType!==1)return;var rows=[];if(n.matches&&n.matches(".msg-row"))rows.push(n);if(n.querySelectorAll)rows=rows.concat(Array.from(n.querySelectorAll(".msg-row")));rows.forEach(function(row){row.style.setProperty("--maomao-theme-motion-duration",val(enter.duration,80,1600,220)+"ms");row.style.setProperty("--maomao-theme-motion-easing",easing.includes(enter.easing)?enter.easing:"ease-out");row.style.setProperty("--maomao-theme-motion-distance",val(enter.distance,0,40,8)+"px");row.classList.remove("maomao-theme-message-enter");void row.offsetWidth;row.classList.add("maomao-theme-message-enter")})})})});ob.observe(stage,{childList:true,subtree:true});shell.__chatThemeObserver=ob}
  }
  function blockNode(b){var n=document.createElement("div");n.className="maomao-theme-custom-block";n.setAttribute("data-maomao-theme-block",b.id);if(b.visible===false)n.style.display="none";if(b.type==="image"){var img=document.createElement("img");img.alt="";img.loading="lazy";if(assetUrls[b.assetPath])img.src=assetUrls[b.assetPath];n.appendChild(img)}else if(b.type==="text")n.textContent=b.text||"";else if(b.type==="divider")n.classList.add("is-divider");else{var strong=document.createElement("strong"),p=document.createElement("p");strong.textContent=b.title||"";p.textContent=b.text||"";n.appendChild(strong);n.appendChild(p)}return n}
  function mount(shell,theme,page){
    removeCustomBlocks(shell);
    (theme.blocks&&theme.blocks[page]||[]).forEach(function(b){var n=blockNode(b),parent=null,before=null,main=shell.querySelector(".main-stage"),stream=shell.querySelector(".tier4-floating-stream"),list=shell.querySelector("#chatListContainer"),profile=shell.querySelector(".white-profile-stage"),music=shell.querySelector(".floating-music-card"),nav=shell.querySelector(".floating-nav"),head=shell.querySelector(".chat-theme-header,.wechat-home-header"),detail=shell.querySelector(".chat-header"),stage=shell.querySelector("#chat-messages"),input=shell.querySelector("#chat-form"),quote=shell.querySelector("#quoteBar");
      if(page==="chatList"){if(b.slot==="top-of-content"||b.slot==="after-header"){parent=main;before=b.slot==="top-of-content"?(head||main.firstElementChild):(head?head.nextElementSibling:null)}else if(b.slot==="above-profile"&&profile){parent=profile.parentElement;before=profile}else if((b.slot==="before-music"||b.slot==="after-music")&&stream){parent=stream;before=b.slot==="before-music"?(music||list):(music?music.nextElementSibling:list)}else if(b.slot==="after-list"&&list){parent=list.parentElement;before=list.nextElementSibling}else if(b.slot==="above-nav"&&nav){parent=nav.parentElement;before=nav}else if(stream){parent=stream;before=list}}
      else if(detail){if(b.slot==="before-header"||b.slot==="after-header"){parent=detail.parentElement;before=b.slot==="before-header"?detail:detail.nextElementSibling}else if((b.slot==="before-messages"||b.slot==="after-messages")&&stage){parent=stage;before=b.slot==="before-messages"?stage.firstElementChild:null}else if(b.slot==="before-input"&&input){parent=input.parentElement;before=input}else if(b.slot==="after-input"&&input){parent=input.parentElement;before=input.nextElementSibling}else if(stage){parent=stage}}
      if(parent)parent.insertBefore(n,before||null)
    })
  }
  function apply(){
    var path=global.location.pathname.toLowerCase(),page=path.indexOf("chat-detail.html")>=0?"chatDetail":(path.indexOf("chat.html")>=0?"chatList":"");
    if(!page||!FORMAT)return;var shell=document.querySelector(".phone-mockup");if(!shell)return;var theme=active(),gen=++generation;
    if(!theme){shell.removeAttribute("data-maomao-chat-theme-active");addStyle(styleId,"");addStyle(motionId,"");cleanMotion(shell);removeCustomBlocks(shell);revoke();signature="";return}
    var sig=theme.id+":"+String(theme.updatedAt||"");if(sig===signature)return;shell.setAttribute("data-maomao-chat-theme-active","1");
    loadAssets(theme).then(function(resources){if(gen!==generation||!active()||active().id!==theme.id){releaseUrls(resources.releases);return}var previousReleases=releases;assetUrls=resources.assetUrls;releases=resources.releases;try{addStyle(styleId,rewrite(FORMAT.buildScopedCss(theme,theme.customCss||"")));var pageKey=page;mount(shell,theme,pageKey);var effects=theme.motions||[];var rules=[
      '.phone-mockup[data-maomao-chat-theme-active="1"] .floating-nav{transition:transform var(--maomao-theme-motion-duration,260ms) var(--maomao-theme-motion-easing,ease-out),opacity var(--maomao-theme-motion-hide-duration,220ms) ease-out!important}',
      '.phone-mockup[data-maomao-chat-theme-active="1"] .floating-nav.maomao-theme-nav-compact{transform:scale(var(--maomao-theme-motion-compact-scale,.86))!important;min-height:var(--maomao-theme-motion-compact-height,38px)!important;padding:6px 9px 4px!important;gap:4px!important}',
      '.phone-mockup[data-maomao-chat-theme-active="1"] .floating-nav.maomao-theme-nav-hidden{opacity:0!important;transform:translateY(18px)!important;pointer-events:none!important}',
      '.phone-mockup[data-maomao-chat-theme-active="1"] .nav-tab.maomao-theme-nav-tapped .nav-ico{transform:translateY(calc(-1 * var(--maomao-theme-motion-lift,4px))) scale(var(--maomao-theme-motion-scale,1.12))!important}',
      '.phone-mockup[data-maomao-chat-theme-active="1"] .maomao-theme-message-enter{animation:maomaoThemeEnter var(--maomao-theme-motion-duration,220ms) var(--maomao-theme-motion-easing,ease-out) both}',
      '@keyframes maomaoThemeEnter{from{opacity:0;transform:translateY(var(--maomao-theme-motion-distance,8px))}to{opacity:1;transform:none}}',
      '.phone-mockup[data-maomao-chat-theme-active="1"].maomao-theme-bubble-press .msg-bubble:active{transform:scale(var(--maomao-theme-bubble-scale,.985))!important;transition:transform var(--maomao-theme-bubble-duration,120ms) var(--maomao-theme-bubble-easing,ease-out)!important}',
      '.phone-mockup[data-maomao-chat-theme-active="1"].maomao-theme-sheet-rise .plus-panel-overlay .plus-panel-sheet{transition-duration:var(--maomao-theme-sheet-duration,300ms)!important;transition-timing-function:var(--maomao-theme-sheet-easing,ease-out)!important}'
    ];addStyle(motionId,rules.join("\n"));motion(shell,theme);signature=sig}catch(error){releaseUrls(previousReleases);throw error}releaseUrls(previousReleases)
    }).catch(function(e){if(gen!==generation)return;shell.removeAttribute("data-maomao-chat-theme-active");addStyle(styleId,"");addStyle(motionId,"");cleanMotion(shell);removeCustomBlocks(shell);revoke();signature="";if(console&&console.error)console.error("[MAOMAO Chat Theme]",e)})
  }
  function schedule(){if(global.requestAnimationFrame)global.requestAnimationFrame(apply);else global.setTimeout(apply,0)}
  global.MAOMAOChatThemePackageRuntime={refresh:schedule,getActive:active,getInstalled:list};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",schedule,{once:true});else schedule();
  global.addEventListener("pageshow",schedule);global.addEventListener("maomao:chat-theme-change",schedule);global.addEventListener("storage",function(e){if(!e||e.key===LIST||e.key===ACTIVE)schedule()});
})(window);
