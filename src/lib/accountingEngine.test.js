import { describe, it, expect } from 'vitest';
import {
  enrichRowSemantics,
  analyzeMappingRowSafety,
  groupMappingRows,
  runValidationEngine,
  buildFinancialMetricsFromRows,
  buildReadinessBundle,
  deriveReadinessGate,
  READINESS_STATUSES,
} from './accountingEngine.js';

describe('Accounting Engine Foundation v1.9.0', () => {
  it('flags total expense lines to prevent double-counting', () => {
    const row = enrichRowSemantics({ raw_account_name: 'รวมค่าใช้จ่าย', account_group: 'expense', statement_type: 'income_statement', mapping_confidence: 0.95, amount: 100 });
    expect(row.line_role).toBe('grand_total');
    expect(row.risk_flags).toContain('double_count_guard');
    expect(analyzeMappingRowSafety(row).safe).toBe(false);
  });

  it('separates OCI tax from regular income tax', () => {
    const row = enrichRowSemantics({ raw_account_name: 'ภาษีเงินได้ของรายการที่จะไม่จัดประเภทใหม่ไปยังกำไรหรือขาดทุนในภายหลัง', account_group: 'tax', statement_type: 'income_statement', mapping_confidence: 0.92, amount: -100 });
    expect(row.account_group).toBe('oci_tax');
    expect(row.line_role).toBe('oci');
    expect(row.risk_flags).toContain('tax_not_regular_income_tax');
    expect(row.needs_review).toBe(true);
  });

  it('marks ordinary high-confidence detail rows as safe', () => {
    const row = { id: 1, raw_account_name: 'ต้นทุนขาย', account_group: 'cogs', suggested_account_group: 'cogs', statement_type: 'income_statement', mapping_confidence: 0.94, amount: 500 };
    const safety = analyzeMappingRowSafety(row, 'cogs');
    expect(safety.safe).toBe(true);
    expect(safety.lineRole).toBe('detail');
  });

  it('groups duplicate accounts across years for bulk review', () => {
    const rows = [
      { id: 'a', company_id: 1, fiscal_year: 2022, raw_account_name: 'ต้นทุนขาย', account_group: 'cogs', suggested_account_group: 'cogs', statement_type: 'income_statement', mapping_confidence: 0.94 },
      { id: 'b', company_id: 1, fiscal_year: 2023, raw_account_name: 'ต้นทุนขาย', account_group: 'cogs', suggested_account_group: 'cogs', statement_type: 'income_statement', mapping_confidence: 0.94 },
    ];
    const groups = groupMappingRows(rows, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].row_count).toBe(2);
    expect(groups[0].safe_to_bulk_confirm).toBe(true);
  });

  it('builds metrics using reported total instead of detail sum when total exists', () => {
    const rows = [
      { id: 'rev', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมรายได้', account_group: 'revenue', statement_type: 'income_statement', amount: 1000, mapping_confidence: 0.95 },
      { id: 'sales', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รายได้จากการขาย', account_group: 'sales_revenue', statement_type: 'income_statement', amount: 800, mapping_confidence: 0.95 },
      { id: 'other', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รายได้อื่น', account_group: 'other_income', statement_type: 'income_statement', amount: 200, mapping_confidence: 0.95 },
    ];
    const buckets = buildFinancialMetricsFromRows(rows);
    const bucket = Object.values(buckets)[0];
    expect(bucket.metrics.revenue.amount).toBe(1000);
    expect(bucket.metrics.revenue.source_type).toBe('reported_total');
  });

  it('validates balance sheet equation', () => {
    const rows = [
      { id: 'a', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมสินทรัพย์', account_group: 'asset', statement_type: 'balance_sheet', amount: 1000, mapping_confidence: 0.95 },
      { id: 'l', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมหนี้สิน', account_group: 'liability', statement_type: 'balance_sheet', amount: 400, mapping_confidence: 0.95 },
      { id: 'e', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมส่วนของผู้ถือหุ้น', account_group: 'equity', statement_type: 'balance_sheet', amount: 600, mapping_confidence: 0.95 },
    ];
    const validation = runValidationEngine(rows);
    expect(validation.results.find(r => r.validation_type === 'balance_sheet_equation').severity).toBe('pass');
  });

  it('marks a complete validated batch as export ready', () => {
    const rows = [
      { id: 'rev', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมรายได้', account_group: 'revenue', statement_type: 'income_statement', amount: 1000, mapping_confidence: 1, needs_review: false },
      { id: 'np', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'กำไรสุทธิ', account_group: 'net_profit', statement_type: 'income_statement', amount: 100, mapping_confidence: 1, needs_review: false },
      { id: 'a', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมสินทรัพย์', account_group: 'asset', statement_type: 'balance_sheet', amount: 1000, mapping_confidence: 1, needs_review: false },
      { id: 'l', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมหนี้สิน', account_group: 'liability', statement_type: 'balance_sheet', amount: 400, mapping_confidence: 1, needs_review: false },
      { id: 'e', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมส่วนของผู้ถือหุ้น', account_group: 'equity', statement_type: 'balance_sheet', amount: 600, mapping_confidence: 1, needs_review: false },
    ];
    const bundle = buildReadinessBundle(rows);
    expect(bundle.summaries[0].readiness_status).toBe(READINESS_STATUSES.EXTERNAL_USE_READY);
    expect(bundle.summaries[0].export_ready).toBe(true);
  });

  it('blocks export readiness when a core metric is missing', () => {
    const gate = deriveReadinessGate({ bucket: { metrics: { revenue: { amount: 100 } }, rows: [] }, validationResults: [] });
    expect(gate.dashboard_ready).toBe(false);
    expect(gate.export_ready).toBe(false);
    expect(gate.missing_core_metrics).toContain('asset');
  });

});
