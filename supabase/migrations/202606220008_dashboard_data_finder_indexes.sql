-- v1.7.5 Dashboard Data Finder / Historical Snapshot support
-- Safe, idempotent performance indexes for searching import history and loading a selected batch.

create index if not exists idx_import_batches_company_year_status_imported
  on public.import_batches (company_id, fiscal_year, status, imported_at desc);

create index if not exists idx_import_batches_company_year_imported
  on public.import_batches (company_id, fiscal_year, imported_at desc);

create index if not exists idx_normalized_financial_data_batch
  on public.normalized_financial_data (import_batch_id);

create index if not exists idx_monthly_operating_data_batch
  on public.monthly_operating_data (import_batch_id);

create index if not exists idx_trial_balance_data_batch
  on public.trial_balance_data (import_batch_id);
