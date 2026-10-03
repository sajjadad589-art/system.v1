# Run locally on RB1100 as admin. Changes only isp-telemetry's allowed source.
# Based on RB1100 SSH log: isp-telemetry arrives from 172.10.13.255.
{
  :local u [/user find where name="isp-telemetry"];
  :if ([:len $u] != 1) do={ :error "STOP: expected one isp-telemetry account"; };
  :local previous [/user get $u address];
  :if ([:tostr $previous] = "172.10.13.255/32") do={
    :put "Already set to observed RB951 source; no change";
  } else={
    :if ([:tostr $previous] != "172.10.13.254/32") do={
      :error "STOP: allowed address differs from reviewed installer; inspect locally";
    };
    /user set $u address=172.10.13.255/32;
    :put "Telemetry source restriction changed .254/32 -> .255/32; credentials unchanged";
  };
}
