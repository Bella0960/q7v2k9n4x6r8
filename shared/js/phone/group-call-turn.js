/* GROUP-CALL-001 C02: read-only admission and persisted turn receipts.
 * Adapter contract: the existing chat engine must return exact committed mids.
 * No second AI pipeline, no history writes, no new persisted message fields.
 * Not mounted until the call integration stage.
 */
(function(root){
 'use strict';
 const fail=code=>Object.freeze({ok:false,code});
 const validId=id=>typeof id==='string'&&id.length>0&&id.length<=256&&id===id.trim()&&!/[\u0000-\u001f\u007f]/.test(id);
 const user=m=>m&&(m.role==='user'||m.role==='sent')&&!m.silent&&!m.isError&&(!m.type||m.type==='text');
 const publicReply=m=>m&&!m.silent&&!m.isError&&(!m.type||m.type==='text');
 const textOf=m=>typeof m?.text==='string'?m.text.trim():typeof m?.content==='string'?m.content.trim():'';
 function create({roster}={}){
  if(!roster||typeof roster.getSnapshot!=='function'||typeof roster.speakerFor!=='function')return null;
  let initial;try{initial=roster.getSnapshot();}catch{return null;}
  if(!initial||typeof initial.accountId!=='string'||!validId(initial.groupId))return null;
  let closed=false,pending=null,serial=0;
  const key='chat_history_'+initial.groupId,storage=root.localStorage;
  function current(){
   if(closed)return false;
   try{const s=roster.getSnapshot();
    if(s&&s.accountId===initial.accountId&&s.groupId===initial.groupId&&root.localStorage===storage)return true;
   }catch{}
   closed=true;pending=null;return false;
  }
  function read(){
   if(!current())return null;
   try{
    const raw=storage.getItem(key);
    // Missing/corrupt primary cannot be treated as an empty history.
    if(raw===null)return null;
    const rows=JSON.parse(raw);if(!Array.isArray(rows)||!current())return null;
    return rows;
   }catch{return null;}
  }
  function begin(text){
   if(!current())return fail('SCOPE_CHANGED');
   if(pending)return fail('BUSY');
   if(typeof text!=='string'||!text.trim())return fail('EMPTY');
   const rows=read();if(!rows)return fail('HISTORY_UNAVAILABLE');
   const token=Object.freeze({accountId:initial.accountId,groupId:initial.groupId,turn:++serial});
   pending={token,text:text.trim(),before:new Set(rows.filter(m=>validId(m?.mid)).map(m=>m.mid))};
   return Object.freeze({ok:true,token});
  }
  function canContinue(token){return current()&&!!pending&&pending.token===token;}
  function inspect(token,receipt){
   if(!canContinue(token))return fail('STALE_TURN');
   const turn=pending;
   if(!receipt||receipt.accountId!==initial.accountId||receipt.groupId!==initial.groupId||
      !validId(receipt.userMid)||!Array.isArray(receipt.replyMids))return fail('UNCONFIRMED');
   const ids=[receipt.userMid,...Array.from(receipt.replyMids)];
   if(ids.some(id=>!validId(id)||turn.before.has(id))||new Set(ids).size!==ids.length)return fail('UNCONFIRMED');
   const rows=read();if(!rows)return fail('HISTORY_UNAVAILABLE');
   const positions=new Map();
   for(let i=0;i<rows.length;i++){const mid=rows[i]?.mid;if(ids.includes(mid)){if(positions.has(mid))return fail('UNCONFIRMED');positions.set(mid,i);}}
   const start=positions.get(receipt.userMid),message=rows[start];
   if(!user(message)||textOf(message)!==turn.text)return fail('UNCONFIRMED');
   let previous=start;
   const replies=[];
   for(const id of ids.slice(1)){
    const at=positions.get(id),m=rows[at],speaker=publicReply(m)?roster.speakerFor(m):null;
    if(!Number.isInteger(at)||at<=previous||!speaker)return fail('UNCONFIRMED');
    replies.push(Object.freeze({mid:id,speakerId:speaker}));previous=at;
   }
   if(!current())return fail('SCOPE_CHANGED');
   return Object.freeze({ok:true,userMid:receipt.userMid,replies:Object.freeze(replies)});
  }
  function settle(token,receipt){
   if(!canContinue(token))return fail('STALE_TURN');
   const result=inspect(token,receipt);
   pending=null;
   return result;
  }
  function abandon(token){if(!canContinue(token))return false;pending=null;return true;}
  function close(){closed=true;pending=null;}
  return Object.freeze({begin,canContinue,inspect,settle,abandon,close});
 }
 root.MAOGroupCallTurn=Object.freeze({version:1,create});
})(window);
