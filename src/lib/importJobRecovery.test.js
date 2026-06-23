import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifyImportJob } from './supabase.js';

const migration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/202606230007_import_job_recovery_center.sql'), 'utf8');
const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const supabaseSource = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/supabase.js'), 'utf8');

describe('v1.9.3 import job recovery center', () => {
  it('adds recovery RPCs without deleting confirmed financial rows', () => {
    expect(migration).toContain('create or replace function public.recover_import_job');
    expect(migration).toContain('create or replace function public.recover_stuck_import_jobs');
    expect(migration).toContain("v_batch_status = 'pending'");
    expect(migration).toContain("import_status = 'rolled_back'");
    expect(migration).not.toMatch(/delete\s+from\s+public\.(normalized_financial_data|monthly_operating_data|trial_balance_data)/i);
  });

  it('protects successful jobs and checks company role before recovery', () => {
    expect(migration).toContain("v_job.status = 'success'");
    expect(migration).toContain('Successful import jobs cannot be cancelled');
    expect(migration).toContain('public.has_company_role');
    expect(migration).toContain("array['owner','admin','editor']");
  });

  it('exposes import job monitor and recovery functions in the frontend', () => {
    expect(supabaseSource).toContain('export async function loadImportJobs');
    expect(supabaseSource).toContain('export async function recoverImportJob');
    expect(supabaseSource).toContain('export async function recoverStuckImportJobs');
    expect(appSource).toContain('function ImportJobsPage');
    expect(appSource).toContain('Recover Stuck');
    expect(appSource).toContain('Clear Lock');
  });

  it('classifies stale active jobs as needing recovery', () => {
    const old = new Date(Date.now() - 45 * 60000).toISOString();
    const job = classifyImportJob({ status: 'processing', started_at: old }, { staleMinutes: 30 });
    expect(job.active).toBe(true);
    expect(job.stale).toBe(true);
    expect(job.needs_recovery).toBe(true);
    expect(job.recovery_hint).toBe('stuck_active_job');
  });
});
