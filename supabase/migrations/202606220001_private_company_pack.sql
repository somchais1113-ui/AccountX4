-- FinAnalytics v1.5 Private Company Import Pack
-- Run after 202606200001_initial_schema.sql and 202606210001_normalized_schema.sql.
-- Safe to run more than once.

-- 1) Company mode: public listed vs private company
alter table public.companies
add column if not exists company_mode text not null default 'public';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_company_mode_check'
  ) then
    alter table public.companies
    add constraint companies_company_mode_check
    check (company_mode in ('public', 'private'));
  end if;
end $$;

-- 2) Import batch metadata for source-aware imports
alter table public.import_batches
add column if not exists source_type text,
add column if not exists parser_profile text;

-- 3) Monthly management account / operating report storage
create table if not exists public.monthly_operating_data (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  fiscal_year integer not null check (fiscal_year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  revenue numeric(20,2) not null default 0,
  expense numeric(20,2) not null default 0,
  cash_in numeric(20,2) not null default 0,
  cash_out numeric(20,2) not null default 0,
  loan_balance numeric(20,2) not null default 0,
  source_file text,
  source_sheet text,
  source_row integer,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  import_status text not null default 'confirmed' check (import_status in ('pending', 'confirmed')),
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, fiscal_year, month)
);

create index if not exists monthly_operating_company_year_idx
on public.monthly_operating_data(company_id, fiscal_year, month);
create index if not exists monthly_operating_batch_idx
on public.monthly_operating_data(import_batch_id);

-- 4) Trial balance storage
create table if not exists public.trial_balance_data (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  fiscal_year integer not null check (fiscal_year between 2000 and 2200),
  period_type text not null default 'annual',
  period text not null default 'FY',
  account_code text,
  account_name text not null,
  debit numeric(20,2) not null default 0,
  credit numeric(20,2) not null default 0,
  ending_balance numeric(20,2) not null default 0,
  account_group text not null default 'other',
  source_file text,
  source_sheet text,
  source_row integer,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  import_status text not null default 'confirmed' check (import_status in ('pending', 'confirmed')),
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trial_balance_company_year_idx
on public.trial_balance_data(company_id, fiscal_year, period);
create index if not exists trial_balance_group_idx
on public.trial_balance_data(account_group);
create index if not exists trial_balance_batch_idx
on public.trial_balance_data(import_batch_id);

-- 5) RLS
alter table public.monthly_operating_data enable row level security;
alter table public.trial_balance_data enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='monthly_operating_data' and policyname='monthly_read') then
    create policy monthly_read on public.monthly_operating_data for select to authenticated using (public.is_company_member(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='monthly_operating_data' and policyname='monthly_create') then
    create policy monthly_create on public.monthly_operating_data for insert to authenticated with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='monthly_operating_data' and policyname='monthly_update') then
    create policy monthly_update on public.monthly_operating_data for update to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[])) with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='monthly_operating_data' and policyname='monthly_delete') then
    create policy monthly_delete on public.monthly_operating_data for delete to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trial_balance_data' and policyname='trial_balance_read') then
    create policy trial_balance_read on public.trial_balance_data for select to authenticated using (public.is_company_member(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trial_balance_data' and policyname='trial_balance_create') then
    create policy trial_balance_create on public.trial_balance_data for insert to authenticated with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trial_balance_data' and policyname='trial_balance_update') then
    create policy trial_balance_update on public.trial_balance_data for update to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[])) with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trial_balance_data' and policyname='trial_balance_delete') then
    create policy trial_balance_delete on public.trial_balance_data for delete to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
  end if;
end $$;

-- 6) Audit triggers if the project has write_audit_log()
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='write_audit_log') then
    if not exists (select 1 from pg_trigger where tgname='audit_monthly_operating_data') then
      create trigger audit_monthly_operating_data after insert or update or delete on public.monthly_operating_data for each row execute function public.write_audit_log();
    end if;
    if not exists (select 1 from pg_trigger where tgname='audit_trial_balance_data') then
      create trigger audit_trial_balance_data after insert or update or delete on public.trial_balance_data for each row execute function public.write_audit_log();
    end if;
  end if;
end $$;

grant select, insert, update, delete on public.monthly_operating_data to authenticated;
grant select, insert, update, delete on public.trial_balance_data to authenticated;

notify pgrst, 'reload schema';
