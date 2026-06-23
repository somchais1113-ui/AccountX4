import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/202606230006_import_transaction_rpc.sql'), 'utf8');

describe('v1.9.2 import transaction RPC migration', () => {
  it('creates an atomic commit_import_batch RPC with an active import lock', () => {
    expect(migration).toContain('create table if not exists public.import_jobs');
    expect(migration).toContain('create unique index import_jobs_active_key_idx');
    expect(migration).toContain('create or replace function public.commit_import_batch');
    expect(migration).toContain('security definer');
    expect(migration).toContain('public.has_company_role');
  });

  it('supersedes old rows inside the RPC before promoting new rows to confirmed', () => {
    const supersedeIndex = migration.indexOf("set import_status = 'superseded'");
    const promoteIndex = migration.indexOf("set import_status = 'confirmed'");
    expect(supersedeIndex).toBeGreaterThan(0);
    expect(promoteIndex).toBeGreaterThan(supersedeIndex);
    expect(migration).toContain("status = 'success'");
  });

  it('removes the old full monthly unique constraint and replaces it with active confirmed uniqueness', () => {
    expect(migration).toContain('drop constraint if exists monthly_operating_data_company_id_fiscal_year_month_key');
    expect(migration).toContain('monthly_operating_one_confirmed_row_idx');
    expect(migration).toContain("where import_status = 'confirmed'");
  });
});
