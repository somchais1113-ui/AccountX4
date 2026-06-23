import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/supabase.js'), 'utf8');
const importRpcMigration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/202606230006_import_transaction_rpc.sql'), 'utf8');

describe('import transaction safety regression checks', () => {
  it('keeps new imports pending in the frontend payload and delegates promotion/confirmation to the transaction RPC', () => {
    expect(source).toContain("status: 'pending'");
    expect(source).toContain("import_status: 'pending'");
    expect(source).toContain("client.rpc('commit_import_batch'");
    expect(importRpcMigration).toContain("set import_status = 'confirmed'");
    expect(importRpcMigration).toContain("status = 'success'");
  });

  it('does not use an undefined excludeBatchId when superseding monthly/trial-balance batches', () => {
    expect(source).toContain('async function markPreviousDataTableImportBatchesSuperseded(client, tableName, applyFilters, excludeBatchId = null)');
    expect(source).not.toMatch(/function markPreviousDataTableImportBatchesSuperseded\(client, tableName, applyFilters\) \{[\s\S]*excludeBatchId/);
  });

  it('does not use the old frontend monthly/trial-balance supersede-before-insert patterns', () => {
    expect(source).not.toContain('const deleteKeys = new Set(monthlyRows');
    expect(source).not.toContain('const deleteYears = new Set(trialBalanceRows');
    expect(source).not.toContain('const replaceMonthlyKeys = new Set(monthlyRows');
    expect(source).not.toContain('const replaceTrialKeys = new Set(trialBalanceRows');
    expect(source).toContain('buildMonthlyImportPayload');
    expect(source).toContain('buildTrialBalanceImportPayload');
  });

  it('relies on the database RPC transaction for failed-import rollback instead of frontend partial cleanup', () => {
    expect(source).toContain('Import transaction RPC is required in v1.9.6');
    expect(source).not.toContain("await cleanupFailedImportBatch(client, batch.id)");
    expect(importRpcMigration).toContain("create or replace function public.commit_import_batch");
    expect(importRpcMigration).toContain("raise exception");
  });

  it('does not auto-reuse high-risk accounting labels as approved mapping memory', () => {
    expect(source).toContain('function isHighRiskMappingLabel');
    expect(source).toContain('High-risk accounting term requires manual review before approved mapping can be reused.');
    expect(source).toContain('row_only_manual_approval');
  });

  it('approves mapping rows by exact normalized row id when available', () => {
    expect(source).toContain('normalizedFinancialDataId = null');
    expect(source).toContain("return query.eq('id', normalizedFinancialDataId)");
    expect(source).toContain('normalized_financial_data_id: normalizedFinancialDataId || null');
  });

  it('rebuilds readiness per confirmed batch instead of creating company-level null batch snapshots', () => {
    expect(source).toContain('Company/all rebuild must not create metric snapshots with import_batch_id = null.');
    expect(source).toContain("await rebuildAccountingReadiness({ companyId, batchId: id, strictAnnual })");
  });

  it('bulk mapping approval skips per-row rebuild and rebuilds each affected batch once', () => {
    expect(source).toContain('skipReadinessRebuild = false');
    expect(source).toContain('skipReadinessRebuild: true');
    expect(source).toContain('affectedBatchIds');
    expect(source).toContain('Readiness rebuild failed after bulk approval');
  });

  it('uses explicit mapping decisions as scoped reusable memory before legacy account_mappings', () => {
    expect(source).toContain('async function loadApprovedMappingDecisions');
    expect(source).toContain(".from('mapping_decisions')");
    expect(source).toContain('approved_mapping_decision');
  });

  it('requires the v1.9.2+ RPC commit path and does not silently fall back to the legacy multi-request save flow', () => {
    expect(source).toContain("client.rpc('commit_import_batch'");
    expect(source).toContain('tryCommitImportBatchViaRpc');
    expect(source).toContain('Import transaction RPC is required in v1.9.6');
    expect(source).not.toContain('Compatibility fallback for databases that have not run v1.9.2 yet.');
    expect(source).toContain('usedRpc: true');
    expect(source).not.toContain('usedRpc: false');
  });

  it('sends all private import table payloads to the atomic commit RPC', () => {
    expect(source).toContain('buildMonthlyImportPayload');
    expect(source).toContain('buildTrialBalanceImportPayload');
    expect(source).toContain('p_monthly_rows: monthlyRows');
    expect(source).toContain('p_trial_balance_rows: trialBalanceRows');
  });

});
