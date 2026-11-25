// Pure prompt-data preparation, not authentication or model invocation.
// A trusted caller must pair the live room instance's log with that same
// instance's rule-projected seat view. Game-specific rules own disclosure.
const fail=code=>{throw new Error(code);};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
const clone=v=>JSON.parse(JSON.stringify(v));
const bounded=(v,max)=>Number.isSafeInteger(v)&&v>0&&v<=max;

export function buildRoomSpeechContext({roleSeatId,view,chatLog,historyLimit=24,historyChars=12000}={}) {
  if(!id(roleSeatId)||!((roleSeatId.startsWith('role:')&&id(roleSeatId.slice(5)))||/^bot:[1-3]$/.test(roleSeatId))||
     !bounded(historyLimit,100)||!bounded(historyChars,64000)) fail('INVALID_SPEECH_CONTEXT');
  if(!view||!id(view.roomId)||!id(view.gameId)||view.selfSeatId!==roleSeatId||
     !Number.isSafeInteger(view.revision)||view.revision<0||!['playing','finished'].includes(view.phase)||
     !Array.isArray(view.seats)||view.seats.length<2||view.seats.length>12) fail('INVALID_SPEECH_VIEW');
  if(!chatLog||chatLog.roomId!==view.roomId||typeof chatLog.read!=='function'||!bounded(chatLog.maxMessages,10000)) fail('SPEECH_ROOM_MISMATCH');
  const seen=new Set();
  const seats=Array.from(view.seats,s=>{
    if(!s||!id(s.seatId)||seen.has(s.seatId)||!['player','observer','moderator'].includes(s.mode)) fail('INVALID_SPEECH_VIEW');
    seen.add(s.seatId);
    if(s.kind==='user'&&s.seatId==='user') return {seatId:'user',kind:'user',mode:s.mode};
    if(s.kind==='role'&&id(s.roleId)&&s.seatId==='role:'+s.roleId) return {seatId:s.seatId,kind:'role',roleId:s.roleId,mode:s.mode};
    if(['ludo','gomoku'].includes(view.gameId)&&s.kind==='bot'&&/^bot:[1-3]$/.test(s.seatId)&&s.roleId===undefined&&s.mode==='player') return {seatId:s.seatId,kind:'bot',mode:'player'};
    fail('INVALID_SPEECH_VIEW');
  });
  if(!seen.has('user')||!seen.has(roleSeatId)|| (view.turnSeatId!==null&&!seen.has(view.turnSeatId))) fail('INVALID_SPEECH_VIEW');
  // Only the existing per-seat log reader; never read user history as fallback.
  const visible=chatLog.read(roleSeatId,{limit:Math.min(historyLimit,chatLog.maxMessages)});
  const messages=[];let chars=0;
  for(let i=visible.length-1;i>=0;i--) {
    const m=visible[i],sender=seats.find(s=>s.seatId===m?.sender?.seatId);
    if(!m||m.roomId!==view.roomId||!sender||m.sender.kind!==sender.kind||m.sender.roleId!==sender.roleId||!id(m.id)||typeof m.text!=='string') fail('INVALID_SPEECH_HISTORY');
    if(chars+m.text.length>historyChars) break;
    chars+=m.text.length;
    messages.unshift({id:m.id,senderSeatId:sender.seatId,kind:sender.kind,text:m.text});
  }
  const context={roomId:view.roomId,gameId:view.gameId,phase:view.phase,revision:view.revision,selfSeatId:roleSeatId,turnSeatId:view.turnSeatId,seats,messages};
  if(Object.hasOwn(view,'game')) {
    if(!view.game||typeof view.game!=='object'||Array.isArray(view.game)) fail('INVALID_SPEECH_VIEW');
    context.game=clone(view.game);
  }
  return context;
}
