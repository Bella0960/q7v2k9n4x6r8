import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const engineSource = fs.readFileSync(new URL('../encounter/encounter-engine.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../encounter/encounter.html', import.meta.url), 'utf8');
const managerSource = fs.readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const charactersPage = fs.readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const desktopSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function harness(seed = {}) {
  const map = new Map(Object.entries(seed));
  const localStorage = {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
  const window = {localStorage, dispatchEvent() {}};
  vm.runInNewContext(engineSource, {window, Math, Set, Uint32Array, Date, JSON, String, Array, Object, Number, CustomEvent: class {}});
  return {api:window.MAOMAOEncounter,map,localStorage};
}

test('邂逅引擎保持离线，不需要 API，并为新角色生成唯一姓名', () => {
  const h = harness({'ai_custom_characters':JSON.stringify([{id:'original',name:'沈知序'}])});
  const seen = new Set(['沈知序']);
  for (let i = 0; i < 35; i++) {
    const r = h.api.generate();
    assert.equal(r.ok, true, r.error);
    assert.ok(!seen.has(r.value.name), '原角色或同轮抽卡姓名不得碰撞');
    seen.add(r.value.name);
    assert.ok(r.value.age >= 21);
    assert.ok(r.value.species !== '哥布林');
    assert.ok(r.value.id.startsWith('enc_'));
  }
});

test('姓名规整能识别空格、宽字符、标点造成的假不同', () => {
  const h = harness();
  assert.equal(h.api.normalizeName('林　野'),h.api.normalizeName('林野'));
  assert.equal(h.api.normalizeName('Ａster·Vale'), h.api.normalizeName('AsterVale'));
});

test('候选保存与删除是显式成功后更新，不会碰正式角色库', () => {
  const h = harness({'ai_custom_characters':'[{"id":"role_1","name":"既有角色"}]'});
  const person = h.api.generate().value;
  const saved = h.api.saveCandidate(person);
  assert.equal(saved.ok,true);
  assert.equal(h.api.getCandidates().value.length,1);
  assert.equal(h.api.saveCandidate(person).value.length,1);
  assert.equal(JSON.parse(h.localStorage.getItem('ai_custom_characters'))[0].name,'既有角色');
  assert.equal(h.api.removeCandidate(person.id).ok,true);
  assert.equal(h.api.getCandidates().value.length,0);
});

test('收藏时再次与正式角色库查重，绝不覆盖现有姓名', () => {
  const h = harness();
  const person = h.api.generate().value;
  h.localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'role_1',name:person.name}]));
  const saved = h.api.saveCandidate(person);
  assert.equal(saved.ok,false);
  assert.equal(h.localStorage.getItem('maomao_encounter_candidates_v1'),null);
});

test('损坏的候选收藏保持原文，不得静默覆盖', () => {
  const raw = '{broken';
  const h = harness({'maomao_encounter_candidates_v1':raw});
  const generated=h.api.generate();
  assert.equal(generated.ok,false);
  assert.equal(h.localStorage.getItem('maomao_encounter_candidates_v1'),raw);
});

test('存储空间不足时不显示收藏成功', () => {
  const h = harness();
  const card=h.api.generate().value;
  h.localStorage.setItem = function() {throw new Error('quota');};
  assert.equal(h.api.saveCandidate(card).ok,false);
});

test('相似度是偏好，不强制排除喜爱的类型', () => {
  const h = harness();
  assert.equal(h.api.savePreferences({similarity:'多来喜欢的类型'}).ok,true);
  assert.equal(h.api.getPreferences().similarity,'多来喜欢的类型');
  const card=h.api.generate();
  assert.equal(card.ok,true);
});

test('扩展点可以注册与撤销，不影响默认抽卡', () => {
  const h=harness();
  const unregister=h.api.registerCardDecorator(function(){return {badge:'custom-event'};});
  assert.equal(h.api.generate().value.badge,'custom-event');
  unregister();
  assert.equal(h.api.generate().value.badge,undefined);
});

test('角色库已有原生编辑器、邂逅候选交接、仅接受 MAOMAO JSON', () => {
  assert.match(charactersPage,/encounter-engine\.js/);
  assert.match(managerSource,/openEncounterCandidateFromQuery/);
  assert.match(managerSource,/MAOMAOEncounter\.formatBrief/);
  assert.match(managerSource,/data\.format !== 'maomao-character'/);
  assert.doesNotMatch(managerSource,/data\.char_name\s*\|\|/);
  assert.match(managerSource,/btnExportRole/);
  assert.match(managerSource,/saveRoles\(roles\)/);
});

test('桌面有独立应用入口，抽卡页有可访问交互与移动端样式', () => {
  assert.match(desktopSource,/data-href="encounter\/encounter\.html"/);
  assert.match(appSource,/id="frontCard"/);
  assert.match(appSource,/pointerdown/);
  assert.match(appSource,/pointermove/);
  assert.match(appSource,/prefers-reduced-motion/);
  assert.match(appSource,/id="savedButton"/);
  assert.match(appSource,/id="moreButton"/);
  assert.doesNotMatch(appSource,/(<img[^>]+src="https:\/\/)/);
});
