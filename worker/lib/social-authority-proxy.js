/** REAL-FRIEND-001: the isolated identity authority owns both accounts, consent,
 * approvals and ciphertext in one store. Never trust stale Preview peer rows. */
import {ApiError} from './http.js';
import {usesExistingAccountAuthority,probeExistingIdentityAuthority} from './identity-bridge.js';
import {cookieValue} from './account-auth.js';
const ID=/^MAO-[A-Z0-9]{12,24}$/;
const ORIGIN='https://mao520.com';

export function isSocialAuthorityRoute(path,method) {
  if(method==='GET'){
    if(['/api/social/friends','/api/social/friend-requests','/api/social/e2ee/conversations','/api/social/e2ee/keys','/api/admin/social/friend-approvals'].includes(path))return true;
    return /^\/api\/social\/e2ee\/(?:keys\/MAO-[A-Z0-9]{12,24}|chats\/MAO-[A-Z0-9]{12,24}\/(?:messages|media\/med_[A-Za-z0-9_-]{16,64}))$/.test(path);
  }
  if(method==='POST'){
    if(['/api/social/friend-codes','/api/social/friend-requests','/api/social/e2ee/keys'].includes(path))return true;
    return /^\/api\/social\/(?:friend-requests\/[A-Za-z0-9_-]{8,96}\/(?:accept|decline|cancel)|friends\/MAO-[A-Z0-9]{12,24}\/block|e2ee\/chats\/MAO-[A-Z0-9]{12,24}\/(?:messages|media))$/.test(path) ||
      /^\/api\/admin\/social\/friend-approvals\/[A-Za-z0-9_-]{8,96}\/(?:approve|reject)$/.test(path);
  }
  return method==='DELETE' && /^\/api\/social\/friends\/MAO-[A-Z0-9]{12,24}(?:\/block)?$/.test(path);
}
async function boundedText(stream,max,status,code) {
  if(!stream)return '';
  const reader=stream.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,result='';
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>max)throw new ApiError(status,code,'真人好友请求或响应超过安全大小限制');
      result+=decoder.decode(value,{stream:true});
    }
    return result+decoder.decode();
  }catch(error){
    try{await reader.cancel();}catch{}
    if(error instanceof ApiError)throw error;
    throw new ApiError(status,code,'真人好友请求或响应无法读取');
  }finally{reader.releaseLock();}
}
export async function proxySocialAuthority({request,path,method,env,accountAuth}) {
  if(env.MAO_DELEGATED_SOCIAL_ENABLED!=='true'||!usesExistingAccountAuthority(env)||
      env.MAO_QA_AUTHORITY_WORKER!=='maomao-identity-core'||
      !ID.test(String(env.MAO_EXPECTED_FOUNDER_ID||''))||
      typeof env.MAO_IDENTITY_AUTHORITY?.fetch!=='function')
    throw new ApiError(503,'SOCIAL_AUTHORITY_NOT_READY','真人好友的统一账号校验尚未完成');
  if(!isSocialAuthorityRoute(path,method))throw new ApiError(404,'SOCIAL_ROUTE_NOT_FOUND','真人好友接口不存在');
  if(path.startsWith('/api/social/e2ee/')&&env.MAO_SOCIAL_E2EE_ENABLED!=='true')throw new ApiError(503,'E2EE_CHAT_NOT_ENABLED','加密聊天尚未启用');
  const actor=await accountAuth.getAuthenticatedAccount(request);
  if(!actor||actor.status!=='active')throw new ApiError(401,'SOCIAL_LOGIN_REQUIRED','请登录有效的 MAO 账号');
  if(!ID.test(actor.account_id)||request.headers.get('x-mao-account-context')!==actor.account_id)
    throw new ApiError(409,'ACCOUNT_CONTEXT_CHANGED','当前页面账号已变化，请重新进入');
  if(path.startsWith('/api/admin/social/')&&(actor.role!=='super_admin'||actor.account_id!==env.MAO_EXPECTED_FOUNDER_ID))
    throw new ApiError(403,'SOCIAL_ADMIN_ONLY','仅 001 管理员有审批权限');
  const token=cookieValue(request);
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw new ApiError(401,'SOCIAL_LOGIN_REQUIRED','登录会话无效');
  const proof=await probeExistingIdentityAuthority(env);
  if(!proof.connected||!proof.initialized||!proof.configured||proof.qaIsolatedAuthority!==true||
      proof.qaExpectedFounderId!==env.MAO_EXPECTED_FOUNDER_ID)
    throw new ApiError(503,'SOCIAL_AUTHORITY_NOT_READY','真人好友身份服务未通过隔离核验');
  const query=new URLSearchParams();
  const allowed=path==='/api/social/friend-requests'&&method==='GET'?['direction']:
    method==='GET'&&path.endsWith('/messages')?['after']:[];
  for(const [key,value] of new URL(request.url).searchParams){
    if(!allowed.includes(key)||query.has(key)||value.length>40)throw new ApiError(400,'SOCIAL_QUERY_INVALID','真人好友查询参数无效');
    query.set(key,value);
  }
  const headers={authorization:'Bearer '+token,accept:'application/json','x-mao-account-context':actor.account_id};
  const init={method,headers,redirect:'error'};
  if(method!=='GET')headers.origin=ORIGIN;
  if(method==='POST'){
    // Accept the historical empty action POSTs, but never forward arbitrary content types.
    const type=request.headers.get('content-type')||'';
    if(request.body&&!/^application\/json(?:\s*;|$)/i.test(type))throw new ApiError(415,'SOCIAL_JSON_REQUIRED','仅接受 JSON 请求');
    headers['content-type']='application/json';
    init.body=await boundedText(request.body,path.endsWith('/media')?600000:8192,413,'PAYLOAD_TOO_LARGE')||'{}';
  }
  const target=ORIGIN+path+(query.size?'?'+query.toString():'');
  let response;
  try{response=await env.MAO_IDENTITY_AUTHORITY.fetch(new Request(target,init));}
  catch{throw new ApiError(503,'SOCIAL_RESULT_UNCONFIRMED','好友服务未确认结果，请先刷新核对；不会自动重复提交');}
  if(response.redirected||response.status>=300&&response.status<400)throw new ApiError(503,'SOCIAL_AUTHORITY_NOT_READY','好友服务响应无效');
  let payload;
  try{payload=JSON.parse(await boundedText(response.body,1024*1024,503,'SOCIAL_AUTHORITY_RESPONSE_INVALID'));}
  catch{throw new ApiError(503,'SOCIAL_AUTHORITY_RESPONSE_INVALID','好友服务响应无法确认');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||typeof payload.ok!=='boolean'||payload.ok!==response.ok)
    throw new ApiError(503,'SOCIAL_AUTHORITY_RESPONSE_INVALID','好友服务响应无法确认');
  if(response.ok&&Object.hasOwn(payload,'ownerAccountId')&&payload.ownerAccountId!==actor.account_id)
    throw new ApiError(503,'SOCIAL_AUTHORITY_RESPONSE_INVALID','好友数据所属账号不一致');
  return Response.json(payload,{status:response.status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
