import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_SCHEMA_VERSION, REQUIRED_MIGRATIONS, buildMissingDoctorRpcStatus, importRequiresDoctor, normalizeDoctorStatus } from './systemDoctor.js';

const supabaseSource = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/supabase.js'), 'utf8');
const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const migration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/202606230010_system_doctor_preflight.sql'), 'utf8');

describe('v1.9.6 System Doctor and RPC enforcement', () => {
  it('defines the current app schema version and required migrations through 010', () => {
    expect(APP_SCHEMA_VERSION).toBe('v1.9.6');
    expect(REQUIRED_MIGRATIONS).toContain('202606230010_system_doctor_preflight.sql');
    expect(REQUIRED_MIGRATIONS).toContain('202606230006_import_transaction_rpc.sql');
    expect(REQUIRED_MIGRATIONS).toContain('202606230009_mapping_conflict_control.sql');
  });

  it('normalizes missing doctor RPC as a blocking preflight status', () => {
    const status = buildMissingDoctorRpcStatus();
    expect(status.overall_status).toBe('blocking');
    expect(status.safe_to_import).toBe(false);
    expect(status.missing_migrations).toContain('202606230010_system_doctor_preflight.sql');
    expect(importRequiresDoctor(status)).toBe(true);
  });

  it('normalizes pass/warn/blocking counts', () => {
    const status = normalizeDoctorStatus({ checks: [
      { key: 'a', status: 'pass' },
      { key: 'b', status: 'warn', migration: 'x.sql' },
      { key: 'c', status: 'blocking', migration: 'y.sql' },
    ]});
    expect(status.counts.pass).toBe(1);
    expect(status.counts.warn).toBe(1);
    expect(status.counts.blocking).toBe(1);
    expect(status.missing_migrations).toEqual(['x.sql', 'y.sql']);
  });

  it('adds a read-only system_doctor_status RPC that checks critical v1.9.x schema pieces', () => {
    expect(migration).toContain('create or replace function public.system_doctor_status');
    expect(migration).toContain('security definer');
    expect(migration).toContain('commit_import_batch');
    expect(migration).toContain('recover_import_job');
    expect(migration).toContain('financial_metrics_snapshots');
    expect(migration).toContain('mapping_conflict_columns');
    expect(migration).toContain('grant execute on function public.system_doctor_status() to authenticated');
  });

  it('exposes System Doctor in the UI and loadSystemDoctorStatus in the Supabase adapter', () => {
    expect(appSource).toContain('SystemDoctorPage');
    expect(appSource).toContain('systemDoctor');
    expect(supabaseSource).toContain('export async function loadSystemDoctorStatus');
    expect(supabaseSource).toContain("client.rpc('system_doctor_status'");
  });

  it('blocks import when commit_import_batch RPC is missing instead of using the legacy fallback', () => {
    expect(supabaseSource).toContain('Import transaction RPC is required in v1.9.6');
    expect(supabaseSource).not.toContain('Compatibility fallback for databases that have not run v1.9.2 yet.');
    expect(supabaseSource).not.toContain('usedRpc: false');
  });
});
