(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
var ROLE_KEY='maomao_game_role', HISTORY_KEY='maomao_cooking_history_v1', PENDING_PREFIX='maomao_cooking_pending_';
var categories=[{id:'all',label:'全部食材'},{id:'staple',label:'主食'},{id:'protein',label:'蛋白质'},{id:'vegetable',label:'蔬菜'},{id:'seasoning',label:'调味料'},{id:'extra',label:'其他'}];
var ingredients=[
{id:'rice',name:'米饭',category:'staple',note:'软糯 / 温和',color:'#e7e3d8',flavor:'温和',tags:['主食','饱腹']},
{id:'noodle',name:'面条',category:'staple',note:'顺滑 / 麦香',color:'#d9cbb0',flavor:'麦香',tags:['主食']},
{id:'bread',name:'面包',category:'staple',note:'烘烤 / 松软',color:'#b99069',flavor:'烘烤香',tags:['主食','甜']},
{id:'potato',name:'土豆',category:'staple',note:'绵密 / 淀粉',color:'#c9b38c',flavor:'绵密',tags:['主食']},
{id:'egg',name:'鸡蛋',category:'protein',note:'鲜香 / 柔软',color:'#e9d9a8',flavor:'鲜香',tags:['蛋白质','百搭']},
{id:'chicken',name:'鸡肉',category:'protein',note:'咸鲜 / 扎实',color:'#cda18c',flavor:'咸鲜',tags:['蛋白质']},
{id:'tofu',name:'豆腐',category:'protein',note:'清淡 / 细腻',color:'#f0eee4',flavor:'清淡',tags:['蛋白质']},
{id:'fish',name:'鱼肉',category:'protein',note:'鲜味 / 轻盈',color:'#c4c9c7',flavor:'鲜味',tags:['蛋白质']},
{id:'tomato',name:'番茄',category:'vegetable',note:'酸甜 / 多汁',color:'#b95d52',flavor:'酸甜',tags:['蔬菜','酸']},
{id:'mushroom',name:'蘑菇',category:'vegetable',note:'鲜味 / 菌香',color:'#9b8c7c',flavor:'菌香',tags:['蔬菜','鲜']},
{id:'carrot',name:'胡萝卜',category:'vegetable',note:'清甜 / 脆口',color:'#d58c50',flavor:'清甜',tags:['蔬菜','甜']},
{id:'greens',name:'青菜',category:'vegetable',note:'清爽 / 轻苦',color:'#83927b',flavor:'清爽',tags:['蔬菜']},
{id:'salt',name:'盐',category:'seasoning',note:'提鲜 / 基础',color:'#d8d8d4',flavor:'咸',tags:['调味']},
{id:'sugar',name:'糖',category:'seasoning',note:'甜味 / 平衡',color:'#eee8da',flavor:'甜',tags:['调味','甜']},
{id:'soy',name:'酱油',category:'seasoning',note:'咸鲜 / 醇厚',color:'#55463b',flavor:'咸鲜',tags:['调味','咸']},
{id:'chili',name:'辣椒',category:'seasoning',note:'辛辣 / 热烈',color:'#a44c42',flavor:'辛辣',tags:['调味','辣']},
{id:'vinegar',name:'醋',category:'seasoning',note:'酸味 / 清亮',color:'#b4a18b',flavor:'酸',tags:['调味','酸']},
{id:'cheese',name:'芝士',category:'extra',note:'浓郁 / 奶香',color:'#d6bd76',flavor:'奶香',tags:['浓郁']},
{id:'honey',name:'蜂蜜',category:'extra',note:'甜润 / 花香',color:'#c49a4d',flavor:'甜润',tags:['甜']},
{id:'chocolate',name:'巧克力',category:'extra',note:'微苦 / 香浓',color:'#59463d',flavor:'可可',tags:['甜','浓郁']}
];
var selected={},activeCategory='all',roles=[],activeRole=null,currentDish=null,history=[];
function safeJSON(raw,fallback){try{return JSON.parse(raw)||fallback}catch(e){return fallback}}
function loadRoles(){
 try{if(window.PhoneStorage&&typeof PhoneStorage.getCharacters==='function')roles=PhoneStorage.getCharacters()||[]}catch(e){}
 if(!Array.isArray(roles)||!roles.length)roles=safeJSON(localStorage.getItem('ai_custom_characters'),[]);
 roles=(Array.isArray(roles)?roles:[]).filter(function(r){return r&&r.id});
 var wanted=localStorage.getItem(ROLE_KEY);
 activeRole=roles.find(function(r){return String(r.id)===String(wanted)})||roles[0]||{id:'',name:'未选择角色',description:'请先创建或选择一个 AI 角色'};
 if(activeRole.id)localStorage.setItem(ROLE_KEY,String(activeRole.id));
 renderRole();
}
function roleName(r){return r&&(r.name||r.nickname||r.charName)||'聊天角色'}
function roleAvatar(r){return r&&(r.avatar||r.avatarUrl||r.avatarData||r.image||r.icon)||''}
function renderRole(){
 $('roleName').textContent=roleName(activeRole);
 $('roleDescription').textContent=activeRole.description||activeRole.bio||activeRole.personality||'做好之后，TA 会给出反应';
 var src=roleAvatar(activeRole),mono=$('roleMonogram'),taste=$('tastingMonogram');
 mono.textContent=(roleName(activeRole).trim().charAt(0)||'?');mono.innerHTML='';
 taste.textContent=(roleName(activeRole).trim().charAt(0)||'?');taste.innerHTML='';
 if(src){var a=document.createElement('img');a.src=src;a.alt='';mono.appendChild(a);var b=document.createElement('img');b.src=src;b.alt='';taste.appendChild(b)}
}
function showToast(msg){var el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(function(){el.classList.remove('show')},2200)}
function ingredient(id){return ingredients.find(function(x){return x.id===id})}
function count(){return Object.keys(selected).reduce(function(n,id){return n+selected[id]},0)}
function chosen(){return Object.keys(selected).map(function(id){var x=ingredient(id);return x?Object.assign({},x,{quantity:selected[id]}):null}).filter(Boolean)}
function renderCategories(){
 $('categoryTabs').innerHTML='';
 categories.forEach(function(cat){var b=document.createElement('button');b.className='category-tab'+(activeCategory===cat.id?' active':'');b.textContent=cat.label;b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-selected',activeCategory===cat.id?'true':'false');b.onclick=function(){activeCategory=cat.id;renderCategories();renderIngredients()};$('categoryTabs').appendChild(b)})
}
function renderIngredients(){
 var grid=$('ingredientGrid');grid.innerHTML='';
 ingredients.filter(function(x){return activeCategory==='all'||x.category===activeCategory}).forEach(function(x){
  var n=selected[x.id]||0,btn=document.createElement('button');btn.type='button';btn.className='ingredient-item'+(n?' selected':'');btn.setAttribute('aria-pressed',n?'true':'false');
  btn.innerHTML='<span class="ingredient-visual" style="background:'+x.color+'"></span><span class="ingredient-name"></span><span class="ingredient-note"></span>';
  btn.querySelector('.ingredient-name').textContent=x.name;btn.querySelector('.ingredient-note').textContent=x.note;
  btn.onclick=function(){selected[x.id]=Math.min(5,(selected[x.id]||0)+1);renderIngredients();renderPot()};
  if(n){var q=document.createElement('div');q.className='quantity';q.innerHTML='<button type="button" aria-label="减少用量">−</button><span>'+n+'</span><button type="button" aria-label="增加用量">+</button>';q.children[0].onclick=function(e){e.stopPropagation();selected[x.id]=Math.max(0,(selected[x.id]||0)-1);if(!selected[x.id])delete selected[x.id];renderIngredients();renderPot()};q.children[2].onclick=function(e){e.stopPropagation();selected[x.id]=Math.min(5,(selected[x.id]||0)+1);renderIngredients();renderPot()};btn.appendChild(q)}
  grid.appendChild(btn)
 })
}
function renderPot(){
 var list=chosen(),pot=$('potContents');pot.innerHTML='';
 if(!list.length){pot.innerHTML='<span class="empty-pot">锅里还空着<br><small>先挑几样食材</small></span>'}
 else list.forEach(function(x){for(var i=0;i<Math.min(x.quantity,3);i++){var dot=document.createElement('i');dot.className='ingredient-dot';dot.style.background=x.color;dot.title=x.name;pot.appendChild(dot)}});
 $('ingredientCount').textContent=String(count()).padStart(2,'0')+' INGREDIENT'+(count()===1?'':'S');
 $('footerCount').textContent=count();$('cookButton').disabled=count()===0;
 $('ingredientSummary').textContent=list.length?list.map(function(x){return x.name+(x.quantity>1?' ×'+x.quantity:'')}).join(' · '):'从下面选食材，点选即可加入锅中。';
}
function tasteProfile(list){
 var tags=list.reduce(function(a,x){return a.concat(x.tags)},[]),flavors=list.map(function(x){return x.flavor});
 var unique=[...new Set(flavors)],has=function(id){return !!selected[id]};
 var odd=(has('chocolate')&&(has('soy')||has('fish')||has('chili')))||(has('honey')&&has('vinegar')&&has('chili'))||(has('bread')&&has('soy')&&has('sugar'));
 var sweet=tags.indexOf('甜')>=0,spicy=has('chili'),acid=has('vinegar')||has('tomato'),protein=list.some(function(x){return x.category==='protein'}),staple=list.some(function(x){return x.category==='staple'}),veg=list.some(function(x){return x.category==='vegetable'});
 var flavor=odd?'实验性搭配':spicy?(acid?'酸辣开胃':'辛香浓郁'):sweet?(protein?'甜咸混搭':'甜口系'):acid?'清爽微酸':protein&&veg?'鲜香均衡':staple?'温和饱腹':'自由风味';
 var names=[];if(staple)names.push(list.find(function(x){return x.category==='staple'}).name);if(protein)names.push(list.find(function(x){return x.category==='protein'}).name);if(veg)names.push(list.find(function(x){return x.category==='vegetable'}).name);
 var dishName=odd?'灵感失控实验碗':names.length?names.slice(0,2).join('与')+'小料理':list.length>2?list[0].name+'的自由组合':list.map(function(x){return x.name}).join('与')+'小食';
 var description=odd?'这道菜大胆得有点出乎意料。味道之间正在进行一场不太按常理出牌的碰撞。':protein&&veg&&staple?'主食、鲜味与蔬菜凑在了一起，是一道层次比较完整的家常风格组合。':sweet?'甜味成为了这道菜的主角，像是一次不太严肃的厨房实验。':spicy?'辛香先声夺人，适合喜欢鲜明味道的试吃员。':'没有固定菜谱的限制，食材各自留下自己的味道，最后拼成了这一份独家组合。';
 return {flavor:flavor,description:description,odd:odd,dishName:dishName,ingredients:list,tags:tags};
}
function setStage(stage){
 ['cookStage','dishStage','tastingStage'].forEach(function(id){$(id).hidden=id!==stage});
 window.scrollTo({top:0,behavior:'smooth'});
}
function cook(){
 var list=chosen();if(!list.length)return;
 $('potScene').classList.add('cooking');$('cookButton').disabled=true;$('cookButton').innerHTML='正在烹饪…';
 setTimeout(function(){
  $('potScene').classList.remove('cooking');$('cookButton').innerHTML='开始烹饪 <span>↗</span>';$('cookButton').disabled=false;
  var profile=tasteProfile(list);currentDish={id:'dish_'+Date.now(),name:profile.dishName,profile:profile,roleId:activeRole.id,roleName:roleName(activeRole),createdAt:new Date().toISOString(),reaction:''};
  $('dishName').value=currentDish.name;$('dishFlavor').textContent=profile.flavor;$('dishCount').textContent=count()+' 份食材';$('dishDescription').textContent=profile.description;
  $('dishFood').style.background='radial-gradient(circle at 35% 35%,'+list[0].color+' 0 10%,transparent 11%),radial-gradient(circle at 63% 61%,'+(list[1]||list[0]).color+' 0 12%,transparent 13%),radial-gradient(circle at 53% 27%,'+(list[2]||list[0]).color+' 0 10%,transparent 11%),radial-gradient(circle at 32% 69%,'+(list[list.length-1]||list[0]).color+' 0 13%,transparent 14%),radial-gradient(circle at 50% 50%,#f1f1ed,#aaa 80%)';
  $('usedIngredients').innerHTML='';list.forEach(function(x){var tag=document.createElement('span');tag.className='used-ingredient';tag.textContent=x.name+(x.quantity>1?' ×'+x.quantity:'');$('usedIngredients').appendChild(tag)});
  $('dishArt').querySelector('.dish-index').textContent='MADE BY YOU / '+String(history.length+1).padStart(3,'0');setStage('dishStage');
 },1000);
}
function localReaction(profile){
 var name=roleName(activeRole),personality=String(activeRole.personality||activeRole.character||activeRole.profile||'').toLowerCase();
 var kind=profile.odd?'奇怪但有趣':profile.flavor.indexOf('甜')>=0?'甜口':profile.flavor.indexOf('辛')>=0?'重口':profile.flavor.indexOf('均衡')>=0?'均衡':'新鲜';
 var lines=profile.odd?['……你真的把这些放在一起了？我得承认，我很好奇。','这味道有点出乎意料。下次我们可以试试少放一点特别的那种。','我先观察一下。你是不是故意想看我的反应？']:profile.flavor.indexOf('甜')>=0?['这个味道意外地讨喜。你是不是记得我会喜欢这种？','甜度挺明显的，不过还蛮有你的风格。','嗯，这一口有点像今天的小惊喜。']:profile.flavor.indexOf('辛')>=0?['第一口就很有存在感……你这是在考验我的接受能力吗？','这个味道很直接，我喜欢你敢这么搭。','有点刺激，不过我愿意再尝一口。']:['搭配比我想象中更协调。你还挺会给人惊喜。','这个组合有点意思。下次要不要让我也来选两样？','能看出来你有认真想过怎么搭，味道也挺舒服。'];
 if(/冷淡|寡言|高冷/.test(personality))lines=['我尝过了。比想象中好。','……可以，再做一次。','搭配有点大胆，但不算差。'];
 if(/活泼|开朗|热情/.test(personality))lines=['哇，居然还不错！再给我一口！','这个组合好有创意，你是不是偷偷练过？','我宣布，这道菜今天有资格上桌！'];
 return {title:profile.odd?'TA 有点意外。':profile.flavor.indexOf('均衡')>=0?'TA 看起来很满意。':'TA 认真尝了一口。',copy:name+'先看了看菜品，然后终于尝了一口。',quote:lines[Math.floor(Math.random()*lines.length)]};
}
function beginTasting(){
 if(!currentDish)return;currentDish.name=$('dishName').value.trim()||currentDish.profile.dishName;
 setStage('tastingStage');$('tastingActions').hidden=true;$('reactionKicker').textContent='THE FIRST LOOK';$('reactionTitle').textContent=roleName(activeRole)+'看向了这道菜。';$('reactionCopy').textContent='TA 先观察了一下你准备的搭配。';$('reactionQuote').textContent='“嗯？今天做了什么？”';$('reactionQuote').classList.add('loading');$('tastingScene').classList.remove('reacted');
 setTimeout(function(){
  $('reactionKicker').textContent='FIRST BITE';$('reactionTitle').textContent='TA 试吃了一口。';$('reactionCopy').textContent='味道如何？让 TA 自己来告诉你。';$('reactionQuote').textContent='正在等 TA 的评价……';
  requestReaction();
 },900);
}
function requestReaction(){
 var profile=currentDish.profile,local=localReaction(profile),cfg=window.PhoneStorage&&PhoneStorage.getApiConfig?window.PhoneStorage.getApiConfig():{};
 var canCall=cfg&&String(cfg.apiKey||'').trim()&&window.PhoneAPI&&typeof window.PhoneAPI.complete==='function';
 function finish(text,source){
  if(!currentDish)return;
  var clean=String(text||local.quote).trim().replace(/^["“”'「」]+|["“”'「」]+$/g,'').slice(0,420);
  currentDish.reaction=clean;currentDish.reactionSource=source;currentDish.name=$('dishName').value.trim()||currentDish.name;
  $('reactionKicker').textContent='THE VERDICT';$('reactionTitle').textContent=local.title;$('reactionCopy').textContent=local.copy;$('reactionQuote').textContent='“'+clean+'”';$('reactionQuote').classList.remove('loading');$('tastingScene').classList.add('reacted');$('tastingActions').hidden=false;
  $('apiNote').textContent=source==='ai'?'这次反应由已配置的 AI 接口生成。':'当前展示本地反应；配置 AI API 后可以获得更贴合角色的评价。';
  history.unshift(Object.assign({},currentDish));history=history.slice(0,60);saveHistory();renderHistoryCount();
 }
 if(!canCall){finish(local.quote,'local');return}
 var rolePrompt=[activeRole.description,activeRole.bio,activeRole.personality,activeRole.character,activeRole.speechStyle,activeRole.prompt,activeRole.systemPrompt].filter(Boolean).join('\n');
 var items=profile.ingredients.map(function(x){return x.name+(x.quantity>1?' ×'+x.quantity:'')}).join('、');
 var user='用户亲手做了一道菜并请你试吃。菜名：'+currentDish.name+'。食材：'+items+'。风味：'+profile.flavor+'。组合特点：'+profile.description+'。请以角色本人身份先给出自然的第一反应和简短评价，像真实聊天，不要客服口吻，不要分析菜谱，不超过90个汉字。';
 window.PhoneAPI.complete({system:'你正在 MAOMAO 小手机里扮演用户选定的聊天角色。保持角色人设，不要声称真实存在。角色设定：'+rolePrompt+'\n你正在试吃用户亲手做的菜。可以惊喜、吐槽或温柔回应，但不要辱骂用户。只输出角色会说的话。',user:user,temperature:0.85,timeoutMs:12000}).then(function(text){finish(text||local.quote,text?'ai':'local')}).catch(function(){finish(local.quote,'local')});
}
function saveHistory(){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history))}catch(e){showToast('记录空间不足，暂时无法保存更多菜品')}}
function loadHistory(){history=safeJSON(localStorage.getItem(HISTORY_KEY),[]);if(!Array.isArray(history))history=[];renderHistoryCount()}
function renderHistoryCount(){$('historyCount').textContent=history.length}
function openHistory(){
 var list=$('historyList');list.innerHTML='';
 if(!history.length){list.innerHTML='<div class="history-empty">这里还空着。<br>先做一道菜，留下你们的第一份试吃记录。</div>'}
 history.forEach(function(item){var row=document.createElement('article');row.className='history-item';var thumb=document.createElement('div');thumb.className='history-thumb';var info=document.createElement('div'),title=document.createElement('strong'),desc=document.createElement('p'),time=document.createElement('time');title.textContent=item.name||'未命名菜品';desc.textContent=(item.profile&&item.profile.ingredients?item.profile.ingredients.map(function(x){return x.name}).join('、'):'')+' · '+(item.reaction||'尚无评价');time.textContent=new Date(item.createdAt||Date.now()).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});info.append(title,desc);row.append(thumb,info,time);list.appendChild(row)});
 $('historyPanel').hidden=false;
}
function continueChat(){
 if(!activeRole.id){showToast('暂时没有可跳转的角色，请先创建角色');return}
 if(!currentDish)return;
 var pending={dishName:currentDish.name,ingredients:currentDish.profile.ingredients.map(function(x){return x.name+(x.quantity>1?' ×'+x.quantity:'')}),flavor:currentDish.profile.flavor,reaction:currentDish.reaction,createdAt:currentDish.createdAt};
 try{localStorage.setItem(PENDING_PREFIX+String(activeRole.id),JSON.stringify(pending))}catch(e){}
 location.href='../chat/chat/chat-detail.html?id='+encodeURIComponent(activeRole.id)+'&cooking=1';
}
$('backButton').onclick=function(){if(history.length>0&&history.state)history.back();else location.href='games.html'};
$('changeRole').onclick=function(){var box=$('roleOptions');if(!roles.length){showToast('暂未找到角色，请先在聊天角色管理中创建');return}box.hidden=!box.hidden;if(!box.hidden){box.innerHTML='';roles.forEach(function(r){var b=document.createElement('button');b.type='button';b.className='role-option'+(String(r.id)===String(activeRole.id)?' active':'');b.textContent=roleName(r);b.onclick=function(){activeRole=r;localStorage.setItem(ROLE_KEY,String(r.id));renderRole();box.hidden=true};box.appendChild(b)})}};
$('clearIngredients').onclick=function(){selected={};renderIngredients();renderPot()};
$('cookButton').onclick=cook;$('editDish').onclick=function(){setStage('cookStage')};$('serveButton').onclick=beginTasting;$('continueChat').onclick=continueChat;$('cookAgain').onclick=function(){selected={};currentDish=null;renderIngredients();renderPot();setStage('cookStage')};
$('historyButton').onclick=openHistory;$('closeHistory').onclick=function(){$('historyPanel').hidden=true};
loadRoles();loadHistory();renderCategories();renderIngredients();renderPot();
})();