import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {validateSample} from './model.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(x:unknown,status=200)=>Response.json(x,{status,headers});
const hash=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return reply({error:'method'},405);
 try{
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(token.length<24||token.length>4096)return reply({error:'unauthorized'},401);
  const raw=await req.text();if(raw.length>100000)return reply({error:'too large'},413);
  const b=JSON.parse(raw);
  if(['config','ingest'].includes(b.action)){
   const {data:c,error:ce}=await db.from('router_connector_tokens').select('connector_router_id').eq('token_hash',await hash(token)).eq('active',true).maybeSingle();
   if(ce||!c)return reply({error:'unauthorized'},401);
   const {data:r}=await db.from('routers').select('device_role').eq('id',c.connector_router_id).single();if(r?.device_role!=='CONNECTOR')return reply({error:'unauthorized'},401);
   if(b.action==='config'){
    const {data,error}=await db.from('isp_monitor_controls').select('subscriber_id,generation,subscribers!inner(pppoe_username,source_router_id)').eq('enabled',true).limit(5);if(error)throw error;
    return reply({controls:data,interval_seconds:30,max_connections:100});
   }
   let sample;try{sample=validateSample(b.sample);}catch{return reply({error:'invalid sample'},400);}
   const {data,error}=await db.rpc('isp_monitor_ingest',{p_sample:sample});if(error)return reply({error:'sample rejected'},409);
   return reply({accepted:data});
  }
  const {data:auth,error:ae}=await db.auth.getUser(token);if(ae||!auth.user)return reply({error:'unauthorized'},401);
  const {data:p}=await db.from('profiles').select('role').eq('id',auth.user.id).single();if(p?.role!=='OWNER')return reply({error:'owner required'},403);
  if(b.action==='toggle'){
   if(typeof b.enabled!=='boolean'||typeof b.subscriber_id!=='string')return reply({error:'invalid control'},400);
   const {data:s}=await db.from('subscribers').select('id').eq('id',b.subscriber_id).is('archived_at',null).maybeSingle();if(!s)return reply({error:'subscriber not found'},404);
   const {error}=await db.from('isp_monitor_controls').upsert({subscriber_id:s.id,enabled:b.enabled,generation:crypto.randomUUID(),updated_at:new Date().toISOString()});if(error)throw error;
   return reply({ok:true});
  }
  if(b.action==='list'){
   const {data,error}=await db.from('isp_monitor_controls').select('*');if(error)throw error;return reply({controls:data});
  }
  if(b.action==='samples'){
   const {data,error}=await db.from('isp_monitor_samples').select('*').eq('subscriber_id',b.subscriber_id).order('sampled_at',{ascending:false}).limit(10);if(error)throw error;return reply({samples:data});
  }
  return reply({error:'unsupported action'},400);
 }catch{return reply({error:'monitor request failed'},500);}
});
