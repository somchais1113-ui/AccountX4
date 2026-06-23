-- FinAnalytics / AccountX4 v1.9.2
-- Import Transaction RPC + Idempotency Lock
-- Safe/idempotent: moves the critical import commit into one PostgreSQL transaction,
-- adds an active import lock, and preserves last-good data if any step fails.

begin;

-- 1) Ensure metadata columns used by the commit RPC exist.
alter table public.import_batches
  add column if not exists source_type text,
  add column if not exists parser_profile text,
  add column if not exists legal_entity_type text,
  add column if not exists accounting_standard_profile text,
  add column if not exists standard_validation_summary jsonb,
  add column if not exists data_quality_score numeric,
  add column if not exists file_hash text,
  add column if not exists file_size bigint,
  add column if not exists storage_path text,
  add column if not exists total_rows integer,
  add column if not exists review_count integer,
  add column if not exists validation_summary jsonb default '{}'::jsonb;

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

-- 2) Monthly history needs to allow pending replacement rows before old rows are superseded.
-- The original table had a full unique(company_id, fiscal_year, month) constraint, which blocks
-- transaction-safe replacement. Keep only one active confirmed row while allowing history.
do $$ begin
  update public.monthly_operating_data m
  set import_status = 'superseded', updated_at = now()
  from (
    select id,
           row_number() over (
             partition by company_id, fiscal_year, month
             order by imported_at desc nulls last, created_at desc nulls last, id desc
           ) as rn
    from public.monthly_operating_data
    where coalesce(import_status, 'confirmed') = 'confirmed'
  ) ranked
  where m.id = ranked.id and ranked.rn > 1;
exception when undefined_table then null; end $$;

alter table public.monthly_operating_data
  drop constraint if exists monthly_operating_data_company_id_fiscal_year_month_key;
drop index if exists public.monthly_operating_data_company_id_fiscal_year_month_key;
create unique index if not exists monthly_operating_one_confirmed_row_idx
  on public.monthly_operating_data(company_id, fiscal_year, month)
  where import_status = 'confirmed';

-- 3) Active import job / idempotency lock.
create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  job_key text not null,
  file_name text,
  file_hash text,
  fiscal_year integer,
  period_type text,
  period text,
  statement_scope text,
  source_type text,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  status text not null default 'processing' check (status in ('pending', 'processing', 'success', 'failed', 'cancelled')),
  error_message text,
  metadata jsonb default '{}'::jsonb,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.import_jobs enable row level security;
do $$ begin
  create policy import_jobs_read on public.import_jobs
    for select to authenticated using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy import_jobs_insert on public.import_jobs
    for insert to authenticated with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy import_jobs_update on public.import_jobs
    for update to authenticated using (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]))
    with check (public.has_company_role(company_id, array['owner','admin','editor']::public.company_role[]));
exception when duplicate_object then null; end $$;

drop index if exists public.import_jobs_active_key_idx;
create unique index import_jobs_active_key_idx
  on public.import_jobs(company_id, job_key)
  where status in ('pending', 'processing');
create index if not exists import_jobs_company_status_idx
  on public.import_jobs(company_id, status, started_at desc);

grant select, insert, update, delete on public.import_jobs to authenticated;

-- 4) One atomic import commit RPC. The frontend still parses/enriches rows, but the database now
-- creates the batch, inserts rows, supersedes old rows, promotes new rows, and confirms the batch
-- inside one transaction.
create or replace function public.commit_import_batch(
  p_company_id bigint,
  p_batch jsonb,
  p_normalized_rows jsonb default '[]'::jsonb,
  p_monthly_rows jsonb default '[]'::jsonb,
  p_trial_balance_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_job_id uuid;
  v_job_key text;
  v_normalized_rows jsonb := coalesce(p_normalized_rows, '[]'::jsonb);
  v_monthly_rows jsonb := coalesce(p_monthly_rows, '[]'::jsonb);
  v_trial_balance_rows jsonb := coalesce(p_trial_balance_rows, '[]'::jsonb);
  v_expected_normalized integer := 0;
  v_expected_monthly integer := 0;
  v_expected_trial integer := 0;
  v_inserted integer := 0;
  v_rows_imported integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required to commit an import.' using errcode = '28000';
  end if;

  if not public.has_company_role(p_company_id, array['owner','admin','editor']::public.company_role[]) then
    raise exception 'You do not have permission to import data for this company.' using errcode = '42501';
  end if;

  if jsonb_typeof(v_normalized_rows) <> 'array' or jsonb_typeof(v_monthly_rows) <> 'array' or jsonb_typeof(v_trial_balance_rows) <> 'array' then
    raise exception 'Import rows must be JSON arrays.' using errcode = '22023';
  end if;

  v_expected_normalized := jsonb_array_length(v_normalized_rows);
  v_expected_monthly := jsonb_array_length(v_monthly_rows);
  v_expected_trial := jsonb_array_length(v_trial_balance_rows);

  if (v_expected_normalized + v_expected_monthly + v_expected_trial) = 0 then
    raise exception 'No import rows were supplied.' using errcode = '22023';
  end if;

  v_job_key := lower(concat_ws('|',
    coalesce(nullif(p_batch->>'source_type', ''), 'import'),
    coalesce(nullif(p_batch->>'file_hash', ''), 'name:' || coalesce(nullif(p_batch->>'file_name', ''), 'unknown_file')),
    coalesce(nullif(p_batch->>'fiscal_year', ''), 'unknown_year'),
    coalesce(nullif(p_batch->>'period_type', ''), 'annual'),
    coalesce(nullif(p_batch->>'period', ''), 'FY'),
    coalesce(nullif(p_batch->>'statement_scope', ''), 'unknown_scope')
  ));

  begin
    insert into public.import_jobs (
      company_id, job_key, file_name, file_hash, fiscal_year, period_type, period,
      statement_scope, source_type, status, started_by, metadata
    ) values (
      p_company_id,
      v_job_key,
      nullif(p_batch->>'file_name', ''),
      nullif(p_batch->>'file_hash', ''),
      nullif(p_batch->>'fiscal_year', '')::integer,
      coalesce(nullif(p_batch->>'period_type', ''), 'annual'),
      coalesce(nullif(p_batch->>'period', ''), 'FY'),
      coalesce(nullif(p_batch->>'statement_scope', ''), 'unknown'),
      coalesce(nullif(p_batch->>'source_type', ''), 'import'),
      'processing',
      v_user_id,
      jsonb_build_object(
        'expected_normalized_rows', v_expected_normalized,
        'expected_monthly_rows', v_expected_monthly,
        'expected_trial_balance_rows', v_expected_trial
      )
    ) returning id into v_job_id;
  exception when unique_violation then
    raise exception 'This import is already processing. Wait for the current save to finish before clicking Save again.' using errcode = 'P0001';
  end;

  insert into public.import_batches (
    company_id, file_name, fiscal_year, period_type, period, statement_scope, status,
    source_type, parser_profile, legal_entity_type, accounting_standard_profile,
    standard_validation_summary, data_quality_score, file_hash, file_size,
    total_rows, review_count, validation_summary, imported_by
  ) values (
    p_company_id,
    coalesce(nullif(p_batch->>'file_name', ''), 'Imported financial file'),
    nullif(p_batch->>'fiscal_year', '')::integer,
    coalesce(nullif(p_batch->>'period_type', ''), 'annual'),
    coalesce(nullif(p_batch->>'period', ''), 'FY'),
    coalesce(nullif(p_batch->>'statement_scope', ''), 'unknown'),
    'pending',
    nullif(p_batch->>'source_type', ''),
    nullif(p_batch->>'parser_profile', ''),
    nullif(p_batch->>'legal_entity_type', ''),
    nullif(p_batch->>'accounting_standard_profile', ''),
    coalesce(p_batch->'standard_validation_summary', p_batch->'standardsQuality'),
    nullif(p_batch->>'data_quality_score', '')::numeric,
    nullif(p_batch->>'file_hash', ''),
    nullif(p_batch->>'file_size', '')::bigint,
    nullif(p_batch->>'total_rows', '')::integer,
    nullif(p_batch->>'review_count', '')::integer,
    coalesce(p_batch->'validation_summary', '{}'::jsonb),
    v_user_id
  ) returning id into v_batch_id;

  update public.import_jobs
  set import_batch_id = v_batch_id, updated_at = now()
  where id = v_job_id;

  if v_expected_normalized > 0 then
    insert into public.normalized_financial_data (
      company_id, fiscal_year, period_type, period, statement_scope, statement_type,
      account_name, account_group, account_subgroup, industry_metric, note,
      original_amount, original_unit, amount, normalized_unit, raw_account_name,
      raw_amount, raw_unit, source_file, source_sheet, source_row, source_column,
      source_cell, import_batch_id, mapping_confidence, mapping_source,
      suggested_account_group, suggested_account_subgroup, review_reason, needs_review,
      accounting_standard_profile, standard_source, standard_ref, standard_label_th,
      standard_label_en, standard_chapter, standard_reason, consolidation_indicator,
      business_combination_indicator, line_role, metric_role, section_path, parent_heading,
      risk_flags, mapping_status, approval_scope, approved_mapping_id,
      is_dashboard_eligible, is_export_eligible, import_status, imported_by
    )
    select
      p_company_id,
      r.fiscal_year,
      coalesce(r.period_type, 'annual'),
      coalesce(r.period, 'FY'),
      coalesce(r.statement_scope, coalesce(nullif(p_batch->>'statement_scope', ''), 'unknown')),
      coalesce(r.statement_type, 'unknown'),
      coalesce(r.account_name, r.raw_account_name, 'Unknown account'),
      coalesce(r.account_group, 'other'),
      r.account_subgroup,
      r.industry_metric,
      r.note,
      r.original_amount,
      r.original_unit,
      coalesce(r.amount, 0),
      coalesce(r.normalized_unit, 'baht'),
      coalesce(r.raw_account_name, r.account_name, 'Unknown account'),
      r.raw_amount,
      r.raw_unit,
      coalesce(r.source_file, p_batch->>'file_name'),
      r.source_sheet,
      r.source_row,
      r.source_column,
      r.source_cell,
      v_batch_id,
      r.mapping_confidence,
      coalesce(r.mapping_source, 'unknown'),
      r.suggested_account_group,
      r.suggested_account_subgroup,
      r.review_reason,
      coalesce(r.needs_review, false),
      coalesce(r.accounting_standard_profile, nullif(p_batch->>'accounting_standard_profile', '')),
      r.standard_source,
      r.standard_ref,
      r.standard_label_th,
      r.standard_label_en,
      r.standard_chapter,
      r.standard_reason,
      r.consolidation_indicator,
      r.business_combination_indicator,
      coalesce(r.line_role, 'detail'),
      coalesce(r.metric_role, 'supporting_line'),
      r.section_path,
      r.parent_heading,
      coalesce(r.risk_flags, '{}'::text[]),
      coalesce(r.mapping_status, case when coalesce(r.needs_review, false) then 'suggested' else 'approved' end),
      r.approval_scope,
      r.approved_mapping_id,
      r.is_dashboard_eligible,
      r.is_export_eligible,
      'pending',
      v_user_id
    from jsonb_to_recordset(v_normalized_rows) as r(
      fiscal_year integer,
      period_type text,
      period text,
      statement_scope text,
      statement_type text,
      account_name text,
      account_group text,
      account_subgroup text,
      industry_metric text,
      note text,
      original_amount numeric,
      original_unit text,
      amount numeric,
      normalized_unit text,
      raw_account_name text,
      raw_amount numeric,
      raw_unit text,
      source_file text,
      source_sheet text,
      source_row integer,
      source_column text,
      source_cell text,
      mapping_confidence numeric,
      mapping_source text,
      suggested_account_group text,
      suggested_account_subgroup text,
      review_reason text,
      needs_review boolean,
      accounting_standard_profile text,
      standard_source text,
      standard_ref text,
      standard_label_th text,
      standard_label_en text,
      standard_chapter text,
      standard_reason text,
      consolidation_indicator text,
      business_combination_indicator text,
      line_role text,
      metric_role text,
      section_path text,
      parent_heading text,
      risk_flags text[],
      mapping_status text,
      approval_scope text,
      approved_mapping_id uuid,
      is_dashboard_eligible boolean,
      is_export_eligible boolean
    );
    get diagnostics v_inserted = row_count;
    if v_inserted <> v_expected_normalized then
      raise exception 'Normalized row count mismatch. Expected %, inserted %.', v_expected_normalized, v_inserted using errcode = 'P0001';
    end if;
    v_rows_imported := v_rows_imported + v_inserted;
  end if;

  if v_expected_monthly > 0 then
    insert into public.monthly_operating_data (
      company_id, fiscal_year, month, revenue, expense, cash_in, cash_out, loan_balance,
      source_file, source_sheet, source_row, import_batch_id, import_status, imported_by
    )
    select
      p_company_id,
      r.fiscal_year,
      r.month,
      coalesce(r.revenue, 0),
      coalesce(r.expense, 0),
      coalesce(r.cash_in, 0),
      coalesce(r.cash_out, 0),
      coalesce(r.loan_balance, 0),
      coalesce(r.source_file, p_batch->>'file_name'),
      r.source_sheet,
      r.source_row,
      v_batch_id,
      'pending',
      v_user_id
    from jsonb_to_recordset(v_monthly_rows) as r(
      fiscal_year integer,
      month integer,
      revenue numeric,
      expense numeric,
      cash_in numeric,
      cash_out numeric,
      loan_balance numeric,
      source_file text,
      source_sheet text,
      source_row integer
    );
    get diagnostics v_inserted = row_count;
    if v_inserted <> v_expected_monthly then
      raise exception 'Monthly row count mismatch. Expected %, inserted %.', v_expected_monthly, v_inserted using errcode = 'P0001';
    end if;
    v_rows_imported := v_rows_imported + v_inserted;
  end if;

  if v_expected_trial > 0 then
    insert into public.trial_balance_data (
      company_id, fiscal_year, period_type, period, account_code, account_name, debit,
      credit, ending_balance, account_group, source_file, source_sheet, source_row,
      import_batch_id, import_status, imported_by
    )
    select
      p_company_id,
      r.fiscal_year,
      coalesce(r.period_type, 'annual'),
      coalesce(r.period, 'FY'),
      r.account_code,
      coalesce(r.account_name, 'Unknown account'),
      coalesce(r.debit, 0),
      coalesce(r.credit, 0),
      coalesce(r.ending_balance, 0),
      coalesce(r.account_group, 'other'),
      coalesce(r.source_file, p_batch->>'file_name'),
      r.source_sheet,
      r.source_row,
      v_batch_id,
      'pending',
      v_user_id
    from jsonb_to_recordset(v_trial_balance_rows) as r(
      fiscal_year integer,
      period_type text,
      period text,
      account_code text,
      account_name text,
      debit numeric,
      credit numeric,
      ending_balance numeric,
      account_group text,
      source_file text,
      source_sheet text,
      source_row integer
    );
    get diagnostics v_inserted = row_count;
    if v_inserted <> v_expected_trial then
      raise exception 'Trial balance row count mismatch. Expected %, inserted %.', v_expected_trial, v_inserted using errcode = 'P0001';
    end if;
    v_rows_imported := v_rows_imported + v_inserted;
  end if;

  -- Supersede old rows before promoting new rows. This is safe because this whole function
  -- is a single database transaction; outside readers see either the old committed state or the new one.
  if v_expected_normalized > 0 then
    with keys as (
      select distinct fiscal_year, period, statement_scope
      from public.normalized_financial_data
      where import_batch_id = v_batch_id
    ), old_rows as (
      update public.normalized_financial_data n
      set import_status = 'superseded', updated_at = now()
      from keys k
      where n.company_id = p_company_id
        and n.import_batch_id is not null
        and n.import_batch_id <> v_batch_id
        and n.import_status = 'confirmed'
        and n.fiscal_year = k.fiscal_year
        and n.period = k.period
        and n.statement_scope = k.statement_scope
      returning n.import_batch_id
    )
    update public.import_batches b
    set status = 'superseded'
    where b.status = 'confirmed'
      and b.id in (select distinct import_batch_id from old_rows where import_batch_id is not null);
  end if;

  if v_expected_monthly > 0 then
    with keys as (
      select distinct fiscal_year, month
      from public.monthly_operating_data
      where import_batch_id = v_batch_id
    ), old_rows as (
      update public.monthly_operating_data m
      set import_status = 'superseded', updated_at = now()
      from keys k
      where m.company_id = p_company_id
        and m.import_batch_id is not null
        and m.import_batch_id <> v_batch_id
        and m.import_status = 'confirmed'
        and m.fiscal_year = k.fiscal_year
        and m.month = k.month
      returning m.import_batch_id
    )
    update public.import_batches b
    set status = 'superseded'
    where b.status = 'confirmed'
      and b.id in (select distinct import_batch_id from old_rows where import_batch_id is not null);
  end if;

  if v_expected_trial > 0 then
    with keys as (
      select distinct fiscal_year, period_type, period
      from public.trial_balance_data
      where import_batch_id = v_batch_id
    ), old_rows as (
      update public.trial_balance_data t
      set import_status = 'superseded', updated_at = now()
      from keys k
      where t.company_id = p_company_id
        and t.import_batch_id is not null
        and t.import_batch_id <> v_batch_id
        and t.import_status = 'confirmed'
        and t.fiscal_year = k.fiscal_year
        and t.period_type = k.period_type
        and t.period = k.period
      returning t.import_batch_id
    )
    update public.import_batches b
    set status = 'superseded'
    where b.status = 'confirmed'
      and b.id in (select distinct import_batch_id from old_rows where import_batch_id is not null);
  end if;

  update public.normalized_financial_data
  set import_status = 'confirmed', updated_at = now()
  where import_batch_id = v_batch_id;
  update public.monthly_operating_data
  set import_status = 'confirmed', updated_at = now()
  where import_batch_id = v_batch_id;
  update public.trial_balance_data
  set import_status = 'confirmed', updated_at = now()
  where import_batch_id = v_batch_id;

  update public.import_batches
  set status = 'confirmed', total_rows = v_rows_imported
  where id = v_batch_id;

  update public.import_jobs
  set status = 'success', finished_at = now(), updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('rows_imported', v_rows_imported)
  where id = v_job_id;

  return jsonb_build_object(
    'ok', true,
    'import_batch_id', v_batch_id,
    'job_id', v_job_id,
    'job_key', v_job_key,
    'rows_imported', v_rows_imported,
    'normalized_rows', v_expected_normalized,
    'monthly_rows', v_expected_monthly,
    'trial_balance_rows', v_expected_trial
  );
end;
$$;

grant execute on function public.commit_import_batch(bigint, jsonb, jsonb, jsonb, jsonb) to authenticated;

comment on function public.commit_import_batch(bigint, jsonb, jsonb, jsonb, jsonb) is
  'v1.9.2 atomic import commit. Inserts pending rows, supersedes old confirmed rows, promotes new rows, and confirms the batch in one PostgreSQL transaction with an active idempotency lock.';

notify pgrst, 'reload schema';

commit;
