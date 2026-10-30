alter table public.routers add column if not exists command_channel_subscriber_enabled boolean not null default false;
