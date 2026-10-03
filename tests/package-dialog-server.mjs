import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Local regression fixture: real UI and RPC serialization; no cloud/router writes.
const html=readFileSync(new URL('../isp-control/index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const subscriberId='00000000-0000-4000-8000-000000000001';
const packageId='00000000-0000-4000-8000-000000000002';
const requests=[];
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4173');
  if(req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({path:url.pathname,body:JSON.parse(body)});
    res.setHeader('Content-Type','application/json');
    if(url.searchParams.has('error')){res.statusCode=400;res.end(JSON.stringify({message:'اختبار خطأ RPC'}));}
    else res.end(JSON.stringify('2026-10-22T14:00:00Z'));
    return;
  }
  if(url.pathname==='/requests'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(requests));return;}
  const testCase=url.searchParams.get('case')||'missing';
  const fixture=`
    state.profile={role:${JSON.stringify(testCase==='viewer'?'VIEWER':'OWNER')}};
    state.subscribers=[{id:'${subscriberId}',full_name:'مشترك اختبار',pppoe_username:'fixture',package_id:'${packageId}',status:'ACTIVE'}];
    state.packages=${JSON.stringify(testCase==='empty'?[]:[{id:packageId,name:'باقة اختبار',active:true,download_mbps:10,upload_mbps:2}])};
    state.subscriptions=${JSON.stringify(testCase==='existing'?[{subscriber_id:subscriberId,expires_at:'2026-10-22T14:00:00Z'}]:[])};
    refreshAll=async()=>{};
    $('#authView').classList.add('hidden');
    openSubscriberActions('${subscriberId}');
  `;
  const page=html
    .replace("const SUPABASE_URL='https://varccsjoydhlfazaizqs.supabase.co';","const SUPABASE_URL=location.origin;")
    .replace("'/rest/v1/rpc/'+name","'/rest/v1/rpc/'+name+"+JSON.stringify(testCase==='error'?'?error=1':''))
    .replace('let session=loadSession();','let session=null;')
    .replace('  setupPWA();\n  boot();',fixture);
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);
}).listen(4173,'127.0.0.1',()=>console.log('Package dialog fixture: http://127.0.0.1:4173'));
