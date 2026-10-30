-- Mirrors migration 20261030141130 already applied to varccsjoydhlfazaizqs.
-- A stale CORE probe is UNKNOWN; rejecting that value also discarded valid telemetry.
begin;
set local lock_timeout = '3s';
alter table public.routers drop constraint routers_internet_status_check;
alter table public.routers add constraint routers_internet_status_check check (internet_status in ('ONLINE','OFFLINE','UNKNOWN'));
commit;
