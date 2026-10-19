export function rosQuote(v: unknown){return '"'+String(v??'').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\$/g,'\\$').replace(/\r/g,'\\r').replace(/\n/g,'\\n')+'"';}
export function prepareScript(script:string){
 const m=script.trim().match(/^(\/[a-zA-Z0-9_ /-]+)\s+print(?:\s+([^;\r\n]*))?$/);
 if(!m)return script;
 const options=(m[2]||'').replace(/\b(without-paging|detail|terse|as-value)\b/g,'').trim();
 return ':return ['+m[1]+' print as-value '+options+'];';
}
export function remoteScript(id:string,script:string,token:string){
 if(!/^[0-9a-f-]{36}$/.test(id)||!/^[0-9a-f]{64}$/.test(token))throw Error('invalid capability');
 const url='https://varccsjoydhlfazaizqs.supabase.co/functions/v1/isp-router-control-result?id='+id+'&token='+token+'&output=';
 const byteMap='"'+Array.from({length:255},(_,i)=>'\\'+(i+1).toString(16).padStart(2,'0').toUpperCase()).join('')+'"';
 const code=':local run [:parse '+rosQuote(prepareScript(script))+'];:local data [$run];:local result "";'+
 ':if ([:typeof $data]="array") do={:foreach k,v in=$data do={:if ([:typeof $v]="array") do={:foreach a,b in=$v do={:if ([:len $result]<1000) do={:set result ($result . $k . "." . $a . "=" . [:tostr $b] . "\\r\\n")}}} else={:if ([:len $result]<1000) do={:set result ($result . $k . "=" . [:tostr $v] . "\\r\\n")}}}} else={:set result [:tostr $data]};'+
 ':if ([:len $result]=0) do={:set result "Command executed. No return value. Use :return for script results."};'+
 ':if ([:len $result]>=1000) do={:set result ([:pick $result 0 1000] . "\\r\\n[OUTPUT TRUNCATED: filter the query]")};'+
 ':local bytes '+byteMap+';:local hex "0123456789ABCDEF";:local enc "";'+
 ':for i from=0 to=([:len $result]-1) do={:local n [:find $bytes [:pick $result $i ($i+1)]];:if ([:typeof $n]="nil") do={:set n 0} else={:set n ($n+1)};:local hi ($n / 16);:local lo ($n % 16);:set enc ($enc . "%" . [:pick $hex $hi ($hi+1)] . [:pick $hex $lo ($lo+1)])};'+
 '/tool fetch url=('+rosQuote(url)+' . $enc) keep-result=no;:put "OK";';
 return ':do {'+code+'} on-error={/tool fetch url='+rosQuote(url+'__ISP_COMMAND_ERROR__%3A%20command%20or%20result%20delivery%20failed')+' keep-result=no;:put "OK";};';
}
