import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=n=>readFileSync(new URL('../backend/'+n,import.meta.url),'utf8');
const html=readFileSync(new URL('../isp-control/index.html',import.meta.url),'utf8');
test('complete application and remote UI parse',()=>{new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);});
test('embedded UI matches source without dollar substitution',()=>{assert.ok(html.includes(source('router-control-ui.js')));});
test('all Edge functions parse after stripping TypeScript',()=>{for(const f of ['remote-script.ts','capability.ts','isp-router-control.ts','isp-router-control-result.ts','isp-router-commands.ts'])new vm.Script(stripTypeScriptTypes(source(f)).replace(/^import .*;$/gm,'').replace(/export /g,''));});
const scriptModule=stripTypeScriptTypes(source('remote-script.ts')).replace(/export /g,'');
const {rosQuote,remoteScript,prepareScript}=new Function(scriptModule+';return {rosQuote,remoteScript,prepareScript}')();
test('RouterOS strings cannot escape wrappers',()=>{assert.equal(rosQuote('"; :put $x\n\\'),'"\\"; :put \\$x\\n\\\\"');});
test('v6 wrapper uses no unsupported HTTP POST or v7 commands',()=>{
const s=remoteScript('11111111-1111-4111-8111-111111111111',':put "hello"','a'.repeat(64));
assert.ok(s.includes(':parse '));assert.ok(s.includes('&token='+'a'.repeat(64)));assert.ok(!s.includes('http-method'));assert.ok(!s.includes('http-header-field'));assert.ok(!s.includes(':execute'));assert.throws(()=>remoteScript('../escape','x','a'.repeat(64)));
});
test('simple print queries return data; arbitrary scripts remain intact',()=>{assert.equal(prepareScript('/interface print detail without-paging'),':return [/interface print as-value ];');assert.equal(prepareScript('/ip address add address=1.1.1.1/32 interface=lo'),'/ip address add address=1.1.1.1/32 interface=lo');assert.equal(prepareScript(':return "done"'),':return "done"');assert.equal(prepareScript('/interface print; /system clock print'),'/interface print; /system clock print');});
async function handler(file,db){let serve;const code=stripTypeScriptTypes(source(file)).replace(/^import .*;$/gm,'').replace(/export /g,'');new Function('createClient','Deno','capability',code)(()=>db,{env:{get:()=> 'fixture-only'},serve:f=>serve=f},async()=> 'a'.repeat(64));return serve;}
const user='22222222-2222-4222-8222-222222222222';
function dbFixture(role='OWNER',valid=true){const calls=[];return {calls,auth:{getUser:async()=>({data:{user:valid?{id:user}:null},error:valid?null:{}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role}})})})}),rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_action==='list'?[]:{id:'job',status:'PENDING',accepted:true}};}};}
const req=b=>new Request('https://fixture/functions/v1/control',{method:'POST',headers:{authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(b)});
test('invalid session and non-owner cannot enqueue or read',async()=>{for(const [role,valid,status] of [['OWNER',false,401],['MANAGER',true,403],['VIEWER',true,403]]){const db=dbFixture(role,valid),h=await handler('isp-router-control.ts',db);assert.equal((await h(req({action:'list'}))).status,status);assert.equal(db.calls.length,0);}});
test('enqueue requires explicit confirmation, bounded command and UUIDs',async()=>{const db=dbFixture(),h=await handler('isp-router-control.ts',db);const b={action:'enqueue',script:':put "ok"',confirmed:true,router_id:user,request_id:user};for(const invalid of [{...b,confirmed:false},{...b,script:'x'.repeat(8001)},{...b,router_id:'bad'}])assert.equal((await h(req(invalid))).status,400);assert.equal(db.calls.length,0);assert.equal((await h(req(b))).status,200);assert.equal(db.calls[0].args.p_actor,user);});
test('result requires capability and preserves unknown/failed states',async()=>{const db=dbFixture(),h=await handler('isp-router-control-result.ts',db);const url='https://fixture/result?id='+user;assert.equal((await h(new Request(url))).status,401);assert.equal(db.calls.length,0);for(const [output,status] of [['hello','COMPLETED'],['__ISP_COMMAND_ERROR__','FAILED'],['__ISP_UNKNOWN__: timeout','UNKNOWN'],['__ISP_OUTPUT_TOO_LARGE__','UNKNOWN']]){const r=await h(new Request(url+'&output='+encodeURIComponent(output),{headers:{authorization:'Basic '+btoa('ispremote:'+'a'.repeat(64))}}));assert.equal(r.status,200);assert.equal(db.calls.at(-1).args.p_hash,status);}});
test('UI presets never dispatch, results are escaped and drafts survive polling',()=>{const s=source('router-control-ui.js');assert.ok(s.includes('esc(j.output'));assert.ok(s.includes('remoteControl.draft=e.target.value'));assert.ok(s.includes("if(!isOwner()||remoteControl.busy)return"));assert.ok(s.includes('confirmed:true'));assert.ok(!s.includes('innerHTML=j.output'));});
