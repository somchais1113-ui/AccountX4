import * as XLSX from 'xlsx';
import { buildTfrsMappingReferenceRows, evaluateTfrsDataQuality, inferAccountingStandardProfile } from './accountingStandards.js';
import { enrichRowSemantics, LINE_ROLES, runValidationEngine } from './accountingEngine.js';
import { summarizeMappingConflicts } from './mappingConflictEngine.js';

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const pick = (groups = {}, keys = []) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(groups, key)) return n(groups[key]);
  }
  return 0;
};
const sum = (groups = {}, keys = []) => keys.reduce((acc, key) => acc + n(groups[key]), 0);
// has(): true only when the key is actually present in the parsed data, so we can tell
// "real zero" apart from "missing". This is what prevents double-counting: when a true
// total line exists we use it and never fall back to summing detail lines.
const has = (groups = {}, keys = []) => keys.some((key) => Object.prototype.hasOwnProperty.call(groups, key));

// Detail-line groups (NOT totals). Only used to derive a metric when the real total line
// is absent from the statement. Keeping these separate from total keys is the core
// double-count guard.
const REVENUE_DETAIL_KEYS = [
  'sales_revenue', 'product_sales_revenue', 'healthcare_patient_revenue',
  'real_estate_sales_revenue', 'bank_net_interest_income', 'bank_net_fee_income',
  'dividend_income', 'other_income', 'income_revenue_detail',
];
const EXPENSE_DETAIL_KEYS = [
  'cogs', 'sga', 'finance_cost', 'tax', 'healthcare_service_cost', 'real_estate_cogs',
  'bank_interest_expense', 'bank_expected_credit_loss', 'bank_other_operating_expenses',
];
const COGS_KEYS = ['cogs', 'healthcare_service_cost', 'real_estate_cogs'];
const SGA_KEYS = ['sga', 'bank_other_operating_expenses'];
const CASH_KEYS = ['cash', 'cash_ending'];
const LOAN_KEYS = ['loan', 'bank_borrowings', 'borrowings', 'bank_debt_issued_and_borrowings'];

const UNIT_CONFIG = {
  baht: { th: 'บาท', en: 'Baht', divisor: 1, suffix: '' },
  thousand: { th: 'พันบาท', en: 'Thousand Baht', divisor: 1000, suffix: '_k' },
  million: { th: 'ล้านบาท', en: 'Million Baht', divisor: 1000000, suffix: '_m' },
};

// Excel number formats. SheetJS applies these via cell.z.
const FMT = {
  amount: '#,##0;(#,##0);"-"',          // thousands separator, negatives in parens, zero as dash
  percent: '0.0%;(0.0%);"-"',           // value must be a real ratio (0.123), not 12.3
  multiple: '0.00"x"',
  ratio: '0.00',
};

const TEXT = {
  th: {
    cover: 'หน้าปก', summary: 'สรุป Dashboard', income: 'งบกำไรขาดทุน', balance: 'งบฐานะการเงิน', cashflow: 'งบกระแสเงินสด', ratios: 'อัตราส่วน', checks: 'ตรวจสอบงบ', mapping: 'Mapping Review', raw: 'Raw Data', lineage: 'Data Lineage', tfrs: 'TFRS Mapping Reference', quality: 'Data Quality', readiness: 'Readiness Gate',
    company: 'บริษัท', ticker: 'Ticker', period: 'ช่วงปี', generatedAt: 'เวลาส่งออก', mode: 'โหมดข้อมูล', unit: 'หน่วย', dataStatus: 'สถานะข้อมูล', warning: 'คำเตือน',
    latest: 'Latest confirmed', snapshot: 'Historical snapshot', archived: 'Archived snapshot',
    reviewWarning: 'ไฟล์นี้มีรายการ Mapping ที่ยังต้อง Review โปรดตรวจ Account Mapping Center ก่อนใช้ประกอบการตัดสินใจ',
    clean: 'Core export generated from confirmed / selected data. โปรดตรวจตัวเลขกับงบต้นฉบับก่อนใช้งานภายนอก',
    metric: 'รายการ', yoy: 'YoY %',
    checkTitle: 'การตรวจสอบความถูกต้องของงบ', checkItem: 'รายการตรวจสอบ', checkResult: 'ผล', checkDiff: 'ส่วนต่าง', checkPass: 'ผ่าน', checkFail: 'ไม่ผ่าน', checkNa: 'ไม่มีข้อมูล',
    balanceCheck: 'สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ', revenuePositive: 'รายได้รวมเป็นบวก', currentAssetsCheck: 'รวมสินทรัพย์หมุนเวียน + ไม่หมุนเวียน = สินทรัพย์รวม',
    integrityWarn: 'พบความผิดปกติของงบ โปรดตรวจ Sheet ตรวจสอบงบ ก่อนนำตัวเลขไปใช้',
    tfrsQualityWarn: 'Data Quality Score ต่ำกว่าระดับที่แนะนำ โปรดตรวจ Mapping/Validation ก่อนนำไปใช้',
    annualPeriodCheck: 'พบงบประจำปี FY สำหรับปีที่เลือก',
    annualPeriodMissing: 'ไม่พบงบประจำปี FY — ระบบจะไม่นำ Q/M/period อื่นมาแทนโดยอัตโนมัติ',
  },
  en: {
    cover: 'Cover', summary: 'Dashboard Summary', income: 'Income Statement', balance: 'Balance Sheet', cashflow: 'Cash Flow', ratios: 'Ratios', checks: 'Integrity Checks', mapping: 'Mapping Review', raw: 'Raw Data', lineage: 'Data Lineage', tfrs: 'TFRS Mapping Reference', quality: 'Data Quality', readiness: 'Readiness Gate',
    company: 'Company', ticker: 'Ticker', period: 'Period', generatedAt: 'Generated at', mode: 'Data mode', unit: 'Unit', dataStatus: 'Data status', warning: 'Warning',
    latest: 'Latest confirmed', snapshot: 'Historical snapshot', archived: 'Archived snapshot',
    reviewWarning: 'This export contains unreviewed accounting mappings. Review Account Mapping Center before decision use.',
    clean: 'Core export generated from confirmed / selected data. Reconcile figures with source statements before external use.',
    metric: 'Line item', yoy: 'YoY %',
    checkTitle: 'Financial statement integrity checks', checkItem: 'Check', checkResult: 'Result', checkDiff: 'Difference', checkPass: 'PASS', checkFail: 'FAIL', checkNa: 'No data',
    balanceCheck: 'Assets = Liabilities + Equity', revenuePositive: 'Total revenue is positive', currentAssetsCheck: 'Current + Non-current assets = Total assets',
    integrityWarn: 'Statement integrity issues found. Review the Integrity Checks sheet before using these figures.',
    tfrsQualityWarn: 'Data Quality Score is below the recommended level. Review mapping/validation before use.',
    annualPeriodCheck: 'FY annual period exists for selected year',
    annualPeriodMissing: 'FY annual period is missing — Q/M/other periods are not silently used as annual data',
  }
};

function safeSheetName(name) {
  return String(name || 'Sheet').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Sheet';
}

// Write an array-of-arrays sheet, then apply per-cell number formats from a parallel
// format map keyed by "r,c" (0-indexed). Also sets column widths and freezes the header.
function appendSheet(workbook, rows, name, { fmtMap = {}, freezeRow = 0 } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const widthCount = Math.max(...rows.map((row) => row.length), 1);
  ws['!cols'] = Array.from({ length: widthCount }, (_, idx) => ({ wch: idx === 0 ? 40 : 16 }));
  for (const [key, z] of Object.entries(fmtMap)) {
    const [r, c] = key.split(',').map(Number);
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = z;
  }
  if (freezeRow > 0) ws['!freeze'] = { xSplit: 0, ySplit: freezeRow, topLeftCell: XLSX.utils.encode_cell({ r: freezeRow, c: 0 }), activePane: 'bottomLeft', state: 'frozen' };
  XLSX.utils.book_append_sheet(workbook, ws, safeSheetName(name));
  return ws;
}

function appendJsonSheet(workbook, records, name) {
  const rows = records?.length ? records : [{ note: 'No rows' }];
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map((key) => ({ wch: Math.min(Math.max(String(key).length + 4, 14), 42) }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  XLSX.utils.book_append_sheet(workbook, ws, safeSheetName(name));
}

function getAnnualSelection(store, companyId, year, { strictAnnual = true } = {}) {
  const yearData = store?.[companyId]?.[year] || store?.[String(companyId)]?.[year] || store?.[companyId]?.[String(year)] || store?.[String(companyId)]?.[String(year)] || {};
  if (yearData.FY?.groups) return { groups: yearData.FY.groups, periodKey: 'FY', missingAnnual: false };
  if (strictAnnual) return { groups: {}, periodKey: null, missingAnnual: true };

  const candidates = Object.entries(yearData)
    .filter(([key, record]) => !String(key).startsWith('_') && record?.groups)
    .map(([key, record]) => ({ key, groups: record.groups }));
  if (!candidates.length) return { groups: {}, periodKey: null, missingAnnual: true };
  const best = candidates.reduce((best, item) => (Object.keys(item.groups).length > Object.keys(best.groups).length ? item : best), candidates[0]);
  return { groups: best.groups, periodKey: best.key, missingAnnual: true };
}

function buildStoreFromNormalizedRows(rows = [], importBatches = []) {
  const batchMeta = new Map((importBatches || []).map((batch) => [batch.id, batch]));
  const store = {};
  (rows || []).map((row) => enrichRowSemantics(row)).forEach((record) => {
    const companyId = record.company_id;
    const year = record.fiscal_year;
    if (!companyId || !year) return;
    const batch = batchMeta.get(record.import_batch_id || record.batch_id) || {};
    const status = batch.status || record.import_status || 'confirmed';
    if (['superseded', 'rolled_back', 'rejected'].includes(status)) return;
    const periodKey = record.period || batch.period || 'FY';
    store[companyId] ||= {};
    store[companyId][year] ||= {};
    store[companyId][year][periodKey] ||= {
      groups: {},
      row_count: 0,
      review_count: 0,
      semantic_warnings: [],
      import_batch_id: record.import_batch_id || batch.id || null,
      _statementScope: record.statement_scope || batch.statement_scope || null,
      _sourceFile: record.source_file || batch.file_name || null,
      _batchStatus: status,
    };
    const target = store[companyId][year][periodKey];
    const groupKey = record.account_group || 'other';
    const role = record.line_role || 'detail';
    const isTotalRole = [LINE_ROLES.TOTAL, LINE_ROLES.GRAND_TOTAL].includes(role);
    const isIgnored = [LINE_ROLES.NOTE, LINE_ROLES.DISCLOSURE, LINE_ROLES.OCI, LINE_ROLES.ATTRIBUTION, LINE_ROLES.MOVEMENT].includes(role);
    if (!isIgnored && record.is_export_eligible !== false) {
      if (isTotalRole) {
        target.groups[groupKey] = n(record.amount); // reported totals override detail sums to prevent double-counting
      } else {
        target.groups[groupKey] = (target.groups[groupKey] || 0) + n(record.amount);
      }
    }
    if (Array.isArray(record.risk_flags) && record.risk_flags.length) target.semantic_warnings.push({ account: record.raw_account_name, flags: record.risk_flags });
    target.row_count += 1;
    if (record.needs_review) target.review_count += 1;
  });
  return store;
}

function getMetrics(groups = {}, meta = {}) {
  // Revenue: use the real total line if present; otherwise derive from detail lines.
  const revenue = has(groups, ['revenue']) ? pick(groups, ['revenue']) : sum(groups, REVENUE_DETAIL_KEYS);
  const cogs = sum(groups, COGS_KEYS);
  const sga = sum(groups, SGA_KEYS);
  const financeCost = pick(groups, ['finance_cost', 'bank_interest_expense']);
  const tax = pick(groups, ['tax']);
  // Expense: prefer the real total. Never combine total + details.
  const expense = has(groups, ['expense']) ? pick(groups, ['expense']) : sum(groups, EXPENSE_DETAIL_KEYS);
  const grossProfit = revenue - cogs;
  const operatingProfit = has(groups, ['operating_profit']) ? pick(groups, ['operating_profit']) : (revenue ? grossProfit - sga : 0);
  const profitBeforeTax = has(groups, ['profit_before_tax']) ? pick(groups, ['profit_before_tax']) : (operatingProfit - financeCost);
  // Net profit: use the reported total when present; otherwise revenue - expense.
  const netProfit = has(groups, ['net_profit']) ? pick(groups, ['net_profit']) : (revenue ? revenue - expense : 0);
  const asset = pick(groups, ['asset']);
  const liability = pick(groups, ['liability']);
  const equity = pick(groups, ['equity']);
  const cash = pick(groups, CASH_KEYS);
  const currentAssets = pick(groups, ['total_current_assets']);
  const nonCurrentAssets = pick(groups, ['total_non_current_assets']);
  const currentLiabilities = pick(groups, ['total_current_liabilities']);
  const nonCurrentLiabilities = pick(groups, ['total_non_current_liabilities']);
  const loans = pick(groups, LOAN_KEYS);
  const cfo = pick(groups, ['operating_cash_flow']);
  const cfi = pick(groups, ['investing_cash_flow']);
  const cff = pick(groups, ['financing_cash_flow']);
  const dividendPaid = Math.abs(pick(groups, ['dividend_paid']));
  const fcf = cfo + cfi;
  return {
    revenue, cogs, grossProfit, sga, operatingProfit, financeCost, profitBeforeTax, tax, expense, netProfit,
    cash, currentAssets, nonCurrentAssets, asset, currentLiabilities, nonCurrentLiabilities, liability, equity, loans,
    cfo, cfi, cff, dividendPaid, fcf,
    // Ratios stored as TRUE RATIOS (0.123 = 12.3%) so Excel % format renders correctly.
    grossMargin: revenue ? grossProfit / revenue : 0,
    operatingMargin: revenue ? operatingProfit / revenue : 0,
    netMargin: revenue ? netProfit / revenue : 0,
    cogsRatio: revenue ? cogs / revenue : 0,
    sgaRatio: revenue ? sga / revenue : 0,
    currentRatio: currentLiabilities ? currentAssets / currentLiabilities : 0,
    debtToEquity: equity ? liability / equity : 0,
    roa: asset ? netProfit / asset : 0,
    roe: equity ? netProfit / equity : 0,
    // Raw fields needed by integrity checks (kept unscaled in baht).
    _raw: { asset, liability, equity, currentAssets, nonCurrentAssets, revenue },
    _present: {
      asset: has(groups, ['asset']),
      liability: has(groups, ['liability']),
      equity: has(groups, ['equity']),
      currentAssets: has(groups, ['total_current_assets']),
      nonCurrentAssets: has(groups, ['total_non_current_assets']),
      revenue: has(groups, ['revenue']) || REVENUE_DETAIL_KEYS.some((key) => has(groups, [key])),
    },
    _meta: { ...meta },
  };
}

// Which metric keys are percentages vs multiples (for cell formatting on the ratio sheet).
const PERCENT_METRICS = new Set(['grossMargin', 'operatingMargin', 'netMargin', 'cogsRatio', 'sgaRatio', 'roa', 'roe']);
const MULTIPLE_METRICS = new Set(['debtToEquity', 'currentRatio']);

function metricRows(th, bilingual) {
  const label = (thText, enText) => bilingual ? `${thText} / ${enText}` : (th ? thText : enText);
  return {
    income: [
      ['revenue', label('รายได้รวม', 'Total revenue')], ['cogs', label('ต้นทุนขาย', 'COGS')], ['grossProfit', label('กำไรขั้นต้น', 'Gross profit')],
      ['sga', label('ค่าใช้จ่ายขายและบริหาร', 'SG&A')], ['operatingProfit', label('กำไรจากการดำเนินงาน', 'Operating profit')],
      ['financeCost', label('ต้นทุนทางการเงิน', 'Finance cost')], ['profitBeforeTax', label('กำไรก่อนภาษี', 'Profit before tax')],
      ['tax', label('ภาษีเงินได้', 'Income tax')], ['netProfit', label('กำไรสุทธิ', 'Net profit')],
    ],
    balance: [
      ['cash', label('เงินสดและรายการเทียบเท่าเงินสด', 'Cash and equivalents')], ['currentAssets', label('สินทรัพย์หมุนเวียน', 'Current assets')],
      ['nonCurrentAssets', label('สินทรัพย์ไม่หมุนเวียน', 'Non-current assets')], ['asset', label('สินทรัพย์รวม', 'Total assets')],
      ['currentLiabilities', label('หนี้สินหมุนเวียน', 'Current liabilities')], ['nonCurrentLiabilities', label('หนี้สินไม่หมุนเวียน', 'Non-current liabilities')],
      ['liability', label('หนี้สินรวม', 'Total liabilities')], ['equity', label('ส่วนของเจ้าของ', 'Equity')], ['loans', label('เงินกู้ / หนี้สินทางการเงิน', 'Loans / Borrowings')],
    ],
    cashflow: [
      ['cfo', label('กระแสเงินสดจากการดำเนินงาน', 'Operating cash flow')], ['cfi', label('กระแสเงินสดจากการลงทุน', 'Investing cash flow')],
      ['cff', label('กระแสเงินสดจากการจัดหาเงิน', 'Financing cash flow')], ['fcf', label('กระแสเงินสดอิสระ', 'Free cash flow')],
      ['dividendPaid', label('เงินปันผลจ่าย', 'Dividend paid')],
    ],
    ratios: [
      ['grossMargin', label('อัตรากำไรขั้นต้น', 'Gross margin')], ['operatingMargin', label('อัตรากำไรจากการดำเนินงาน', 'Operating margin')],
      ['netMargin', label('อัตรากำไรสุทธิ', 'Net margin')], ['cogsRatio', label('ต้นทุนขายต่อรายได้', 'COGS / Revenue')],
      ['sgaRatio', label('SG&A ต่อรายได้', 'SG&A / Revenue')], ['currentRatio', label('Current ratio', 'Current ratio')],
      ['debtToEquity', label('หนี้สินต่อทุน', 'Debt to equity')], ['roa', label('ROA', 'ROA')], ['roe', label('ROE', 'ROE')],
    ],
  };
}

function scaled(value, unit) {
  return n(value) / (UNIT_CONFIG[unit]?.divisor || 1);
}

// Build a statement sheet with year columns plus a true year-over-year column for each
// adjacent pair, and a format map for SheetJS. `isRatioSheet` switches amount formatting
// to percent/multiple per metric key.
function statementSheet(workbook, title, metricList, metricsByYear, years, unit, lang, isRatioSheet = false) {
  const t = TEXT[lang];
  const yoyHeaders = years.length > 1 ? years.slice(1).map((y, i) => `${t.yoy} ${years[i]}->${y}`) : [];
  const header = [t.metric, ...years.map(String), ...yoyHeaders];
  const rows = [[title], [t.unit, isRatioSheet ? (lang === 'th' ? 'เท่า / %' : 'x / %') : (UNIT_CONFIG[unit]?.[lang] || unit)], [], header];
  const headerRowIdx = 3;
  const fmtMap = {};

  metricList.forEach(([key, label], i) => {
    const r = headerRowIdx + 1 + i;
    const isPct = isRatioSheet && PERCENT_METRICS.has(key);
    const isMult = isRatioSheet && MULTIPLE_METRICS.has(key);
    const values = years.map((year) => {
      const v = metricsByYear[year]?.[key];
      return isRatioSheet ? n(v) : scaled(v, unit);
    });
    const row = [label, ...values];
    // True per-pair YoY (only meaningful for amount metrics).
    if (years.length > 1) {
      years.slice(1).forEach((year, idx) => {
        const prev = values[idx];
        const curr = values[idx + 1];
        row.push((!isRatioSheet && prev) ? (curr - prev) / Math.abs(prev) : '');
      });
    }
    rows.push(row);
    // Format value columns.
    years.forEach((_, c) => {
      const col = 1 + c;
      if (isPct) fmtMap[`${r},${col}`] = FMT.percent;
      else if (isMult) fmtMap[`${r},${col}`] = FMT.multiple;
      else fmtMap[`${r},${col}`] = FMT.amount;
    });
    // YoY columns always percent.
    if (years.length > 1) {
      years.slice(1).forEach((_, idx) => { fmtMap[`${r},${1 + years.length + idx}`] = FMT.percent; });
    }
  });
  appendSheet(workbook, rows, title, { fmtMap, freezeRow: headerRowIdx + 1 });
}

// Integrity checks per year. Tolerance 1% of the larger side (or 1 baht floor).
function buildIntegrityRows(metricsByYear, years, lang) {
  const t = TEXT[lang];
  const rows = [[t.checkTitle], [], [t.checkItem, t.period, t.checkResult, t.checkDiff]];
  let anyFail = false;
  const tol = (a, b) => Math.max(Math.abs(a), Math.abs(b)) * 0.01 + 1;
  const present = (obj, key, flags = null) => flags ? Boolean(flags[key]) : (Object.prototype.hasOwnProperty.call(obj || {}, key) && obj[key] !== undefined && obj[key] !== null && obj[key] !== '');

  for (const year of years) {
    const m = metricsByYear[year]?._raw || {};
    const meta = metricsByYear[year]?._meta || {};
    const flags = metricsByYear[year]?._present || {};
    if (meta.missingAnnual) {
      anyFail = true;
      rows.push([t.annualPeriodCheck, year, t.checkFail, t.annualPeriodMissing]);
    } else {
      rows.push([t.annualPeriodCheck, year, t.checkPass, '']);
    }
    // 1. Assets = Liabilities + Equity
    if (present(m, 'asset', flags) || present(m, 'liability', flags) || present(m, 'equity', flags)) {
      const diff = m.asset - (m.liability + m.equity);
      const pass = Math.abs(diff) <= tol(m.asset, m.liability + m.equity);
      if (!pass) anyFail = true;
      rows.push([t.balanceCheck, year, pass ? t.checkPass : t.checkFail, diff]);
    } else {
      rows.push([t.balanceCheck, year, t.checkNa, '']);
    }
    // 2. Revenue positive
    if (present(m, 'revenue', flags)) {
      const pass = m.revenue > 0;
      if (!pass) anyFail = true;
      rows.push([t.revenuePositive, year, pass ? t.checkPass : t.checkFail, m.revenue]);
    } else {
      rows.push([t.revenuePositive, year, t.checkNa, '']);
    }
    // 3. Current + Non-current assets = Total assets (only when both subtotals exist)
    if (present(m, 'currentAssets', flags) && present(m, 'nonCurrentAssets', flags) && present(m, 'asset', flags)) {
      const diff = (m.currentAssets + m.nonCurrentAssets) - m.asset;
      const pass = Math.abs(diff) <= tol(m.currentAssets + m.nonCurrentAssets, m.asset);
      if (!pass) anyFail = true;
      rows.push([t.currentAssetsCheck, year, pass ? t.checkPass : t.checkFail, diff]);
    } else {
      rows.push([t.currentAssetsCheck, year, t.checkNa, '']);
    }
  }
  return { rows, anyFail };
}

function normalizeRawRows(rawRows = []) {
  return rawRows.map((row) => ({
    company_id: row.company_id, fiscal_year: row.fiscal_year, period: row.period,
    statement_type: row.statement_type, source_sheet: row.source_sheet, source_row: row.source_row,
    standard_profile: row.accounting_standard_profile, standard_ref: row.standard_ref, standard_source: row.standard_source, standard_reason: row.standard_reason,
    raw_account_name: row.raw_account_name, account_name: row.account_name, account_group: row.account_group,
    account_subgroup: row.account_subgroup, amount: row.amount, needs_review: row.needs_review,
    mapping_confidence: row.mapping_confidence, mapping_source: row.mapping_source, review_reason: row.review_reason,
    accounting_standard_profile: row.accounting_standard_profile, standard_source: row.standard_source, standard_ref: row.standard_ref,
    standard_label_th: row.standard_label_th, standard_label_en: row.standard_label_en, standard_reason: row.standard_reason,
    consolidation_indicator: row.consolidation_indicator, business_combination_indicator: row.business_combination_indicator,
    import_status: row.import_status, import_batch_id: row.import_batch_id, source_file: row.source_file,
  }));
}

function normalizeMappingRows(mappingRows = []) {
  return mappingRows.map((row) => ({
    company: row.companies?.ticker_symbol || row.company_id, fiscal_year: row.fiscal_year,
    statement_type: row.statement_type, raw_account_name: row.raw_account_name, current_group: row.account_group,
    suggested_group: row.suggested_account_group, confidence: row.mapping_confidence, source: row.mapping_source,
    needs_review: row.needs_review, review_reason: row.review_reason, source_file: row.source_file,
    source_sheet: row.source_sheet, source_row: row.source_row,
    standard_profile: row.accounting_standard_profile, standard_ref: row.standard_ref, standard_source: row.standard_source, standard_reason: row.standard_reason,
    conflict_status: row.conflict_status || 'none', conflict_reasons: Array.isArray(row.conflict_reasons) ? row.conflict_reasons.join(', ') : row.conflict_reasons,
    approval_policy: row.approval_policy || '', manual_approval_reason: row.manual_approval_reason || '', conflict_score: row.conflict_score ?? '',
  }));
}

function normalizeLineageRows(importBatches = []) {
  return importBatches.map((row) => ({
    imported_at: row.imported_at, company: row.companies?.ticker_symbol || row.company_id, fiscal_year: row.fiscal_year,
    period_type: row.period_type, period: row.period, file_name: row.file_name, status: row.status,
    total_rows: row.total_rows, review_count: row.review_count, source_type: row.source_type,
    parser_profile: row.parser_profile, batch_id: row.id,
  }));
}

export function buildFinancialExcelWorkbook({
  company = {}, companyId, store = {}, years = [], importBatches = [],
  rawRows = [], normalizedRows = [], monthlyRows = [], trialBalanceRows = [], mappingRows = [], language = 'th', labelMode = 'bilingual',
  unit = 'million', mode = 'latest', strictAnnual = true, readinessRows = [], exportReason = '',
} = {}) {
  const lang = language === 'en' ? 'en' : 'th';
  const th = lang === 'th';
  const bilingual = labelMode === 'bilingual';
  const t = TEXT[lang];
  const actualYears = years.map(Number).filter(Boolean).sort((a, b) => a - b);
  const sourceStore = normalizedRows?.length ? buildStoreFromNormalizedRows(normalizedRows, importBatches) : store;
  const selectionsByYear = Object.fromEntries(actualYears.map((year) => [year, getAnnualSelection(sourceStore, companyId || company.id, year, { strictAnnual })]));
  const metricsByYear = Object.fromEntries(actualYears.map((year) => [year, getMetrics(selectionsByYear[year]?.groups || {}, { missingAnnual: Boolean(selectionsByYear[year]?.missingAnnual), periodKey: selectionsByYear[year]?.periodKey || null })]));
  const reviewRows = mappingRows.filter((row) => row?.needs_review !== false || row?.account_group === 'other' || Number(row?.mapping_confidence) < 0.86 || (row?.conflict_status && row.conflict_status !== 'none') || ['manual_required','blocked','row_only_manual'].includes(row?.approval_policy));
  const mappingConflictSummary = summarizeMappingConflicts(mappingRows);
  const hasImportantReview = reviewRows.length > 0 || mappingConflictSummary.conflict_count > 0;
  const profile = company.accountingStandardProfile || company.accounting_standard_profile || inferAccountingStandardProfile(company, {});
  const dataQuality = evaluateTfrsDataQuality(rawRows?.length ? rawRows : normalizedRows, { profile });
  const accountingValidation = runValidationEngine(rawRows?.length ? rawRows : normalizedRows, { strictAnnual });
  const tfrsReferenceRows = buildTfrsMappingReferenceRows(rawRows?.length ? rawRows : normalizedRows);
  const hasTfrsQualityIssue = dataQuality.score < 80 || dataQuality.critical_review_rows > 0 || dataQuality.missing_core_metrics.length > 0;
  const { rows: integrityRows, anyFail: hasIntegrityIssue } = buildIntegrityRows(metricsByYear, actualYears, lang);
  const rows = metricRows(th, bilingual);
  const wb = XLSX.utils.book_new();

  appendSheet(wb, [
    ['FinAnalytics / AccountX4 Excel Export'],
    [],
    [t.company, th ? (company.nameTh || company.name_th || company.nameEn || company.name_en || companyId) : (company.nameEn || company.name_en || company.nameTh || company.name_th || companyId)],
    [t.ticker, company.tickerSymbol || company.ticker_symbol || ''],
    [t.period, actualYears.length ? `${actualYears[0]} - ${actualYears[actualYears.length - 1]}` : '-'],
    [t.generatedAt, new Date().toLocaleString(th ? 'th-TH' : 'en-GB')],
    [t.mode, mode === 'latest' ? t.latest : mode === 'archived_snapshot' ? t.archived : t.snapshot],
    [t.unit, UNIT_CONFIG[unit]?.[lang] || unit],
    ['Accounting standard profile', profile],
    ['Data Quality Score', `${dataQuality.score}/100`],
    ['Readiness Gate', readinessRows?.length ? readinessRows.map((row) => `${row.fiscal_year || ''}: ${row.readiness_status || 'not_validated'} (${row.readiness_score ?? '-'})`).join(' | ') : 'not_validated'],
    ['Mapping conflicts', mappingConflictSummary.conflict_count],
    ['Manual mapping approvals required', mappingConflictSummary.manual_required_count],
    ['Blocked mapping conflicts', mappingConflictSummary.blocked_count],
    ...(exportReason ? [['Export anyway reason', exportReason]] : []),
    [t.dataStatus, hasImportantReview ? t.reviewWarning : t.clean],
    ...(hasIntegrityIssue ? [[t.warning, t.integrityWarn]] : []),
    ...(hasTfrsQualityIssue ? [[t.warning, t.tfrsQualityWarn]] : []),
    [],
    [t.warning, 'AI can help map accounts, but exported figures should be reconciled with source financial statements before external or filing use.'],
  ], t.cover);

  // Summary sheet: amounts + ratios mixed, so format per-row.
  const summaryMetrics = [
    ['revenue', th ? 'รายได้รวม' : 'Total revenue', 'amount'], ['netProfit', th ? 'กำไรสุทธิ' : 'Net profit', 'amount'],
    ['asset', th ? 'สินทรัพย์รวม' : 'Total assets', 'amount'], ['liability', th ? 'หนี้สินรวม' : 'Total liabilities', 'amount'],
    ['equity', th ? 'ส่วนของเจ้าของ' : 'Equity', 'amount'], ['netMargin', th ? 'Net margin' : 'Net margin', 'percent'],
    ['debtToEquity', th ? 'D/E' : 'D/E', 'multiple'],
  ];
  {
    const yoyHeaders = actualYears.length > 1 ? actualYears.slice(1).map((y, i) => `${t.yoy} ${actualYears[i]}->${y}`) : [];
    const srows = [[t.summary], [t.unit, UNIT_CONFIG[unit]?.[lang] || unit], [], [t.metric, ...actualYears.map(String), ...yoyHeaders]];
    const fmtMap = {};
    summaryMetrics.forEach(([key, label, kind], i) => {
      const r = 4 + i;
      const isAmount = kind === 'amount';
      const values = actualYears.map((year) => isAmount ? scaled(metricsByYear[year]?.[key], unit) : n(metricsByYear[year]?.[key]));
      const row = [label, ...values];
      if (actualYears.length > 1) {
        actualYears.slice(1).forEach((year, idx) => {
          const prev = values[idx], curr = values[idx + 1];
          row.push((isAmount && prev) ? (curr - prev) / Math.abs(prev) : '');
        });
      }
      srows.push(row);
      actualYears.forEach((_, c) => { fmtMap[`${r},${1 + c}`] = kind === 'percent' ? FMT.percent : kind === 'multiple' ? FMT.multiple : FMT.amount; });
      if (actualYears.length > 1) actualYears.slice(1).forEach((_, idx) => { if (isAmount) fmtMap[`${r},${1 + actualYears.length + idx}`] = FMT.percent; });
    });
    appendSheet(wb, srows, t.summary, { fmtMap, freezeRow: 4 });
  }

  statementSheet(wb, t.income, rows.income, metricsByYear, actualYears, unit, lang);
  statementSheet(wb, t.balance, rows.balance, metricsByYear, actualYears, unit, lang);
  statementSheet(wb, t.cashflow, rows.cashflow, metricsByYear, actualYears, unit, lang);
  statementSheet(wb, t.ratios, rows.ratios, metricsByYear, actualYears, 'baht', lang, true);

  // Integrity checks sheet with format on the difference column.
  {
    const fmtMap = {};
    integrityRows.forEach((row, r) => { if (typeof row[3] === 'number') fmtMap[`${r},3`] = FMT.amount; });
    appendSheet(wb, integrityRows, t.checks, { fmtMap, freezeRow: 3 });
  }

  appendJsonSheet(wb, (readinessRows || []).map((row) => ({
    company: row.companies?.ticker_symbol || row.company_id,
    file_name: row.file_name,
    fiscal_year: row.fiscal_year,
    period: row.period,
    period_type: row.period_type,
    statement_scope: row.statement_scope,
    status: row.status,
    readiness_status: row.readiness_status || 'not_validated',
    readiness_score: row.readiness_score ?? null,
    dashboard_ready: Boolean(row.dashboard_ready),
    export_ready: Boolean(row.export_ready),
    external_use_ready: Boolean(row.external_use_ready),
    review_count: row.review_count,
    total_rows: row.total_rows,
    last_validated_at: row.last_validated_at,
    export_reason: exportReason || '',
    mapping_conflict_count: mappingConflictSummary.conflict_count,
    manual_required_count: mappingConflictSummary.manual_required_count,
    blocked_conflict_count: mappingConflictSummary.blocked_count,
    exported_with_mapping_conflicts: mappingConflictSummary.conflict_count > 0,
  })), t.readiness || 'Readiness Gate');

  appendJsonSheet(wb, [{
    accounting_standard_profile: profile,
    data_quality_score: dataQuality.score,
    total_rows: dataQuality.total_rows,
    review_rows: dataQuality.review_rows,
    tfrs_referenced_rows: dataQuality.tfrs_referenced_rows,
    missing_core_metrics: dataQuality.missing_core_metrics.join(', '),
    critical_review_rows: dataQuality.critical_review_rows,
    validation_passed: accountingValidation.passed,
    validation_issues: accountingValidation.results.filter(r => !['pass','info'].includes(r.severity)).length,
    mapping_conflict_count: mappingConflictSummary.conflict_count,
    manual_required_count: mappingConflictSummary.manual_required_count,
    blocked_count: mappingConflictSummary.blocked_count,
    row_only_approval_count: mappingConflictSummary.row_only_approval_count,
    missing_approval_reason_count: mappingConflictSummary.missing_approval_reason_count,
    consolidation_signals: dataQuality.consolidation_signals.join(', '),
    business_combination_signals: dataQuality.business_combination_signals.join(', '),
  }], t.quality);
  appendJsonSheet(wb, tfrsReferenceRows, t.tfrs);
  appendJsonSheet(wb, normalizeMappingRows(reviewRows), t.mapping);
  appendJsonSheet(wb, normalizeRawRows(rawRows), t.raw);
  appendJsonSheet(wb, normalizeLineageRows(importBatches), t.lineage);

  wb._integrity = { hasIntegrityIssue, hasImportantReview, hasTfrsQualityIssue, dataQuality, accountingValidation };
  return wb;
}


export function previewFinancialExcelExport(options = {}) {
  const wb = buildFinancialExcelWorkbook(options);
  return { integrity: wb._integrity || {} };
}

export function exportFinancialExcel(options = {}) {
  const wb = buildFinancialExcelWorkbook(options);
  const company = options.company || {};
  const ticker = company.tickerSymbol || company.ticker_symbol || company.nameEn || company.name_en || 'Company';
  const years = (options.years || []).map(Number).filter(Boolean).sort((a, b) => a - b);
  const yearPart = years.length ? `${years[0]}-${years[years.length - 1]}` : 'export';
  const unit = UNIT_CONFIG[options.unit || 'million']?.suffix || '';
  const mode = options.mode === 'latest' ? 'latest' : 'snapshot';
  const fileName = `${String(ticker).replace(/[^a-zA-Z0-9ก-ฮ_-]+/g, '_')}_Financial_Export_${yearPart}${unit}_${mode}.xlsx`;
  XLSX.writeFile(wb, fileName, { compression: true });
  // Return both filename and integrity flags so the UI can warn the user.
  return { fileName, integrity: wb._integrity || {} };
}
