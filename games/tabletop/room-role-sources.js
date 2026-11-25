// Standalone adapter for the existing shared saved-source contract.
// The future runtime must supply a freshly verified role and account-scoped
// storage and binding bridge. This module does not authenticate or call AI.
const fail=code=>{throw new Error(code);};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
const own=(o,k)=>Object.hasOwn(o,k);
const textFields=['name','persona','prompt','tone','speechStyle','speech'];
const sourceKeys=new Set(['chat_rp_protocol_','phone_worldbooks']);

export function buildRoomRoleSources({speechContext,role,storage,sourceContract,contextPolicy,bindingBridge,defaultProtocol}={}) {
  const seatId=speechContext?.selfSeatId;
  const seat=Array.isArray(speechContext?.seats)&&speechContext.seats.find(s=>s?.seatId===seatId);
  if(!seat||seat.kind!=='role'||!id(seat.roleId)||seatId!=='role:'+seat.roleId||role?.id!==seat.roleId) fail('SPEECH_ROLE_MISMATCH');
  if(!storage||typeof storage.getItem!=='function'||typeof sourceContract?.buildSavedSourceEnvelope!=='function'||
     typeof sourceContract?.validateFinalApiMessages!=='function'||typeof contextPolicy?.buildWorldbookInjectionText!=='function'||
     typeof bindingBridge?.filterBooks!=='function') fail('SPEECH_SOURCE_DEPENDENCIES');
  // Do not pass the full character object: the shared builder falls back to
  // role.memory even when options.memory is empty. Exclude it structurally.
  const saved={id:seat.roleId};
  for(const k of textFields) {
    if(!own(role,k)||role[k]==null) continue;
    if(typeof role[k]!=='string') fail('INVALID_SPEECH_ROLE');
    saved[k]=role[k];
  }
  if(!saved.name?.trim()) fail('INVALID_SPEECH_ROLE');
  if(own(role,'worldBookIds')) {
    if(!Array.isArray(role.worldBookIds)||!Array.from(role.worldBookIds).every(id)) fail('INVALID_SPEECH_ROLE');
    saved.worldBookIds=[...new Set(role.worldBookIds)];
  }
  if(role.encounterOrigin?.version===1) saved.encounterOrigin={version:1};
  if(!Array.isArray(speechContext.messages)||speechContext.messages.length>100||!Array.from(speechContext.messages).every(m=>m&&typeof m.text==='string')) fail('INVALID_SPEECH_HISTORY');
  const recentMessages=speechContext.messages.slice(-8).map(m=>({text:m.text}));
  const scopedRead=Object.freeze({getItem(key){if(!sourceKeys.has(key)) fail('SPEECH_SOURCE_READ_DENIED');return storage.getItem(key);}});
  const bindings=Object.freeze({filterBooks(roleId,books){
    if(roleId!==saved.id) fail('SPEECH_ROLE_MISMATCH');
    return bindingBridge.filterBooks(roleId,books,saved);
  }});
  const result=sourceContract.buildSavedSourceEnvelope({role:saved,storage:scopedRead,contextPolicy,bindingBridge:bindings,
    conversationId:saved.id,recentMessages,currentText:'',memory:'',defaultProtocol});
  if(result?.ok!==true||result.role?.id!==saved.id||result.worldbookPolicyReady!==true) fail('SPEECH_SOURCE_UNVERIFIED');
  const out={roleId:saved.id,name:saved.name};
  for(const k of ['persona','tone','protocol','expandedProtocol','worldbook']) {
    if(typeof result[k]!=='string'||result[k].length>32000) fail('INVALID_SPEECH_SOURCE');
    out[k]=result[k];
  }
  if(!out.persona.trim()||!out.protocol.trim()||!out.expandedProtocol.trim()) fail('INVALID_SPEECH_SOURCE');
  // Reuse the shared final-source validator before returning any authored data.
  // This checks the source block only, not a later final provider payload.
  const system=[out.expandedProtocol,out.persona,out.tone,out.worldbook].filter(Boolean).join('\n\n');
  const check=sourceContract.validateFinalApiMessages({role:saved,speakerId:saved.id,...out,worldbookPolicyReady:true,messages:[{role:'system',content:system}]});
  if(check?.ok!==true) fail('SPEECH_SOURCE_UNVERIFIED');
  return Object.freeze({...out,system});
}
