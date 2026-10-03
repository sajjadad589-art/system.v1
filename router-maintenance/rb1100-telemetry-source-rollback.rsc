# Only for reverting rb1100-telemetry-source-fix.rsc on RB1100.
{
  :local u [/user find where name="isp-telemetry"];
  :if ([:len $u] != 1) do={ :error "STOP: expected one isp-telemetry account"; };
  :if ([:tostr [/user get $u address]] != "172.10.13.255/32") do={
    :error "STOP: allowed address changed since fix";
  };
  /user set $u address=172.10.13.254/32;
  :put "Telemetry source restriction restored; credentials unchanged";
}
