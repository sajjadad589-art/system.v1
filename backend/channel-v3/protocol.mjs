export function quote(v){return '"'+String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\$/g,'\\$').replace(/\r/g,'\\r').replace(/\n/g,'\\n')+'"';}
export function prepareScript(s){
 const script=String(s).trim();const m=script.match(/^(\/[a-zA-Z0-9_ /-]+)\s+print(?:\s+([^;\r\n]*))?$/);
 if(!m)return script;
 const options=(m[2]||'').replace(/\b(without-paging|detail|terse|as-value)\b/g,'').trim();
 return ':return ['+m[1]+' print as-value '+options+'];';
}
export function sshCommand(script){return ':local run [:parse '+quote(script)+'];:local value [$run];:put [:tostr $value];';}
export function resultParams(b,connector,core){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.command_id||''))throw Error('id');
 if(!['CORE','CONNECTOR'].includes(b.target)||typeof b.ok!=='boolean')throw Error('target/status');
 const output=String(b.ok?b.output??'':b.error??'execution failed');
 return {p_action:'finish_paired',p_router:b.target==='CORE'?core:connector,p_request:b.command_id,p_hash:b.ok?(output.length>8000?'UNKNOWN':'COMPLETED'):'FAILED',p_script:output.slice(0,8000)};
}

