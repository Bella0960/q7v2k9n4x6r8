/** QA v155 adapts main-only music storage contracts to the already-deployed
 * v154 music player. The main branch suite is unchanged. These 10 tests exercise
 * retained music storage APIs and the merged profile transaction rollback. */
/** QA-specific music regression: v154 player is not identical to main player.
 * Exercise the actual retained QA code, not an incompatible main-only stub. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../music/music.html', import.meta.url)), 'utf8');
function block(from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, 'missing QA music source block ' + from);
  return source.slice(a, b);
}
const profileFn = block('function persistProfileFields(fields) {', 'function saveProfileEdit() {');
const listsFn = block('function musicSaveIdList(', 'function removeTrackFromRecent(');
const stateFn = block('function saveState() {', 'function loadState() {');

function storage(seed = {}) {
  const raw = { ...seed };
  let failKey = null, silentlyDropKey = null, failures = 0, readFail = false;
  return {
    raw,
    getItem(k) { if (readFail) throw new Error('Storage read failed'); return Object.prototype.hasOwnProperty.call(raw,k) ? raw[k] : null; },
    setItem(k,v) { if (k === failKey && failures++ === 0) throw new Error('QuotaExceededError'); if(k === silentlyDropKey)return; raw[k]=String(v); },
    removeItem(k) { delete raw[k]; },
    failOnce(k) { failKey=k; failures=0; },
    drop(k) { silentlyDropKey=k; },
    failRead() { readFail=true; }
  };
}
function ctx(s) {
  const warnings=[];
  const sb={ localStorage:s, toast:t=>warnings.push(t),
    musicWarnOnce:(k,t)=>warnings.push(t), musicRecentReadError:null,
    musicFavReadError:null, tracks:[{id:'example'}], currentIdx:0,
    window:{audio:{currentTime:8}}, playing:false,
  };
  vm.createContext(sb);
  return {sb,warnings};
}
const profileFields = [
  ['music_profile_name','新昵称'], ['music_profile_handle','@new'], ['music_profile_bg','#efefef']
];

test('profile: three fields write and read back', () => {
  const s=storage(); const {sb}=ctx(s); vm.runInContext(profileFn,sb);
  assert.equal(sb.persistProfileFields(profileFields),true);
  assert.equal(s.raw.music_profile_bg,'#efefef');
});
test('profile: third-key quota failure rolls back every old field', () => {
  const orig={music_profile_name:'旧昵称',music_profile_handle:'@old',music_profile_bg:'#222'};
  const s=storage(orig);s.failOnce('music_profile_bg');const {sb,warnings}=ctx(s);vm.runInContext(profileFn,sb);
  assert.equal(sb.persistProfileFields(profileFields),false);
  assert.deepEqual(s.raw,orig);
  assert.ok(warnings.some(t=>t.includes('旧资料已恢复')));
});
test('profile: silently dropped write is treated as failed', () => {
  const orig={music_profile_name:'旧昵称',music_profile_handle:'@old',music_profile_bg:'#222'};
  const s=storage(orig);s.drop('music_profile_handle');
  const {sb}=ctx(s);vm.runInContext(profileFn,sb);
  assert.equal(sb.persistProfileFields(profileFields),false);
  assert.deepEqual(s.raw,orig);
});
test('profile: storage read unavailable does not write', () => {
  const s=storage();s.failRead();const {sb,warnings}=ctx(s);vm.runInContext(profileFn,sb);
  assert.equal(sb.persistProfileFields(profileFields),false);
  assert.deepEqual(s.raw,{});
  assert.ok(warnings.some(x=>x.includes('无法读取')));
});
test('favorites: damaged previous list blocks overwrite', () => {
  const s=storage({music_fav_list:'{damaged'});
  const {sb,warnings}=ctx(s);sb.musicFavReadError=new Error('corrupt');
  vm.runInContext(listsFn,sb);
  assert.equal(sb.saveFavIds(['x']),false);
  assert.equal(s.raw.music_fav_list,'{damaged');
  assert.ok(warnings.some(x=>x.includes('未覆盖原数据')));
});
test('recent IDs: save and readback, quota failure refuses false success', () => {
  const s=storage();const {sb}=ctx(s);vm.runInContext(listsFn,sb);
  assert.equal(sb.saveRecentIds(['a']),true);
  assert.equal(s.raw.music_recent,'["a"]');
  s.failOnce('music_recent');
  assert.equal(sb.saveRecentIds(['b']),false);
  assert.equal(s.raw.music_recent,'["a"]');
});
test('favorites: silently dropped write fails readback', () => {
  const s=storage({music_fav_list:'["keep"]'});const {sb}=ctx(s);vm.runInContext(listsFn,sb);
  s.drop('music_fav_list');
  assert.equal(sb.saveFavIds(['new']),false);
  assert.equal(s.raw.music_fav_list,'["keep"]');
});
test('playback state: damaged previous value must not be overwritten', () => {
  const s=storage({music_state:'{bad'});const {sb}=ctx(s);vm.runInContext(stateFn,sb);
  assert.equal(sb.saveState(),false);
  assert.equal(s.raw.music_state,'{bad');
});
test('playback state: successful state persists and verifies', () => {
  const s=storage();const {sb}=ctx(s);vm.runInContext(stateFn,sb);
  assert.equal(sb.saveState(),true);
  assert.equal(JSON.parse(s.raw.music_state).time,8);
});
test('source guard: retained player and new rollback both survive integration', () => {
  assert.ok(source.includes('function persistProfileFields('));
  assert.ok(source.includes('function musicSaveIdList('));
  assert.ok(source.includes('function musicAudioTypeFromSignature('));
  assert.ok(source.includes('function musicWarnOnce('));
  assert.ok(source.includes("Playback count not persisted"));
  assert.ok(source.includes("Favorites count not persisted"));
});

const catalogFn = block('function readLocalTracksMeta() {', '  // 合并本地曲目');
const toastFn = block('let musicToastTimer = null;', '  function musicSafeText(');
const editFn = block('function saveProfileEdit() {', '  // Android/SAF');
test('catalog: empty corrupt bytes and non-array values are preserved', () => {
 for (const old of ['', 'null', '{}', 'false']) {
  const s=storage({music_local_tracks:old});
  const {sb}=ctx(s);sb.LOCAL_TRACKS_KEY='music_local_tracks';sb.musicMetaReadFailure=null;
  vm.runInContext(catalogFn,sb);
  assert.equal(sb.readLocalTracksMeta().length,0);
  assert.throws(()=>sb.saveLocalTracksMeta([{id:'new'}]),/禁止覆盖/);
  assert.equal(s.raw.music_local_tracks,old);
 }
});
test('catalog: an absent key still allows first import and readback', () => {
 const s=storage();const {sb}=ctx(s);sb.LOCAL_TRACKS_KEY='music_local_tracks';sb.musicMetaReadFailure=null;
 vm.runInContext(catalogFn,sb);
 assert.equal(sb.readLocalTracksMeta().length,0);
 sb.saveLocalTracksMeta([{id:'first'}]);
 assert.equal(s.raw.music_local_tracks,'[{"id":"first"}]');
});
test('playback state: empty corrupt bytes and non-object values stay unchanged', () => {
 for (const old of ['', '[]', 'false', '7', '"bad"']) {
  const s=storage({music_state:old});const {sb}=ctx(s);vm.runInContext(stateFn,sb);
  assert.equal(sb.saveState(),false);
  assert.equal(s.raw.music_state,old);
 }
});
test('playback state: legacy null sentinel can initialize', () => {
 const s=storage({music_state:'null'});const {sb}=ctx(s);vm.runInContext(stateFn,sb);
 assert.equal(sb.saveState(),true);assert.equal(JSON.parse(s.raw.music_state).id,'example');
});
test('toast: create once, reuse, replace deadline, dismiss, and throttle per failure key', () => {
 const nodes=new Map(),timers=new Map();let sequence=0;
 const sb={document:{getElementById:id=>nodes.get(id)||null,querySelector:()=>null,
  createElement(){return {textContent:'',classList:new Set(),setAttribute(){}};},
  body:{appendChild(node){nodes.set(node.id,node);}}},
  setTimeout(fn){timers.set(++sequence,fn);return sequence;},clearTimeout(id){timers.delete(id);}};
 // Native DOMTokenList uses remove, not Set.delete.
 const create=sb.document.createElement;
 sb.document.createElement=()=>{const n=create();n.classList.remove=n.classList.delete.bind(n.classList);return n;};
 vm.createContext(sb);vm.runInContext(toastFn,sb);
 sb.toast('第一条');const node=nodes.get('musicToast');
 assert.equal(node.textContent,'第一条');assert.equal(node.classList.has('show'),true);
 sb.toast('第二条');assert.equal(nodes.size,1);assert.equal(node.textContent,'第二条');assert.equal(timers.size,1);
 [...timers.values()][0]();assert.equal(node.classList.has('show'),false);
 sb.musicWarnOnce('write','失败');sb.musicWarnOnce('write','不应重复');
 assert.equal(node.textContent,'失败');sb.musicWarnOnce('read','另一个问题');assert.equal(node.textContent,'另一个问题');
});
test('profile editor remains open after rejected persistence and closes only on success', () => {
 const s=storage();const {sb}=ctx(s);let rendered=0,closed=0;
 sb.document={getElementById:id=>({value:{editName:' 新昵称 ',editHandle:'mao',editBgCustom:'#eeeeee'}[id]})};
 sb.BG_PRESETS=[{css:'#111'}];sb.selectedBg=0;sb.renderProfile=()=>rendered++;sb.closeProfileEdit=()=>closed++;
 vm.runInContext(profileFn+'\n'+editFn,sb);
 s.failOnce('music_profile_bg');sb.saveProfileEdit();assert.equal(rendered,0);assert.equal(closed,0);assert.deepEqual(s.raw,{});
 sb.saveProfileEdit();assert.equal(rendered,1);assert.equal(closed,1);
 assert.equal(s.raw.music_profile_name,'新昵称');assert.equal(s.raw.music_profile_handle,'@mao');
});
