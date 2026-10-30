begin;
set local lock_timeout='3s';
alter table public.routers add column if not exists command_channel_version integer not null default 1;
CREATE OR REPLACE FUNCTION public.isp_control_job(p_action text, p_actor uuid DEFAULT NULL::uuid, p_router uuid DEFAULT NULL::uuid, p_script text DEFAULT NULL::text, p_hash text DEFAULT NULL::text, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare j private.router_control_jobs%rowtype;
begin
 update private.router_control_jobs set status='EXPIRED',finished_at=now() where status='PENDING' and created_at<now()-interval '60 seconds';
 update private.router_control_jobs set status='UNKNOWN',finished_at=now() where status='EXECUTING' and claimed_at<now()-interval '120 seconds';
 if p_action='enqueue' then
  perform pg_advisory_xact_lock(170019,1);
  if not exists(select 1 from public.profiles where id=p_actor and role::text='OWNER') then raise exception 'owner required'; end if;
  select * into j from private.router_control_jobs where actor_id=p_actor and request_id=p_request;
  if found then return jsonb_build_object('id',j.id,'status',j.status); end if;
  if not exists(select 1 from public.routers where id=p_router and device_role in ('CORE','CONNECTOR') and adapter_mode='ROUTEROS') then raise exception 'unsupported router'; end if;
  if not exists(select 1 from public.routers where device_role='CONNECTOR' and command_channel_last_seen_at>now()-interval '20 seconds') then raise exception 'command channel offline'; end if;
  if exists(select 1 from public.routers where id=p_router and device_role='CONNECTOR') and not exists(select 1 from public.routers where id=p_router and command_channel_version=3 and command_channel_last_seen_at>now()-interval '20 seconds') then raise exception 'connector requires live v3 channel'; end if;
  if exists(select 1 from private.router_control_jobs where router_id=p_router and status in ('PENDING','EXECUTING')) then raise exception 'router has an unfinished command'; end if;
  if (select count(*) from private.router_control_jobs where actor_id=p_actor and created_at>now()-interval '1 minute')>=10 then raise exception 'rate limit'; end if;
  insert into private.router_control_jobs(router_id,actor_id,script,request_id) values(p_router,p_actor,p_script,p_request) returning * into j;
  return jsonb_build_object('id',j.id,'status',j.status);
 elsif p_action='claim' then
  select * into j from private.router_control_jobs where router_id=p_router and status='PENDING' order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update private.router_control_jobs set status='EXECUTING',claimed_at=now() where id=j.id;
  return jsonb_build_object('id',j.id,'script',j.script);
 elsif p_action='list' then
  if not exists(select 1 from public.profiles where id=p_actor and role::text='OWNER') then raise exception 'owner required'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,router_id,script,status,output,created_at,claimed_at,finished_at from private.router_control_jobs where actor_id=p_actor order by created_at desc limit 40) x),'[]'::jsonb);
 elsif p_action='cancel' then
  update private.router_control_jobs set status='CANCELED',finished_at=now() where id=p_request and actor_id=p_actor and status='PENDING';
  return jsonb_build_object('canceled',found);
 elsif p_action='finish_paired' then
  if p_hash not in ('COMPLETED','FAILED','UNKNOWN') then raise exception 'invalid result status'; end if;
  update private.router_control_jobs set status=p_hash,output=left(p_script,8000),finished_at=now() where id=p_request and router_id=p_router and status='EXECUTING';
  return jsonb_build_object('accepted',found);
 elsif p_action='finish' then
  update private.router_control_jobs set status=p_hash,output=left(p_script,8000),finished_at=now() where id=p_request and status='EXECUTING';
  return jsonb_build_object('accepted',found);
 elsif p_action='ack' then
  if not exists(select 1 from private.router_control_jobs where id=p_request and router_id=p_router) then return jsonb_build_object('remote',false); end if;
  if p_hash='failed' then
   update private.router_control_jobs set status='UNKNOWN',output=left(p_script,8000),finished_at=now() where id=p_request and status='EXECUTING';
  end if;
  return jsonb_build_object('remote',true);
 end if;
 raise exception 'unsupported action';
end $function$;
commit;

