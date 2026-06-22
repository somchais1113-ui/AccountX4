-- FinAnalytics v1.7.2 AI-assisted Accounting Mapping Review
-- Safe to run more than once. Adds suggestion provenance and human approval tracking.

-- 1) Keep suggested mapping metadata on normalized rows.
alter table if exists public.normalized_financial_data
  add column if not exists mapping_source text default 'parser_rule',
  add column if not exists suggested_account_group text,
  add column if not exists suggested_account_subgroup text,
  add column if not exists review_reason text;

alter table if exists public.normalized_financial_data
  drop constraint if exists normalized_financial_data_mapping_source_check;
alter table if exists public.normalized_financial_data
  add constraint normalized_financial_data_mapping_source_check
  check (mapping_source in ('approved_mapping', 'accounting_dictionary', 'ai_similarity', 'parser_rule', 'unknown'));

-- 2) Track which account_mappings were explicitly approved by a human.
alter table if exists public.account_mappings
  add column if not exists is_approved boolean not null default false,
  add column if not exists mapping_source text not null default 'approved_mapping',
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists usage_count integer not null default 0,
  add column if not exists last_used_at timestamptz;

alter table if exists public.account_mappings
  drop constraint if exists account_mappings_mapping_source_check;
alter table if exists public.account_mappings
  add constraint account_mappings_mapping_source_check
  check (mapping_source in ('approved_mapping', 'human_approved', 'parser_rule'));

create index if not exists normalized_data_mapping_review_idx
  on public.normalized_financial_data(company_id, needs_review, mapping_source, import_status);

create index if not exists account_mappings_approved_lookup_idx
  on public.account_mappings(company_id, statement_type, raw_account_name)
  where is_approved = true;

-- Existing legacy mappings are intentionally left as is_approved = false.
-- New approvals from Account Mapping Center will set is_approved = true.

notify pgrst, 'reload schema';
