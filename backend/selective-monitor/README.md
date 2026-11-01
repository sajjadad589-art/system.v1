# Selective subscriber monitoring

OWNER controls are in the usage insights screen. Defaults are disabled. Each enable/disable creates a generation; late samples from previous generations are rejected atomically. The collector resolves the current PPPoE IP and session-id each time, then checks both again after sampling. It never uses the previously observed 172.10.11.253 as a fixed target.

Limits: five enabled subscribers, at least 30 seconds between collection rounds, 100 outbound connection rows and ten DNS hints per destination, 20-second SSH timeout, 100 KB output, 500 snapshots/subscriber and seven-day cleanup on ingest. Empty offline snapshots are persisted. Ambiguous concurrent PPPoE sessions, interrupted output, connection-counter errors and reconnects fail the sample. Byte values are original/reply connection counters, not interval deltas or billing totals. Short connections, inbound-initiated connections and flows bypassing connection tracking are not represented.

DNS cache is router-wide and may be stale, shared, absent or bypassed through encrypted DNS. Labels are UNKNOWN, DNS_CANDIDATE or AMBIGUOUS; an app family is a hint only. No HTTPS paths, queries, payloads or full URLs are collected.

## Deployment

Apply schema.sql once using the migration API, then deploy index.ts and model.mjs as `isp-selective-monitor`. The endpoint performs its own OWNER JWT or existing active connector-token authentication. Never put service-role keys or router passwords in frontend code. The additive backend is deployed; UI and collector availability must be verified separately.

Run the Node 24 collector on an existing trusted host that can SSH to RB1100 with its current read permissions. Set ISP_MONITOR_URL to the deployed function HTTPS URL, ISP_CONNECTOR_TOKEN to the existing connector credential, and ISP_ROUTER_SSH to a configured SSH host alias or user@host. SSH uses batch mode, preverified host keys and the existing ssh-agent/config. Optional `--once` runs one round. Do not enable router API services, change firewall, create router users, install schedules or weaken SSH host verification to run this collector.

`node backend/selective-monitor/collector.mjs --once`

`node --test backend/selective-monitor/model.test.mjs`

database-test.sql tests persistence/idempotency/disable races and grants in a transaction that rolls back. The synthetic fixture is not subscriber telemetry. RouterOS 6.38.7 script execution and live IP/session changes still require a reachable router and must not be reported as verified based on parser tests.
