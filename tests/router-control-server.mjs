import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../isp-control/index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const jobs=[];
createServer(async(req,res)=>{
res.setHeader('Content-Type','application/json; charset=utf-8');
if(req.url.startsWith('/functions/')){let body='';for await(const c of req)body+=c;const b=JSON.parse(body);if(b.action==='enqueue'){const job={id:crypto.randomUUID(),router_id:b.router_id,script:b.script,status:'COMPLETED',output:'FIXTURE: command preview verified',created_at:new Date().toISOString()};jobs.unshift(job);res.end(JSON.stringify({id:job.id,status:'PENDING'}));}else res.end(JSON.stringify({jobs}));return;}
if(req.url==='/requests'){res.end(JSON.stringify(jobs));return;}
const fixture=`state.profile={role:'OWNER'};state.routers=[{id:'19b8c5c4-df01-4cb5-b885-5a69ffab94c1',name:'Main MikroTik',model:'RB1100AHx4',routeros_version:'6.38.7',device_role:'CORE',adapter_mode:'ROUTEROS',router_status:'ONLINE'},{id:'1acd1f8d-5eb6-42e9-b027-5c325a30aa82',name:'ISP Connector',model:'RB951',device_role:'CONNECTOR',adapter_mode:'ROUTEROS',command_channel_last_seen_at:new Date().toISOString()}];$('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');goPage('router-control');`;
const page=html.replace("const SUPABASE_URL='https://varccsjoydhlfazaizqs.supabase.co';","const SUPABASE_URL=location.origin;").replace('let session=loadSession();','let session=null;').replace('  setupPWA();\n  boot();',fixture);
res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);
}).listen(4175,'127.0.0.1',()=>console.log('Router control fixture on port 4175'));
