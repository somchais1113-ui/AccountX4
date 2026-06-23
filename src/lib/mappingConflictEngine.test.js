import { describe, it, expect } from 'vitest';
import {
  detectHighRiskAccountingTerms,
  evaluateMappingConflict,
  isSafeForBulkConfirm,
  isReusableMappingDecision,
  summarizeMappingConflicts,
} from './mappingConflictEngine.js';
import { analyzeMappingRowSafety, enrichRowSemantics, buildReadinessBundle } from './accountingEngine.js';

describe('v1.9.5 Mapping Conflict Detector + Approval Control', () => {
  it('does not allow OCI tax to become safe_auto tax', () => {
    const row = enrichRowSemantics({
      raw_account_name: 'ภาษีเงินได้ของรายการที่จะไม่จัดประเภทใหม่ไปยังกำไรหรือขาดทุนในภายหลัง',
      account_group: 'tax',
      statement_type: 'income_statement',
      mapping_confidence: 0.97,
    });
    const result = evaluateMappingConflict(row);
    expect(row.account_group).toBe('oci_tax');
    expect(result.approval_policy).toBe('manual_required');
    expect(isSafeForBulkConfirm(row, result)).toBe(false);
    expect(analyzeMappingRowSafety(row).safe).toBe(false);
  });

  it('forces goodwill and business combination items into manual review', () => {
    const row = enrichRowSemantics({
      raw_account_name: 'ค่าความนิยมจากการรวมธุรกิจ',
      account_group: 'goodwill',
      statement_type: 'balance_sheet',
      mapping_confidence: 0.98,
    });
    const result = evaluateMappingConflict(row);
    expect(detectHighRiskAccountingTerms(row).hasHighRiskTerm).toBe(true);
    expect(result.approval_policy).toBe('manual_required');
    expect(result.conflict_reasons).toContain('business_combination_goodwill_risk');
  });

  it('forces NCI items into manual review', () => {
    const row = enrichRowSemantics({
      raw_account_name: 'ส่วนได้เสียที่ไม่มีอำนาจควบคุม',
      account_group: 'non_controlling_interests',
      statement_type: 'balance_sheet',
      mapping_confidence: 0.98,
    });
    const result = evaluateMappingConflict(row);
    expect(result.approval_policy).toBe('manual_required');
    expect(result.conflict_reasons.join(',')).toMatch(/consolidation|nci|high_risk/i);
  });

  it('detects previous approved mapping conflicts for the same raw account', () => {
    const row = enrichRowSemantics({
      raw_account_name: 'ภาษีเงินได้',
      account_group: 'tax',
      statement_type: 'income_statement',
      statement_scope: 'consolidated',
      accounting_standard_profile: 'TFRS_PAE',
      line_role: 'detail',
      mapping_confidence: 0.95,
    });
    const previousDecisions = [{
      raw_account_name: 'ภาษีเงินได้',
      statement_type: 'income_statement',
      statement_scope: 'consolidated',
      accounting_standard_profile: 'TFRS_PAE',
      line_role: 'detail',
      account_group: 'oci_tax',
      reusable: true,
      reuse_scope: 'company_standard_scope',
    }];
    const result = evaluateMappingConflict(row, { previousDecisions });
    expect(result.conflict_status).toBe('confirmed_conflict');
    expect(result.approval_policy).toBe('manual_required');
  });

  it('keeps ordinary high-confidence detail rows safe for bulk confirm', () => {
    const row = enrichRowSemantics({
      raw_account_name: 'ต้นทุนขาย',
      account_group: 'cogs',
      statement_type: 'income_statement',
      line_role: 'detail',
      mapping_confidence: 0.96,
    });
    const result = evaluateMappingConflict(row);
    expect(result.approval_policy).toBe('safe_auto');
    expect(isSafeForBulkConfirm(row, result)).toBe(true);
  });

  it('prevents subtotal/total rows from bulk confirm', () => {
    const row = enrichRowSemantics({
      raw_account_name: 'รวมค่าใช้จ่าย',
      account_group: 'expense',
      statement_type: 'income_statement',
      mapping_confidence: 0.97,
    });
    const result = evaluateMappingConflict(row);
    expect(result.approval_policy).toBe('manual_required');
    expect(isSafeForBulkConfirm(row, result)).toBe(false);
  });

  it('does not reuse row-only manual mapping decisions', () => {
    expect(isReusableMappingDecision({
      raw_account_name: 'ค่าความนิยม',
      account_group: 'goodwill',
      decision_method: 'row_only_manual_approval',
      reusable: false,
      reuse_scope: 'row_only',
    })).toBe(false);
  });

  it('summarizes conflicts for Data Quality and Export', () => {
    const rows = [
      { conflict_status: 'none', approval_policy: 'safe_auto' },
      { conflict_status: 'high_risk_term', approval_policy: 'manual_required' },
      { conflict_status: 'blocked', approval_policy: 'blocked' },
    ];
    const summary = summarizeMappingConflicts(rows);
    expect(summary.conflict_count).toBe(2);
    expect(summary.manual_required_count).toBe(1);
    expect(summary.blocked_count).toBe(1);
  });

  it('reduces readiness when unresolved mapping conflicts exist', () => {
    const rows = [
      { id: 'rev', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมรายได้', account_group: 'revenue', statement_type: 'income_statement', amount: 1000, mapping_confidence: 1, needs_review: false },
      { id: 'np', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'กำไรสุทธิ', account_group: 'net_profit', statement_type: 'income_statement', amount: 100, mapping_confidence: 1, needs_review: false },
      { id: 'a', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมสินทรัพย์', account_group: 'asset', statement_type: 'balance_sheet', amount: 1000, mapping_confidence: 1, needs_review: false },
      { id: 'l', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมหนี้สิน', account_group: 'liability', statement_type: 'balance_sheet', amount: 400, mapping_confidence: 1, needs_review: false },
      { id: 'e', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'รวมส่วนของผู้ถือหุ้น', account_group: 'equity', statement_type: 'balance_sheet', amount: 600, mapping_confidence: 1, needs_review: false },
      { id: 'g', company_id: 1, fiscal_year: 2023, period: 'FY', period_type: 'annual', statement_scope: 'consolidated', raw_account_name: 'ค่าความนิยมจากการรวมธุรกิจ', account_group: 'goodwill', statement_type: 'balance_sheet', amount: 50, mapping_confidence: 1, needs_review: true },
    ].map((row) => enrichRowSemantics(row));
    const bundle = buildReadinessBundle(rows);
    expect(bundle.summaries[0].export_ready).toBe(false);
    expect(bundle.summaries[0].mapping_conflict_summary.conflict_count).toBeGreaterThan(0);
  });
});
