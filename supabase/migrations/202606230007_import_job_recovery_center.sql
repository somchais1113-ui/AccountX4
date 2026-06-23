-- FinAnalytics / AccountX4 v1.9.3
-- Import Job Monitor + Recovery Center
-- Adds safe recovery controls for stuck import_jobs created by v1.9.2.
-- Safe/idempotent: does not delete financial data. Pending rows are marked rolled_back
-- only when the attached import batch is still pending.

begin;

-- 1) Recovery metadata for auditability.
alter table public.import_jobs
  add column if not exists recovery_action text,
  add column if not exists recovery_note text,
  add column if not exists recovered_at timestamptz,
  add column if not exists recovered_by uuid references auth.users(id) on delete set null,
  add column if not exists retry_count integer not null default 0;

create index if not exists import_jobs_recovery_status_idx
  on public.import_jobs(company_id, status, started_at desc, recovered_at desc);

-- 2) Recover a single stuck/failed import job. This is intentionally conservative:
--    - success jobs cannot be modified
--    - confirmed/superseded/rolled_back batches are not rejected
--    - only a pending attached batch can be rejected, and its pending rows are rolled_back
create or replace function public.recover_import_job(
  p_job_id uuid,
  p_action text default 'mark_failed',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.import_jobs%rowtype;
  v_batch_status text;
  v_next_status text;
  v_rows_normalized integer := 0;
  v_rows_monthly integer := 0;
  v_rows_trial integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required to recover import jobs.' using errcode = '28000';
  end if;

  select * into v_job
  from public.import_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Import job % was not found.', p_job_id using errcode = 'P0002';
  end if;

  if not public.has_company_role(v_job.company_id, array['owner','admin','editor']::public.company_role[]) then
    raise exception 'You do not have permission to recover this import job.' using errcode = '42501';
  end if;

  if p_action not in ('cancel', 'mark_failed', 'clear_stuck', 'retry_requested') then
    raise exception 'Unsupported import recovery action: %', p_action using errcode = '22023';
  end if;

  if v_job.status = 'success' and p_action <> 'retry_requested' then
    raise exception 'Successful import jobs cannot be cancelled or marked failed.' using errcode = '22023';
  end if;

  if v_job.import_batch_id is not null then
    select status into v_batch_status
    from public.import_batches
    where id = v_job.import_batch_id
    for update;
  end if;

  if v_job.import_batch_id is not null and v_batch_status = 'pending' and p_action in ('cancel', 'mark_failed', 'clear_stuck') then
    update public.normalized_financial_data
    set import_status = 'rolled_back', updated_at = now()
    where import_batch_id = v_job.import_batch_id and import_status = 'pending';
    get diagnostics v_rows_normalized = row_count;

    update public.monthly_operating_data
    set import_status = 'rolled_back', updated_at = now()
    where import_batch_id = v_job.import_batch_id and import_status = 'pending';
    get diagnostics v_rows_monthly = row_count;

    update public.trial_balance_data
    set import_status = 'rolled_back', updated_at = now()
    where import_batch_id = v_job.import_batch_id and import_status = 'pending';
    get diagnostics v_rows_trial = row_count;

    update public.import_batches
    set status = 'rejected',
        validation_summary = coalesce(validation_summary, '{}'::jsonb) || jsonb_build_object(
          'recovered_by', v_user_id,
          'recovered_at', now(),
          'recovery_action', p_action,
          'recovery_note', p_note,
          'previous_status', v_batch_status
        )
    where id = v_job.import_batch_id and status = 'pending';
  end if;

  v_next_status := case
    when p_action = 'cancel' then 'cancelled'
    when p_action = 'retry_requested' then v_job.status
    else 'failed'
  end;

  update public.import_jobs
  set status = v_next_status,
      error_message = case
        when p_action = 'retry_requested' then error_message
        when coalesce(error_message, '') = '' then concat('Recovered by ', p_action)
        else error_message
      end,
      recovery_action = p_action,
      recovery_note = p_note,
      recovered_at = now(),
      recovered_by = v_user_id,
      retry_count = case when p_action = 'retry_requested' then coalesce(retry_count, 0) + 1 else retry_count end,
      finished_at = case when p_action in ('cancel', 'mark_failed', 'clear_stuck') then coalesce(finished_at, now()) else finished_at end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'last_recovery_action', p_action,
        'last_recovery_note', p_note,
        'last_recovered_at', now(),
        'rolled_back_normalized_rows', v_rows_normalized,
        'rolled_back_monthly_rows', v_rows_monthly,
        'rolled_back_trial_balance_rows', v_rows_trial,
        'attached_batch_previous_status', v_batch_status
      )
  where id = p_job_id;

  return jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'action', p_action,
    'status', v_next_status,
    'import_batch_id', v_job.import_batch_id,
    'batch_previous_status', v_batch_status,
    'rolled_back_rows', jsonb_build_object(
      'normalized', v_rows_normalized,
      'monthly', v_rows_monthly,
      'trial_balance', v_rows_trial
    )
  );
end;
$$;

grant execute on function public.recover_import_job(uuid, text, text) to authenticated;

-- 3) Bulk-recover active jobs that are older than the selected threshold. This clears
--    stale idempotency locks without touching any already-confirmed last-good batch.
create or replace function public.recover_stuck_import_jobs(
  p_company_id bigint default null,
  p_older_than_minutes integer default 30,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_cutoff timestamptz := now() - make_interval(mins => greatest(coalesce(p_older_than_minutes, 30), 1));
  v_job record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required to recover stuck import jobs.' using errcode = '28000';
  end if;

  for v_job in
    select id, company_id
    from public.import_jobs
    where status in ('pending', 'processing')
      and started_at < v_cutoff
      and (p_company_id is null or company_id = p_company_id)
    order by started_at asc
    limit 100
  loop
    if public.has_company_role(v_job.company_id, array['owner','admin','editor']::public.company_role[]) then
      v_result := public.recover_import_job(
        v_job.id,
        'clear_stuck',
        coalesce(p_note, concat('Auto-recovered stale import job older than ', p_older_than_minutes, ' minutes.'))
      );
      v_results := v_results || jsonb_build_array(v_result);
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'older_than_minutes', p_older_than_minutes,
    'recovered_count', v_count,
    'jobs', v_results
  );
end;
$$;

grant execute on function public.recover_stuck_import_jobs(bigint, integer, text) to authenticated;

comment on function public.recover_import_job(uuid, text, text) is
  'v1.9.3 recovery action for a single import job. Clears active locks and rejects only still-pending attached batches.';
comment on function public.recover_stuck_import_jobs(bigint, integer, text) is
  'v1.9.3 bulk recovery for stale pending/processing import jobs older than a threshold.';

notify pgrst, 'reload schema';

commit;
