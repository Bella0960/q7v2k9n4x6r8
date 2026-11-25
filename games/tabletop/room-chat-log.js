// Pure in-memory game conversation log. Only a trusted future room adapter
// may provide seats, sender metadata and the game's authorized audience.
// No authentication, AI requests, persistence or daily-chat integration here.
export const ROOM_CHAT_SCHEMA = 1;
const fail=code=>{throw new Error(code);};
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
const limit=(v,max)=>Number.isSafeInteger(v)&&v>0&&v<=max;

export function createRoomChatLog({roomId,seats,maxMessages=4096,maxTextLength=4000}={}) {
  if(!validId(roomId)||!Array.isArray(seats)||!seats.length||seats.length>12||
     !limit(maxMessages,10000)||!limit(maxTextLength,16000)) fail('INVALID_CHAT_SPEC');
  const members=new Map();
  for(const seat of seats) {
    if(!seat||!validId(seat.seatId)||members.has(seat.seatId)) fail('INVALID_CHAT_SEAT');
    let sender;
    if(seat.kind==='user'&&seat.seatId==='user'&&seat.roleId===undefined) sender={seatId:'user',kind:'user'};
    else if(seat.kind==='role'&&validId(seat.roleId)&&seat.seatId==='role:'+seat.roleId) sender={seatId:seat.seatId,kind:'role',roleId:seat.roleId};
    else fail('INVALID_CHAT_SEAT');
    members.set(seat.seatId,Object.freeze(sender));
  }
  if(!members.has('user')) fail('INVALID_CHAT_SEAT');
  const entries=[], byId=new Map();
  let closed=false;
  function member(seatId) {
    if(closed) fail('CHAT_CLOSED');
    if(!members.has(seatId)) fail('CHAT_UNKNOWN_SEAT');
    return members.get(seatId);
  }
  function audience(ids,senderSeatId) {
    // Explicit allowlist only: the rule adapter, not the role output, chooses it.
    if(!Array.isArray(ids)||!ids.length||ids.length>members.size||!Array.from(ids).every(id=>members.has(id))||new Set(ids).size!==ids.length||!ids.includes(senderSeatId)) fail('INVALID_CHAT_AUDIENCE');
    return new Set(ids);
  }
  function append({senderSeatId,messageId,audienceSeatIds,time}={},text) {
    const sender=member(senderSeatId);
    if(!validId(messageId)||!Number.isSafeInteger(time)||time<0||typeof text!=='string'||!text.trim()||text.length>maxTextLength) fail('INVALID_CHAT_MESSAGE');
    const readers=audience(audienceSeatIds,senderSeatId);
    const prior=byId.get(messageId);
    if(prior) {
      if(prior.message.sender.seatId!==senderSeatId||prior.message.text!==text||prior.readers.size!==readers.size||[...readers].some(id=>!prior.readers.has(id))) fail('CHAT_MESSAGE_ID_CONFLICT');
      return Object.freeze({message:prior.message,duplicate:true});
    }
    // Fail visibly instead of deleting history. Future persistence is a separate gate.
    if(entries.length>=maxMessages) fail('CHAT_CAPACITY_REACHED');
    const message=Object.freeze({schema:ROOM_CHAT_SCHEMA,roomId,id:messageId,sender,text,time});
    const entry={message,readers};entries.push(entry);byId.set(messageId,entry);
    return Object.freeze({message,duplicate:false});
  }
  function read(seatId,{limit:count=maxMessages}={}) {
    member(seatId);
    if(!limit(count,maxMessages)) fail('INVALID_CHAT_LIMIT');
    // Project only the reader's messages, in authoritative append order.
    // No global sequence, recipient list, total count or hidden-message gaps.
    return entries.filter(entry=>entry.readers.has(seatId)).slice(-count).map(entry=>entry.message);
  }
  return Object.freeze({roomId,maxMessages,append,read,close(){closed=true;}});
}
