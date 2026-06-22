import { describe, it, expect } from 'vitest';
import { buildFinancialExcelWorkbook } from './exportExcel.js';

const baseOpts = (groups, extra = {}) => ({
  company: { id: 1, nameEn: 'Test Co', nameTh: 'บริษัท ทดสอบ', tickerSymbol: 'TEST' },
  companyId: 1,
  store: { 1: { 2024: { FY: { groups } } } },
  years: [2024],
  importBatches: [{ id: 'b1', file_name: 'test.xlsx', fiscal_year: 2024, status: 'confirmed', total_rows: 10, review_count: 0 }],
  rawRows: [{ fiscal_year: 2024, raw_account_name: 'รายได้', account_group: 'revenue', amount: 1000 }],
  mappingRows: [],
  language: 'en',
  unit: 'baht',
  ...extra,
});

describe('Excel export workbook', () => {
  it('builds analyst pack sheets from normalized store', () => {
    const wb = buildFinancialExcelWorkbook(baseOpts({ revenue: 1000, cogs: 400, net_profit: 200, asset: 5000, liability: 3000, equity: 2000 }));
    expect(wb.SheetNames).toContain('Cover');
    expect(wb.SheetNames).toContain('Income Statement');
    expect(wb.SheetNames).toContain('Integrity Checks');
    expect(wb.SheetNames).toContain('Data Lineage');
  });

  it('flags a balance-sheet imbalance', () => {
    // asset != liability + equity -> integrity issue
    const wb = buildFinancialExcelWorkbook(baseOpts({ revenue: 1000, net_profit: 200, asset: 5000, liability: 3000, equity: 1000 }));
    expect(wb._integrity.hasIntegrityIssue).toBe(true);
  });

  it('passes a balanced sheet', () => {
    const wb = buildFinancialExcelWorkbook(baseOpts({ revenue: 1000, net_profit: 200, asset: 5000, liability: 3000, equity: 2000 }));
    expect(wb._integrity.hasIntegrityIssue).toBe(false);
  });

  it('does not double-count revenue when a real total exists alongside detail lines', () => {
    // Real total revenue=1000; detail sales_revenue=900 + other_income=100 also present.
    // getMetrics must use the total (1000), not 1000+900+100.
    const wb = buildFinancialExcelWorkbook(baseOpts(
      { revenue: 1000, sales_revenue: 900, other_income: 100, net_profit: 200, asset: 5000, liability: 3000, equity: 2000 }
    ));
    const ws = wb.Sheets['Income Statement'];
    // Header row index 3 (0-based), first metric row (Total revenue) at row 4, value col B = 1.
    const cell = ws['B5'];
    expect(cell.v).toBe(1000);
  });

  it('derives revenue from detail lines only when total is missing', () => {
    const wb = buildFinancialExcelWorkbook(baseOpts(
      { sales_revenue: 900, other_income: 100, net_profit: 200, asset: 5000, liability: 3000, equity: 2000 }
    ));
    const ws = wb.Sheets['Income Statement'];
    expect(ws['B5'].v).toBe(1000);
  });

  it('does not silently use Q data when FY is missing in strict annual export', () => {
    const wb = buildFinancialExcelWorkbook({
      ...baseOpts({}, { store: { 1: { 2024: { Q1: { groups: { revenue: 250, asset: 1000, liability: 400, equity: 600 } } } } } }),
      years: [2024],
      strictAnnual: true,
    });
    expect(wb._integrity.hasIntegrityIssue).toBe(true);
    const ws = wb.Sheets['Integrity Checks'];
    expect(ws['C4'].v).toBe('FAIL');
  });

  it('can rebuild export metrics from exact batch rows instead of stale frontend store', () => {
    const wb = buildFinancialExcelWorkbook({
      ...baseOpts({ revenue: 1, net_profit: 1, asset: 1, liability: 1, equity: 0 }),
      years: [2024],
      normalizedRows: [
        { company_id: 1, fiscal_year: 2024, period: 'FY', account_group: 'revenue', amount: 5000, import_status: 'confirmed', import_batch_id: 'b1' },
        { company_id: 1, fiscal_year: 2024, period: 'FY', account_group: 'net_profit', amount: 800, import_status: 'confirmed', import_batch_id: 'b1' },
        { company_id: 1, fiscal_year: 2024, period: 'FY', account_group: 'asset', amount: 9000, import_status: 'confirmed', import_batch_id: 'b1' },
        { company_id: 1, fiscal_year: 2024, period: 'FY', account_group: 'liability', amount: 4000, import_status: 'confirmed', import_batch_id: 'b1' },
        { company_id: 1, fiscal_year: 2024, period: 'FY', account_group: 'equity', amount: 5000, import_status: 'confirmed', import_batch_id: 'b1' },
      ],
    });
    const ws = wb.Sheets['Income Statement'];
    expect(ws['B5'].v).toBe(5000);
  });

});
