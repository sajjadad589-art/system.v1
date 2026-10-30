import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sha256Hex(input:string){
  const data=new TextEncoder().encode(input);
  const hash=await crypto.subtle.digest("SHA-256",data);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function n(v:any,min:number,max:number){
  const x=Number(v);
  if(!Number.isFinite(x))return null;
  return Math.min(max,Math.max(min,x));
}
function keepOrNumber(v:any,current:any,min:number,max:number){
  if(v===undefined||v===null||v===""){
    const c=Number(current);
    return Number.isFinite(c)?Math.min(max,Math.max(min,c)):null;
  }
  return n(v,min,max);
}

Deno.serve(async (req:Request)=>{
  if(req.method!=="POST")return new Response("method not allowed",{status:405});
  try{
    const auth=req.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return new Response("unauthorized",{status:401});
    const token=auth.slice(7).trim();
    if(token.length<24)return new Response("unauthorized",{status:401});
    const supabase=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    const tokenHash=await sha256Hex(token);
    const {data:tokenRow,error:tokenErr}=await supabase.from("router_connector_tokens")
      .select("id,connector_router_id,active").eq("token_hash",tokenHash).eq("active",true).maybeSingle();
    if(tokenErr||!tokenRow)return new Response("unauthorized",{status:401});

    const body=await req.json().catch(()=>({}));
    if(body?.test===true)return Response.json({ok:true,paired:true,connector_router_id:tokenRow.connector_router_id});

    const devices=Array.isArray(body?.devices)?body.devices.slice(0,2):[];
    if(!devices.length)return Response.json({ok:false,error:"devices required"},{status:400});

    const {data:routers,error:routersErr}=await supabase.from("routers")
      .select("id,device_role,routeros_version,uptime_seconds,cpu_load,ram_used_percent,temperature_c,provider_rx_bps,provider_tx_bps,pppoe_active_sessions")
      .in("device_role",["CORE","CONNECTOR"]);
    if(routersErr)throw routersErr;
    const byRole=new Map((routers||[]).map((r:any)=>[r.device_role,r]));

    let accepted=0;
    for(const d of devices){
      const role=String(d?.role||"").toUpperCase();
      if(role!=="CORE"&&role!=="CONNECTOR")continue;
      const router:any=byRole.get(role);
      if(!router)continue;
      if(role==="CONNECTOR"&&router.id!==tokenRow.connector_router_id)continue;

      const probeOnly=d?.probe_only===true;
      const params={
        p_router_id:router.id,
        p_routeros_version:d.routeros_version?String(d.routeros_version).slice(0,40):(probeOnly?router.routeros_version:null),
        p_uptime_seconds:probeOnly?keepOrNumber(d.uptime_seconds,router.uptime_seconds,0,3153600000):n(d.uptime_seconds,0,3153600000),
        p_cpu_load:probeOnly?keepOrNumber(d.cpu_load,router.cpu_load,0,100):n(d.cpu_load,0,100),
        p_ram_used_percent:probeOnly?keepOrNumber(d.ram_used_percent,router.ram_used_percent,0,100):n(d.ram_used_percent,0,100),
        p_temperature_c:d.temperature_c==null?(probeOnly?keepOrNumber(null,router.temperature_c,-20,150):null):n(d.temperature_c,-20,150),
        p_internet_status:["ONLINE","OFFLINE"].includes(String(d.internet_status??"").trim().toUpperCase())?String(d.internet_status).trim().toUpperCase():"UNKNOWN",
        p_provider_rx_bps:probeOnly?(keepOrNumber(d.provider_rx_bps,router.provider_rx_bps,0,1000000000000)??0):(n(d.provider_rx_bps,0,1000000000000)??0),
        p_provider_tx_bps:probeOnly?(keepOrNumber(d.provider_tx_bps,router.provider_tx_bps,0,1000000000000)??0):(n(d.provider_tx_bps,0,1000000000000)??0),
        p_pppoe_active_sessions:probeOnly?(keepOrNumber(d.pppoe_active_sessions,router.pppoe_active_sessions,0,100000)??0):(n(d.pppoe_active_sessions,0,100000)??0)
      };
      const {error}=await supabase.rpc("ingest_router_heartbeat",params);
      if(error)throw error;
      if(role==="CORE"&&probeOnly)await supabase.from("routers").update({adapter_mode:"PING"}).eq("id",router.id);
      accepted++;
    }

    await supabase.from("router_connector_tokens").update({last_used_at:new Date().toISOString()}).eq("id",tokenRow.id);
    return Response.json({ok:true,accepted});
  }catch(err:any){
    console.error("ISP_HEARTBEAT_ERROR", JSON.stringify({code:err?.code,message:err?.message}));
    return Response.json({ok:false,error:String(err?.message||err)},{status:500});
  }
});