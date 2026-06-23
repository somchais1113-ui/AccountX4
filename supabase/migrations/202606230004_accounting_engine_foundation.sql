-- FinAnalytics / AccountX4 v1.9.0
-- Accounting Engine Foundation
-- Safe/idempotent: adds semantic accounting metadata, scoped mapping decisions,
-- validation storage, and financial metric snapshot storage. Does not delete data.

begin;

-- 1) Add semantic metadata to normalized rows.
alter table public.normalized_financial_data
  add column if not exists line_role text default 'detail',
  add column if not exists metric_role text default 'supporting_line',
  add column if not exists section_path text,
  add column if not exists parent_heading text,
  add column if not exists risk_flags text[] default '{}'::text[],
  add column if not exists mapping_status text default 'suggested',
  add column if not exists approval_scope text,
  add column if not exists approved_mapping_id uuid,
  add column if not exists is_dashboard_eligible boolean default false,
  add column if not exists is_export_eligible boolean default true;

create index if not exists idx_nfd_semantic_lookup
  on public.normalized_financial_data(company_id, fiscal_year, period, period_type, statement_scope, statement_type, line_role, account_group);
create index if not exists idx_nfd_risk_flags_gin
  on public.normalized_financial_data using gin(risk_flags);
create index if not exists idx_nfd_mapping_status
  on public.normalized_financial_data(company_id, mapping_status, needs_review);

-- 2) Make approved mapping memory more scoped and explainable.
alter table public.account_mappings
  add column if not exists normalized_account_name text,
  add column if not exists statement_scope text default 'any',
  add column if not exists accounting_standard_profile text,
  add column if not exists line_role text,
  add column if not exists risk_flags text[] default '{}'::text[],
  add column if not exists approval_scope text,
  add column if not exists usage_count integer default 0;

update public.account_mappings
set normalized_account_name = lower(trim(raw_account_name))
where normalized_account_name is null and raw_account_name is not null;

create index if not exists idx_account_mappings_scoped_memory
  on public.account_mappings(company_id, normalized_account_name, statement_type, statement_scope, accounting_standard_profile, line_role);
create index if not exists idx_account_mappings_risk_flags_gin
  on public.account_mappings using gin(risk_flags);

-- 3) Store explicit mapping decisions. This is the audit-friendly source of truth
-- for human approvals and bulk-safe confirmations.
create table if not exists public.mapping_decisions (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  normalized_financial_data_id bigint references public.normalized_financial_data(id) on delete set null,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  raw_account_name text not null,
  normalized_account_name text,
  statement_type text,
  statement_scope text default 'any',
  accounting_standard_profile text,
  line_role text,
  metric_role text,
  account_group text not null,
  account_subgroup text,
  standard_ref text,
  standard_source text,
  risk_flags text[] default '{}'::text[],
  confidence numeric,
  decision_status text not null default 'approved',
  decision_method text not null default 'single_row',
  decision_reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.mapping_decisions enable row level security;
do $$ begin
  create policy mapping_decisions_read on public.mapping_decisions
    for select to authenticated using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mapping_decisions_insert on public.mapping_decisions
    for insert to authenticated with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mapping_decisions_update on public.mapping_decisions
    for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

create index if not exists idx_mapping_decisions_company_lookup
  on public.mapping_decisions(company_id, normalized_account_name, statement_type, statement_scope, accounting_standard_profile, approved_at desc);
create index if not exists idx_mapping_decisions_batch
  on public.mapping_decisions(import_batch_id);

-- 4) Store validation results so Dashboard/Data Quality/Export use the same gates.
create table if not exists public.validation_results (
  id bigserial primary key,
  company_id bigint references public.companies(id) on delete cascade,
  import_batch_id uuid references public.import_batches(id) on delete cascade,
  fiscal_year integer,
  period text default 'FY',
  period_type text default 'annual',
  statement_scope text default 'unknown',
  validation_type text not null,
  severity text not null default 'info',
  difference numeric,
  message text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.validation_results enable row level security;
do $$ begin
  create policy validation_results_read on public.validation_results
    for select to authenticated using (company_id is null or public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy validation_results_insert on public.validation_results
    for insert to authenticated with check (company_id is null or public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy validation_results_update on public.validation_results
    for update to authenticated using (company_id is null or public.is_company_member(company_id)) with check (company_id is null or public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

create index if not exists idx_validation_results_company_batch
  on public.validation_results(company_id, import_batch_id, fiscal_year, period, statement_scope, severity);

-- 5) Store batch-exact financial metrics snapshots generated by the accounting engine.
create table if not exists public.financial_metrics_snapshots (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  import_batch_id uuid references public.import_batches(id) on delete cascade,
  fiscal_year integer not null,
  period text default 'FY',
  period_type text default 'annual',
  statement_scope text default 'unknown',
  metric_key text not null,
  metric_value numeric,
  source_type text,
  source_rows jsonb default '[]'::jsonb,
  validation_status text default 'unvalidated',
  created_at timestamptz default now(),
  unique(company_id, import_batch_id, fiscal_year, period, period_type, statement_scope, metric_key)
);

alter table public.financial_metrics_snapshots enable row level security;
do $$ begin
  create policy financial_metrics_snapshots_read on public.financial_metrics_snapshots
    for select to authenticated using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy financial_metrics_snapshots_insert on public.financial_metrics_snapshots
    for insert to authenticated with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy financial_metrics_snapshots_update on public.financial_metrics_snapshots
    for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

create index if not exists idx_financial_metrics_snapshots_lookup
  on public.financial_metrics_snapshots(company_id, fiscal_year, period, period_type, statement_scope, metric_key);

commit;
