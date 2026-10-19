import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
export async function hash(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return reply({error:'method not allowed'},405);
 try{
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  const {data:auth,error:ae}=await db.auth.getUser(token);if(ae||!auth.user)return reply({error:'unauthorized'},401);
  const {data:profile}=await db.from('profiles').select('role').eq('id',auth.user.id).single();
  if(profile?.role!=='OWNER')return reply({error:'هذا القسم متاح لمالك النظام فقط'},403);
  const raw=await req.text();if(raw.length>16000)return reply({error:'request too large'},413);const b=JSON.parse(raw);
  if(b.action==='list'){
   // Maintenance expires stale jobs without re-executing them.
   const {data,error}=await db.rpc('isp_control_job',{p_action:'list',p_actor:auth.user.id});
   if(error)throw error;return reply({jobs:data});
  }
  if(b.action==='cancel'){
   const {data,error}=await db.rpc('isp_control_job',{p_action:'cancel',p_actor:auth.user.id,p_request:b.id});
   if(error)throw error;return reply(data);
  }
  if(b.action!=='enqueue'||b.confirmed!==true||typeof b.script!=='string'||!b.script.trim()||new TextEncoder().encode(b.script).length>8000||!/^[0-9a-f-]{36}$/i.test(b.router_id||'')||!/^[0-9a-f-]{36}$/i.test(b.request_id||''))return reply({error:'invalid command'},400);
  const {data,error}=await db.rpc('isp_control_job',{p_action:'enqueue',p_actor:auth.user.id,p_router:b.router_id,p_script:b.script,p_request:b.request_id});
  if(error)return reply({error:error.message},409);
  return reply(data);
 }catch{return reply({error:'تعذر إتمام طلب التحكم'},500);}
});
