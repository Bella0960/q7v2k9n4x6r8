import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../worker/lib/migrations.js';
import { createStore } from '../worker/lib/store.js';

test('QA Cron stores one free message, exposes it only to its account and cancels on opt-out', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const exec = (sql, ...params) => db.prepare(sql).all(...params);
    const now = 1800000000000;
    applyMigrations(exec, now);
    const store = createStore(exec);
    for (const id of ['a','b']) {
      exec("INSERT INTO mao_accounts(id,username,username_key,password_salt,password_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?)",
        id,id,id,'fixture','fixture',now,now);
      exec('INSERT INTO devices(id,secret_hash,user_id,created_at,last_seen_at) VALUES(?,?,?,?,?)',
        id,'fixture',id,now,now);
      exec('INSERT INTO push_subscriptions(id,device_id,endpoint,p256dh,auth_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        id,id,'https://example.test/'+id,'fixture','fixture',now,now);
    }
    const task = {id:'task01',userId:'a',deviceId:'a',characterId:'r',now};
    assert.equal(store.queueQaMockContact(task),'disabled');
    store.setUserAutonomy('a',true,now,'a');
    assert.equal(store.queueQaMockContact({...task,deviceId:'b'}),'disabled');
    assert.equal(store.queueQaMockContact(task),'queued');
    assert.equal(store.queueQaMockContact({...task,id:'repeat'}),'limited');
    assert.deepEqual(store.listDueActivities(now,10),[]);
    assert.deepEqual(store.listDueActivitiesForUser({...task,limit:10}),[]);
    store.runQaMockContacts(now);
    store.runQaMockContacts(now+1);
    const inbox = (account) => store.listPendingOutboundMessages({userId:account,deviceId:account,characterId:'r'});
    assert.deepEqual(inbox('a').map(m=>m.server_message_id),['qa_mock_task01']);
    assert.deepEqual(inbox('b'),[]);
    assert.deepEqual(store.listOutboundPushCandidates({now}).map(m=>[m.device_id,m.server_message_id]),[['a','qa_mock_task01']]);
    assert.equal(store.queueQaMockContact({...task,id:'task02',now:now+300000}),'queued');
    store.setUserAutonomy('a',false,now+300001,'a');
    store.setUserAutonomy('a',true,now+300002,'a');
    store.runQaMockContacts(now+300003);
    assert.equal(inbox('a').length,1);
    assert.equal(exec("SELECT COUNT(*) AS total FROM schema_migrations WHERE version LIKE '0020_%'")[0].total,0);
  } finally {
    db.close();
  }
});
