-- FinAnalytics v1.7.6
-- Reconcile private-company historical snapshots.
-- Purpose:
-- 1) Keep only the latest confirmed monthly row per company/year/month.
-- 2) Keep only the latest confirmed trial-balance batch per company/year.
-- 3) Sync import_batches.status from all data tables, not only normalized_financial_data.
-- This migration does not delete rows; it only marks stale rows/batches as superseded.

with ranked_monthly as (
  select
    m.id,
    row_number() over (
      partition by m.company_id, m.fiscal_year, m.month
      order by coalesce(b.imported_at, m.updated_at, m.created_at) desc, m.id desc
    ) as rn
  from public.monthly_operating_data m
  left join public.import_batches b on b.id = m.import_batch_id
  where coalesce(m.import_status, 'confirmed') = 'confirmed'
)
update public.monthly_operating_data m
set import_status = 'superseded', updated_at = now()
from ranked_monthly r
where m.id = r.id
  and r.rn > 1
  and coalesce(m.import_status, 'confirmed') = 'confirmed';

with ranked_trial as (
  select
    t.import_batch_id,
    t.company_id,
    t.fiscal_year,
    row_number() over (
      partition by t.company_id, t.fiscal_year
      order by max(coalesce(b.imported_at, t.updated_at, t.created_at)) desc, t.import_batch_id desc
    ) as rn
  from public.trial_balance_data t
  left join public.import_batches b on b.id = t.import_batch_id
  where t.import_batch_id is not null
    and coalesce(t.import_status, 'confirmed') = 'confirmed'
  group by t.import_batch_id, t.company_id, t.fiscal_year
)
update public.trial_balance_data t
set import_status = 'superseded', updated_at = now()
from ranked_trial r
where t.import_batch_id = r.import_batch_id
  and r.rn > 1
  and coalesce(t.import_status, 'confirmed') = 'confirmed';

with all_rows as (
  select import_batch_id, import_status from public.normalized_financial_data where import_batch_id is not null
  union all
  select import_batch_id, import_status from public.monthly_operating_data where import_batch_id is not null
  union all
  select import_batch_id, import_status from public.trial_balance_data where import_batch_id is not null
), desired as (
  select
    import_batch_id,
    case
      when bool_or(coalesce(import_status, 'confirmed') = 'confirmed') then 'confirmed'
      when bool_or(import_status = 'rolled_back') then 'rolled_back'
      when bool_or(import_status = 'superseded') then 'superseded'
      when bool_or(import_status = 'rejected') then 'rejected'
      else 'superseded'
    end as desired_status
  from all_rows
  group by import_batch_id
)
update public.import_batches b
set status = d.desired_status
from desired d
where b.id = d.import_batch_id
  and b.status is distinct from d.desired_status;

notify pgrst, 'reload schema';
