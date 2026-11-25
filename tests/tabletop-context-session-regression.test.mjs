import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyRoomContext} from '../games/tabletop/account-room-context.js';
import {createRoomSession} from '../games/tabletop/room-session.js';
const id='MAO-ABCDEFGHIJKL';
function fixture() {
 let roleIds=['r1','r2'], sessionId='s1', status='active', disposed=0, called=0, scope={ready:true,accountId:id,pageAccountId:id,role:'user'};
 const readScope=()=>scope;
 const request=async path=>({ok:true,json:async()=>path.endsWith('/me')?{account:{id,role:'user',status}}:{currentSessionId:sessionId}});
 const readScopedRoster=async expected=>({...expected,roleIds});
 const session=createRoomSession({verifyContext:({signal})=>verifyRoomContext({request,readScope,readScopedRoster,signal}),createLifetime:({getContext})=>({dispose(){disposed++;},viewUser:getContext,prepareUserAction:()=>()=>{called++;return getContext();},prepareRoleMove:roleId=>()=>{const c=getContext();if(!c.roleIds.includes(roleId))throw Error('ROLE_UNAVAILABLE');called++;return c;}})});
 return {session,verify:()=>verifyRoomContext({request,readScope,readScopedRoster}),roster:r=>{roleIds=r;},scope:s=>{scope=s;},status:s=>{status=s;},sessionId:s=>{sessionId=s;},counts:()=>({disposed,called})};
}
test('sparse roster is rejected by preflight itself',async()=>{const f=fixture();f.roster(Array(1));await assert.rejects(f.verify(),/ROSTER_UNVERIFIED/);});
test('a coercible object is not a valid account ID',async()=>{const f=fixture(), fake={toString:()=>id};f.scope({ready:true,accountId:fake,pageAccountId:fake,role:'user'});await assert.rejects(f.verify(),/ACCOUNT_SCOPE_UNREADY/);});
test('removed then restored role cannot revive previously prepared callback',async()=>{const f=fixture();await f.session.refresh();const cb=f.session.prepareRoleMove('r1');f.roster(['r2']);await f.session.refresh();assert.throws(()=>cb('move'),/ROLE_UNAVAILABLE/);f.roster(['r1','r2']);await f.session.refresh();assert.throws(()=>cb('move'),/STALE_ROSTER/);assert.equal(f.counts().called,0);f.session.prepareRoleMove('r1')('move');assert.equal(f.counts().called,1);});
test('roster change also invalidates previously prepared user action',async()=>{const f=fixture();await f.session.refresh();const cb=f.session.prepareUserAction();f.roster(['r1']);await f.session.refresh();assert.throws(()=>cb({type:'start'}),/STALE_ROSTER/);assert.equal(f.counts().called,0);});
test('same roster in a different order does not invalidate a callback',async()=>{const f=fixture();await f.session.refresh();const cb=f.session.prepareRoleMove('r1');f.roster(['r2','r1','r2']);await f.session.refresh();cb('move');assert.equal(f.counts().called,1);});
test('real preflight session change permanently closes session bridge',async()=>{const f=fixture();await f.session.refresh();const cb=f.session.prepareUserAction();f.sessionId('s2');await assert.rejects(f.session.refresh(),/SCOPE_CHANGED/);assert.throws(()=>cb({}),/ROOM_DISPOSED/);assert.deepEqual(f.counts(),{disposed:1,called:0});});
test('real preflight disabled account closes session bridge',async()=>{const f=fixture();await f.session.refresh();f.status('disabled');await assert.rejects(f.session.refresh(),/ACCOUNT_VERIFICATION_FAILED/);assert.equal(f.session.status(),'disposed');assert.equal(f.counts().disposed,1);});
