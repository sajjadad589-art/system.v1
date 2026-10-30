import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { prepareScript, sshCommand, resultParams } from './protocol.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...(status===401?{'WWW-Authenticate':'Bearer realm="ISP channel"'}:{})}});
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'method not allowed'},405);
 try{
  const a=req.headers.get('authorization')||'';
  if(!a.startsWith('Bearer '))return reply({error:'unauthorized'},401);
  const token=a.slice(7).trim(); if(token.length<24)return reply({error:'unauthorized'},401);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const {data:credential,error:te}=await db.from('router_connector_tokens').select('id,connector_router_id').eq('token_hash',hash).eq('active',true).maybeSingle();
  if(te)throw te;if(!credential)return reply({error:'unauthorized'},401);
  const raw=await req.text();if(raw.length>24000)return reply({error:'too large'},413);
  let b;try{b=JSON.parse(raw);}catch{return reply({error:'invalid JSON'},400);}
  const {data:routers,error:re}=await db.from('routers').select('id,device_role,command_channel_subscriber_enabled').in('device_role',['CORE','CONNECTOR']);
  if(re)throw re;
  const connector=routers?.find(r=>r.device_role==='CONNECTOR'&&r.id===credential.connector_router_id);
  const core=routers?.find(r=>r.device_role==='CORE');
  if(!connector||!core)return reply({error:'router pairing unavailable'},409);
  if(b.action==='test')return reply({ok:true,paired:true,version:3});
  if(b.action==='pull'){
   const {error:seen}=await db.from('routers').update({command_channel_last_seen_at:new Date().toISOString(),command_channel_version:3}).eq('id',connector.id);
   if(seen)throw seen;
   for(const target of [connector,core]){
    const {data:job,error}=await db.rpc('isp_control_job',{p_action:'claim',p_router:target.id});if(error)throw error;
    if(job){const script=prepareScript(job.script);return reply({ok:true,command:{id:job.id,type:'REMOTE_SCRIPT',remote:true,target:target.device_role,script,ssh_script:sshCommand(script)}});}
   }
   // Installation never drains a historical subscriber queue without OWNER consent.
   if(connector.command_channel_subscriber_enabled!==true)return reply({ok:true,subscriber_commands:'paused',command:null});
   // The established endpoint retains subscriber claim/ack semantics.
   const legacy=await fetch(url+'/functions/v1/isp-router-commands',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'pull'}),signal:AbortSignal.timeout(15000)});
   const data=await legacy.json();if(data.command)data.command={...data.command,remote:false,target:'CORE'};
   return reply(data,legacy.status);
  }
  if(b.action==='result'){
   let params;try{params=resultParams(b,connector.id,core.id);}catch{return reply({error:'invalid result'},400);}
   if(b.remote===true){const {data,error}=await db.rpc('isp_control_job',params);if(error)throw error;return reply({ok:true,...data});}
   const legacy=await fetch(url+'/functions/v1/isp-router-commands',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'result',command_id:b.command_id,ok:b.ok===true,error:String(b.error||'').slice(0,1000)}),signal:AbortSignal.timeout(15000)});
   return reply(await legacy.json(),legacy.status);
  }
  return reply({error:'unsupported action'},400);
 }catch(e){console.error('ISP_CHANNEL_V3_ERROR',String(e?.code||'runtime'));return reply({error:'channel request failed'},500);}
});

