import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {capability} from './capability.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(async req=>{
 if(req.method!=='GET')return new Response('method not allowed',{status:405});
 const id=new URL(req.url).searchParams.get('id')||'';
 if(!/^[0-9a-f-]{36}$/.test(id))return new Response('invalid id',{status:400});
 let supplied=new URL(req.url).searchParams.get('token')||'';try{const a=req.headers.get('authorization')||'';if(a.startsWith('Basic '))supplied=atob(a.slice(6)).replace(/^ispremote:/,'');}catch{}
 const expected=await capability(id);let diff=supplied.length^expected.length;for(let i=0;i<expected.length;i++)diff|=(supplied.charCodeAt(i)||0)^expected.charCodeAt(i);
 if(diff)return new Response('unauthorized',{status:401,headers:{'WWW-Authenticate':'Basic realm="ISP remote result"'}});
 const output=new URL(req.url).searchParams.get('output')||'';if(output.length>8000)return new Response('too large',{status:413});
 const status=output.includes('__ISP_COMMAND_ERROR__')?'FAILED':output.startsWith('__ISP_UNKNOWN__')?'UNKNOWN':output.startsWith('__ISP_OUTPUT_TOO_LARGE__')?'UNKNOWN':'COMPLETED';
 const {data,error}=await db.rpc('isp_control_job',{p_action:'finish',p_request:id,p_hash:status,p_script:output});
 if(error)return new Response('result not saved',{status:500});return Response.json(data);
});
