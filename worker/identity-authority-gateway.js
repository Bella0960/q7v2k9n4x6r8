/**
 * Internal identity gateway for the one existing MAOMAO founder account.
 *
 * Cloudflare forbids mounting a Preview's Durable Object namespace into any
 * other Worker (API 10061). This gateway therefore forwards ONLY existing
 * authentication endpoints over HTTPS to the verified founder Preview.
 *
 * The gateway has no public workers.dev endpoint, no routes, no database,
 * no local users, no founder bootstrap, and no access to wallet/chat data.
 * QA invokes it through a secret-gated Worker Service Binding.
 */
const INTERNAL_ORIGIN='https://mao520.com';
const FOUNDER_AUTHORITY_ORIGIN='https://qa-phone-founder-001-keyreset-20261111-mao.miamor520000.workers.dev';
const BRIDGE_HEADER='x-mao-identity-bridge';
const OPERATIONS=new Set([
  'GET /api/admin/bootstrap/status',
  'POST /api/accounts/login',
  'GET /api/accounts/me',
  'POST /api/accounts/logout'
]);
function error(status,code){
  return new Response(JSON.stringify({ok:false,error:{code}}),{
    status,headers:{'content-type':'application/json','cache-control':'no-store'}
  });
}
async function authorized(configured,supplied){
  if(configured.length<32||supplied.length<32)return false;
  const encoder=new TextEncoder();
  const results=await Promise.all([configured,supplied].map(s=>
    crypto.subtle.digest('SHA-256',encoder.encode('maomao-gateway|'+s))
  ));
  const a=new Uint8Array(results[0]),b=new Uint8Array(results[1]);
  if(a.length!==b.length)return false;
  let difference=0;
  for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  return difference===0;
}
export async function handleGatewayRequest(request,env,outboundFetch=fetch){
  const url=new URL(request.url);
  if(url.origin!==INTERNAL_ORIGIN||url.search||
     !OPERATIONS.has(request.method.toUpperCase()+' '+url.pathname)){
    return error(404,'IDENTITY_GATEWAY_ROUTE_DENIED');
  }
  const configured=String(env.MAO_IDENTITY_BRIDGE_SECRET||'');
  const supplied=String(request.headers.get(BRIDGE_HEADER)||'');
  if(!await authorized(configured,supplied)){
    return error(403,'IDENTITY_GATEWAY_FORBIDDEN');
  }
  const target=FOUNDER_AUTHORITY_ORIGIN+url.pathname;
  const headers=new Headers(request.headers);
  headers.delete(BRIDGE_HEADER);
  headers.delete('cookie');
  headers.delete('cf-connecting-ip');
  if(request.method!=='GET')headers.set('origin',FOUNDER_AUTHORITY_ORIGIN);
  else headers.delete('origin');
  try{
    const forwarded=new Request(target,{
      method:request.method,headers,
      ...(request.method!=='GET'?{body:await request.text()}:{}),
      redirect:'manual',
      signal:AbortSignal.timeout(15000)
    });
    const response=await outboundFetch(forwarded);
    if(response.status>=300&&response.status<400)
      return error(502,'IDENTITY_AUTHORITY_REDIRECT_DENIED');
    return response;
  }catch{
    return error(503,'IDENTITY_AUTHORITY_OFFLINE');
  }
}
export default {
  fetch(request,env){return handleGatewayRequest(request,env);}
};