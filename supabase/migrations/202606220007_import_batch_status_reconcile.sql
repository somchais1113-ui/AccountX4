-- v1.7.4 Import batch status reconciliation
-- Safe to run after v1.7.3, even if 202606220006 was already run.
-- It aligns import_batches.status with the row-level import_status in data tables.

with all_batch_rows as (
  select import_batch_id, coalesce(import_status, 'confirmed') as import_status
  from normalized_financial_data
  where import_batch_id is not null
  union all
  select import_batch_id, coalesce(import_status, 'confirmed') as import_status
  from monthly_operating_data
  where import_batch_id is not null
  union all
  select import_batch_id, coalesce(import_status, 'confirmed') as import_status
  from trial_balance_data
  where import_batch_id is not null
), batch_status as (
  select
    import_batch_id,
    bool_or(import_status = 'confirmed') as has_confirmed,
    bool_or(import_status = 'superseded') as has_superseded,
    bool_or(import_status = 'rolled_back') as has_rolled_back,
    bool_or(import_status = 'rejected') as has_rejected
  from all_batch_rows
  group by import_batch_id
), desired as (
  select
    import_batch_id,
    case
      when has_confirmed then 'confirmed'
      when has_rejected then 'rejected'
      when has_rolled_back then 'rolled_back'
      when has_superseded then 'superseded'
      else 'confirmed'
    end as desired_status
  from batch_status
)
update import_batches b
set status = d.desired_status
from desired d
where b.id = d.import_batch_id
  and b.status is distinct from d.desired_status;

notify pgrst, 'reload schema';
