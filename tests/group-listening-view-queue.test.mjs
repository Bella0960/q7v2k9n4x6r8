import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../shared/js/phone/group-listening-view.js',import.meta.url),'utf8');
const fn=src.slice(src.indexOf('  function nextAfterEnd('),src.indexOf('  function mount(o)'));
const next=new Function(fn+'\nreturn nextAfterEnd;')();
const state={status:'paused',playing:false,trackId:'a',queue:['a','b'],duration:1,currentTime:1};
const audio={ended:true,paused:true};
test('natural completion advances one song, never wraps',()=>{
 assert.equal(next(state,audio),'b');assert.equal(next({...state,trackId:'b'},audio),null);
});
test('manual pause, still-playing, loading and detached source cannot advance',()=>{
 for(const a of [{ended:false,paused:true},{ended:true,paused:false},null])assert.equal(next(state,a),null);
 for(const s of [{...state,playing:true},{...state,status:'loading'},{...state,currentTime:0.2},{...state,duration:0},{...state,trackId:'old'},null])assert.equal(next(s,audio),null);
});

const prune=new Function(fn+'\nreturn availableSelection;')();
test('deleted selections are pruned while remaining order is preserved',()=>{
 assert.deepEqual([...prune(['gone','b','a'],[{id:'a'},{id:'b'}])],['b','a']);
 assert.deepEqual([...prune(['gone'],[])],[]);
 assert.equal(prune(Array.from({length:110},(_,i)=>'t'+i),Array.from({length:110},(_,i)=>({id:'t'+i}))).size,100);
});

const changed=new Function(fn+'\nreturn catalogChanged;')();
test('catalog metadata changes invalidate only the relevant view, including scoped keys',()=>{
 const a='MAO-AAAAAAAAAAAA';
 for(const k of ['music_local_tracks','music_cover_assets_v1','__mao_account_v1__'+a+'__music_local_tracks','__mao_account_v1__'+a+'__music_cover_assets_v1',null])assert.equal(changed(k,a),true);
 for(const k of ['music_state','music_recent','phone_groups','__mao_account_v1__MAO-BBBBBBBBBBBB__music_local_tracks',undefined])assert.equal(changed(k,a),false);
});
test('catalog storage listener invalidates the render key without altering the player or picker',()=>{
 const anchor=src.slice(src.indexOf('    function onStorage(event)'),src.indexOf('    function syncTimer()'));
 let tickCount=0;
 const run=new Function('catalogChanged','account','tick',`let lastKey='unchanged';${anchor};return {onStorage,key:()=>lastKey};`)(changed,'MAO-AAAAAAAAAAAA',()=>tickCount++);
 run.onStorage({key:'music_state'});assert.equal(run.key(),'unchanged');
 run.onStorage({key:'music_local_tracks'});assert.equal(run.key(),'');
 assert.equal(tickCount,2);
 assert.match(src,/removeEventListener\('storage',onStorage\)/);
 assert.match(src,/addEventListener\('storage',onStorage\)/);
});
