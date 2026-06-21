import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { extractPeriodInfo, parseFinancialWorkbook } from './parser.js';

function makeWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['บริษัท ตัวอย่าง จำกัด (มหาชน)'],
    ['งบฐานะการเงิน'],
    ['ณ วันที่ 31 ธันวาคม พ.ศ. 2568'],
    [],
    [null, null, null, null, null, 'พ.ศ. 2568', null, 'พ.ศ. 2567'],
    [null, null, null, 'หมายเหตุ', null, 'บาท', null, 'บาท'],
    ['สินทรัพย์'],
    ['สินทรัพย์หมุนเวียน'],
    ['เงินสดและรายการเทียบเท่าเงินสด', null, null, '9', null, 150, null, 100],
    ['รวมสินทรัพย์', null, null, null, null, 500, null, 400],
    ['หนี้สินและส่วนของเจ้าของ'],
    ['รวมหนี้สิน', null, null, null, null, 200, null, 180],
    ['รวมส่วนของเจ้าของ', null, null, null, null, 300, null, 220],
  ]), 'TH 6-8');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['บริษัท ตัวอย่าง จำกัด (มหาชน)'],
    ['งบกำไรขาดทุนเบ็ดเสร็จ'],
    ['สำหรับปีสิ้นสุดวันที่ 31 ธันวาคม พ.ศ. 2568'],
    [],
    [null, null, null, null, null, 'พ.ศ. 2568', null, 'พ.ศ. 2567'],
    [null, null, null, 'หมายเหตุ', null, 'บาท', null, 'บาท'],
    ['รายได้'],
    ['รายได้จากการขายและการให้บริการ', null, null, null, null, 900, null, 800],
    ['รวมรายได้', null, null, null, null, 950, null, 850],
    ['ค่าใช้จ่าย'],
    ['ต้นทุนขายและการให้บริการ', null, null, null, null, -400, null, -350],
    ['ค่าใช้จ่ายในการบริหาร', null, null, null, null, -100, null, -90],
    ['ต้นทุนทางการเงิน', null, null, '27', null, -20, null, -15],
    ['กำไรก่อนภาษีเงินได้', null, null, null, null, 430, null, 395],
    ['ค่าใช้จ่ายภาษีเงินได้', null, null, '29', null, -86, null, -79],
    ['กําไรสุทธิสําหรับปี', null, null, null, null, 344, null, 316],
  ]), 'TH 9-10');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['บริษัท ตัวอย่าง จำกัด (มหาชน)'],
    ['งบกระแสเงินสด'],
    ['สำหรับปีสิ้นสุดวันที่ 31 ธันวาคม พ.ศ. 2568'],
    [],
    [null, null, null, null, null, 'พ.ศ. 2568', null, 'พ.ศ. 2567'],
    [null, null, null, 'หมายเหตุ', null, 'บาท', null, 'บาท'],
    ['กระแสเงินสดจากกิจกรรมดำเนินงาน'],
    ['เงินสดสุทธิได้มาจากกิจกรรมดําเนินงาน', null, null, null, null, 300, null, 250],
    ['กระแสเงินสดจากกิจกรรมลงทุน'],
    [null, 'เงินสดจ่ายเพื่อซื้อสินทรัพย์ทางการเงินที่วัดมูลค่าด้วย', null, null, null, null, null, null],
    [null, null, 'มูลค่ายุติธรรมผ่านกำไรหรือขาดทุน', '10.1', null, -50, null, -40],
    ['เงินสดสุทธิใช้ไปในกิจกรรมลงทุน', null, null, null, null, -60, null, -45],
    ['กระแสเงินสดจากกิจกรรมจัดหาเงิน'],
    ['เงินสดสุทธิใช้ไปในกิจกรรมจัดหาเงิน', null, null, null, null, -100, null, -80],
  ]), 'TH 12-13');
  return wb;
}

describe('Import Parser v2', () => {
  it('does not detect years inside large numeric values', () => {
    expect(extractPeriodInfo('1,308,408,690')).toBeNull();
    expect(extractPeriodInfo('พ.ศ. 2568')).toMatchObject({ year: 2025, period_type: 'FY' });
  });

  it('parses Thai public company statement layout into dashboard-safe groups', () => {
    const rows = parseFinancialWorkbook(makeWorkbook(), 1, 'fixture.xlsx');
    expect(rows.summary.years).toEqual([2025, 2024]);
    expect(rows.summary.statements).toEqual(expect.arrayContaining(['balance_sheet', 'income_statement', 'cash_flow']));

    const groupSum = (year, group) => rows
      .filter((row) => row.fiscal_year === year && row.account_group === group)
      .reduce((sum, row) => sum + Number(row.amount), 0);

    expect(groupSum(2025, 'revenue')).toBe(950);
    expect(groupSum(2025, 'cogs')).toBe(400);
    expect(groupSum(2025, 'sga')).toBe(100);
    expect(groupSum(2025, 'net_profit')).toBe(344);
    expect(groupSum(2025, 'asset')).toBe(500);
    expect(groupSum(2025, 'liability')).toBe(200);
    expect(groupSum(2025, 'equity')).toBe(300);
    expect(groupSum(2025, 'operating_cash_flow')).toBe(300);
    expect(groupSum(2025, 'investing_cash_flow')).toBe(-60);
    expect(groupSum(2025, 'financing_cash_flow')).toBe(-100);

    const merged = rows.find((row) => row.raw_account_name.includes('เงินสดจ่ายเพื่อซื้อสินทรัพย์ทางการเงิน') && row.raw_account_name.includes('มูลค่ายุติธรรม'));
    expect(merged).toBeTruthy();
    expect(merged.note).toBe('10.1');
  });
});
