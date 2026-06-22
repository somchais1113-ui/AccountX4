-- FinAnalytics v1.8.0 — TFRS Standards Layer
-- Safe/idempotent migration. Adds standards metadata only; does not delete or rewrite financial figures.

begin;

alter table public.companies
  add column if not exists accounting_standard_profile text;

update public.companies
set accounting_standard_profile = case
  when coalesce(company_mode, '') = 'public' or coalesce(legal_entity_type, '') = 'public_limited' or ticker_symbol is not null then 'TFRS_PAE'
  when coalesce(company_mode, '') = 'private' or coalesce(legal_entity_type, '') in ('limited_company','partnership','registered_partnership') then 'TFRS_NPAE'
  else coalesce(accounting_standard_profile, 'UNKNOWN')
end
where accounting_standard_profile is null;

alter table public.normalized_financial_data
  add column if not exists accounting_standard_profile text,
  add column if not exists standard_source text,
  add column if not exists standard_ref text,
  add column if not exists standard_label_th text,
  add column if not exists standard_label_en text,
  add column if not exists standard_chapter text,
  add column if not exists standard_reason text,
  add column if not exists consolidation_indicator text,
  add column if not exists business_combination_indicator text;

alter table public.import_batches
  add column if not exists accounting_standard_profile text,
  add column if not exists standard_validation_summary jsonb default '{}'::jsonb,
  add column if not exists data_quality_score numeric;

alter table public.account_mappings
  add column if not exists standard_source text,
  add column if not exists standard_ref text,
  add column if not exists standard_label_th text,
  add column if not exists standard_label_en text;

update public.normalized_financial_data nfd
set accounting_standard_profile = coalesce(
  nfd.accounting_standard_profile,
  (select c.accounting_standard_profile from public.companies c where c.id = nfd.company_id),
  'UNKNOWN'
)
where nfd.accounting_standard_profile is null;

update public.import_batches ib
set accounting_standard_profile = coalesce(
  ib.accounting_standard_profile,
  (select c.accounting_standard_profile from public.companies c where c.id = ib.company_id),
  case
    when coalesce(ib.source_type, '') like 'private_%' then 'TFRS_NPAE'
    else 'TFRS_PAE'
  end
)
where ib.accounting_standard_profile is null;

create index if not exists idx_nfd_standard_ref on public.normalized_financial_data(company_id, standard_ref);
create index if not exists idx_nfd_standard_profile on public.normalized_financial_data(company_id, accounting_standard_profile, fiscal_year);
create index if not exists idx_nfd_consolidation_indicator on public.normalized_financial_data(company_id, consolidation_indicator) where consolidation_indicator is not null;
create index if not exists idx_nfd_business_combination_indicator on public.normalized_financial_data(company_id, business_combination_indicator) where business_combination_indicator is not null;
create index if not exists idx_import_batches_quality on public.import_batches(company_id, accounting_standard_profile, data_quality_score);

comment on column public.companies.accounting_standard_profile is 'FinAnalytics accounting standard profile: TFRS_PAE, TFRS_NPAE, MANAGEMENT_REPORT, TRIAL_BALANCE, UNKNOWN.';
comment on column public.normalized_financial_data.standard_ref is 'Deterministic accounting standards reference used by FinAnalytics mapping layer, e.g. TFRS_NPAE_CH18, TFRS10_CONTROL_MODEL, TFRS3_GOODWILL.';
comment on column public.import_batches.standard_validation_summary is 'JSON summary of standards/data-quality checks generated at import/export time.';
comment on column public.import_batches.data_quality_score is '0-100 deterministic data quality score based on mapping review, core metrics and TFRS standards coverage.';

commit;
