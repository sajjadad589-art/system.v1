export const ipv4 = x => typeof x==='string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(x) && x.split('.').every(n=>Number(n)<=255);
export function label(domains) {
 const names=[...new Set(domains.map(x=>String(x).toLowerCase()).filter(x=>x.length<=253&&/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(x)))].sort().slice(0,10);
 const families=[['Google',/(^|\.)(googleapis\.com|google\.com|gstatic\.com|googlevideo\.com|youtube\.com)$/],['Meta',/(^|\.)(facebook\.com|fbcdn\.net|instagram\.com|whatsapp\.net)$/],['TikTok',/(^|\.)(tiktok\.com|tiktokcdn\.com)$/],['Telegram',/(^|\.)telegram\.org$/]];
 const apps=[...new Set(names.flatMap(n=>families.filter(([,r])=>r.test(n)).map(([a])=>a)))];
 return {domains:names,app:apps.length===1?apps[0]:null,confidence:names.length===1?'DNS_CANDIDATE':names.length>1?'AMBIGUOUS':'UNKNOWN',source:'ROUTER_DNS_CACHE'};
}
export function validateSample(b) {
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 if(!uuid(b.id)||!uuid(b.subscriber_id)||!uuid(b.generation)||!Number.isFinite(Date.parse(b.sampled_at))||Math.abs(Date.now()-Date.parse(b.sampled_at))>120000)throw Error('invalid sample identity or time');
 if(typeof b.online!=='boolean'||typeof b.truncated!=='boolean'||!Array.isArray(b.connections)||b.connections.length>100)throw Error('invalid sample');
 if(b.online?(!ipv4(b.current_ip)||typeof b.session_key!=='string'||!b.session_key.length||b.session_key.length>160):(b.current_ip!==null||b.session_key!==null||b.connections.length))throw Error('invalid session');
 const connections=b.connections.map(x=>{
  if(!ipv4(x.ip)||!['tcp','udp','icmp','gre','esp','ah','other'].includes(x.protocol)||!(x.port===null||Number.isInteger(x.port)&&x.port>=1&&x.port<=65535))throw Error('invalid destination');
  if(![x.orig_bytes,x.repl_bytes].every(n=>Number.isSafeInteger(n)&&n>=0)||!Array.isArray(x.domains)||x.domains.length>10)throw Error('invalid counters');
  return {ip:x.ip,port:x.port,protocol:x.protocol,orig_bytes:x.orig_bytes,repl_bytes:x.repl_bytes,...label(x.domains)};
 });
 return {id:b.id,subscriber_id:b.subscriber_id,generation:b.generation,sampled_at:b.sampled_at,online:b.online,truncated:b.truncated,current_ip:b.current_ip,session_key:b.session_key,connections};
}
