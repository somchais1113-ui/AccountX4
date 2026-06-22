-- FinAnalytics v1.7 Alert Engine + LINE-ready Integration
-- Adds actor-aware alert events, alert settings, and safe policies.
-- Safe to run more than once after v1.6 data governance tables.


-- 0) Compatibility patch for databases that created private tables from the emergency safe patch.
alter table if exists public.monthly_operating_data
  add column if not exists expense numeric default 0,
  add column if not exists source_file text,
  add column if not exists import_status text default 'confirmed';

alter table if exists public.trial_balance_data
  add column if not exists source_file text,
  add column if not exists import_status text default 'confirmed';

alter table if exists public.normalized_financial_data
  add column if not exists import_status text default 'confirmed';

alter table if exists public.import_batches
  add column if not exists source_type text,
  add column if not exists parser_profile text,
  add column if not exists legal_entity_type text,
  add column if not exists file_hash text,
  add column if not exists file_size bigint,
  add column if not exists storage_path text,
  add column if not exists total_rows integer,
  add column if not exists review_count integer,
  add column if not exists validation_summary jsonb default '{}'::jsonb;

-- 1) Alert event queue. LINE sending can consume pending events from this table.
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null default 'info',
  status text not null default 'pending',

  company_id bigint references public.companies(id) on delete set null,
  import_batch_id uuid references public.import_batches(id) on delete set null,

  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_name text,

  title text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,

  delivery_channel text not null default 'line',
  recipient_type text,
  recipient_id text,

  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.alert_events
  drop constraint if exists alert_events_severity_check;
alter table public.alert_events
  add constraint alert_events_severity_check
  check (severity in ('info', 'success', 'warning', 'critical', 'security', 'summary'));

alter table public.alert_events
  drop constraint if exists alert_events_status_check;
alter table public.alert_events
  add constraint alert_events_status_check
  check (status in ('pending', 'sent', 'read', 'dismissed', 'failed'));

create index if not exists alert_events_company_created_idx
  on public.alert_events(company_id, created_at desc);
create index if not exists alert_events_status_created_idx
  on public.alert_events(status, created_at desc);
create index if not exists alert_events_import_batch_idx
  on public.alert_events(import_batch_id);
create index if not exists alert_events_actor_idx
  on public.alert_events(actor_user_id, created_at desc);

-- 2) LINE alert settings per company. Do not store Channel Access Token here.
-- Keep LINE Channel Access Token in Vercel/Supabase Edge Function env only.
create table if not exists public.line_alert_settings (
  id uuid primary key default gen_random_uuid(),
  company_id bigint references public.companies(id) on delete cascade,
  is_enabled boolean not null default false,
  recipient_type text not null default 'group',
  recipient_id text,
  notify_import_success boolean not null default true,
  notify_import_failed boolean not null default true,
  notify_mapping_review boolean not null default true,
  notify_data_quality_warning boolean not null default true,
  notify_rollback boolean not null default true,
  notify_mapping_change boolean not null default true,
  notify_permission_change boolean not null default true,
  notify_daily_summary boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id)
);

alter table public.line_alert_settings
  drop constraint if exists line_alert_settings_recipient_type_check;
alter table public.line_alert_settings
  add constraint line_alert_settings_recipient_type_check
  check (recipient_type in ('user', 'group', 'room'));

-- 3) RLS
alter table public.alert_events enable row level security;
alter table public.line_alert_settings enable row level security;

drop policy if exists alert_events_read on public.alert_events;
drop policy if exists alert_events_insert on public.alert_events;
drop policy if exists alert_events_update on public.alert_events;
drop policy if exists alert_events_delete on public.alert_events;

create policy alert_events_read
on public.alert_events
for select
to authenticated
using (
  company_id is null
  or exists (
    select 1 from public.company_members cm
    where cm.company_id = alert_events.company_id
      and cm.user_id = auth.uid()
  )
);

create policy alert_events_insert
on public.alert_events
for insert
to authenticated
with check (
  company_id is null
  or exists (
    select 1 from public.company_members cm
    where cm.company_id = alert_events.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin', 'editor')
  )
);

create policy alert_events_update
on public.alert_events
for update
to authenticated
using (
  company_id is null
  or exists (
    select 1 from public.company_members cm
    where cm.company_id = alert_events.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin', 'editor')
  )
)
with check (
  company_id is null
  or exists (
    select 1 from public.company_members cm
    where cm.company_id = alert_events.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin', 'editor')
  )
);

create policy alert_events_delete
on public.alert_events
for delete
to authenticated
using (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = alert_events.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin')
  )
);

drop policy if exists line_alert_settings_read on public.line_alert_settings;
drop policy if exists line_alert_settings_insert on public.line_alert_settings;
drop policy if exists line_alert_settings_update on public.line_alert_settings;
drop policy if exists line_alert_settings_delete on public.line_alert_settings;

create policy line_alert_settings_read
on public.line_alert_settings
for select
to authenticated
using (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = line_alert_settings.company_id
      and cm.user_id = auth.uid()
  )
);

create policy line_alert_settings_insert
on public.line_alert_settings
for insert
to authenticated
with check (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = line_alert_settings.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin')
  )
);

create policy line_alert_settings_update
on public.line_alert_settings
for update
to authenticated
using (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = line_alert_settings.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = line_alert_settings.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin')
  )
);

create policy line_alert_settings_delete
on public.line_alert_settings
for delete
to authenticated
using (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = line_alert_settings.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin')
  )
);

-- 4) Grants
grant select, insert, update, delete on public.alert_events to authenticated;
grant select, insert, update, delete on public.line_alert_settings to authenticated;

notify pgrst, 'reload schema';
