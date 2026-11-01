import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ipv4,validateSample} from './model.mjs';
const exec=promisify(execFile);
export function scriptFor(name){
 if(typeof name!=='string'||! /^[a-zA-Z0-9_@.+-]{1,100}$/.test(name))throw Error('unsupported PPPoE name');
 // Only read commands; the target IP comes from the active PPPoE session.
 return `:local p [/ppp active find where name="${name}"]; :if ([:len $p] = 0) do={ :put "OFFLINE"; :return; }; :if ([:len $p] != 1) do={ :error "ambiguous PPPoE sessions"; }; :local a [:pick $p 0]; :local ip [/ppp active get $a address]; :local sk [/ppp active get $a session-id]; :put ("BEGIN|" . $ip . "|" . $sk); :local n 0; :foreach c in=[/ip firewall connection find where src-address~("^" . $ip . ":")] do={ :if ($n < 100) do={ :local src [/ip firewall connection get $c src-address]; :local cut [:find $src ":"]; :if ([:typeof $cut] != "nil") do={ :set src [:pick $src 0 $cut]; }; :if ($src = $ip) do={ :local dst [/ip firewall connection get $c dst-address]; :local proto [/ip firewall connection get $c protocol]; :put ("C|" . $dst . "|" . $proto . "|" . [/ip firewall connection get $c orig-bytes] . "|" . [/ip firewall connection get $c repl-bytes]); :local dip $dst; :local dc [:find $dst ":"]; :if ([:typeof $dc] != "nil") do={ :set dip [:pick $dst 0 $dc]; }; :local dn 0; :foreach d in=[/ip dns cache find where address=$dip] do={ :if ($dn < 10) do={ :put ("D|" . $dip . "|" . [/ip dns cache get $d name]); :set dn ($dn + 1); }; }; :set n ($n + 1); }; }; }; :local q [/ppp active find where name="${name}"]; :if ([:len $q] != 1) do={ :error "session changed"; }; :local z [:pick $q 0]; :if (([/ppp active get $z address] != $ip) || ([/ppp active get $z session-id] != $sk)) do={ :error "session changed"; }; :put ("END|" . $n);`;
}
export function parseOutput(raw,control){
 const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const base={id:randomUUID(),subscriber_id:control.subscriber_id,generation:control.generation,sampled_at:new Date().toISOString(),online:false,truncated:false,current_ip:null,session_key:null,connections:[]};
 if(lines.length===1&&lines[0]==='OFFLINE')return base;
 if(lines.length<2||!lines[0].startsWith('BEGIN|')||!/^END\|\d+$/.test(lines.at(-1)))throw Error('incomplete snapshot');
 const [,ip,session]=lines[0].split('|');if(!ipv4(ip)||!session)throw Error('invalid session');
 const dns=new Map();const rows=[];
 for(const line of lines.slice(1,-1)){
  const a=line.split('|');
  if(a[0]==='D'&&a.length===3){dns.set(a[1],[...(dns.get(a[1])||[]),a[2]].slice(0,10));continue;}
  if(a[0]!=='C'||a.length!==5)throw Error('unexpected router output');
  const dest=a[1].split(':');rows.push({ip:dest[0],port:dest.length===2?Number(dest[1]):null,protocol:['tcp','udp','icmp','gre','esp','ah'].includes(a[2])?a[2]:'other',orig_bytes:Number(a[3]),repl_bytes:Number(a[4])});
 }
 const count=Number(lines.at(-1).split('|')[1]);if(count!==rows.length)throw Error('snapshot count mismatch');
 return validateSample({...base,online:true,current_ip:ip,session_key:session,truncated:count===100,connections:rows.map(x=>({...x,domains:dns.get(x.ip)||[]}))});
}
async function main(){
 const endpoint=process.env.ISP_MONITOR_URL,token=process.env.ISP_CONNECTOR_TOKEN,target=process.env.ISP_ROUTER_SSH;
 if(!endpoint?.startsWith('https://')||!token||!target||!/^[a-zA-Z0-9_.@:-]+$/.test(target)||target.startsWith('-'))throw Error('set ISP_MONITOR_URL, ISP_CONNECTOR_TOKEN and ISP_ROUTER_SSH');
 const call=async b=>{const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`monitor HTTP ${r.status}`);return r.json();};
 do{
  const {controls}=await call({action:'config'});
  for(const c of controls){
   try{
    const {stdout}=await exec('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5',target,scriptFor(c.subscribers.pppoe_username)],{timeout:20000,maxBuffer:100000,windowsHide:true});
    const result=await call({action:'ingest',sample:parseOutput(stdout,c)});
    console.log(`${new Date().toISOString()} sample ${result.accepted?'accepted':'disabled or changed'}`);
   }catch{console.error('Sample failed; no data persisted for this attempt');}
  }
  if(process.argv.includes('--once'))break;
  await new Promise(r=>setTimeout(r,30000));
 }while(true);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Collector stopped: configuration or connection failure');process.exitCode=1;});
