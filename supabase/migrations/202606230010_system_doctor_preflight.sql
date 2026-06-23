-- FinAnalytics / AccountX4 v1.9.6.1
-- System Doctor + Migration Preflight SQL hotfix
-- Safe/idempotent: installs read-only diagnostics RPC used by the frontend to block
-- imports when the database schema is behind the application version.

begin;

-- Helper kept small and pure so system_doctor_status() does not need unsupported
-- nested PL/pgSQL procedures. PostgreSQL PL/pgSQL does not support declaring a
-- local procedure inside a function body; the previous v1.9.6 migration used that
-- pattern and failed near "p_key text".
create or replace function public.system_doctor_check_object(
  p_key text,
  p_label text,
  p_ok boolean,
  p_message text,
  p_migration text default null,
  p_severity text default 'blocking',
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
as $helper$
  select jsonb_build_object(
    'key', p_key,
    'label', p_label,
    'status', case when coalesce(p_ok, false) then 'pass' when p_severity = 'warning' then 'warn' else 'blocking' end,
    'ok', coalesce(p_ok, false),
    'severity', case when coalesce(p_ok, false) then 'info' else coalesce(p_severity, 'blocking') end,
    'message', p_message,
    'migration', p_migration,
    'details', coalesce(p_details, '{}'::jsonb)
  );
$helper$;

create or replace function public.system_doctor_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_checks jsonb := '[]'::jsonb;
  v_blocking integer := 0;
  v_warn integer := 0;
  v_pass integer := 0;
  v_missing text[];
  v_ok boolean;
begin
  -- Core tables from the normalized schema.
  v_missing := array[]::text[];
  if to_regclass('public.import_batches') is null then v_missing := array_append(v_missing, 'import_batches'); end if;
  if to_regclass('public.normalized_financial_data') is null then v_missing := array_append(v_missing, 'normalized_financial_data'); end if;
  if to_regclass('public.monthly_operating_data') is null then v_missing := array_append(v_missing, 'monthly_operating_data'); end if;
  if to_regclass('public.trial_balance_data') is null then v_missing := array_append(v_missing, 'trial_balance_data'); end if;
  if to_regclass('public.account_mappings') is null then v_missing := array_append(v_missing, 'account_mappings'); end if;
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'core_tables',
    'Core import tables',
    coalesce(array_length(v_missing, 1), 0) = 0,
    case when coalesce(array_length(v_missing, 1), 0) = 0 then 'Core import tables are installed.' else 'Missing table(s): ' || array_to_string(v_missing, ', ') end,
    '202606210001_normalized_schema.sql',
    'blocking',
    jsonb_build_object('missing', coalesce(to_jsonb(v_missing), '[]'::jsonb))
  ));

  -- Accounting engine tables.
  v_missing := array[]::text[];
  if to_regclass('public.mapping_decisions') is null then v_missing := array_append(v_missing, 'mapping_decisions'); end if;
  if to_regclass('public.validation_results') is null then v_missing := array_append(v_missing, 'validation_results'); end if;
  if to_regclass('public.financial_metrics_snapshots') is null then v_missing := array_append(v_missing, 'financial_metrics_snapshots'); end if;
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'accounting_engine_tables',
    'Accounting engine tables',
    coalesce(array_length(v_missing, 1), 0) = 0,
    case when coalesce(array_length(v_missing, 1), 0) = 0 then 'Accounting engine tables are installed.' else 'Missing table(s): ' || array_to_string(v_missing, ', ') end,
    '202606230004_accounting_engine_foundation.sql',
    'blocking',
    jsonb_build_object('missing', coalesce(to_jsonb(v_missing), '[]'::jsonb))
  ));

  -- Readiness columns on import_batches.
  select array_agg(col) into v_missing
  from unnest(array['readiness_status','readiness_score','dashboard_ready','export_ready','external_use_ready','last_validated_at']::text[]) as required(col)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'import_batches' and c.column_name = required.col
  );
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'readiness_gate_columns',
    'Readiness gate columns',
    coalesce(array_length(v_missing, 1), 0) = 0,
    case when coalesce(array_length(v_missing, 1), 0) = 0 then 'Readiness columns are installed.' else 'Missing import_batches column(s): ' || array_to_string(v_missing, ', ') end,
    '202606230005_readiness_gate.sql',
    'blocking',
    jsonb_build_object('missing', coalesce(to_jsonb(v_missing), '[]'::jsonb))
  ));

  -- Import transaction RPC + idempotency lock.
  v_ok := exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'commit_import_batch'
  ) and to_regclass('public.import_jobs') is not null and to_regclass('public.import_jobs_active_key_idx') is not null;
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'import_transaction_rpc',
    'Import transaction RPC and active lock',
    v_ok,
    case when v_ok then 'commit_import_batch RPC and import_jobs active lock are installed.' else 'Missing commit_import_batch RPC, import_jobs table, or active import lock index.' end,
    '202606230006_import_transaction_rpc.sql',
    'blocking',
    jsonb_build_object(
      'commit_import_batch', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'commit_import_batch'),
      'import_jobs', to_regclass('public.import_jobs') is not null,
      'active_lock_index', to_regclass('public.import_jobs_active_key_idx') is not null
    )
  ));

  -- Recovery RPCs and columns.
  select array_agg(col) into v_missing
  from unnest(array['recovery_action','recovery_note','recovered_at','recovered_by','retry_count']::text[]) as required(col)
  where to_regclass('public.import_jobs') is null or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'import_jobs' and c.column_name = required.col
  );
  v_ok := coalesce(array_length(v_missing, 1), 0) = 0
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'recover_import_job')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'recover_stuck_import_jobs');
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'import_job_recovery_rpc',
    'Import Job recovery center',
    v_ok,
    case when v_ok then 'Import job recovery RPCs and columns are installed.' else 'Missing recovery RPC(s) or import_jobs recovery column(s).' end,
    '202606230007_import_job_recovery_center.sql',
    'blocking',
    jsonb_build_object('missing_columns', coalesce(to_jsonb(v_missing), '[]'::jsonb))
  ));

  -- Snapshot source of truth columns.
  select array_agg(col) into v_missing
  from unnest(array['snapshot_run_id','snapshot_status','is_current','superseded_at','superseded_by','source_metric_role','source_line_role','source_batch_status','snapshot_metadata']::text[]) as required(col)
  where to_regclass('public.financial_metrics_snapshots') is null or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'financial_metrics_snapshots' and c.column_name = required.col
  );
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'snapshot_source_of_truth_columns',
    'Metric snapshot source-of-truth columns',
    coalesce(array_length(v_missing, 1), 0) = 0,
    case when coalesce(array_length(v_missing, 1), 0) = 0 then 'Snapshot source-of-truth columns are installed.' else 'Missing financial_metrics_snapshots column(s): ' || array_to_string(v_missing, ', ') end,
    '202606230008_metric_snapshot_source_of_truth.sql',
    'blocking',
    jsonb_build_object('missing', coalesce(to_jsonb(v_missing), '[]'::jsonb))
  ));

  -- Mapping conflict columns.
  select array_agg(col) into v_missing
  from unnest(array['conflict_status','conflict_reasons','conflict_score','approval_policy','manual_approval_reason','mapping_conflict_checked_at']::text[]) as required(col)
  where to_regclass('public.normalized_financial_data') is null or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'normalized_financial_data' and c.column_name = required.col
  );
  v_ok := coalesce(array_length(v_missing, 1), 0) = 0
    and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='mapping_decisions' and c.column_name='approval_reason')
    and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='mapping_decisions' and c.column_name='reusable');
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'mapping_conflict_columns',
    'Mapping conflict control columns',
    v_ok,
    case when v_ok then 'Mapping conflict control columns are installed.' else 'Missing mapping conflict column(s).' end,
    '202606230009_mapping_conflict_control.sql',
    'blocking',
    jsonb_build_object('missing_normalized_columns', coalesce(to_jsonb(v_missing), '[]'::jsonb))
  ));

  -- RLS quick check. Warning only because some old dev databases may still be usable for one-owner testing.
  v_missing := array[]::text[];
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='import_jobs' and c.relrowsecurity = false) then v_missing := array_append(v_missing, 'import_jobs'); end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='mapping_decisions' and c.relrowsecurity = false) then v_missing := array_append(v_missing, 'mapping_decisions'); end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='financial_metrics_snapshots' and c.relrowsecurity = false) then v_missing := array_append(v_missing, 'financial_metrics_snapshots'); end if;
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'rls_enabled',
    'RLS quick check',
    coalesce(array_length(v_missing, 1), 0) = 0,
    case when coalesce(array_length(v_missing, 1), 0) = 0 then 'Key governance tables have RLS enabled.' else 'RLS disabled on table(s): ' || array_to_string(v_missing, ', ') end,
    null,
    'warning',
    jsonb_build_object('rls_disabled_tables', coalesce(to_jsonb(v_missing), '[]'::jsonb))
  ));

  -- This function is installed if the call succeeded.
  v_checks := v_checks || jsonb_build_array(public.system_doctor_check_object(
    'system_doctor_rpc',
    'System Doctor RPC',
    true,
    'system_doctor_status RPC is installed.',
    '202606230010_system_doctor_preflight.sql',
    'blocking',
    '{}'::jsonb
  ));

  select
    count(*) filter (where check_item->>'status' = 'pass'),
    count(*) filter (where check_item->>'status' = 'warn'),
    count(*) filter (where check_item->>'status' = 'blocking')
  into v_pass, v_warn, v_blocking
  from jsonb_array_elements(v_checks) as t(check_item);

  return jsonb_build_object(
    'app_schema_version', 'v1.9.6.1',
    'database_schema_version', 'v1.9.6.1-preflight',
    'checked_at', now(),
    'overall_status', case when v_blocking > 0 then 'blocking' when v_warn > 0 then 'warning' else 'pass' end,
    'safe_to_import', v_blocking = 0,
    'safe_to_export', v_blocking = 0,
    'counts', jsonb_build_object('pass', v_pass, 'warn', v_warn, 'blocking', v_blocking),
    'checks', v_checks,
    'required_migrations', jsonb_build_array(
      '202606230002_export_security_hardening.sql',
      '202606230003_tfrs_standards_layer.sql',
      '202606230004_accounting_engine_foundation.sql',
      '202606230005_readiness_gate.sql',
      '202606230006_import_transaction_rpc.sql',
      '202606230007_import_job_recovery_center.sql',
      '202606230008_metric_snapshot_source_of_truth.sql',
      '202606230009_mapping_conflict_control.sql',
      '202606230010_system_doctor_preflight.sql'
    )
  );
end;
$$;

grant execute on function public.system_doctor_status() to authenticated;
grant execute on function public.system_doctor_check_object(text, text, boolean, text, text, text, jsonb) to authenticated;
comment on function public.system_doctor_status() is
  'FinAnalytics v1.9.6.1 read-only preflight diagnostics. The frontend uses this to block imports when the database schema is behind the app version.';

commit;
