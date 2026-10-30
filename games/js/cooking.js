(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
var ROLE_KEY='maomao_game_role', HISTORY_KEY='maomao_cooking_history_v1', PENDING_PREFIX='maomao_cooking_pending_', TASTE_PREFIX='maomao_cooking_taste_v1_', DISCOVERY_KEY='maomao_cooking_discoveries_v1', ACHIEVEMENT_KEY='maomao_cooking_achievements_v1';
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

/* 食材 SVG 图形库 — 简洁手绘风，统一尺寸 24x24 */
var ingredientArt={
rice:'<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="15" rx="8" ry="5" fill="#f5f2e8"/><ellipse cx="9" cy="12" rx="2.5" ry="1.8" fill="#fff"/><ellipse cx="14" cy="11" rx="2.5" ry="1.8" fill="#fff"/><ellipse cx="12" cy="14" rx="2.5" ry="1.8" fill="#faf8f0"/></svg>',
noodle:'<svg viewBox="0 0 24 24" fill="none" stroke="#d9a860" stroke-width="1.8" stroke-linecap="round"><path d="M5 8c2-2 4 2 6 0s4 2 6 0"/><path d="M5 12c2-2 4 2 6 0s4 2 6 0"/><path d="M5 16c2-2 4 2 6 0s4 2 6 0"/></svg>',
bread:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 14c0-4 3-7 8-7s8 3 8 7v3c0 1.5-1 2.5-2.5 2.5h-11C5.5 19.5 4 18.5 4 17v-3z" fill="#c49a6c"/><path d="M7 12c1-1.5 3-2 5-2" stroke="#a67c52" stroke-width="1.2" stroke-linecap="round"/></svg>',
potato:'<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="13" rx="7" ry="6" fill="#c9a876"/><circle cx="9" cy="11" r=".8" fill="#a8855a"/><circle cx="14" cy="14" r=".8" fill="#a8855a"/><circle cx="12" cy="9" r=".8" fill="#a8855a"/></svg>',
egg:'<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="13" rx="6" ry="7.5" fill="#f5e6b8"/><ellipse cx="12" cy="14" rx="3" ry="3.5" fill="#f2b830"/></svg>',
chicken:'<svg viewBox="0 0 24 24" fill="none"><path d="M6 16c-1-3 1-7 5-8s7 1 7 4-2 6-6 6-5 0-6-2z" fill="#d99a80"/><path d="M9 12c1-1.5 3-2 5-1.5" stroke="#b87a62" stroke-width="1" stroke-linecap="round"/></svg>',
tofu:'<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="9" width="12" height="10" rx="1.5" fill="#f5f3ea"/><rect x="6" y="9" width="12" height="3" rx="1.5" fill="#fff"/></svg>',
fish:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12c2-3 5-5 8-5s6 2 8 5c-2 3-5 5-8 5s-6-2-8-5z" fill="#b8c4c9"/><path d="M19 12l3-3v6l-3-3z" fill="#9aa8ad"/><circle cx="8" cy="11" r=".8" fill="#333"/></svg>',
tomato:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="14" r="7" fill="#d45d4e"/><path d="M12 7l-1.5-2 2 1 1.5-1.5-.5 2 2 .5-2 1.5z" fill="#6a994e"/><ellipse cx="9" cy="12" rx="1.5" ry="2" fill="#e88a7d" opacity=".6"/></svg>',
mushroom:'<svg viewBox="0 0 24 24" fill="none"><path d="M5 11c0-4 3-6 7-6s7 2 7 6H5z" fill="#a67c52"/><rect x="10" y="11" width="4" height="7" rx="1.5" fill="#f0e8d8"/><circle cx="9" cy="9" r="1" fill="#d4b896"/><circle cx="15" cy="8" r="1" fill="#d4b896"/></svg>',
carrot:'<svg viewBox="0 0 24 24" fill="none"><path d="M12 10c2 3 3 7 2 10H10c-1-3 0-7 2-10z" fill="#e8873a"/><path d="M12 10c-1-2-2-4-1-6 1 1 2 2 3 3-1 1-1 2-2 3z" fill="#6a994e"/></svg>',
greens:'<svg viewBox="0 0 24 24" fill="none"><path d="M12 20V10" stroke="#5a7a4a" stroke-width="1.5"/><path d="M12 12c-3-1-5-4-4-7 3 0 5 2 5 4 0 2-1 3-1 3z" fill="#7a9a6a"/><path d="M12 14c3-1 5-4 4-7-3 0-5 2-5 4 0 2 1 3 1 3z" fill="#8bab7b"/></svg>',
salt:'<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="6" width="6" height="12" rx="1" fill="#e8e8e8"/><rect x="9" y="6" width="6" height="3" fill="#fff"/><circle cx="11" cy="13" r=".8" fill="#ccc"/><circle cx="13" cy="15" r=".8" fill="#ccc"/></svg>',
sugar:'<svg viewBox="0 0 24 24" fill="none"><rect x="7" y="8" width="10" height="10" rx="1" fill="#f5f0e0"/><circle cx="10" cy="11" r="1" fill="#e0d8c0"/><circle cx="14" cy="13" r="1" fill="#e0d8c0"/><circle cx="12" cy="15" r="1" fill="#e0d8c0"/></svg>',
soy:'<svg viewBox="0 0 24 24" fill="none"><path d="M12 6c3 4 5 7 5 9a5 5 0 0 1-10 0c0-2 2-5 5-9z" fill="#5c3d2e"/><ellipse cx="10" cy="14" rx="1" ry="1.5" fill="#7a5240"/></svg>',
chili:'<svg viewBox="0 0 24 24" fill="none"><path d="M6 8c0 6 4 10 10 10 2 0 3-1 3-2" stroke="#c44" stroke-width="2.5" stroke-linecap="round"/><path d="M6 8c0-2 2-3 4-2" stroke="#6a994e" stroke-width="2" stroke-linecap="round"/></svg>',
vinegar:'<svg viewBox="0 0 24 24" fill="none"><path d="M12 5c2 3 4 6 4 8a4 4 0 0 1-8 0c0-2 2-5 4-8z" fill="#b8956a"/><rect x="10" y="3" width="4" height="3" rx=".5" fill="#9a7a52"/></svg>',
cheese:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 15l14-6 2 8H6l-2-2z" fill="#e8c560"/><circle cx="10" cy="15" r="1.5" fill="#d4a845"/><circle cx="16" cy="13" r="1" fill="#d4a845"/></svg>',
honey:'<svg viewBox="0 0 24 24" fill="none"><path d="M12 5c3 4 5 7 5 9a5 5 0 0 1-10 0c0-2 2-5 5-9z" fill="#e8b840"/><ellipse cx="10" cy="13" rx="1" ry="1.5" fill="#f0d070"/></svg>',
chocolate:'<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="6" width="14" height="12" rx="1" fill="#5c3d2e"/><path d="M5 10h14M5 14h14M10 6v12M15 6v12" stroke="#4a2f22" stroke-width="1"/></svg>'
};

/* 盘子里的菜品布局 — 根据食材数量和类型排列 */
function dishPlatingArt(list){
 if(!list||!list.length)return '';
 var positions=[
  {x:'20%',y:'30%',s:28},
  {x:'55%',y:'25%',s:26},
  {x:'35%',y:'55%',s:30},
  {x:'60%',y:'58%',s:24},
  {x:'42%',y:'38%',s:22},
  {x:'25%',y:'60%',s:20}
 ];
 var html='';
 list.slice(0,6).forEach(function(item,i){
  var p=positions[i],art=ingredientArt[item.id]||'';
  if(!art)return;
  html+='<span class="dish-item dish-item-'+i+'" style="left:'+p.x+';top:'+p.y+';width:'+p.s+'px;height:'+p.s+'px">'+art+'</span>';
 });
 return html;
}
var selected={},activeCategory='all',roles=[],activeRole=null,currentDish=null,history=[],tasteMemory={},discoveries=[],progress={dishes:0,feedback:0,ingredients:[],unlocked:[]};
var cookBy='me'; // 'me' = 用户做的, 'them' = 角色做的
var CUSTOM_RECIPES_KEY='maomao_custom_recipes_v1';
var customRecipes=[];
function loadCustomRecipes(){
 try{customRecipes=JSON.parse(localStorage.getItem(CUSTOM_RECIPES_KEY)||'[]')}catch(e){customRecipes=[]}
 if(!Array.isArray(customRecipes))customRecipes=[];
}
function saveCustomRecipes(){
 try{localStorage.setItem(CUSTOM_RECIPES_KEY,JSON.stringify(customRecipes))}catch(e){showToast('保存失败，存储空间不足')}
}
var hiddenRecipes=[
{id:'midnight-rice',name:'深夜酱香蛋炒饭',required:['rice','egg','soy'],flavor:'深夜咸香',description:'米饭、鸡蛋与酱油在锅里相遇，像一份专门留给深夜的热乎心意。',event:'深夜厨房事件'},
{id:'sunset-egg',name:'日落芝士烘蛋',required:['egg','tomato','cheese'],flavor:'酸甜奶香',description:'番茄的酸甜托起芝士的浓郁，像把傍晚的暖光留在盘子里。',event:'日落试吃事件'},
{id:'rainy-noodles',name:'雨夜菌菇鸡汤面',required:['noodle','chicken','mushroom','soy'],flavor:'温润鲜香',description:'鸡肉与菌菇的鲜味落进面汤里，是适合雨天慢慢吃完的一碗。',event:'雨夜暖心事件'},
{id:'midnight-toast',name:'午夜蜂蜜巧克力吐司',required:['bread','honey','chocolate'],flavor:'甜润可可',description:'烘烤香、蜂蜜的甜润与巧克力的微苦叠在一起，是一份安静的小甜点。',event:'午夜甜点事件'}
];
var achievementDefs=[{id:'first-dish',title:'第一道作品',desc:'完成第一次烹饪',test:function(){return progress.dishes>=1}},{id:'hidden-dish',title:'发现隐藏料理',desc:'解锁任意一份隐藏配方',test:function(){return discoveries.length>=1}},{id:'five-dishes',title:'常驻厨房',desc:'累计完成 5 道料理',test:function(){return progress.dishes>=5}},{id:'ingredient-explorer',title:'食材漫游者',desc:'尝试过 8 种不同食材',test:function(){return progress.ingredients.length>=8}},{id:'taste-listener',title:'认真倾听',desc:'累计留下 3 次口味反馈',test:function(){return progress.feedback>=3}}];
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
 loadTasteMemory();
 $('roleName').textContent=roleName(activeRole);
 $('roleDescription').textContent=activeRole.description||activeRole.bio||activeRole.personality||'做好之后，TA 会给出反应';
 var src=roleAvatar(activeRole),mono=$('roleMonogram'),taste=$('tastingMonogram');
 mono.textContent=(roleName(activeRole).trim().charAt(0)||'?');mono.innerHTML='';
 taste.textContent=(roleName(activeRole).trim().charAt(0)||'?');taste.innerHTML='';
 if(src){var a=document.createElement('img');a.src=src;a.alt='';mono.appendChild(a);var b=document.createElement('img');b.src=src;b.alt='';taste.appendChild(b)}
 renderTasteMemory();
}
function tasteStorageKey(){return TASTE_PREFIX+String(activeRole&&activeRole.id||'unknown')}
function loadTasteMemory(){tasteMemory=safeJSON(localStorage.getItem(tasteStorageKey()),{likes:0,dislikes:0,flavors:{},ingredients:{},lastFeedback:''});if(!tasteMemory||typeof tasteMemory!=='object')tasteMemory={likes:0,dislikes:0,flavors:{},ingredients:{},lastFeedback:''};tasteMemory.flavors=tasteMemory.flavors||{};tasteMemory.ingredients=tasteMemory.ingredients||{}}
function renderTasteMemory(){var target=$('tasteMemoryText');if(!target)return;var top=Object.keys(tasteMemory.flavors||{}).sort(function(a,b){return tasteMemory.flavors[b]-tasteMemory.flavors[a]})[0],fav=Object.keys(tasteMemory.ingredients||{}).sort(function(a,b){return tasteMemory.ingredients[b]-tasteMemory.ingredients[a]})[0];if(!tasteMemory.likes&&!tasteMemory.dislikes){target.textContent='还没有记录。每次试吃后，可以慢慢了解 TA 喜欢什么。';return}var bits=['已记录 '+(tasteMemory.likes+tasteMemory.dislikes)+' 次反馈'];if(top&&tasteMemory.flavors[top]>0)bits.push('偏好风味：'+top);if(fav&&tasteMemory.ingredients[fav]>0)bits.push('偏好食材：'+fav);target.textContent=bits.join(' · ')}
function saveTasteFeedback(liked){if(!currentDish||currentDish.tasteFeedback){showToast('这道菜的口味反馈已经记过啦');return}loadTasteMemory();var p=currentDish.profile||{},flavor=p.flavor||'自由风味';if(liked)tasteMemory.likes=(tasteMemory.likes||0)+1;else tasteMemory.dislikes=(tasteMemory.dislikes||0)+1;tasteMemory.flavors[flavor]=(tasteMemory.flavors[flavor]||0)+(liked?1:-1);(p.ingredients||[]).forEach(function(item){var n=item.name;tasteMemory.ingredients[n]=(tasteMemory.ingredients[n]||0)+(liked?1:-1)});tasteMemory.lastFeedback=(liked?'喜欢':'不太合口味')+'：'+(currentDish.name||'未命名菜品');currentDish.tasteFeedback=liked?'liked':'disliked';progress.feedback++;checkAchievements();saveProgress();renderKitchenProgress();try{localStorage.setItem(tasteStorageKey(),JSON.stringify(tasteMemory))}catch(e){showToast('口味档案暂时无法保存');return}$('tasteLiked').classList.toggle('selected',liked);$('tasteDisliked').classList.toggle('selected',!liked);$('tasteFeedbackNote').textContent=liked?'记下啦。下次试吃会参考这次的风味和食材。':'记下啦。之后会尝试避开类似的搭配，或让 TA 给出更谨慎的评价。';renderTasteMemory();saveHistory();showToast('已更新 '+roleName(activeRole)+' 的口味档案')}
function loadProgress(){discoveries=safeJSON(localStorage.getItem(DISCOVERY_KEY),[]);if(!Array.isArray(discoveries))discoveries=[];progress=safeJSON(localStorage.getItem(ACHIEVEMENT_KEY),{dishes:0,feedback:0,ingredients:[],unlocked:[]});if(!progress||typeof progress!=='object')progress={dishes:0,feedback:0,ingredients:[],unlocked:[]};progress.dishes=Number(progress.dishes)||0;progress.feedback=Number(progress.feedback)||0;progress.ingredients=Array.isArray(progress.ingredients)?progress.ingredients:[];progress.unlocked=Array.isArray(progress.unlocked)?progress.unlocked:[];checkAchievements();renderKitchenProgress()}
function saveProgress(){try{localStorage.setItem(DISCOVERY_KEY,JSON.stringify(discoveries));localStorage.setItem(ACHIEVEMENT_KEY,JSON.stringify(progress))}catch(e){showToast('图鉴空间不足，进度暂时无法保存')}}
function checkAchievements(){achievementDefs.forEach(function(def){if(def.test()&&progress.unlocked.indexOf(def.id)<0)progress.unlocked.push(def.id)})}
function renderKitchenProgress(){
 var dc=$('discoveryCount'),ac=$('achievementCount'),dl=$('discoveryList'),al=$('achievementList');
 if(!dc||!ac||!dl||!al)return;
 var allRecipes=hiddenRecipes.concat(customRecipes);
 dc.textContent=discoveries.length+'/'+allRecipes.length;
 ac.textContent=progress.unlocked.length+'/'+achievementDefs.length;
 dl.innerHTML='';
 allRecipes.forEach(function(recipe){
  var found=discoveries.indexOf(recipe.id)>=0,row=document.createElement('div');
  row.className='kitchen-record'+(found?' unlocked':'');
  var title=document.createElement('strong'),desc=document.createElement('span');
  title.textContent=found?recipe.name:'未发现的料理';
  desc.textContent=found?(recipe.flavor+' · 已收入图鉴'):recipe.custom?'你的自定义配方':'尝试不同食材的特定组合';
  row.append(title,desc);
  dl.appendChild(row)
 });
 al.innerHTML='';achievementDefs.forEach(function(def){var found=progress.unlocked.indexOf(def.id)>=0,row=document.createElement('div');row.className='kitchen-record'+(found?' unlocked':'');var title=document.createElement('strong'),desc=document.createElement('span');title.textContent=(found?'已解锁 / ':'待解锁 / ')+def.title;desc.textContent=def.desc;row.append(title,desc);al.appendChild(row)})
}
function registerCookedDish(profile){progress.dishes++;(profile.ingredients||[]).forEach(function(item){if(progress.ingredients.indexOf(item.id)<0)progress.ingredients.push(item.id)});if(profile.specialRecipe&&discoveries.indexOf(profile.specialRecipe.id)<0){discoveries.push(profile.specialRecipe.id);showToast('发现隐藏料理：'+profile.specialRecipe.name)}checkAchievements();saveProgress();renderKitchenProgress()}
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
  var art=ingredientArt[x.id]||'';
  btn.innerHTML='<span class="ingredient-visual" style="background:#fafaf7">'+art+'</span><span class="ingredient-name"></span><span class="ingredient-note"></span>';
  btn.querySelector('.ingredient-name').textContent=x.name;btn.querySelector('.ingredient-note').textContent=x.note;
  btn.onclick=function(){selected[x.id]=Math.min(5,(selected[x.id]||0)+1);renderIngredients();renderPot()};
  if(n){var q=document.createElement('div');q.className='quantity';q.innerHTML='<button type="button" aria-label="减少用量">−</button><span>'+n+'</span><button type="button" aria-label="增加用量">+</button>';q.children[0].onclick=function(e){e.stopPropagation();selected[x.id]=Math.max(0,(selected[x.id]||0)-1);if(!selected[x.id])delete selected[x.id];renderIngredients();renderPot()};q.children[2].onclick=function(e){e.stopPropagation();selected[x.id]=Math.min(5,(selected[x.id]||0)+1);renderIngredients();renderPot()};btn.appendChild(q)}
  grid.appendChild(btn)
 })
}
function renderPot(){
 var list=chosen(),pot=$('potContents');pot.innerHTML='';
 if(!list.length){pot.innerHTML='<span class="empty-pot">锅里还空着<br><small>先挑几样食材</small></span>'}
 else list.forEach(function(x){for(var i=0;i<Math.min(x.quantity,2);i++){var wrap=document.createElement('span');wrap.className='pot-ingredient';wrap.title=x.name;wrap.innerHTML=ingredientArt[x.id]||'';pot.appendChild(wrap)}});
 $('ingredientCount').textContent=String(count()).padStart(2,'0')+' INGREDIENT'+(count()===1?'':'S');
 $('footerCount').textContent=count();$('cookButton').disabled=count()===0;
 $('ingredientSummary').textContent=list.length?list.map(function(x){return x.name+(x.quantity>1?' ×'+x.quantity:'')}).join(' · '):'从下面选食材，点选即可加入锅中。';
}
function tasteProfile(list){
 var tags=list.reduce(function(a,x){return a.concat(x.tags)},[]),flavors=list.map(function(x){return x.flavor});
 var unique=[...new Set(flavors)],has=function(id){return !!selected[id]};
 var odd=(has('chocolate')&&(has('soy')||has('fish')||has('chili')))||(has('honey')&&has('vinegar')&&has('chili'))||(has('bread')&&has('soy')&&has('sugar'));
 var ids=list.map(function(x){return x.id}).sort();
 // 先找内置隐藏配方
 var recipe=hiddenRecipes.find(function(r){return r.required.length===ids.length&&r.required.slice().sort().every(function(id,i){return id===ids[i]})})||null;
 // 再找自定义配方
 if(!recipe){
  recipe=customRecipes.find(function(r){return r.required&&r.required.length===ids.length&&r.required.slice().sort().every(function(id,i){return id===ids[i]})})||null;
 }
 var sweet=tags.indexOf('甜')>=0,spicy=has('chili'),acid=has('vinegar')||has('tomato'),protein=list.some(function(x){return x.category==='protein'}),staple=list.some(function(x){return x.category==='staple'}),veg=list.some(function(x){return x.category==='vegetable'});
 var flavor=recipe?recipe.flavor:odd?'实验性搭配':spicy?(acid?'酸辣开胃':'辛香浓郁'):sweet?(protein?'甜咸混搭':'甜口系'):acid?'清爽微酸':protein&&veg?'鲜香均衡':staple?'温和饱腹':'自由风味';
 var names=[];if(staple)names.push(list.find(function(x){return x.category==='staple'}).name);if(protein)names.push(list.find(function(x){return x.category==='protein'}).name);if(veg)names.push(list.find(function(x){return x.category==='vegetable'}).name);
 var dishName=recipe?recipe.name:odd?'灵感失控实验碗':names.length?names.slice(0,2).join('与')+'小料理':list.length>2?list[0].name+'的自由组合':list.map(function(x){return x.name}).join('与')+'小食';
 var description=recipe?recipe.description:odd?'这道菜大胆得有点出乎意料。味道之间正在进行一场不太按常理出牌的碰撞。':protein&&veg&&staple?'主食、鲜味与蔬菜凑在了一起，是一道层次比较完整的家常风格组合。':sweet?'甜味成为了这道菜的主角，像是一次不太严肃的厨房实验。':spicy?'辛香先声夺人，适合喜欢鲜明味道的试吃员。':'没有固定菜谱的限制，食材各自留下自己的味道，最后拼成了这一份独家组合。';
 return {flavor:flavor,description:description,odd:odd,dishName:dishName,ingredients:list,tags:tags,specialRecipe:recipe};
}
function setStage(stage){
 ['cookStage','dishStage','tastingStage'].forEach(function(id){$(id).hidden=id!==stage});
 window.scrollTo({top:0,behavior:'smooth'});
}
function cook(){
 var isThem=cookBy==='them';
 if(isThem){
  // TA来做：自动选食材
  randomIngredientsForThem();
  renderIngredients();
  renderPot();
 }
 var list=chosen();if(!list.length)return;

 // 判断是炒菜还是煮汤，换厨具
 var hasSoupBase=list.some(function(x){return x.id==='noodle'||x.id==='rice'||x.id==='potato'});
 var utensil=$('potUtensil');
 if(hasSoupBase){
  utensil.className='pot-utensil ladle';
  // 汤勺：长手柄斜靠锅边，勺头浸在汤里
  utensil.innerHTML='<svg viewBox="0 0 44 70" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="18" y2="48"/><ellipse cx="18" cy="55" rx="10" ry="7" fill="#bbb" stroke="#999"/></svg>';
 }else{
  utensil.className='pot-utensil spatula';
  // 锅铲：长手柄，铲头平的
  utensil.innerHTML='<svg viewBox="0 0 44 70" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="19" y2="45"/><rect x="12" y="45" width="14" height="12" rx="2" fill="#bbb" stroke="#999"/></svg>';
 }

 $('potScene').classList.add('cooking');
 $('cookButton').disabled=true;
 $('cookButton').innerHTML=isThem?'TA正在做饭…':(hasSoupBase?'正在煮汤…':'正在炒菜…');
 setTimeout(function(){
  $('potScene').classList.remove('cooking');
  $('cookButton').innerHTML=isThem?'等TA做饭 <span>→</span>':'开始烹饪 ';
  $('cookButton').disabled=false;
  var profile=tasteProfile(list);
  currentDish={id:'dish_'+Date.now(),name:profile.dishName,profile:profile,roleId:activeRole.id,roleName:roleName(activeRole),createdAt:new Date().toISOString(),reaction:'',cookBy:cookBy};
  registerCookedDish(profile);
  $('dishName').value=currentDish.name;
  $('dishFlavor').textContent=profile.flavor;
  $('dishCount').textContent=count()+' 份食材';
  $('dishDescription').textContent=isThem?(profile.specialRecipe?profile.description:roleName(activeRole)+'随手做的一道菜，卖相看起来还不错。'):profile.description;
  var dishFoodEl=$('dishFood');
  dishFoodEl.style.background='radial-gradient(circle at 50% 50%,#f8f6f0,#e8e6e0 85%)';
  dishFoodEl.innerHTML=dishPlatingArt(list);
  $('usedIngredients').innerHTML='';list.forEach(function(x){var tag=document.createElement('span');tag.className='used-ingredient';tag.textContent=x.name+(x.quantity>1?' ×'+x.quantity:'');$('usedIngredients').appendChild(tag)});
  $('dishArt').querySelector('.dish-index').textContent=isThem?'MADE BY '+roleName(activeRole).toUpperCase()+' / 001':'MADE BY YOU / '+String(history.length+1).padStart(3,'0');
  // 出锅页面标题反过来
  document.querySelector('#dishStage .stage-heading h2').textContent=isThem?'TA做了这道菜。':'这道菜，出锅了。';
  document.querySelector('#dishStage .stage-heading .eyebrow').textContent=isThem?'02 / PLATED BY THEM':'02 / PLATE';
  $('serveButton').textContent=isThem?'我来尝尝 ':'端给TA ';
  setStage('dishStage');
 },isThem?1500:1000);
}
function localReaction(profile){
 var name=roleName(activeRole),personality=String(activeRole.personality||activeRole.character||activeRole.profile||'').toLowerCase();
 var kind=profile.odd?'奇怪但有趣':profile.flavor.indexOf('甜')>=0?'甜口':profile.flavor.indexOf('辛')>=0?'重口':profile.flavor.indexOf('均衡')>=0?'均衡':'新鲜';
 var lines=profile.odd?['……你真的把这些放在一起了？我得承认，我很好奇。','这味道有点出乎意料。下次我们可以试试少放一点特别的那种。','我先观察一下。你是不是故意想看我的反应？']:profile.flavor.indexOf('甜')>=0?['这个味道意外地讨喜。你是不是记得我会喜欢这种？','甜度挺明显的，不过还蛮有你的风格。','嗯，这一口有点像今天的小惊喜。']:profile.flavor.indexOf('辛')>=0?['第一口就很有存在感……你这是在考验我的接受能力吗？','这个味道很直接，我喜欢你敢这么搭。','有点刺激，不过我愿意再尝一口。']:['搭配比我想象中更协调。你还挺会给人惊喜。','这个组合有点意思。下次要不要让我也来选两样？','能看出来你有认真想过怎么搭，味道也挺舒服。'];
 if(/冷淡|寡言|高冷/.test(personality))lines=['我尝过了。比想象中好。','……可以，再做一次。','搭配有点大胆，但不算差。'];
 if(/活泼|开朗|热情/.test(personality))lines=['哇，居然还不错！再给我一口！','这个组合好有创意，你是不是偷偷练过？','我宣布，这道菜今天有资格上桌！'];
 var flavorScore=(tasteMemory.flavors&&tasteMemory.flavors[profile.flavor])||0,ingredientScore=(profile.ingredients||[]).reduce(function(sum,item){return sum+((tasteMemory.ingredients&&tasteMemory.ingredients[item.name])||0)},0);var eventLine=profile.specialRecipe?({ 'midnight-rice':'你居然做出了深夜酱香蛋炒饭……这组合有种被认真照顾到的感觉。','sunset-egg':'番茄和芝士的味道意外合拍。这个配方，我想记住。','rainy-noodles':'这碗面很适合慢慢吃。今天好像真的被安慰到了。','midnight-toast':'蜂蜜和巧克力？这份甜点有点犯规，我想再尝一口。'}[profile.specialRecipe.id]||'这个隐藏配方让我有点惊喜。'):null;if(eventLine)lines=[eventLine];else if(flavorScore>0||ingredientScore>=2)lines=['你记得我喜欢这样的味道吧？这次真的很合口味。','这份搭配很对我的胃口，感觉你有认真记住之前的反馈。','嗯，这次比上次更合适了。我愿意把它列进喜欢的菜。'];else if(flavorScore<0||ingredientScore<=-2)lines=['这次的味道和我平常喜欢的有点不一样，不过我能感受到你的用心。','好像有一点点不太合口味。下次我们可以试着调整一下搭配。'];return {title:profile.specialRecipe?'发现隐藏料理！':profile.odd?'TA 有点意外。':profile.flavor.indexOf('均衡')>=0?'TA 看起来很满意。':'TA 认真尝了一口。',copy:profile.specialRecipe?name+'触发了「'+profile.specialRecipe.event+'」。':name+'先看了看菜品，然后终于尝了一口。',quote:lines[Math.floor(Math.random()*lines.length)]};
}
function beginTasting(){
 if(!currentDish)return;currentDish.tasteFeedback='';currentDish.name=$('dishName').value.trim()||currentDish.profile.dishName;
 var isThem=cookBy==='them';
 setStage('tastingStage');$('tastingActions').hidden=true;$('tasteFeedback').hidden=true;$('tasteLiked').classList.remove('selected');$('tasteDisliked').classList.remove('selected');
 $('tasteFeedbackNote').textContent='你的选择会记进 TA 的口味档案，影响之后的试吃反应。';

 if(isThem){
  // TA做的菜：我来尝，我来评价
  $('reactionKicker').textContent='TA 做的菜 / 你尝了';
  $('reactionTitle').textContent='你尝了一口。';
  $('reactionCopy').textContent=roleName(activeRole)+'满怀期待地看着你。';
  $('reactionQuote').textContent='“怎么样？好吃吗？”';
  $('reactionQuote').classList.remove('loading');
  $('tastingScene').classList.add('reacted');
  $('tasteFeedback').hidden=false;
  $('tasteFeedback').querySelector('p').textContent='这道菜，合你的口味吗？';
  $('tasteLiked').textContent='好吃！我很喜欢';
  $('tasteDisliked').textContent='好像差点意思';
  $('tastingActions').hidden=false;
  $('tastingActions').querySelector('#cookAgain').textContent='再让TA做一道';
  $('tastingActions').querySelector('#continueChat').textContent='跟TA聊聊 →';
  $('apiNote').textContent='这道菜是 '+roleName(activeRole)+' 做的。选完之后，去跟TA聊聊味道吧。';
  history.unshift(Object.assign({},currentDish));history=history.slice(0,60);saveHistory();renderHistoryCount();
  return;
 }

 // 我做的菜：TA来尝，TA评价
 $('reactionKicker').textContent='THE FIRST LOOK';
 $('reactionTitle').textContent=roleName(activeRole)+'看向了这道菜。';
 $('reactionCopy').textContent='TA 先观察了一下你准备的搭配。';
 $('reactionQuote').textContent='“嗯？今天做了什么？”';
 $('reactionQuote').classList.add('loading');
 $('tastingScene').classList.remove('reacted');
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
  $('tasteFeedback').hidden=false;$('tasteLiked').classList.remove('selected');$('tasteDisliked').classList.remove('selected');
  history.unshift(Object.assign({},currentDish));history=history.slice(0,60);saveHistory();renderHistoryCount();
 }
 if(!canCall){finish(local.quote,'local');return}
 var rolePrompt=[activeRole.description,activeRole.bio,activeRole.personality,activeRole.character,activeRole.speechStyle,activeRole.prompt,activeRole.systemPrompt].filter(Boolean).join('\n');
 var items=profile.ingredients.map(function(x){return x.name+(x.quantity>1?' ×'+x.quantity:'')}).join('、');
 var memory=tasteMemory||{},memoryLine=(memory.likes||memory.dislikes)?'过往一起做饭的口味记忆：你记得用户喜欢的风味有'+Object.keys(memory.flavors||{}).filter(function(k){return memory.flavors[k]>0}).join('、')+'，不太喜欢的有'+Object.keys(memory.flavors||{}).filter(function(k){return memory.flavors[k]<0}).join('、')+'。这些是你们一起在厨房做饭时慢慢积累的记忆，自然地融入反应里，不要机械复述。':'这是你们第一次一起在厨房做饭，还没有太多口味记忆，请自然地表达第一反应。';
 var isThem=cookBy==='them';
 var userPrompt=isThem
   ? '你（'+roleName(activeRole)+'）刚刚在你们俩的厨房里亲手做了一道菜，端到用户面前。菜名：'+currentDish.name+'。食材：'+items+'。风味：'+profile.flavor+'。组合特点：'+profile.description+'。'+(profile.specialRecipe?'这是你们一起发现的隐藏料理「'+profile.specialRecipe.name+'」，触发了「'+profile.specialRecipe.event+'」的专属时刻。':'')+memoryLine+'\n\n请以你本人的身份，说出你端出这道菜时会对用户说的话——带着点期待、有点小得意，或者温柔地看着用户尝第一口。像真实情侣在厨房里的互动，不要客服口吻，不要分析菜谱，不超过90个汉字。'
   : '用户刚刚在你们俩的厨房里亲手做了一道菜，端到你（'+roleName(activeRole)+'）面前请你试吃。菜名：'+currentDish.name+'。食材：'+items+'。风味：'+profile.flavor+'。组合特点：'+profile.description+'。'+(profile.specialRecipe?'这是你们一起发现的隐藏料理「'+profile.specialRecipe.name+'」，触发了「'+profile.specialRecipe.event+'」的专属时刻。':'')+memoryLine+'\n\n请以你本人的身份，说出你看到这道菜、尝第一口时会说的话——可以惊喜、吐槽、温柔回应，或者有点小感动。这是你们在自己厨房里的亲密互动，不是外面买的外卖，也不是餐厅点菜。像真实情侣在家做饭的感觉，不要客服口吻，不要分析菜谱，不超过90个汉字。';
 window.PhoneAPI.complete({system:'你正在 MAOMAO 小手机里扮演用户选定的聊天角色。保持角色人设和语气，不要声称真实存在。角色设定：'+rolePrompt+'\n\n【场景说明】\n这是你们两个人的专属厨房——不是外面的餐厅，不是外卖，不是买的菜。是你们俩一起在厨房里，一个人做饭、另一个人等着尝，或者两个人一起忙活的亲密日常。\n你要清楚地知道：这道菜是谁做的、是在你们自己的厨房里做的，而不是外面买来的。你的反应要带着「我们在自己家厨房」的那种熟悉感和亲密感。\n只输出角色会说的话，不要解释场景，不要分析菜谱。',user:userPrompt,temperature:0.85,timeoutMs:12000}).then(function(text){finish(text||local.quote,text?'ai':'local')}).catch(function(){finish(local.quote,'local')});
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
 var pending={dishName:currentDish.name,ingredients:currentDish.profile.ingredients.map(function(x){return x.name+(x.quantity>1?' ×'+x.quantity:'')}),flavor:currentDish.profile.flavor,reaction:currentDish.reaction,createdAt:currentDish.createdAt,cookBy:cookBy};
 try{localStorage.setItem(PENDING_PREFIX+String(activeRole.id),JSON.stringify(pending))}catch(e){}
 location.href='../chat/chat/chat-detail.html?id='+encodeURIComponent(activeRole.id)+'&cooking=1';
}
$('backButton').onclick=function(){if(window.history.length>1)window.history.back();else location.href='games.html'};
$('changeRole').onclick=function(){var box=$('roleOptions');if(!roles.length){showToast('暂未找到角色，请先在聊天角色管理中创建');return}box.hidden=!box.hidden;if(!box.hidden){box.innerHTML='';roles.forEach(function(r){var b=document.createElement('button');b.type='button';b.className='role-option'+(String(r.id)===String(activeRole.id)?' active':'');b.textContent=roleName(r);b.onclick=function(){activeRole=r;localStorage.setItem(ROLE_KEY,String(r.id));renderRole();box.hidden=true};box.appendChild(b)})}};
$('clearIngredients').onclick=function(){selected={};renderIngredients();renderPot()};
$('cookButton').onclick=cook;$('editDish').onclick=function(){setStage('cookStage')};$('serveButton').onclick=beginTasting;$('continueChat').onclick=continueChat;$('cookAgain').onclick=function(){selected={};currentDish=null;renderIngredients();renderPot();setStage('cookStage')};
$('historyButton').onclick=openHistory;$('closeHistory').onclick=function(){$('historyPanel').hidden=true};
$('tasteLiked').onclick=function(){saveTasteFeedback(true)};$('tasteDisliked').onclick=function(){saveTasteFeedback(false)};

// 谁来做 切换
document.querySelectorAll('.cook-by-btn').forEach(function(btn){
 btn.onclick=function(){
  cookBy=btn.getAttribute('data-cook-by');
  document.querySelectorAll('.cook-by-btn').forEach(function(b){b.classList.toggle('active',b===btn)});
  updateCookByMode();
 };
});

// 添加自定义菜品
$('addCustomRecipe').onclick=function(){
 var name=prompt('给这道新菜取个名字：');
 if(!name||!name.trim())return;
 name=name.trim();
 var requiredStr=prompt('需要哪些食材？用食材名，逗号分隔。\n比如：鸡蛋,番茄,米饭\n\n可选食材：'+ingredients.map(function(x){return x.name}).join('、'));
 if(!requiredStr||!requiredStr.trim())return;
 var requiredIds=[];
 requiredStr.split(/[,，、]/).forEach(function(s){
  s=s.trim();
  var match=ingredients.find(function(x){return x.name===s});
  if(match)requiredIds.push(match.id);
 });
 if(requiredIds.length<2){showToast('至少需要选2种食材哦');return}
 customRecipes.push({
  id:'custom-'+Date.now(),
  name:name,
  required:requiredIds,
  flavor:'自定义配方',
  description:'这是你自己发明的独家菜品。',
  event:'自定义菜品事件',
  custom:true
 });
 saveCustomRecipes();
 renderKitchenProgress();
 showToast('已添加到图鉴：'+name);
};

function updateCookByMode(){
 var isThem=cookBy==='them';
 document.body.classList.toggle('cook-by-them',isThem);
 var btn=$('cookButton');
 if(isThem){
  // TA来做模式：隐藏食材选择，按钮变成"开始等TA做"
  btn.innerHTML='等TA做饭 <span>→</span>';
  btn.disabled=false;
  $('cookButton').classList.add('them-mode');
  $('ingredientSummary').textContent=roleName(activeRole)+'正在想着要给你做什么菜…';
 }else{
  btn.innerHTML='开始烹饪 ';
  btn.disabled=count()===0;
  $('cookButton').classList.remove('them-mode');
  renderPot(); // 恢复原来的提示文字
 }
}

// 随机选食材（TA做饭用）
function randomIngredientsForThem(){
 var shuffled=ingredients.slice().sort(function(){return Math.random()-0.5});
 var count=2+Math.floor(Math.random()*3); // 2~4样
 var picked=shuffled.slice(0,count);
 selected={};
 picked.forEach(function(x){selected[x.id]=1});
}

loadRoles();loadHistory();loadProgress();loadCustomRecipes();renderCategories();renderIngredients();renderPot();
})();