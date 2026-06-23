-- FinAnalytics / AccountX4 v1.9.4
-- Dashboard / Export Single Source of Truth
-- Safe/idempotent: keeps metric snapshots batch-exact, version-aware, and usable
-- as the single source for Dashboard and Excel Export. Does not delete user data.

begin;

-- Snapshot versioning / current-row flags. This allows rebuilds to create a new
-- current snapshot while keeping older snapshots as audit history.
alter table public.financial_metrics_snapshots
  add column if not exists snapshot_run_id uuid,
  add column if not exists snapshot_status text default 'current',
  add column if not exists is_current boolean default true,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by uuid,
  add column if not exists source_metric_role text,
  add column if not exists source_line_role text,
  add column if not exists source_batch_status text,
  add column if not exists snapshot_metadata jsonb default '{}'::jsonb;

-- Existing rows become the current snapshot for their batch until the next rebuild.
update public.financial_metrics_snapshots
set snapshot_status = coalesce(snapshot_status, 'current'),
    is_current = coalesce(is_current, true),
    snapshot_metadata = coalesce(snapshot_metadata, '{}'::jsonb)
where snapshot_status is null or is_current is null or snapshot_metadata is null;

-- Older migrations created a table-level unique constraint. v1.9.4 replaces it
-- with a partial unique index so superseded snapshots can remain as history.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.financial_metrics_snapshots'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%company_id%'
      and pg_get_constraintdef(oid) ilike '%import_batch_id%'
      and pg_get_constraintdef(oid) ilike '%metric_key%'
  loop
    execute format('alter table public.financial_metrics_snapshots drop constraint if exists %I', constraint_record.conname);
  end loop;
end $$;

-- Ensure no duplicate current rows remain before creating the partial unique index.
with ranked as (
  select id,
         row_number() over (
           partition by company_id, import_batch_id, fiscal_year, period, period_type, statement_scope, metric_key
           order by created_at desc, id desc
         ) as rn
  from public.financial_metrics_snapshots
  where coalesce(is_current, true) = true
)
update public.financial_metrics_snapshots fms
set is_current = false,
    snapshot_status = 'superseded',
    superseded_at = coalesce(fms.superseded_at, now())
from ranked
where fms.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists idx_financial_metric_current_unique
  on public.financial_metrics_snapshots(company_id, import_batch_id, fiscal_year, period, period_type, statement_scope, metric_key)
  where is_current = true;

create index if not exists idx_financial_metric_current_lookup
  on public.financial_metrics_snapshots(company_id, fiscal_year, period, period_type, statement_scope, is_current, snapshot_status, created_at desc);

create index if not exists idx_financial_metric_lineage_lookup
  on public.financial_metrics_snapshots(import_batch_id, snapshot_run_id, metric_key, is_current);

comment on table public.financial_metrics_snapshots is
  'v1.9.4 source of truth for Dashboard and Excel Export metrics. Raw financial rows are for drill-down/audit.';
comment on column public.financial_metrics_snapshots.is_current is
  'Only current snapshot rows should feed Dashboard/Export. Older rows remain for audit history.';
comment on column public.financial_metrics_snapshots.snapshot_run_id is
  'Groups all metric rows produced by one Accounting Engine rebuild run.';
comment on column public.financial_metrics_snapshots.source_rows is
  'Lineage references to normalized rows or parser cells used to build this metric.';

commit;
