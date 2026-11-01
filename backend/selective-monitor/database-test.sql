begin;
do $$
declare sid uuid; gen uuid:=gen_random_uuid(); sample jsonb; accepted boolean;
begin
 select id into sid from public.subscribers where pppoe_username='muh@sajj1' and archived_at is null limit 1;
 if sid is null then raise exception 'target subscriber missing'; end if;
 insert into public.isp_monitor_controls(subscriber_id,enabled,generation) values(sid,true,gen)
 on conflict(subscriber_id) do update set enabled=true,generation=excluded.generation;
 sample:=jsonb_build_object('id',gen_random_uuid(),'subscriber_id',sid,'generation',gen,'sampled_at',now(),'current_ip',null,'session_key',null,'online',false,'truncated',false,'connections','[]'::jsonb);
 accepted:=public.isp_monitor_ingest(sample);if accepted is distinct from true then raise exception 'ingest failed'; end if;
 if public.isp_monitor_ingest(sample) is distinct from true then raise exception 'idempotency failed'; end if;
 update public.isp_monitor_controls set enabled=false,generation=gen_random_uuid() where subscriber_id=sid;
 if public.isp_monitor_ingest(sample) is distinct from false then raise exception 'disable race failed'; end if;
 if has_table_privilege('anon','public.isp_monitor_samples','SELECT') or has_table_privilege('authenticated','public.isp_monitor_samples','INSERT') or has_function_privilege('authenticated','public.isp_monitor_ingest(jsonb)','EXECUTE') then raise exception 'privilege isolation failed'; end if;
end $$;
rollback;
