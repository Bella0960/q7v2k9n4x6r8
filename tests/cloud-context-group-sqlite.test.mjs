import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../worker/lib/store.js';
import {applyMigrations,splitSql,MIGRATIONS} from '../worker/lib/migrations.js';
import {SQL,VERSION} from '../worker/migrations/0020_cloud_autonomous_context.js';
const now=1800000000000;
function fixture(){
  const db=new DatabaseSync(':memory:');
  const exec=(sql,...args)=>db.prepare(sql).all(...args);
  applyMigrations(exec,now);
  assert.ok(!MIGRATIONS.some(m=>m.version===VERSION),'staged schema must not auto-migrate live');
  db.exec('BEGIN IMMEDIATE');try{for(const statement of splitSql(SQL))exec(statement);exec('INSERT INTO schema_migrations VALUES(?,?)',VERSION,now);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  for(const [account,device] of [['a','d1'],['b','d2']]){
    exec("INSERT INTO mao_accounts(id,username,username_key,password_salt,password_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?)",account,account,account,'synthetic','synthetic',now,now);
    exec('INSERT INTO devices(id,secret_hash,user_id,created_at,last_seen_at) VALUES(?,?,?,?,?)',device,'synthetic',account,now,now);
  }
  return {db,exec,store:createStore(exec)};
}
const snap=(u,d,r,e,time=now)=>({userId:u,deviceId:d,characterId:r,eventId:e,characterName:'测试',personaText:'日常',recentMessages:[{role:'user',content:'测试消息'}],lastUserMessageAt:time-1,now:time});
function activity(exec,id,device,role,version,mode='cloud'){
  exec("INSERT INTO activity_queue(id,device_id,character_id,kind,status,scheduled_at,attempt_count,max_attempts,locked_by,locked_until,payload_json,created_at,updated_at,dedupe_key) VALUES(?,?,?,'contact','running',?,1,3,'cloud_model_executor',?,?,?,?,?)",id,device,role,now,now+60000,JSON.stringify({contextVersion:version,sourceDeviceId:device,executionMode:mode}),now,now,'task:'+id);
}
test('consent defaults off, isolates same-name roles/accounts, rejects stale events and revokes only cloud tasks',()=>{
 const {db,exec,store}=fixture();try{
  const a=snap('a','d1','r','e1'),b=snap('b','d2','r','e1');
  assert.equal(store.recordCharacterContextSnapshot(a).disabled,true);
  assert.equal(store.setUserContextSharing({userId:'a',deviceId:'d2',enabled:true,now}),null);
  for(const [userId,deviceId] of [['a','d1'],['b','d2']]) assert.equal(store.setUserContextSharing({userId,deviceId,enabled:true,now}).enabled,1);
  const x=store.recordCharacterContextSnapshot(a),y=store.recordCharacterContextSnapshot(b);assert.equal(x.saved,true);assert.equal(y.saved,true);
  assert.equal(store.recordCharacterContextSnapshot(a).duplicate,true);
  assert.equal(store.recordCharacterContextSnapshot({...a,personaText:'different'}).conflict,true);
  assert.equal(store.recordCharacterContextSnapshot({...a,deviceId:'d2'}).revoked,true);
  activity(exec,'cloudA','d1','r',x.contextVersion);activity(exec,'localA','d1','r',x.contextVersion,'foreground');activity(exec,'cloudB','d2','r',y.contextVersion);
  assert.equal(store.setUserContextSharing({userId:'a',deviceId:'d1',enabled:false,now:now+1}).enabled,0);
  assert.equal(store.getCharacterContextSnapshot({userId:'a',characterId:'r',contextVersion:x.contextVersion}),null);
  assert.ok(store.getCharacterContextSnapshot({userId:'b',characterId:'r',contextVersion:y.contextVersion}));
  assert.equal(exec("SELECT status FROM activity_queue WHERE id='cloudA'")[0].status,'superseded');
  assert.equal(exec("SELECT status FROM activity_queue WHERE id='localA'")[0].status,'running');
  assert.equal(exec("SELECT status FROM activity_queue WHERE id='cloudB'")[0].status,'running');
  store.setUserContextSharing({userId:'a',deviceId:'d1',enabled:true,now:now+2});
  assert.equal(store.recordCharacterContextSnapshot(a).conflict,true);
  assert.equal(store.recordCharacterContextSnapshot(snap('a','d1','r','e2',now+3)).saved,true);
  exec("UPDATE mao_accounts SET status='disabled' WHERE id='a'");
  assert.equal(store.getLatestCharacterContextSnapshot({userId:'a',characterId:'r'}),null);
 }finally{db.close();}
});
test('group commit is all-or-nothing on conflict, scoped and replay safe',()=>{
 const {db,exec,store}=fixture();try{
  store.setUserContextSharing({userId:'a',deviceId:'d1',enabled:true,now});
  const s=store.recordCharacterContextSnapshot(snap('a','d1','r','e1'));
  const id='t',groupId='cloudgrp_t_1';
  activity(exec,id,'d1','r',s.contextVersion);
  const messages=[1,2].map(i=>({serverMessageId:groupId+'_0'+i,dedupeKey:groupId+':'+i,payload:{type:'text',text:'测试'+i}}));
  const args={id,owner:'cloud_model_executor',attemptCount:1,now:now+1,groupId,contextVersion:s.contextVersion,sourceDeviceId:'d1',messages};
  assert.equal(store.completeCloudActivityWithOutboundGroup({...args,sourceDeviceId:'d2'}),null);
  exec("INSERT INTO outbound_messages(id,device_id,character_id,payload_json,server_message_id,dedupe_key,created_at) VALUES('collision','d2','r','{}',?,?,?)",messages[1].serverMessageId,'other',now);
  assert.equal(store.completeCloudActivityWithOutboundGroup(args).conflict,true);
  assert.equal(exec("SELECT status FROM activity_queue WHERE id='t'")[0].status,'running');
  assert.equal(exec("SELECT COUNT(*) n FROM outbound_messages WHERE device_id='d1'")[0].n,0);
  exec("DELETE FROM outbound_messages WHERE id='collision'");
  assert.equal(store.completeCloudActivityWithOutboundGroup(args).completed,true);
  assert.equal(store.completeCloudActivityWithOutboundGroup(args).alreadyCompleted,true);
  assert.deepEqual(exec('SELECT group_index FROM outbound_messages WHERE device_id=? ORDER BY group_index','d1').map(r=>r.group_index),[1,2]);
  for(const [id,device] of [['s1','d1'],['s2','d2']]){
    exec('INSERT INTO push_subscriptions(id,device_id,endpoint,p256dh,auth_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      id,device,'https://example.test/'+id,'synthetic','synthetic',now,now);
  }
  assert.deepEqual(store.listOutboundPushCandidates({now:now+2}).map(r=>[r.device_id,r.server_message_id]),
    [['d1',messages[0].serverMessageId]]);
  const pending=(userId,deviceId)=>store.listPendingOutboundMessages({userId,deviceId,characterId:'r'}).map(r=>r.server_message_id);
  assert.deepEqual(pending('a','d1'),messages.map(m=>m.serverMessageId));
  assert.deepEqual(pending('b','d2'),[]);
  assert.ok(store.getOutboundAccess({userId:'a',deviceId:'d1',characterId:'r',serverMessageId:messages[0].serverMessageId}));
  exec("UPDATE outbound_messages SET payload_json='{}' WHERE server_message_id=?",messages[0].serverMessageId);
  assert.deepEqual(pending('a','d1'),[messages[1].serverMessageId]);
  assert.deepEqual(store.listOutboundPushCandidates({now:now+2}),[]);
  exec('UPDATE outbound_messages SET payload_json=? WHERE server_message_id=?',JSON.stringify(messages[0].payload),messages[0].serverMessageId);
  assert.equal(store.repairAllStagedActivityOutboxes({now:now+2}).scanned,0);
  assert.equal(store.completeCloudActivityWithOutboundGroup({...args,messages:[{...messages[0],payload:{type:'text',text:'changed'}},messages[1]]}),null);
 }finally{db.close();}
});

test('contact scheduling binds the latest consented turn and reuses its pending task',()=>{
  const {db,store}=fixture();
  try {
    store.setUserContextSharing({userId:'a',deviceId:'d1',enabled:true,now});
    const first=store.recordCharacterContextSnapshot(snap('a','d1','r','e1'));
    const args={userId:'a',characterId:'r',deviceId:'d1',contextVersion:first.contextVersion,
      now,minIdleMs:60000,maxAttempts:2};
    assert.equal(store.enqueueCloudContactForSnapshot(args),null);
    store.setUserAutonomy('a',true,now,'d1');
    const pending=store.enqueueCloudContactForSnapshot(args);
    assert.equal(pending.scheduled_at,now+59999);
    assert.equal(store.enqueueCloudContactForSnapshot(args).scheduled_at,pending.scheduled_at);
    assert.equal(store.countPendingActivitiesForCharacter('a','r'),1);
    const newer=store.recordCharacterContextSnapshot(snap('a','d1','r','e2',now+5));
    assert.equal(store.enqueueCloudContactForSnapshot(args),null);
    assert.equal(store.enqueueCloudContactForSnapshot({...args,deviceId:'d2',contextVersion:newer.contextVersion}),null);
    store.setUserContextSharing({userId:'a',deviceId:'d1',enabled:false,now:now+6});
    assert.equal(store.enqueueCloudContactForSnapshot({...args,contextVersion:newer.contextVersion}),null);
  } finally {db.close();}
});

test('0020 rolls back schema and data on a failed migration receipt and retries cleanly', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const exec = (sql, ...params) => db.prepare(sql).all(...params);
    applyMigrations(exec, now);
    exec("INSERT INTO devices(id,secret_hash,user_id,created_at,last_seen_at) VALUES('fixture','synthetic','owner',?,?)", now, now);
    const before = exec("SELECT type,name,sql FROM sqlite_master ORDER BY name");
    const migration = [{ version: VERSION, sql: SQL }];
    assert.throws(() => applyMigrations((sql,...params) => {
      if (sql.startsWith('INSERT INTO schema_migrations') && params[0] === VERSION) throw Error('receipt write interrupted');
      return exec(sql,...params);
    }, now + 1, null, migration), /receipt write interrupted/);
    assert.deepEqual(exec("SELECT type,name,sql FROM sqlite_master ORDER BY name"),before);
    assert.equal(exec('SELECT COUNT(*) AS n FROM devices WHERE id=?','fixture')[0].n,1);
    assert.deepEqual(applyMigrations(exec, now + 2, null, migration),[VERSION]);
    assert.deepEqual(applyMigrations(exec, now + 3, null, migration),[]);
    assert.equal(exec('SELECT COUNT(*) AS n FROM user_context_sharing')[0].n,0);
    assert.equal(exec('PRAGMA integrity_check')[0].integrity_check,'ok');
  } finally { db.close(); }
});
