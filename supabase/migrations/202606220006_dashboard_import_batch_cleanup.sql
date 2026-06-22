-- v1.7.3 Dashboard / Import History cleanup
-- Safe, non-destructive: does not delete data. It marks older duplicate active batches as superseded.
-- Latest confirmed batch is kept per company + fiscal_year + period + statement_scope.

with normalized_batches as (
  select
    n.company_id,
    n.fiscal_year,
    coalesce(n.period, 'FY') as period,
    coalesce(n.statement_scope, 'consolidated') as statement_scope,
    n.import_batch_id,
    max(coalesce(b.imported_at, n.updated_at, now())) as imported_at
  from normalized_financial_data n
  join import_batches b on b.id = n.import_batch_id
  where n.import_batch_id is not null
    and coalesce(n.import_status, 'confirmed') = 'confirmed'
    and coalesce(b.status, 'confirmed') = 'confirmed'
  group by n.company_id, n.fiscal_year, coalesce(n.period, 'FY'), coalesce(n.statement_scope, 'consolidated'), n.import_batch_id
), ranked as (
  select
    *,
    row_number() over (
      partition by company_id, fiscal_year, period, statement_scope
      order by imported_at desc, import_batch_id desc
    ) as rn
  from normalized_batches
)
update import_batches b
set status = 'superseded'
from ranked r
where b.id = r.import_batch_id
  and r.rn > 1
  and coalesce(b.status, 'confirmed') = 'confirmed';

with normalized_batches as (
  select
    n.company_id,
    n.fiscal_year,
    coalesce(n.period, 'FY') as period,
    coalesce(n.statement_scope, 'consolidated') as statement_scope,
    n.import_batch_id,
    max(coalesce(b.imported_at, n.updated_at, now())) as imported_at
  from normalized_financial_data n
  join import_batches b on b.id = n.import_batch_id
  where n.import_batch_id is not null
    and coalesce(n.import_status, 'confirmed') = 'confirmed'
  group by n.company_id, n.fiscal_year, coalesce(n.period, 'FY'), coalesce(n.statement_scope, 'consolidated'), n.import_batch_id
), ranked as (
  select
    *,
    row_number() over (
      partition by company_id, fiscal_year, period, statement_scope
      order by imported_at desc, import_batch_id desc
    ) as rn
  from normalized_batches
)
update normalized_financial_data n
set import_status = 'superseded'
from ranked r
where n.import_batch_id = r.import_batch_id
  and r.rn > 1
  and coalesce(n.import_status, 'confirmed') = 'confirmed';

notify pgrst, 'reload schema';
