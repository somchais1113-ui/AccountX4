-- FinAnalytics v1.5.3 Legal Entity Type
-- Adds explicit Thai legal entity types for upload/company workflows.
-- Safe to run more than once.

alter table public.companies
add column if not exists legal_entity_type text not null default 'limited_company';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_legal_entity_type_check'
  ) then
    alter table public.companies
    add constraint companies_legal_entity_type_check
    check (legal_entity_type in ('public_limited', 'limited_company', 'limited_partnership'));
  end if;
end $$;

update public.companies
set legal_entity_type = case
  when company_mode = 'public' or ticker_symbol is not null then 'public_limited'
  when legal_entity_type is null then 'limited_company'
  else legal_entity_type
end;

alter table public.import_batches
add column if not exists legal_entity_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_batches_legal_entity_type_check'
  ) then
    alter table public.import_batches
    add constraint import_batches_legal_entity_type_check
    check (legal_entity_type is null or legal_entity_type in ('public_limited', 'limited_company', 'limited_partnership'));
  end if;
end $$;

notify pgrst, 'reload schema';
