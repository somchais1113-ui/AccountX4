-- Migration for Normalized Financial Schema

-- 1. Update Companies
ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS ticker_symbol text,
ADD COLUMN IF NOT EXISTS fiscal_year_end text default '12-31';

-- 2. Drop old financial_records
DROP TABLE IF EXISTS public.financial_records CASCADE;

-- 3. Create import_batches
CREATE TABLE public.import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  file_name text not null,
  fiscal_year integer,
  period_type text,
  period text,
  statement_scope text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  data_version integer default 1,
  is_restated boolean default false,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now()
);
CREATE INDEX import_batches_company_idx on public.import_batches(company_id);

-- 4. Create account_mappings
CREATE TABLE public.account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  raw_account_name text not null,
  statement_type text not null,
  account_group text not null,
  account_subgroup text,
  industry_metric text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, raw_account_name, statement_type)
);
CREATE INDEX account_mappings_company_idx on public.account_mappings(company_id);

-- 5. Create normalized_financial_data
CREATE TABLE public.normalized_financial_data (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  company_name text,
  ticker_symbol text,
  industry text,
  fiscal_year integer not null,
  period_type text not null,
  period text not null,
  statement_scope text not null,
  statement_type text not null,
  account_name text not null,
  account_group text not null,
  account_subgroup text,
  industry_metric text,
  note text,
  original_amount numeric,
  original_unit text,
  amount numeric not null,
  normalized_unit text not null default 'baht',
  raw_account_name text,
  raw_amount numeric,
  raw_unit text,
  source_file text,
  source_sheet text,
  source_row integer,
  source_column text,
  source_cell text,
  import_batch_id uuid references public.import_batches(id) on delete cascade,
  data_version integer default 1,
  is_restated boolean default false,
  mapping_confidence numeric(5,4),
  needs_review boolean default false,
  import_status text not null default 'pending' check (import_status in ('pending', 'confirmed')),
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX normalized_data_company_year_idx on public.normalized_financial_data(company_id, fiscal_year, period);
CREATE INDEX normalized_data_batch_idx on public.normalized_financial_data(import_batch_id);
CREATE INDEX normalized_data_group_idx on public.normalized_financial_data(account_group);

-- Enable RLS
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalized_financial_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Import Batches
create policy batches_read on public.import_batches for select to authenticated using (public.is_company_member(company_id));
create policy batches_create on public.import_batches for insert to authenticated with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
create policy batches_update on public.import_batches for update to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[])) with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));

-- Account Mappings
create policy mappings_read on public.account_mappings for select to authenticated using (public.is_company_member(company_id));
create policy mappings_create on public.account_mappings for insert to authenticated with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
create policy mappings_update on public.account_mappings for update to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[])) with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));

-- Normalized Data
create policy data_read on public.normalized_financial_data for select to authenticated using (public.is_company_member(company_id));
create policy data_create on public.normalized_financial_data for insert to authenticated with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
create policy data_update on public.normalized_financial_data for update to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[])) with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
create policy data_delete on public.normalized_financial_data for delete to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));

-- Audit trigger for new tables
create trigger audit_import_batches after insert or update or delete on public.import_batches for each row execute function public.write_audit_log();
create trigger audit_account_mappings after insert or update or delete on public.account_mappings for each row execute function public.write_audit_log();
create trigger audit_normalized_data after insert or update or delete on public.normalized_financial_data for each row execute function public.write_audit_log();

-- Required API privileges for Supabase PostgREST. RLS still controls row-level access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.normalized_financial_data TO authenticated;
