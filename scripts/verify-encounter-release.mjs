#!/usr/bin/env node
/**
 * 「邂逅」本地发布门禁。只读检查；不会合并 PR、部署 Worker 或写真实账号数据库。
 * 推荐执行顺序：
 *   npm ci
 *   npm run build
 *   npm run test:encounter
 *   npm run test:encounter:browser
 *   npm run gate:encounter
 *
 * Android/iOS 真机、正式账号桥接和生产恢复验收仍须单独确认。
 */
import {readFileSync,existsSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const path=name=>resolve(root,name);
const errors=[],results=[];
const requireFile=(name,why)=>{
  if(!existsSync(path(name))){errors.push(name+' 缺失：'+why);return false;}
  results.push(name+' 存在');return true;
};
const read=name=>existsSync(path(name))?readFileSync(path(name),'utf8'):'';
const requirePattern=(name,regex,why)=>{
  const source=read(name);
  if(!regex.test(source))errors.push(name+' 验证失败：'+why);
  else results.push(name+' '+why);
};

requireFile('account/index.html','必须先整合并验收正式 MAO 登录（账号 PR #290）');
requireFile('account/account.js','必须复用已验证的 MAO 账号入口');
requireFile('shared/js/mao-account-scope.js','禁止新建第二套账号隔离');
requireFile('encounter/encounter.html','抽卡页面未进入工程');
requireFile('encounter/encounter-engine.js','本地候选引擎缺失');
requireFile('tests/encounter-contract.test.mjs','无角色/存储合同测试');
requireFile('tests/encounter-actual-scope.test.mjs','缺真实账号隔离测试');
requireFile('tests/encounter-ui-contract.test.mjs','无真实手势状态模拟测试');
requireFile('tests/encounter-browser.mjs','无浏览器端到端验收脚本');
requirePattern('worker.js',/mao-account-scope\.js\?v=2/,'Worker 必须注入正式账号隔离脚本');
requirePattern('sw.js',/req\.mode === 'navigate' && !isPublicAccountPage/,'私有 HTML 导航必须走 Worker 验证');
requirePattern('sw.js',/requestedAccountId !== account\.id/,'字体资源不得跨账号复用');
requirePattern('shared/js/font-loader.js',/fontAssetPath \+= encodeURIComponent\(maoScope\.accountId\)/,'字体 URL 必须使用原账号隔离逻辑');
requirePattern('encounter/encounter-engine.js',/maomao_encounter_card_v2:/,'候选必须逐条保存，不得回退整包覆盖');
requirePattern('encounter/encounter-engine.js',/manager\.request\('maomao:encounter:v2:/,'支持 Web Locks 时须序列化跨标签写入');
requirePattern('index.html',/data-href="encounter\/encounter\.html" data-drag="app_encounter"/,'必须有真实桌面入口');
requirePattern('index.html',/function addEncounterShortcutToExistingLayouts\(\)/,'旧用户桌面布局不可丢失入口');

for(const item of [
  'dist/index.html',
  'dist/account/index.html',
  'dist/encounter/encounter.html',
  'dist/encounter/encounter-engine.js',
  'dist/shared/js/mao-account-scope.js',
  'dist/pwa-pages.json'
]){
  requireFile(item,'请先运行完整 npm run build，并验证正式 PWA 产物');
}
if(existsSync(path('dist/pwa-pages.json'))){
  try{
    const pages=JSON.parse(read('dist/pwa-pages.json'));
    if(!Array.isArray(pages)||!pages.includes('encounter/encounter.html')||
       !pages.includes('account/index.html'))errors.push('PWA 清单缺少邂逅或正式账号页面');
  }catch(e){errors.push('PWA 页面清单不是有效 JSON');}
}
for(const width of [375,390,430]){
  requireFile('test-results/encounter-'+width+'.png',
    '需实际执行 Playwright 浏览器测试并留存手机宽度截图');
}
requireFile('test-results/encounter-original-role-editor.png',
  '需真实跑通候选进入角色编辑器、创建、刷新、JSON 导出与重新导入');

// 构建与截图必须由同一次 Git HEAD 的实际运行生成，旧图片不能混过门禁。
const parseReceipt=name=>{
  if(!requireFile(name,'缺少该版本真实执行回执，不接受旧截图或旧构建'))return null;
  try{
    const receipt=JSON.parse(read(name));
    if(!receipt || receipt.schemaVersion!==1)throw new Error('回执版本错误');
    return receipt;
  }catch(error){errors.push(name+' 无效：'+error.message);return null;}
};
let head='';
try{
  head=execFileSync('git',['rev-parse','HEAD'],{
    cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']
  }).trim();
  const dirty=execFileSync('git',['status','--porcelain','--untracked-files=normal'],{
    cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']
  }).trim();
  if(dirty)errors.push('工作区有未提交修改，测试回执无法与正在验收的代码一致');
}catch(e){errors.push('无法读取 Git HEAD 或工作区状态，不能确认当前测试版本');}
const accountTest=parseReceipt('test-results/encounter-account-test-receipt.json');
const encounterTest=parseReceipt('test-results/encounter-encounter-test-receipt.json');
for(const [kind,receipt] of [['account',accountTest],['encounter',encounterTest]]){
  if(!receipt)continue;
  if(receipt.kind!==kind || receipt.source!=='native-node-test' ||
      !Number.isFinite(receipt.finishedAt)){
    errors.push(kind+' 原生 Node 测试回执格式无效');
  }
  if(head && receipt.gitHead!==head){
    errors.push(kind+' Node 回归来自旧 Git 提交，必须重新测试');
  }
}
const built=parseReceipt('dist/encounter-build-receipt.json');
const browsed=parseReceipt('test-results/encounter-browser-receipt.json');
if(built && head && built.gitHead!==head)errors.push('构建回执对应旧提交，必须重新构建：'+built.gitHead);
if(browsed && head && browsed.gitHead!==head)errors.push('浏览器截图对应旧提交，必须重新测试：'+browsed.gitHead);
if(browsed && browsed.source!=='vite-dist')errors.push('浏览器必须加载 Vite dist 构建页面，源码截图不能当正式验收');
if(built && browsed) {
  if(!Number.isFinite(built.createdAt)||!Number.isFinite(browsed.startedAt)||
      browsed.startedAt < built.createdAt-1000)
    errors.push('浏览器测试早于本次构建，必须重新截图验收');
  const sizes=[375,390,430];
  if(!Array.isArray(browsed.viewports)||sizes.some(x=>!browsed.viewports.includes(x)))
    errors.push('缺少 375/390/430px 全尺寸真实浏览器验收');
  const mustCheck=['cardSwap','swipeRebound','fingerSwipeLeft','candidatePersistence','roleCreation',
    'jsonRoundTrip','thirdPartyJsonRejected','freeDrawNoApi','blindPersonaGuess','objectIdentityGuess',
    'maskedClueSteps','reunionNativeChat'];
  for(const item of mustCheck)if(browsed.checked?.[item]!==true)errors.push('未实际完成浏览器断言：'+item);
  for(const name of [
    'encounter-375.png','encounter-390.png','encounter-430.png',
    'encounter-original-role-editor.png','encounter-object-concealed.png',
    'encounter-object-guess-390.png','encounter-blind-guess-390.png',
    'encounter-masked-clues-390.png'
  ]){
    const info=browsed.captured?.[name];
    const filename='test-results/'+name;
    if(!info||!Number.isFinite(info.bytes)||info.bytes<1000||
        !existsSync(path(filename))||statSync(path(filename)).size!==info.bytes||
        statSync(path(filename)).mtimeMs < browsed.startedAt-1000)
      errors.push('截图缺失、无有效回执或与本次测试不匹配：'+filename);
  }
}
for(const line of results)console.log('CHECK  '+line);
if(errors.length){
  for(const error of errors)console.error('BLOCK  '+error);
  console.error('邂逅发布门禁未通过：禁止据此合并正式版。');
  process.exitCode=1;
}else{
  console.log('代码/构建/浏览器产物门禁通过。仍需人工确认 Android、iPhone 与正式 MAO 账号隔离及备份恢复。');
}
