import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../inspect-phone/inspect-persona-web.js',import.meta.url),'utf8');
const feature=readFileSync(new URL('../inspect-phone/inspect-feature.js',import.meta.url),'utf8');
const native=readFileSync(new URL('../inspect-phone/inspect-native-view.js',import.meta.url),'utf8');
const phone=readFileSync(new URL('../inspect-phone/phone.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function create(){
  const window={};vm.runInNewContext(source,{window,Date,Math,Number,String,Array,Object,JSON});
  return window.InspectPersonaWeb;
}
function story(roleId='test-role'){
  return {roleId,sections:{browser:{searchHistory:[{query:'之前保存的一次搜索',time:Date.now()-50000}],
    bookmarks:[{title:'旧收藏',summary:'以前手工保存的资料'}],pageViews:[]},
  forum:{posts:[{title:'先前发的帖子',text:'之前保存的正文不可丢失',time:Date.now()-50000,
    comments:[{name:'朋友',text:'旧评论'}]}]}}};
}
const current=Date.now();
test('恋人角色搜索过送女朋友鲜花，搜索结果有至少三个可打开的原创页面',()=>{
  const w=create(),data=story('lover'),role={id:'lover',name:'林禾',occupation:'出版社编辑',relationship:'恋人',description:'认真细心'};
  const seeded=w.seed(role,'lover',data,current);
  assert.ok(seeded.added>=3);
  const history=data.sections.browser.searchHistory;
  assert.ok(history.some(x=>x.query.includes('女朋友买鲜花')));
  assert.ok(history.some(x=>x.origin==='role_persona_sample'));
  const results=w.find('如何给女朋友买鲜花 玫瑰花',w.persona(role),data.sections.browser);
  assert.ok(results.length>=3);
  assert.ok(results.some(x=>x.title.includes('玫瑰')));
  assert.ok(results.some(x=>x.title.includes('郁金香')));
  assert.ok(results.every(x=>x.paragraphs.length>=2));
  assert.ok(results.every(x=>x.paragraphs.join('').includes('花')||x.title.includes('送花')));
});
test('校园人物不会硬套女朋友送花剧情，论坛按校园日常生成发帖',()=>{
  const w=create(),data=story('student'),role={id:'student',name:'小叶',occupation:'在校大学生',relationship:'朋友',description:'参加社团'};
  w.seed(role,'student',data,current);
  assert.ok(data.sections.browser.searchHistory.some(x=>x.query.includes('课程')));
  assert.ok(!data.sections.browser.searchHistory.some(x=>x.query.includes('女朋友买鲜花')));
  assert.ok(data.sections.forum.posts.some(x=>x.title.includes('课程')||x.title.includes('课表')));
  assert.ok(data.sections.forum.posts.filter(x=>x.authorId==='student').length>=2);
});
test('已有帖子和浏览史不能被人格种子清空，重复打开不复制种子',()=>{
  const w=create(),d=story('repeat'),role={id:'repeat',name:'阿疏',occupation:'设计师',relationship:'朋友'};
  const first=w.seed(role,'repeat',d,current);
  assert.ok(first.added>0);
  const before=JSON.stringify(d.sections);
  const second=w.seed(role,'repeat',d,current+60000);
  assert.equal(second.added,0);
  assert.equal(JSON.stringify(d.sections),before);
  assert.ok(d.sections.forum.posts.some(x=>x.title==='先前发的帖子'));
  assert.ok(d.sections.browser.searchHistory.some(x=>x.query==='之前保存的一次搜索'));
});
test('任意搜索能写入当前角色的搜索历史，不会把模拟页称作真实网页',()=>{
  const w=create(),d=story('search');
  const q='如何给女朋友选玫瑰花';
  const r=w.search(d.sections.browser,q,current);
  assert.equal(r.ok,true);
  assert.equal(d.sections.browser.searchHistory[0].query,q);
  assert.equal(d.sections.browser.searchHistory[0].origin,'user_on_fictional_phone');
  assert.ok(r.results.length>=3);
  assert.match(JSON.stringify(r.results),/非实时|示例|原创/);
  assert.equal(w.search(d.sections.browser,'   ').ok,false);
});
test('打开文章会留下访问记录，再次访问和收藏均可追溯',()=>{
  const w=create(),d=story('visits'),browser=d.sections.browser;
  const a=w.find('送花给女朋友',w.persona({name:'林禾',relationship:'恋人'}),browser)[0];
  assert.ok(w.visit(browser,a.id,'送花给女朋友',current));
  assert.ok(w.bookmark(browser,a.id,current));
  assert.ok(w.bookmark(browser,a.id,current+100));
  assert.equal(browser.pageViews[0].articleId,a.id);
  assert.equal(browser.bookmarks.filter(x=>x.articleId===a.id).length,1);
  assert.ok(w.article(a.id,browser).paragraphs.length>=2);
  assert.equal(w.visit(browser,'missing-page','什么',current),false);
});
test('未知搜索词不制造不存在的商家，也不会给出假货比价',()=>{
  const w=create(),d=story('missing');
  const r=w.search(d.sections.browser,'龙涎星球物流社',current);
  assert.equal(r.ok,true);
  assert.equal(r.results.length,0);
  assert.equal(w.find('龙涎星球物流社',{},d.sections.browser).length,0);
});
test('AI创作的虚构资料校验严格，拒绝缺少正文和超长异常数据',()=>{
  const w=create(),d=story('ai'),browser=d.sections.browser;
  const valid={pages:[
    {title:'一份完整的生活指南',snippet:'这是一份关于自我安排与生活经验的参考文案',
      paragraphs:['这是一段完全原创的参考文字，用来介绍如何把一个抽象问题分成明确的小步骤。','另一段正文会进一步解释经验与局限，读者应该根据实际情况调整。']},
    {title:'另一份不同的参考文章',snippet:'这是一段不重复前一篇文章主题的编辑说明',
      paragraphs:['可以通过不同角度描述用户问题，不需要杜撰真实的商家、网址或广告链接。','资料是AI创作的虚构文章，不声称在现实的互联网中存在。']}
  ]};
  assert.equal(w.acceptAI(browser,'一个新问题',{pages:[{title:'短',snippet:'短',paragraphs:['短']}]},current),false);
  assert.equal(w.acceptAI(browser,'一个新问题',valid,current),true);
  const results=w.find('一个新问题',{},browser);
  assert.equal(results.length,2);
  assert.ok(results[0].domain.includes('AI 生成'));
  assert.ok(w.article(results[0].id,browser));
});
test('不同角色的搜索、浏览与论坛帖子不会相互污染',()=>{
  const w=create(),a=story('a'),b=story('b');
  w.seed({name:'林禾',relationship:'恋人'},'a',a,current);
  w.seed({name:'小叶',occupation:'在校大学生'},'b',b,current);
  w.search(a.sections.browser,'只存在A手机里的搜索',current);
  assert.ok(!b.sections.browser.searchHistory.some(x=>x.query.includes('只存在A')));
  assert.ok(a.sections.forum.posts.some(x=>x.authorId==='a'));
  assert.ok(!b.sections.forum.posts.some(x=>x.authorId==='a'));
});
test('手机和离线PWA真实加载人设网页模块，论坛与浏览器有完整视图',()=>{
  assert.match(phone,/inspect-persona-web\.js\?v=20261112v1/);
  assert.match(sw,/inspect-persona-web\.js\?v=20261112v1/);
  assert.match(feature,/personaWeb\.seed\(role,roleId,data,now\)/);
  assert.match(native,/inspectBrowserSearch/);
  assert.match(native,/nv-browser-article/);
  assert.match(native,/data-action="forumMine"/);
  assert.match(feature,/function postForumComment\(form\)/);
  assert.match(feature,/function browserSearch\(form\)/);
  assert.match(feature,/function preserveUserEntries\(id,oldSection,newSection\)/);
});
