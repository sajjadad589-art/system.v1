import fs from 'node:fs';import crypto from 'node:crypto';import {quote} from './protocol.mjs';
const out='outputs/isp-channel-v3';fs.mkdirSync(out,{recursive:true});
const secretPath='work/channel-v3/secrets.json';
fs.mkdirSync('work/channel-v3',{recursive:true});
const secrets=fs.existsSync(secretPath)?JSON.parse(fs.readFileSync(secretPath)): {token:crypto.randomBytes(32).toString('hex'),password:crypto.randomBytes(24).toString('hex')};
fs.writeFileSync(secretPath,JSON.stringify(secrets));
const endpoint='https://varccsjoydhlfazaizqs.supabase.co/functions/v1/isp-router-channel-v3';
const worker=`:if ([/system script job print count-only where script="isp-command-worker-v3"]>1) do={:return};
:local token ${quote(secrets.token)};
:local pass ${quote(secrets.password)};
:local ep ${quote(endpoint)};
:local hdr ("Content-Type:application/json,Authorization:Bearer ".$token);
:local f;
:onerror e in={:set f [/tool fetch url=$ep http-method=post http-header-field=$hdr http-data="{\\"action\\":\\"pull\\"}" check-certificate=yes duration=20s idle-timeout=15s output=user as-value];} do={:log warning "ISP V3 PULL FAILED";:return};
:local j [:deserialize from=json value=($f->"data")];
:local c ($j->"command");
:if ([:typeof $c]="nil") do={:return};
:local ok true;:local err "";:local result "";
:local target [:tostr ($c->"target")];
:local remote (($c->"remote")=true);
:onerror e in={
 :if ($target="CONNECTOR") do={
  :if (!$remote) do={:error "Invalid local command"};
  :local run [:parse [:tostr ($c->"script")]];
  :local value [$run];
  :set result [:serialize to=json value=$value options=json.no-string-conversion];
 } else={
  :if ($target!="CORE") do={:error "Invalid execution target"};
  :local code [:tostr ($c->"script")];
  :if ($remote) do={:set code [:tostr ($c->"ssh_script")]};
  :local r [/system ssh-exec address=10.10.5.1 user=isp-channel-v3 password=$pass command=$code as-value];
  :if (($r->"exit-code")!=0) do={:error [:tostr ($r->"output")]};
  :set result [:tostr ($r->"output")];
 };
} do={:set ok false;:set err [:tostr $e]};
:if ([:len $result]>8000) do={:set ok false;:set result "";:set err "Output too large; filter the command. Execution is not retried."};
:local body {"action"="result";"command_id"=[:tostr ($c->"id")];"remote"=$remote;"target"=$target;"ok"=$ok;"output"=$result;"error"=$err};
:local ack;
:onerror e in={:set ack [/tool fetch url=$ep http-method=post http-header-field=$hdr http-data=[:serialize to=json value=$body options=json.no-string-conversion] check-certificate=yes duration=20s idle-timeout=15s output=user as-value];} do={:log warning "ISP V3 ACK FAILED - DO NOT REPLAY COMMAND";:return};
:local saved [:deserialize from=json value=($ack->"data")];
:if (($saved->"ok")!=true) do={:log warning "ISP V3 RESULT NOT CONFIRMED";:return};
:if ($remote && (($saved->"accepted")!=true)) do={:log warning "ISP V3 RESULT NOT ACCEPTED";:return};
:if ($ok) do={:log info ("ISP V3 COMMAND DONE: ".[:tostr ($c->"type")])} else={:log warning ("ISP V3 COMMAND FAILED: ".$err)};
`;
const rollback=`:foreach s in=[/system scheduler find where name="isp-command-runner-v3"] do={/system scheduler disable $s};
:foreach name in={"isp-command-worker-v1";"isp-command-worker-v2"} do={
 :local backup [/system script find where name=($name."-pre-v3")];
 :local original [/system script find where name=$name];
 :if (([:len $backup]=1)&&([:len $original]=1)) do={/system script set $original source=[/system script get $backup source]};
};
:put "V3 stopped; previous command workers restored. Monitoring unchanged.";
`;
const installer=`# ISP Control unified installer v3 - PRIVATE: contains device credentials.
# Import this SAME file on RB1100 FIRST, then RB951. No PPP/subscriber mutations during preflight.
# Source is compatible with ROS6; ROS7-only worker code is stored as a quoted string.
{
 :local model [/system routerboard get model];
 :local marker "ISP-CONTROL-CHANNEL-V3";
 :if ($model~"RB1100") do={
  :local uid [/user find where name="isp-channel-v3"];
  :if ([:len $uid]>0) do={
   :if ([/user get $uid comment]!=$marker) do={:error "STOP: account name conflict"};
   /user set $uid password=${quote(secrets.password)} address=172.10.13.255/32 disabled=no;
  } else={/user add name="isp-channel-v3" group=full address=172.10.13.255/32 password=${quote(secrets.password)} comment=$marker};
  :put "CORE_READY: import this same file on RB951 next.";
 } else={
  :if (!($model~"RB951")) do={:error "STOP: unsupported router; no changes made"};
  :if ([:pick [/system resource get version] 0 1]!="7") do={:error "STOP: RB951 needs RouterOS 7; no upgrade performed"};
  :local token ${quote(secrets.token)};
  :local pass ${quote(secrets.password)};
  :local ep ${quote(endpoint)};
  :local headers ("Content-Type:application/json,Authorization:Bearer ".$token);
  :local cloud [/tool fetch url=$ep http-method=post http-header-field=$headers http-data="{\\"action\\":\\"test\\"}" check-certificate=yes output=user as-value];
  :local paired [:deserialize from=json value=($cloud->"data")];
  :if (($paired->"paired")!=true) do={:error "STOP: cloud pairing failed; old workers unchanged"};
  :local ssh [/system ssh-exec address=10.10.5.1 user=isp-channel-v3 password=$pass command="/system identity print" as-value];
  :if (($ssh->"exit-code")!=0) do={:error "STOP: CORE SSH test failed; old workers unchanged"};
  :put ($ssh->"output");
  :foreach name in={"isp-command-worker-v1";"isp-command-worker-v2"} do={
   :if ([/system script job print count-only where script=$name]>0) do={:error "STOP: old command running; retry import when idle"};
  };
  :foreach name in={"isp-command-worker-v3";"isp-v3-rollback"} do={
   :local sid [/system script find where name=$name];
   :if ([:len $sid]>0) do={:if ([/system script get $sid comment]!=$marker) do={:error "STOP: script name conflict"}};
  };
  :local sched [/system scheduler find where name="isp-command-runner-v3"];
  :if ([:len $sched]>0) do={:if ([/system scheduler get $sched comment]!=$marker) do={:error "STOP: scheduler name conflict"}};
  :local rollback ${quote(rollback)};
  :local rid [/system script find where name="isp-v3-rollback"];
  :if ([:len $rid]=0) do={/system script add name="isp-v3-rollback" source=$rollback policy=read,write,policy,test,password,sensitive comment=$marker};
  :do {
   :if ([:len $sched]>0) do={/system scheduler disable $sched};
   :local src ${quote(worker)};
   :local wid [/system script find where name="isp-command-worker-v3"];
   :if ([:len $wid]=0) do={/system script add name="isp-command-worker-v3" source=$src policy=read,write,policy,test,password,sensitive comment=$marker} else={/system script set $wid source=$src};
   :foreach name in={"isp-command-worker-v1";"isp-command-worker-v2"} do={
    :local old [/system script find where name=$name];
    :if ([:len $old]=1) do={
     :local backupName ($name."-pre-v3");
     :if ([:len [/system script find where name=$backupName]]=0) do={/system script add name=$backupName source=[/system script get $old source] policy=[/system script get $old policy] comment=$marker};
     /system script set $old source=":return;";
    };
   };
   :if ([:len $sched]=0) do={/system scheduler add name="isp-command-runner-v3" interval=5s start-time=startup on-event="/system script run isp-command-worker-v3" policy=read,write,policy,test,password,sensitive disabled=yes comment=$marker;:set sched [/system scheduler find where name="isp-command-runner-v3"]};
   /system scheduler enable $sched;
  } on-error={/system script run isp-v3-rollback;:error "INSTALL FAILED: previous workers restored"};
  :put "CONNECTOR_INSTALLED: scheduled channel ready; verify real command results in owner console.";
 };
}
`;
fs.writeFileSync(out+'/ISP-Control-Install.rsc',installer.replace(/\n/g,'\r\n'));
fs.writeFileSync('work/channel-v3/worker.rsc',worker);
console.log(JSON.stringify({tokenHash:crypto.createHash('sha256').update(secrets.token).digest('hex'),installerBytes:Buffer.byteLength(installer)}));

