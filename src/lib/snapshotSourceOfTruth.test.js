import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { flattenMetricSnapshotRows, READINESS_STATUSES } from './accountingEngine.js';

describe('v1.9.4 metric snapshot source of truth', () => {
  it('flattens reported, supporting detail, and validation metrics into one snapshot payload', () => {
    const rows = flattenMetricSnapshotRows({
      importBatchId: 'batch-1',
      snapshotRunId: '11111111-1111-4111-8111-111111111111',
      summary: {
        company_id: 1,
        fiscal_year: 2023,
        period: 'FY',
        period_type: 'annual',
        statement_scope: 'consolidated',
        readiness_status: READINESS_STATUSES.EXPORT_READY,
        readiness_score: 92,
      },
      bucket: {
        metrics: { revenue: { amount: 100, source_type: 'reported_total', source_rows: ['r1'] } },
        detail: { cogs: { amount: 60, source_type: 'detail_sum', source_rows: ['r2', 'r3'] } },
        validation: { asset: { amount: 500, source_type: 'validation_total', source_rows: ['r4'] } },
      },
    });
    const byKey = Object.fromEntries(rows.map((row) => [row.metric_key, row]));
    expect(byKey.revenue.metric_value).toBe(100);
    expect(byKey.cogs.metric_value).toBe(60);
    expect(byKey.asset.metric_value).toBe(500);
    expect(byKey.revenue.is_current).toBe(true);
    expect(byKey.cogs.snapshot_run_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('uses financial_metrics_snapshots as the loadAllFinancialData primary source', () => {
    const source = readFileSync(new URL('./supabase.js', import.meta.url), 'utf8');
    expect(source).toContain('Dashboard/Export should use financial_metrics_snapshots as the');
    expect(source).toContain('loadAllMetricSnapshotData');
    expect(source).toContain('financial_metrics_snapshots');
    expect(source).toContain('Snapshot source-of-truth unavailable; falling back to raw stores.');
  });

  it('installs a current-only unique index so superseded snapshots remain auditable', () => {
    const migration = readFileSync(new URL('../../supabase/migrations/202606230008_metric_snapshot_source_of_truth.sql', import.meta.url), 'utf8');
    expect(migration).toContain('idx_financial_metric_current_unique');
    expect(migration).toContain('where is_current = true');
    expect(migration).toContain('drop constraint');
    expect(migration).toContain('source of truth for Dashboard and Excel Export');
  });
});
