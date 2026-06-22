-- FinAnalytics v1.6 Data Governance Pack
-- Import History, raw file storage metadata, rollback-safe statuses, validation/mapping support.
-- Safe to run more than once after v1.5 migrations.

-- 1) Import batch metadata for lineage
alter table public.import_batches
add column if not exists file_hash text,
add column if not exists file_size bigint,
add column if not exists storage_path text,
add column if not exists total_rows integer,
add column if not exists review_count integer,
add column if not exists validation_summary jsonb;

-- 2) Status lifecycle: confirmed -> superseded -> rolled_back
alter table public.import_batches
  drop constraint if exists import_batches_status_check;
alter table public.import_batches
  add constraint import_batches_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'superseded', 'rolled_back'));

alter table public.normalized_financial_data
  drop constraint if exists normalized_financial_data_import_status_check;
alter table public.normalized_financial_data
  add constraint normalized_financial_data_import_status_check
  check (import_status in ('pending', 'confirmed', 'superseded', 'rolled_back'));

alter table public.monthly_operating_data
  drop constraint if exists monthly_operating_data_import_status_check;
alter table public.monthly_operating_data
  add constraint monthly_operating_data_import_status_check
  check (import_status in ('pending', 'confirmed', 'superseded', 'rolled_back'));

alter table public.trial_balance_data
  drop constraint if exists trial_balance_data_import_status_check;
alter table public.trial_balance_data
  add constraint trial_balance_data_import_status_check
  check (import_status in ('pending', 'confirmed', 'superseded', 'rolled_back'));

create index if not exists import_batches_company_status_idx
  on public.import_batches(company_id, status, imported_at desc);
create index if not exists import_batches_hash_idx
  on public.import_batches(file_hash) where file_hash is not null;
create index if not exists normalized_data_status_idx
  on public.normalized_financial_data(company_id, fiscal_year, period, statement_scope, import_status);

-- 3) Raw file bucket for original Excel/CSV evidence.
insert into storage.buckets (id, name, public)
values ('raw-financial-files', 'raw-financial-files', false)
on conflict (id) do nothing;

-- 4) Storage policies: authenticated company members can read/upload only files under their allowed company id path.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='raw_financial_files_read') then
    create policy raw_financial_files_read
    on storage.objects for select to authenticated
    using (
      bucket_id = 'raw-financial-files'
      and public.is_company_member(nullif(split_part(name, '/', 1), '')::bigint)
    );
  end if;

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='raw_financial_files_upload') then
    create policy raw_financial_files_upload
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'raw-financial-files'
      and public.has_company_role(nullif(split_part(name, '/', 1), '')::bigint, array['owner','admin','editor']::public.company_role[])
    );
  end if;

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='raw_financial_files_update') then
    create policy raw_financial_files_update
    on storage.objects for update to authenticated
    using (
      bucket_id = 'raw-financial-files'
      and public.has_company_role(nullif(split_part(name, '/', 1), '')::bigint, array['owner','admin','editor']::public.company_role[])
    )
    with check (
      bucket_id = 'raw-financial-files'
      and public.has_company_role(nullif(split_part(name, '/', 1), '')::bigint, array['owner','admin','editor']::public.company_role[])
    );
  end if;
end $$;

-- 5) Grants for new metadata are covered by table grants, but keep explicit privileges.
grant select, insert, update, delete on public.import_batches to authenticated;
grant select, insert, update, delete on public.normalized_financial_data to authenticated;
grant select, insert, update, delete on public.monthly_operating_data to authenticated;
grant select, insert, update, delete on public.trial_balance_data to authenticated;
grant select, insert, update, delete on public.account_mappings to authenticated;

notify pgrst, 'reload schema';
