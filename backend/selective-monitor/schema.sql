-- Selective monitoring; no router configuration changes.
create table public.isp_monitor_controls (
 subscriber_id uuid primary key references public.subscribers(id),
 enabled boolean not null default false,
 generation uuid not null default gen_random_uuid(),
 updated_at timestamptz not null default now()
);
create table public.isp_monitor_samples (
 id uuid primary key,
 subscriber_id uuid not null references public.subscribers(id),
 generation uuid not null,
 sampled_at timestamptz not null,
 received_at timestamptz not null default now(),
 current_ip inet,
 session_key text,
 online boolean not null,
 truncated boolean not null,
 connections jsonb not null check(jsonb_typeof(connections)='array' and jsonb_array_length(connections)<=100)
);
create index isp_monitor_samples_recent on public.isp_monitor_samples(subscriber_id, sampled_at desc);
alter table public.isp_monitor_controls enable row level security;
alter table public.isp_monitor_samples enable row level security;
revoke all on public.isp_monitor_controls,public.isp_monitor_samples from anon,authenticated;
grant select on public.isp_monitor_controls,public.isp_monitor_samples to authenticated;
grant all on public.isp_monitor_controls,public.isp_monitor_samples to service_role;
create policy owner_read on public.isp_monitor_controls for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role::text='OWNER'));
create policy owner_read on public.isp_monitor_samples for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role::text='OWNER'));
create function public.isp_monitor_limit() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 perform pg_advisory_xact_lock(170020,1);
 if new.enabled and (select count(*) from public.isp_monitor_controls where enabled and subscriber_id<>new.subscriber_id)>=5 then raise exception 'maximum five monitored subscribers'; end if;
 return new;
end $$;
revoke all on function public.isp_monitor_limit() from public,anon,authenticated;
create trigger monitor_limit before insert or update on public.isp_monitor_controls for each row execute function public.isp_monitor_limit();
create function public.isp_monitor_ingest(p_sample jsonb) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare c public.isp_monitor_controls%rowtype;
begin
 select * into c from public.isp_monitor_controls where subscriber_id=(p_sample->>'subscriber_id')::uuid for update;
 if not found or not c.enabled or c.generation<>(p_sample->>'generation')::uuid then return false; end if;
 if exists(select 1 from public.isp_monitor_samples where id=(p_sample->>'id')::uuid) then return true; end if;
 if exists(select 1 from public.isp_monitor_samples where subscriber_id=c.subscriber_id and received_at>now()-interval '25 seconds') then raise exception 'sampling rate limit'; end if;
 insert into public.isp_monitor_samples(id,subscriber_id,generation,sampled_at,current_ip,session_key,online,truncated,connections)
 values((p_sample->>'id')::uuid,c.subscriber_id,c.generation,(p_sample->>'sampled_at')::timestamptz,nullif(p_sample->>'current_ip','')::inet,p_sample->>'session_key',(p_sample->>'online')::boolean,(p_sample->>'truncated')::boolean,p_sample->'connections');
 -- Bounded retention, including inactive subscribers.
 delete from public.isp_monitor_samples where received_at<now()-interval '7 days';
 delete from public.isp_monitor_samples where id in(select id from public.isp_monitor_samples where subscriber_id=c.subscriber_id order by sampled_at desc offset 500);
 return true;
end $$;
revoke all on function public.isp_monitor_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.isp_monitor_ingest(jsonb) to service_role;
