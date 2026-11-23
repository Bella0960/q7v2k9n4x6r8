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
