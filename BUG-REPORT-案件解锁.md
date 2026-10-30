# 侦探案件解锁 Bug 报告

## 项目
- 路径：`C:\Users\32770\Desktop\phone-app`
- 纯静态 HTML/JS 项目，仿手机桌面，用浏览器打开 `index.html` 进入
- 侦探游戏入口：`games/games.html`（约 30 万字符的单文件）
- 沉浸式查案流程：`games/js/immersive-v21.js`

## 现象
- 案件 01「潮汐档案室的最后一夜」已正确指认结案，卡片右上角红色"已结案"印章亮着
- 但案件 02「走廊尽头的17号房」仍显示灰色"完成上一案后解锁"，按钮 disabled，点不进去
- 案件 01 底部状态文字显示"可调查"而不是"✓ 已结案"
- 已尝试重置存档、强制刷新、清缓存、Service Worker 注销，均无效

## 诊断数据（用户浏览器实际 localStorage）
通过 `games/diagnose.html` 读到：
```
maomao_game_role = role_3

maomao_detective_progress_v1 = {
  "role_3": {
    "completed": [0],
    "attempts": {},
    "notes": {
      "潮汐档案室的最后一夜": {"result":"solved","day":"2026-10-29","legacy":true}
    },
    "campaign": {"trust":{},"flags":[],"threads":[],"choices":[]}
  },
  "default-partner": {
    "completed": [0],
    "notes": {
      "潮汐档案室的最后一夜": {
        "result":"solved","day":"2026-10-29",
        "suspect":"贺知远","evidence":7,"source":"immersive"
      }
    },
    "attempts": {},
    "campaign": {"trust":{},"flags":[],"threads":[],"choices":[]}
  }
}

immCasesDone = [0]
maomao_detective_immersive_progress_migrated_v1 = 1
maomao_detective_team_v1 = ["role_3","role_1","role_2"]
```

**关键矛盾**：数据里 `role_3.completed = [0]`，按代码逻辑案件 02 应该解锁，但实际 UI 仍锁定。这说明用户浏览器里跑的 `games.html` **不是磁盘上最新版本**，或者读取的 progress key 与 `role_3` 对不上。

## 关键代码位置

### 1. 案件数据 `games/games.html` 约 880-898 行
```js
var CASES = [
  {title:'潮汐档案室的最后一夜', ..., answer: 1, suspects:[...]},
  {title:'走廊尽头的17号房', ..., answer: 1, suspects:[...]},
  ...
];
```

### 2. 进度读写 `games/games.html` 约 900-904 行
```js
function caseProgressRoot(){try{return JSON.parse(localStorage.getItem('maomao_detective_progress_v1')||'{}')||{};}catch(e){return {};}}
function caseProgress(){
  var all=caseProgressRoot(),
      key=String(activeRole&&activeRole.id||'default-partner');
  if(!all[key]) all[key]={completed:[],attempts:{},notes:{},campaign:{...}};
  ...
  return all[key];
}
function saveCaseProgress(progress){
  var all=caseProgressRoot();
  all[String(activeRole&&activeRole.id||'default-partner')]=progress||caseProgress();
  localStorage.setItem('maomao_detective_progress_v1',JSON.stringify(all));
}
```

### 3. 角色加载 `games/games.html` 约 633-644 行
```js
function loadRoles(){
  var list=[];
  try{
    if(window.PhoneStorage&&typeof window.PhoneStorage.getCharacters==='function')
      list=window.PhoneStorage.getCharacters()||[];
    if(!Array.isArray(list)||!list.length){
      var raw=localStorage.getItem('ai_custom_characters');
      list=raw?JSON.parse(raw):[];
    }
  }catch(e){list=[];}
  roleList=(Array.isArray(list)?list:[]).filter(function(r){return r&&r.id;});
  if(!roleList.length) roleList=[defaultRole];
  var wanted=localStorage.getItem('maomao_game_role'); // = "role_3"
  activeRole=roleList.find(function(r){return String(r.id)===String(wanted);})||roleList[0];
  localStorage.setItem('maomao_game_role',String(activeRole.id));
}
```
**嫌疑点**：如果 `roleList` 里没有 `id==="role_3"` 的角色，`activeRole` 会 fallback 到 `roleList[0]`，其 id 可能不是 `role_3`，导致 `caseProgress()` 读的是另一个 key 下的空进度。但诊断显示 `role_3.completed=[0]` 是有值的，需要确认 `roleList[0]` 的实际 id。

### 4. 档案室渲染（已被我改过，但用户说没生效）`games/games.html` 约 925-934 行
```js
function startCase(){
  ...
  var progress=caseProgress(),team=detectiveTeam();
  CASES.forEach(function(c,idx){
    if(progress.notes[c.title]&&progress.notes[c.title].result==='solved'
       &&progress.completed.indexOf(idx)<0) progress.completed.push(idx);
  });
  // 我加的：合并全局 immCasesDone
  try{
    var _legacyDone=JSON.parse(localStorage.getItem('immCasesDone')||'[]');
    if(Array.isArray(_legacyDone)){
      var _today=new Date().toISOString().slice(0,10);
      _legacyDone.forEach(function(v){
        var n=Number(v);
        if(isFinite(n)&&n>=0&&Math.floor(n)===n&&n<CASES.length){
          if(progress.completed.indexOf(n)<0) progress.completed.push(n);
          if(!progress.notes[CASES[n].title])
            progress.notes[CASES[n].title]={result:'solved',day:_today,legacy:true};
        }
      });
    }
  }catch(e){}
  saveCaseProgress(progress);
  var _immDone=[];
  try{
    var _r=JSON.parse(localStorage.getItem('immCasesDone')||'[]');
    if(Array.isArray(_r)) _immDone=_r.map(Number);
  }catch(e){}
  function _isCaseDone(i){
    return progress.completed.indexOf(i)>=0||_immDone.indexOf(i)>=0;
  }
  byId('gameContent').innerHTML='...' +
    CASES.map(function(c,i){
      var done=_isCaseDone(i),
          locked=i>0&&!_isCaseDone(i-1);
      return '<button ... '+(locked?'disabled':'')+'>...'+
             (done?'✓ 已结案':locked?'完成上一案后解锁':i===0?'可调查':'待调查')+
             '</button>';
    }).join('') + '...';
```

### 5. 沉浸式结案写进度 `games/js/immersive-v21.js` 约 771-809 行
```js
function recordSolvedCaseInArchive(){
  var cc=c();
  // 写全局 immCasesDone
  var done=JSON.parse(localStorage.getItem('immCasesDone')||'[]');
  if(done.indexOf(IMM.caseIndex)<0) done.push(IMM.caseIndex);
  localStorage.setItem('immCasesDone',JSON.stringify(done));
  // 写按角色 maomao_detective_progress_v1
  var all=JSON.parse(localStorage.getItem('maomao_detective_progress_v1')||'{}')||{};
  var key=detectiveProgressKey(); // = String(activeRole.id) || 'default-partner'
  var progress=all[key]&&typeof all[key]==='object'?all[key]:{};
  if(!Array.isArray(progress.completed)) progress.completed=[];
  if(progress.completed.indexOf(IMM.caseIndex)<0) progress.completed.push(IMM.caseIndex);
  progress.notes[cc.title]={result:'solved',...,source:'immersive'};
  all[key]=progress;
  localStorage.setItem('maomao_detective_progress_v1',JSON.stringify(all));
}
```

### 6. 沉浸式拦截卡片点击 `games/js/immersive-v21.js` 约 966-974 行
```js
document.addEventListener('click',function(e){
  var card=e.target.closest?e.target.closest('.case-archive-item[data-open-case]'):null;
  if(card&&!card.disabled){
    e.stopPropagation();e.preventDefault();
    openImmersive(Number(card.getAttribute('data-open-case')));
  }
},true);
```

## 已尝试过的修复（均未解决）
1. 在 `startCase` 里加 notes 自愈逻辑
2. 在 `startCase` 里加 `immCasesDone` 合并到 `progress.completed`
3. 解锁判定改为 `_isCaseDone(i)` 同时查 `progress.completed` 和 `immCasesDone`
4. 升级 `sw.js` 版本号 v123→v124
5. 做了 `games/reset-cases.html` 清 localStorage + 注销 Service Worker + 清 caches
6. 做了 `games/force-unlock.html` 把所有角色槽的 completed 都补上 [0]
7. 做了 `games/diagnose.html` 读取实际 localStorage 数据

## 最可能的原因（待其他 AI 验证）
1. **用户实际运行的不是磁盘上的 games.html**：可能是 Android WebView 打包版本（项目里有 `android/` 目录和 `.github/workflows/build-android-apk.yml`），用户在手机上玩，改磁盘文件不影响手机 App
2. **index.html 里有 iframe 或缓存机制**：用户从手机桌面图标进的是 `index.html`，它可能内嵌了旧版 games.html
3. **activeRole 实际不是 role_3**：`loadRoles()` 里如果 `ai_custom_characters` 里没有 role_3 这个角色，会 fallback 到 roleList[0]，而 roleList[0] 的 id 可能是别的（比如新建角色时 id 是别的格式）。需要在浏览器控制台跑 `console.log(activeRole, roleList)` 确认
4. **games.html 有多个副本或构建产物**：`.trae-html-share-packages/` 或 `dist/` 目录里可能有打包后的旧版本

## 建议其他 AI 的排查步骤
1. 让用户在 games.html 页面按 F12 打开控制台，跑：
   ```js
   console.log('activeRole=', activeRole);
   console.log('roleList=', roleList.map(r=>r.id));
   console.log('progress=', caseProgress());
   console.log('immCasesDone=', localStorage.getItem('immCasesDone'));
   ```
   把输出截图发出来，一眼就能看出 activeRole 是谁、progress 从哪个 key 读的
2. 确认用户是在浏览器里直接打开 games.html，还是在手机 App 里玩
3. 检查 index.html 是怎么加载 games.html 的（iframe? window.open? location.href?）
4. 如果是打包版，需要改源码后重新构建
