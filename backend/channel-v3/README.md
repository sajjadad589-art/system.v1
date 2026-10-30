# Paired command channel v3

The previous worker authenticated to Supabase but failed SSH authentication to CORE. V3 uses a dedicated credential stored only in the private installer, explicit CORE/CONNECTOR targeting, and result handling bound to the selected router. No raw router credential or connector token is committed.

The backend is deployed to varccsjoydhlfazaizqs. Migration 20261030143925 extends the existing service-only private queue; migration 20261030144059 leaves subscriber commands paused by default. The existing OWNER endpoint authenticates the user and server-side role before changing that mode. Old endpoints and telemetry are retained.

Generate a private installer with node backend/channel-v3/build-installer.mjs. This creates local credentials and writes outputs/isp-channel-v3/ISP-Control-Install.rsc; register the generated SHA-256 token hash in the existing connector-token table before using a newly generated installer. The delivered private installer for this incident already has its token registered. Never commit work/channel-v3/secrets.json or the generated .rsc.

Import the SAME installer on RB1100 first, then RB951. It creates a dedicated administrator account restricted to the observed RB951 source 172.10.13.255/32. It tests certificate-validated HTTPS and a read-only SSH identity request before suspending only old command-worker sources. It preserves those sources and monitoring, makes a worker rollback script, and adds a five-second schedule. It does not restore router backups, reboot, change interfaces/firewall/routes, modify PPPoE or subscribers, or drain old subscriber requests automatically.

The standalone owner console is isp-control/remote-v3.html. Its sessions remain in memory, and outputs use textContent. Existing authenticated OWNER API controls enqueue/list/cancel; old Cloudflare/Vercel pages are not modified or verified by this change.

Validation: 3 node protocol tests; 5 live HTTP checks (missing/wrong credentials, valid pairing without claiming work, invalid target, nonexistent job); transactional SQL fixture rejected a result for the wrong target and accepted it for the matching target, then rolled back. Existing security advisory counts did not change. Installer delimiter/string checks and frontend JavaScript syntax/secret-exclusion checks pass. RouterOS syntax has not been verified by a real import or emulator. Router installation and actual command round trips are NOT complete: WinBox RB1100 returns permission denial; RB951 window capture is unavailable. No device success is claimed.
