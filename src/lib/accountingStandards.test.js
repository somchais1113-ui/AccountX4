import { describe, expect, test } from 'vitest';
import { applyTfrsStandardMetadata, evaluateTfrsDataQuality, inferAccountingStandardProfile } from './accountingStandards.js';

describe('TFRS standards layer', () => {
  test('classifies private companies as TFRS_NPAE', () => {
    expect(inferAccountingStandardProfile({ companyMode: 'private', legalEntityType: 'limited_company' })).toBe('TFRS_NPAE');
    expect(inferAccountingStandardProfile({ companyMode: 'public', tickerSymbol: 'CPF' })).toBe('TFRS_PAE');
  });

  test('adds NPAE standard reference to common Thai account labels', () => {
    const mapping = applyTfrsStandardMetadata({
      label: 'สินค้าคงเหลือ',
      statementType: 'balance_sheet',
      mapping: { group: 'inventory', subgroup: 'inventory', confidence: 0.9, mapping_source: 'parser_rule' },
      row: { company_mode: 'private', legal_entity_type: 'limited_company' },
    });
    expect(mapping.standard_ref).toBe('TFRS_NPAE_CH8');
    expect(mapping.standard_label_th).toContain('สินค้าคงเหลือ');
  });

  test('detects TFRS 10 and TFRS 3 special signals', () => {
    const nci = applyTfrsStandardMetadata({
      label: 'ส่วนได้เสียที่ไม่มีอำนาจควบคุม',
      statementType: 'balance_sheet',
      mapping: { group: 'other', confidence: 0.4, mapping_source: 'unknown' },
    });
    expect(nci.consolidation_indicator).toBe('non_controlling_interest');

    const goodwill = applyTfrsStandardMetadata({
      label: 'ค่าความนิยม',
      statementType: 'balance_sheet',
      mapping: { group: 'goodwill', confidence: 0.9, mapping_source: 'parser_rule' },
    });
    expect(goodwill.business_combination_indicator).toBe('goodwill');
  });

  test('data quality score penalizes missing core metrics', () => {
    const quality = evaluateTfrsDataQuality([
      { account_group: 'revenue', standard_ref: 'TFRS_NPAE_CH18', mapping_confidence: 0.95, needs_review: false },
    ]);
    expect(quality.score).toBeLessThan(100);
    expect(quality.missing_core_metrics).toContain('asset');
  });
});
