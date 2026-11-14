/* Account scope compatibility guard for fictional inspect-phone records.
 * IMPORTANT: This does not authenticate an account. Only the MAO server session
 * and the Worker-injected mao-account-scope.js may establish that identity.
 * If the server injects account meta but its scope fails to initialize, fail
 * closed; never silently read unscoped storage or trust an input account id.
 */
(function(global){
'use strict';
function state(){
  var meta=null;
  try{meta=global.document&&global.document.querySelector?
    global.document.querySelector('meta[name="mao-account-id"]'):null;}catch(e){}
  var scope=global.__MAO_ACCOUNT_SCOPE__,id=meta&&String(meta.content||'').trim();
  if(meta){
    if(!/^MAO-[A-Z0-9]{12,24}$/.test(id||'')||
      !scope||scope.ready!==true||scope.accountId!==id)
      return {mode:'blocked',accountId:null};
    return {mode:'authenticated',accountId:id};
  }
  if(scope&&scope.ready)return {mode:'blocked',accountId:null};
  return {mode:'local-demo',accountId:null};
}
function canRead(record){
  var s=state();
  if(s.mode==='blocked')return false;
  if(!record||typeof record!=='object')return false;
  if(s.mode==='authenticated')return !record.ownerAccountId||record.ownerAccountId===s.accountId;
  return !record.ownerAccountId;
}
function stamp(record){
  var s=state();
  if(s.mode==='blocked'||!record||typeof record!=='object')return false;
  if(s.mode==='authenticated'){
    if(record.ownerAccountId&&record.ownerAccountId!==s.accountId)return false;
    record.ownerAccountId=s.accountId;
    return true;
  }
  return !record.ownerAccountId;
}
global.InspectPhoneAccountGuard={state:state,canRead:canRead,stamp:stamp};
})(window);
