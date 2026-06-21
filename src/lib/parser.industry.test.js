import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFinancialWorkbook } from './parser.js';

function sheet(rows) {
  return XLSX.utils.aoa_to_sheet(rows);
}

describe('Industry Parser Pack v1', () => {
  it('maps industry-specific Thai financial statement labels without manual review', () => {
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, sheet([
      ['บริษัท ธนาคารตัวอย่าง จำกัด (มหาชน)'],
      ['งบฐานะการเงิน'],
      [null, null, null, null, null, null, 'งบการเงินรวม', null, 'งบการเงินเฉพาะธนาคาร'],
      [null, null, null, null, null, 'หมายเหตุ', '2568', null, '2567'],
      ['สินทรัพย์'],
      ['เงินสด', null, null, null, null, null, 100, null, 90],
      ['เงินให้สินเชื่อแก่ลูกหนี้และดอกเบี้ยค้างรับสุทธิ', null, null, null, null, '8', 500, null, 450],
      ['รวมหนี้สิน'],
      ['เงินรับฝาก', null, null, null, null, '14', 400, null, 350],
      ['รวมสินทรัพย์', null, null, null, null, null, 900, null, 800],
    ]), 'งบฐานะการเงิน');

    XLSX.utils.book_append_sheet(wb, sheet([
      ['บริษัท โรงพยาบาลตัวอย่าง จำกัด (มหาชน)'],
      ['งบกำไรขาดทุน'],
      ['สำหรับปีสิ้นสุดวันที่ 31 ธันวาคม 2568'],
      [null, null, null, null, null, null, '2568', null, '2567'],
      ['รายได้'],
      ['รายได้ค่ารักษาพยาบาล', null, null, null, null, null, 1000, null, 900],
      ['ค่าใช้จ่าย'],
      ['ต้นทุนค่ารักษาพยาบาลและต้นทุนขาย', null, null, null, null, null, -600, null, -540],
      ['กำไรสำหรับปี', null, null, null, null, null, 250, null, 230],
    ]), 'PL-T (12)');

    XLSX.utils.book_append_sheet(wb, sheet([
      ['บริษัท อสังหาตัวอย่าง จำกัด (มหาชน)'],
      ['งบฐานะการเงิน'],
      [null, null, null, null, null, null, '2568', null, '2567'],
      ['สินทรัพย์หมุนเวียน'],
      ['ต้นทุนการพัฒนาอสังหาริมทรัพย์', null, null, null, null, null, 700, null, 650],
      ['เงินมัดจำค่าซื้อที่ดิน', null, null, null, null, null, 50, null, 40],
    ]), 'BS');

    XLSX.utils.book_append_sheet(wb, sheet([
      ['บริษัท ผลิตอาหารตัวอย่าง จำกัด (มหาชน)'],
      ['งบฐานะการเงิน'],
      [null, null, null, null, null, null, '2568', null, '2567'],
      ['สินทรัพย์หมุนเวียน'],
      ['สินทรัพย์ชีวภาพหมุนเวียน', null, null, null, null, null, 120, null, 110],
    ]), 'BS-7-10');

    const rows = parseFinancialWorkbook(wb, 'fixture', 'industry-fixture.xlsx');
    expect(rows.summary.reviewCount).toBe(0);
    expect(rows.map((row) => row.account_group)).toEqual(expect.arrayContaining([
      'bank_loans_to_customers',
      'bank_deposits',
      'healthcare_patient_revenue',
      'healthcare_service_cost',
      'net_profit',
      'real_estate_development_costs',
      'land_purchase_deposits',
      'biological_assets_current',
    ]));
  });
});
