import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parsePrivateWorkbook } from './privateParser.js';

function workbookFromRows(sheetName, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return wb;
}

describe('private company parser', () => {
  it('parses standardized monthly management report', () => {
    const wb = workbookFromRows('monthly', [
      ['เดือน', 'ปี', 'รายได้', 'ค่าใช้จ่าย', 'เงินสดเข้า', 'เงินสดออก', 'เงินกู้'],
      [1, 2568, 1000, 700, 900, 650, 5000],
      [2, 2568, 1200, 800, 1100, 760, 4800],
    ]);
    const result = parsePrivateWorkbook(wb, 1, 'monthly.xlsx', 'monthly_report');
    expect(result.monthlyRows).toHaveLength(2);
    expect(result.monthlyRows[0]).toMatchObject({ fiscal_year: 2025, month: 1, revenue: 1000, expense: 700 });
    expect(result.summary.monthlyRows).toBe(2);
  });

  it('parses trial balance and derives normalized rows', () => {
    const wb = workbookFromRows('tb', [
      ['รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต', 'ยอดคงเหลือ'],
      ['4000', 'รายได้จากการขาย', 0, 10000, 10000],
      ['5000', 'ต้นทุนขาย', 6000, 0, 6000],
      ['1000', 'เงินสดและรายการเทียบเท่าเงินสด', 2500, 0, 2500],
    ]);
    const result = parsePrivateWorkbook(wb, 1, 'tb.xlsx', 'trial_balance');
    expect(result.trialBalanceRows).toHaveLength(3);
    expect(result.normalizedRows.some(row => row.account_group === 'revenue' && row.amount === 10000)).toBe(true);
    expect(result.normalizedRows.some(row => row.account_group === 'cash' && row.statement_type === 'balance_sheet')).toBe(true);
  });
});
