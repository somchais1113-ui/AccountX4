export const APP_SCHEMA_VERSION = 'v1.9.6';
export const REQUIRED_MIGRATIONS = [
  '202606230002_export_security_hardening.sql',
  '202606230003_tfrs_standards_layer.sql',
  '202606230004_accounting_engine_foundation.sql',
  '202606230005_readiness_gate.sql',
  '202606230006_import_transaction_rpc.sql',
  '202606230007_import_job_recovery_center.sql',
  '202606230008_metric_snapshot_source_of_truth.sql',
  '202606230009_mapping_conflict_control.sql',
  '202606230010_system_doctor_preflight.sql',
];

export const SYSTEM_DOCTOR_CHECKS = [
  { key: 'core_tables', label: 'Core import tables', migration: '202606210001_normalized_schema.sql' },
  { key: 'accounting_engine_tables', label: 'Accounting engine tables', migration: '202606230004_accounting_engine_foundation.sql' },
  { key: 'readiness_gate_columns', label: 'Readiness gate columns', migration: '202606230005_readiness_gate.sql' },
  { key: 'import_transaction_rpc', label: 'Import transaction RPC', migration: '202606230006_import_transaction_rpc.sql' },
  { key: 'import_job_recovery_rpc', label: 'Import job recovery RPC', migration: '202606230007_import_job_recovery_center.sql' },
  { key: 'snapshot_source_of_truth_columns', label: 'Snapshot source-of-truth columns', migration: '202606230008_metric_snapshot_source_of_truth.sql' },
  { key: 'mapping_conflict_columns', label: 'Mapping conflict columns', migration: '202606230009_mapping_conflict_control.sql' },
  { key: 'system_doctor_rpc', label: 'System Doctor RPC', migration: '202606230010_system_doctor_preflight.sql' },
];

export function normalizeDoctorStatus(payload = {}) {
  const rawChecks = Array.isArray(payload.checks) ? payload.checks : [];
  const checks = rawChecks.map((check) => ({
    key: String(check.key || check.check_key || 'unknown'),
    label: check.label || check.name || check.key || 'Unknown check',
    status: check.status || (check.ok === true ? 'pass' : 'blocking'),
    ok: check.ok === true || check.status === 'pass',
    severity: check.severity || (check.status === 'pass' ? 'info' : check.status === 'warn' ? 'warning' : 'blocking'),
    message: check.message || '',
    migration: check.migration || check.required_migration || null,
    details: check.details || null,
  }));
  const counts = checks.reduce((acc, check) => {
    const key = check.status === 'pass' ? 'pass' : check.status === 'warn' ? 'warn' : 'blocking';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { pass: 0, warn: 0, blocking: 0 });
  const overall = payload.overall_status || (counts.blocking ? 'blocking' : counts.warn ? 'warning' : 'pass');
  return {
    app_schema_version: payload.app_schema_version || APP_SCHEMA_VERSION,
    database_schema_version: payload.database_schema_version || null,
    checked_at: payload.checked_at || new Date().toISOString(),
    overall_status: overall,
    safe_to_import: payload.safe_to_import ?? overall === 'pass',
    safe_to_export: payload.safe_to_export ?? !counts.blocking,
    counts,
    checks,
    required_migrations: payload.required_migrations || REQUIRED_MIGRATIONS,
    missing_migrations: Array.from(new Set(checks.filter(check => check.status !== 'pass' && check.migration).map(check => check.migration))),
  };
}

export function buildMissingDoctorRpcStatus(message = '') {
  return normalizeDoctorStatus({
    app_schema_version: APP_SCHEMA_VERSION,
    overall_status: 'blocking',
    safe_to_import: false,
    safe_to_export: false,
    checks: [
      {
        key: 'system_doctor_rpc',
        label: 'System Doctor RPC',
        status: 'blocking',
        severity: 'blocking',
        migration: '202606230010_system_doctor_preflight.sql',
        message: message || 'System Doctor RPC is not installed. Run migration 202606230010_system_doctor_preflight.sql.',
      },
      {
        key: 'import_transaction_rpc',
        label: 'Import transaction RPC enforcement',
        status: 'blocking',
        severity: 'blocking',
        migration: '202606230006_import_transaction_rpc.sql',
        message: 'Import save is blocked until database schema is verified. Run System Doctor after applying migrations.',
      },
    ],
  });
}

export function summarizeDoctor(status = {}) {
  const normalized = normalizeDoctorStatus(status);
  return {
    label: normalized.overall_status === 'pass' ? 'PASS' : normalized.overall_status === 'warning' ? 'WARNING' : 'BLOCKED',
    color: normalized.overall_status === 'pass' ? 'green' : normalized.overall_status === 'warning' ? 'amber' : 'red',
    text: normalized.overall_status === 'pass'
      ? 'Database schema matches the app requirements.'
      : normalized.overall_status === 'warning'
        ? 'Database schema is usable but has warnings that should be reviewed.'
        : 'Database schema is behind the app version. Import/export actions should be blocked until migrations are applied.',
  };
}

export function importRequiresDoctor(status = {}) {
  const normalized = normalizeDoctorStatus(status);
  return !normalized.safe_to_import || normalized.overall_status === 'blocking';
}
