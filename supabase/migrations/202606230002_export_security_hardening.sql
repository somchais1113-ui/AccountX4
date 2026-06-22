-- v1.7.9 export/security hardening
-- Safe idempotent migration. It does not delete financial data.

-- Keep alert tables protected even if previous migrations were partially applied.
alter table if exists public.alert_events enable row level security;
alter table if exists public.line_alert_settings enable row level security;

-- Re-scope policies to company membership. These are intentionally idempotent.
drop policy if exists alert_events_read on public.alert_events;
drop policy if exists alert_events_insert on public.alert_events;
drop policy if exists alert_events_update on public.alert_events;
drop policy if exists alert_events_delete on public.alert_events;

create policy alert_events_read
on public.alert_events
for select
to authenticated
using (
  exists (
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
  exists (
    select 1 from public.company_members cm
    where cm.company_id = alert_events.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner','admin','editor')
  )
);

create policy alert_events_update
on public.alert_events
for update
to authenticated
using (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = alert_events.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner','admin','editor')
  )
)
with check (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = alert_events.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner','admin','editor')
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
      and cm.role in ('owner','admin')
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
      and cm.role in ('owner','admin')
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
      and cm.role in ('owner','admin')
  )
)
with check (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = line_alert_settings.company_id
      and cm.user_id = auth.uid()
      and cm.role in ('owner','admin')
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
      and cm.role in ('owner','admin')
  )
);
