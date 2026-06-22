import { describe, it, expect } from 'vitest';
import { buildFinancialExcelWorkbook } from './exportExcel.js';

describe('Excel export workbook', () => {
  it('builds analyst pack sheets from normalized store', () => {
    const wb = buildFinancialExcelWorkbook({
      company: { id: 1, nameEn: 'Test Co', nameTh: 'บริษัท ทดสอบ', tickerSymbol: 'TEST' },
      companyId: 1,
      store: { 1: { 2024: { FY: { groups: { revenue: 1000, cogs: 400, net_profit: 200, asset: 5000, liability: 3000, equity: 2000 } } } } },
      years: [2024],
      importBatches: [{ id: 'b1', file_name: 'test.xlsx', fiscal_year: 2024, status: 'confirmed', total_rows: 10, review_count: 0 }],
      rawRows: [{ fiscal_year: 2024, raw_account_name: 'รายได้', account_group: 'revenue', amount: 1000 }],
      mappingRows: [],
      language: 'en',
      unit: 'baht',
    });
    expect(wb.SheetNames).toContain('Cover');
    expect(wb.SheetNames).toContain('Income Statement');
    expect(wb.SheetNames).toContain('Data Lineage');
  });
});
