import {remoteScript} from './remote-script.ts';
import {capability} from './capability.ts';
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sha256Hex(input:string){
  const data=new TextEncoder().encode(input);
  const hash=await crypto.subtle.digest("SHA-256",data);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

function rosQuote(v: unknown){
  return '"' + String(v ?? "")
    .replace(/\\/g,"\\\\")
    .replace(/"/g,'\\"')
    .replace(/\$/g,"\\$")
    .replace(/\r/g,"\\r")
    .replace(/\n/g,"\\n") + '"';
}

async function probeSignature(secret:string,commandId:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const hash=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode("ISP-PROBE-V2:"+commandId));
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

function baseProfileFor(profile:string){
  if(profile==="ISP-Light") return "1 - Light";
  if(profile==="ISP-Eco") return "2 - Economic";
  if(profile==="ISP-STANDARD") return "3 - Standard";
  if(profile==="IPS-Turbo") return "4 - Active";
  return "2 - Economic";
}

function ensureProfileScript(profile:string, rate:string){
  const base=baseProfileFor(profile);
  return ':local pr '+rosQuote(profile)+';:local rt '+rosQuote(rate)+';:local pf [/ppp profile find where name=$pr];:if ([:len $pf]=0) do={:local bn '+rosQuote(base)+';:local bp [/ppp profile find where name=$bn];:if ([:len $bp]=0) do={:error "Base PPP profile not found"};/ppp profile add copy-from=[:pick $bp 0] name=$pr;:set pf [/ppp profile find where name=$pr]};:if ([:len $rt]>0) do={/ppp profile set [:pick $pf 0] rate-limit=$rt};';
}

function buildScript(c:any, probeToken:string=''){
  const t=String(c?.type||"");
  const u=String(c?.username||"");
  const old=String(c?.old_username||u);
  const pw=String(c?.password||"");
  const profile=String(c?.profile||"");
  const sid=String(c?.subscriber_id||"");
  const short=sid.replace(/-/g,"").slice(0,8);
  const up=Number(c?.upload_mbps);
  const down=Number(c?.download_mbps);
  const rate=(Number.isFinite(up)&&Number.isFinite(down)&&up>0&&down>0)?String(up)+'M/'+String(down)+'M':"";
  const expName='ISP-EXP-'+short;
  const expDate=String(c?.expires_local_date||"");
  const expTime=String(c?.expires_local_time||"");
  const expired=c?.expired_now===true;

  if(t==="PROBE_INTERNET"){
    const commandId=String(c?.id||"");
    if(!/^[0-9a-f-]{36}$/i.test(commandId)||!/^[0-9a-f]{64}$/i.test(probeToken))
      throw new Error("Missing unique probe signature");
    const endpoint='https://varccsjoydhlfazaizqs.supabase.co/functions/v1/isp-network-probe-ingest?v=2&id='+commandId+'&sig='+probeToken+'&a=';
    return ':local a "";:local b "";'+
      ':for i from=1 to=20 do={:local r [/ping address=8.8.8.8 count=1];:if (($r!=0)&&($r!=1)) do={:error "invalid ICMP result"};:set a ($a . $r);:delay 100ms;};'+
      ':for i from=1 to=20 do={:local r [/ping address=8.8.4.4 count=1];:if (($r!=0)&&($r!=1)) do={:error "invalid ICMP result"};:set b ($b . $r);:delay 100ms;};'+
      ':local url ('+rosQuote(endpoint)+' . $a . "&b=" . $b);'+
      '/tool fetch url=$url keep-result=no;:put "OK";';
  }


  if(t==="DELETE_PPPOE"){
    if(!u||!short) throw new Error("DELETE_PPPOE missing exact username/subscriber id");
    return ':local u '+rosQuote(u)+';'+
      ':local secretIds [/ppp secret find where name=$u];'+
      ':if ([:len $secretIds]>1) do={:error "Ambiguous PPPoE username"};'+
      ':foreach a in=[/ppp active find where name=$u] do={/ppp active remove $a};'+
      ':foreach s in=$secretIds do={/ppp secret remove $s};'+
      ':foreach e in=[/system scheduler find where name='+rosQuote(expName)+'] do={/system scheduler remove $e};'+
      ':foreach e in=[/system scheduler find where name=("EXP-" . $u)] do={/system scheduler remove $e};'+
      ':put "OK";';
  }

  if(t==="DISCONNECT_SESSION")
    return ':local u '+rosQuote(u)+';:foreach a in=[/ppp active find where name=$u] do={/ppp active remove $a};:put "OK";';

  if(t==="DISABLE_PPPOE")
    return ':local u '+rosQuote(u)+';:local s [/ppp secret find where name=$u];:if ([:len $s]=0) do={:error "PPPoE secret not found"};/ppp secret disable [:pick $s 0];:foreach a in=[/ppp active find where name=$u] do={/ppp active remove $a};:put "OK";';

  if(t==="ENABLE_PPPOE")
    return ':local u '+rosQuote(u)+';:local s [/ppp secret find where name=$u];:if ([:len $s]=0) do={:error "PPPoE secret not found"};/ppp secret enable [:pick $s 0];:put "OK";';

  if(t==="CREATE_PPPOE"){
    if(!u||!profile) throw new Error("CREATE_PPPOE missing username/profile");
    return ensureProfileScript(profile,rate)+
      ':local u '+rosQuote(u)+';:local pw '+rosQuote(pw)+';:local s [/ppp secret find where name=$u];:if ([:len $s]=0) do={/ppp secret add name=$u password=$pw service=pppoe profile=$pr disabled=no comment="ISP Control"} else={/ppp secret set [:pick $s 0] password=$pw service=pppoe profile=$pr disabled=no};:put "OK";';
  }

  if(t==="UPDATE_PPPOE"){
    const prefix=profile?ensureProfileScript(profile,rate):"";
    let setCmd='/ppp secret set [:pick $s 0] name=$u password=$pw';
    if(profile) setCmd+=' profile=$pr';
    return prefix+
      ':local u '+rosQuote(u)+';:local ou '+rosQuote(old)+';:local pw '+rosQuote(pw)+';:local s [/ppp secret find where name=$ou];:if ([:len $s]=0) do={:set s [/ppp secret find where name=$u]};:if ([:len $s]=0) do={:error "PPPoE secret not found"};'+setCmd+';:put "OK";';
  }

  if(t==="UPDATE_SPEED"){
    if(!rate||!short) throw new Error("UPDATE_SPEED missing speed/subscriber");
    const np='ISP-U-'+short;
    return ':local u '+rosQuote(u)+';:local rt '+rosQuote(rate)+';:local np '+rosQuote(np)+';:local s [/ppp secret find where name=$u];:if ([:len $s]=0) do={:error "PPPoE secret not found"};:local pf [/ppp profile find where name=$np];:if ([:len $pf]=0) do={:local oldp [/ppp secret get [:pick $s 0] profile];:local bp [/ppp profile find where name=$oldp];:if ([:len $bp]=0) do={:error "Current PPP profile not found"};/ppp profile add copy-from=[:pick $bp 0] name=$np;:set pf [/ppp profile find where name=$np]};/ppp profile set [:pick $pf 0] rate-limit=$rt;/ppp secret set [:pick $s 0] profile=$np;:put "OK";';
  }

  if(t==="REMOVE_EXPIRY")
    return ':local u '+rosQuote(u)+';/system scheduler remove [find where name='+rosQuote(expName)+'];/system scheduler remove [find where name=("EXP-" . $u)];:put "OK";';

  if(t==="SET_EXPIRY"){
    if(!short) throw new Error("SET_EXPIRY missing subscriber");
    if(expired)
      return ':local u '+rosQuote(u)+';/system scheduler remove [find where name='+rosQuote(expName)+'];/ppp secret disable [find where name=$u];:foreach a in=[/ppp active find where name=$u] do={/ppp active remove $a};:put "OK";';
    if(!expDate||!expTime) throw new Error("SET_EXPIRY missing expiry");
    const event=':local u '+rosQuote(u)+';/ppp secret disable [find where name=$u];:foreach a in=[/ppp active find where name=$u] do={/ppp active remove $a};:log warning ("SUBSCRIPTION EXPIRED: " . $u);';
    return ':local ev '+rosQuote(event)+';/system scheduler remove [find where name='+rosQuote(expName)+'];/system scheduler add name='+rosQuote(expName)+' start-date='+expDate+' start-time='+expTime+' interval=0s policy=read,write,policy,test,sensitive on-event=$ev;:put "OK";';
  }

  throw new Error('Unsupported command: '+t);
}

Deno.serve(async (req:Request)=>{
  if(req.method!=="POST") return new Response("method not allowed",{status:405});
  try{
    const auth=req.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer ")) return new Response("unauthorized",{status:401});
    const token=auth.slice(7).trim();
    if(token.length<24) return new Response("unauthorized",{status:401});

    const db=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    const tokenHash=await sha256Hex(token);
    const {data:tokenRow,error:tokenErr}=await db.from("router_connector_tokens")
      .select("id,connector_router_id").eq("token_hash",tokenHash).eq("active",true).maybeSingle();
    if(tokenErr||!tokenRow) return new Response("unauthorized",{status:401});

    const {data:core,error:coreErr}=await db.from("routers")
      .select("id").eq("device_role","CORE").maybeSingle();
    if(coreErr||!core) throw coreErr || new Error("CORE router not found");

    const channelSeenAt=new Date().toISOString();
    await db.from("routers")
      .update({command_channel_last_seen_at:channelSeenAt})
      .eq("id",tokenRow.connector_router_id);

    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"pull").toLowerCase();

    if(action==="pull"){
      const {data:remote,error:remoteError}=await db.rpc("isp_control_job",{p_action:"claim",p_router:core.id});
      if(remoteError)throw remoteError;
      if(remote)return Response.json({ok:true,channel:"online",command:{id:remote.id,type:"PROBE_INTERNET",username:"",script:remoteScript(remote.id,remote.script,await capability(remote.id))}});
      const {data,error}=await db.rpc("claim_next_router_command",{p_router_id:core.id});
      if(error) throw error;
      await db.from("router_connector_tokens").update({last_used_at:new Date().toISOString()}).eq("id",tokenRow.id);
      if(!data) return Response.json({ok:true,channel:"online",command:null});
      let probeToken="";
      if(data.type==="PROBE_INTERNET"){
        const {data:cfg,error:cfgErr}=await db.rpc("get_isp_probe_config_for_service");
        if(cfgErr||!cfg?.active)throw new Error("Probe auth config unavailable");
        probeToken=await probeSignature(String(cfg.token||""),String(data.id));
      }
      return Response.json({ok:true,channel:"online",command:{id:data.id,type:data.type,username:data.username,script:buildScript(data,probeToken)}});
    }

    if(action==="result"){
      const commandId=String(body?.command_id||"");
      if(!/^[0-9a-f-]{36}$/i.test(commandId)) return Response.json({ok:false,error:"invalid command_id"},{status:400});
      const success=body?.ok===true;
      const {data:remoteAck,error:ackError}=await db.rpc("isp_control_job",{p_action:"ack",p_router:core.id,p_request:commandId,p_hash:success?"ok":"failed",p_script:String(body?.error||"Worker did not confirm execution; review before sending again")});
      if(ackError)throw ackError;
      if(remoteAck?.remote)return Response.json({ok:true,channel:"online"});
      const err=success?null:String(body?.error||"execution failed").slice(0,1000);
      const {error}=await db.rpc("finish_router_command",{
        p_command_id:commandId,p_router_id:core.id,p_ok:success,p_error:err
      });
      if(error) throw error;
      await db.from("router_connector_tokens").update({last_used_at:new Date().toISOString()}).eq("id",tokenRow.id);
      return Response.json({ok:true,channel:"online"});
    }

    return Response.json({ok:false,error:"unsupported action"},{status:400});
  }catch(err:any){
    return Response.json({ok:false,error:String(err?.message||err)},{status:500});
  }
});
