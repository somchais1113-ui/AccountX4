import * as XLSX from 'xlsx';

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const pick = (groups = {}, keys = []) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(groups, key)) return n(groups[key]);
  }
  return 0;
};
const sum = (groups = {}, keys = []) => keys.reduce((acc, key) => acc + n(groups[key]), 0);

const REVENUE_KEYS = [
  'revenue', 'sales_revenue', 'healthcare_patient_revenue', 'product_sales_revenue',
  'real_estate_sales_revenue', 'bank_net_interest_income', 'bank_interest_income',
  'bank_net_fee_income', 'bank_fee_income', 'other_income'
];
const EXPENSE_KEYS = [
  'expense', 'cogs', 'sga', 'healthcare_service_cost', 'real_estate_cogs',
  'finance_cost', 'tax', 'bank_interest_expense', 'bank_expected_credit_loss',
  'bank_other_operating_expenses'
];
const COGS_KEYS = ['cogs', 'healthcare_service_cost', 'real_estate_cogs'];
const SGA_KEYS = ['sga', 'bank_other_operating_expenses'];
const CASH_KEYS = ['cash', 'cash_ending', 'cash_beginning'];
const LOAN_KEYS = ['loan', 'bank_borrowings', 'borrowings', 'bank_debt_issued_and_borrowings'];

const UNIT_CONFIG = {
  baht: { th: 'บาท', en: 'Baht', divisor: 1, suffix: '' },
  thousand: { th: 'พันบาท', en: 'Thousand Baht', divisor: 1_000, suffix: '_k' },
  million: { th: 'ล้านบาท', en: 'Million Baht', divisor: 1_000_000, suffix: '_m' },
};

const TEXT = {
  th: {
    cover: 'หน้าปก', summary: 'สรุป Dashboard', income: 'งบกำไรขาดทุน', balance: 'งบฐานะการเงิน', cashflow: 'งบกระแสเงินสด', ratios: 'อัตราส่วน', mapping: 'Mapping Review', raw: 'Raw Data', lineage: 'Data Lineage',
    company: 'บริษัท', ticker: 'Ticker', period: 'ช่วงปี', generatedAt: 'เวลาส่งออก', mode: 'โหมดข้อมูล', unit: 'หน่วย', dataStatus: 'สถานะข้อมูล', warning: 'คำเตือน',
    latest: 'Latest confirmed', snapshot: 'Historical snapshot', archived: 'Archived snapshot',
    reviewWarning: 'ไฟล์นี้มีรายการ Mapping ที่ยังต้อง Review โปรดตรวจ Account Mapping Center ก่อนใช้ประกอบการตัดสินใจ',
    clean: 'Core export generated from confirmed / selected data. โปรดตรวจตัวเลขกับงบต้นฉบับก่อนใช้งานภายนอก',
    metric: 'รายการ', yoy: 'YoY %',
  },
  en: {
    cover: 'Cover', summary: 'Dashboard Summary', income: 'Income Statement', balance: 'Balance Sheet', cashflow: 'Cash Flow', ratios: 'Ratios', mapping: 'Mapping Review', raw: 'Raw Data', lineage: 'Data Lineage',
    company: 'Company', ticker: 'Ticker', period: 'Period', generatedAt: 'Generated at', mode: 'Data mode', unit: 'Unit', dataStatus: 'Data status', warning: 'Warning',
    latest: 'Latest confirmed', snapshot: 'Historical snapshot', archived: 'Archived snapshot',
    reviewWarning: 'This export contains unreviewed accounting mappings. Review Account Mapping Center before decision use.',
    clean: 'Core export generated from confirmed / selected data. Reconcile figures with source statements before external use.',
    metric: 'Line item', yoy: 'YoY %',
  }
};

function safeSheetName(name) {
  return String(name || 'Sheet').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Sheet';
}

function appendSheet(workbook, rows, name) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const widthCount = Math.max(...rows.map((row) => row.length), 1);
  ws['!cols'] = Array.from({ length: widthCount }, (_, idx) => ({ wch: idx === 0 ? 34 : 16 }));
  XLSX.utils.book_append_sheet(workbook, ws, safeSheetName(name));
}

function appendJsonSheet(workbook, records, name) {
  const rows = records?.length ? records : [{ note: 'No rows' }];
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map((key) => ({ wch: Math.min(Math.max(String(key).length + 4, 14), 42) }));
  XLSX.utils.book_append_sheet(workbook, ws, safeSheetName(name));
}

function displayText(mode, th, bilingual) {
  const t = TEXT[th ? 'th' : 'en'];
  const other = TEXT[th ? 'en' : 'th'];
  return bilingual ? `${t[mode]} / ${other[mode]}` : t[mode];
}

function getAnnualGroups(store, companyId, year) {
  const yearData = store?.[companyId]?.[year] || store?.[String(companyId)]?.[year] || store?.[companyId]?.[String(year)] || store?.[String(companyId)]?.[String(year)] || {};
  const period = yearData.FY || Object.values(yearData).find((record) => record?.groups);
  return period?.groups || {};
}

function getMetrics(groups = {}) {
  const revenue = pick(groups, ['revenue']) || sum(groups, REVENUE_KEYS.filter(k => k !== 'revenue'));
  const cogs = sum(groups, COGS_KEYS);
  const sga = sum(groups, SGA_KEYS);
  const financeCost = pick(groups, ['finance_cost', 'bank_interest_expense']);
  const tax = pick(groups, ['tax']);
  const expense = pick(groups, ['expense']) || sum(groups, EXPENSE_KEYS.filter(k => k !== 'expense'));
  const grossProfit = revenue - cogs;
  const operatingProfit = pick(groups, ['operating_profit']) || (revenue ? grossProfit - sga : 0);
  const profitBeforeTax = pick(groups, ['profit_before_tax']) || (operatingProfit - financeCost);
  const netProfit = pick(groups, ['net_profit']) || (revenue ? revenue - expense : 0);
  const asset = pick(groups, ['asset']);
  const liability = pick(groups, ['liability']);
  const equity = pick(groups, ['equity']);
  const cash = pick(groups, CASH_KEYS);
  const currentAssets = pick(groups, ['total_current_assets', 'current_assets']);
  const nonCurrentAssets = pick(groups, ['total_non_current_assets', 'non_current_assets']);
  const currentLiabilities = pick(groups, ['total_current_liabilities', 'current_liabilities']);
  const nonCurrentLiabilities = pick(groups, ['total_non_current_liabilities', 'non_current_liabilities']);
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
    grossMargin: revenue ? (grossProfit / revenue) * 100 : 0,
    operatingMargin: revenue ? (operatingProfit / revenue) * 100 : 0,
    netMargin: revenue ? (netProfit / revenue) * 100 : 0,
    cogsRatio: revenue ? (cogs / revenue) * 100 : 0,
    sgaRatio: revenue ? (sga / revenue) * 100 : 0,
    currentRatio: currentLiabilities ? currentAssets / currentLiabilities : 0,
    debtToEquity: equity ? liability / equity : 0,
    roa: asset ? (netProfit / asset) * 100 : 0,
    roe: equity ? (netProfit / equity) * 100 : 0,
  };
}

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
      ['grossMargin', label('อัตรากำไรขั้นต้น %', 'Gross margin %')], ['operatingMargin', label('อัตรากำไรจากการดำเนินงาน %', 'Operating margin %')],
      ['netMargin', label('อัตรากำไรสุทธิ %', 'Net margin %')], ['cogsRatio', label('ต้นทุนขายต่อรายได้ %', 'COGS / Revenue %')],
      ['sgaRatio', label('SG&A ต่อรายได้ %', 'SG&A / Revenue %')], ['currentRatio', label('Current ratio', 'Current ratio')],
      ['debtToEquity', label('หนี้สินต่อทุน', 'Debt to equity')], ['roa', label('ROA %', 'ROA %')], ['roe', label('ROE %', 'ROE %')],
    ],
  };
}

function scaled(value, unit) {
  return n(value) / (UNIT_CONFIG[unit]?.divisor || 1);
}

function statementSheetRows(title, metricList, metricsByYear, years, unit, lang) {
  const t = TEXT[lang];
  const rows = [[title], [t.unit, UNIT_CONFIG[unit]?.[lang] || unit], [], [t.metric, ...years.map(String), t.yoy]];
  for (const [key, label] of metricList) {
    const values = years.map((year) => scaled(metricsByYear[year]?.[key], unit));
    const first = values[0];
    const last = values[values.length - 1];
    const yoy = values.length > 1 && first ? ((last - first) / Math.abs(first)) * 100 : '';
    rows.push([label, ...values, yoy]);
  }
  return rows;
}

function normalizeRawRows(rawRows = []) {
  return rawRows.map((row) => ({
    company_id: row.company_id,
    fiscal_year: row.fiscal_year,
    period: row.period,
    statement_type: row.statement_type,
    source_sheet: row.source_sheet,
    source_row: row.source_row,
    raw_account_name: row.raw_account_name,
    account_name: row.account_name,
    account_group: row.account_group,
    account_subgroup: row.account_subgroup,
    amount: row.amount,
    needs_review: row.needs_review,
    mapping_confidence: row.mapping_confidence,
    mapping_source: row.mapping_source,
    review_reason: row.review_reason,
    import_status: row.import_status,
    import_batch_id: row.import_batch_id,
    source_file: row.source_file,
  }));
}

function normalizeMappingRows(mappingRows = []) {
  return mappingRows.map((row) => ({
    company: row.companies?.ticker_symbol || row.company_id,
    fiscal_year: row.fiscal_year,
    statement_type: row.statement_type,
    raw_account_name: row.raw_account_name,
    current_group: row.account_group,
    suggested_group: row.suggested_account_group,
    confidence: row.mapping_confidence,
    source: row.mapping_source,
    needs_review: row.needs_review,
    review_reason: row.review_reason,
    source_file: row.source_file,
    source_sheet: row.source_sheet,
    source_row: row.source_row,
  }));
}

function normalizeLineageRows(importBatches = []) {
  return importBatches.map((row) => ({
    imported_at: row.imported_at,
    company: row.companies?.ticker_symbol || row.company_id,
    fiscal_year: row.fiscal_year,
    period_type: row.period_type,
    period: row.period,
    file_name: row.file_name,
    status: row.status,
    total_rows: row.total_rows,
    review_count: row.review_count,
    source_type: row.source_type,
    parser_profile: row.parser_profile,
    batch_id: row.id,
  }));
}

export function buildFinancialExcelWorkbook({
  company = {},
  companyId,
  store = {},
  years = [],
  importBatches = [],
  rawRows = [],
  mappingRows = [],
  language = 'th',
  labelMode = 'bilingual',
  unit = 'million',
  mode = 'latest',
} = {}) {
  const lang = language === 'en' ? 'en' : 'th';
  const th = lang === 'th';
  const bilingual = labelMode === 'bilingual';
  const t = TEXT[lang];
  const actualYears = years.map(Number).filter(Boolean).sort((a, b) => a - b);
  const metricsByYear = Object.fromEntries(actualYears.map((year) => [year, getMetrics(getAnnualGroups(store, companyId || company.id, year))]));
  const reviewRows = mappingRows.filter((row) => row?.needs_review !== false || row?.account_group === 'other' || Number(row?.mapping_confidence) < 0.86);
  const hasImportantReview = reviewRows.length > 0;
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
    [t.dataStatus, hasImportantReview ? t.reviewWarning : t.clean],
    [],
    [t.warning, 'AI can help map accounts, but exported figures should be reconciled with source financial statements before external or filing use.'],
  ], t.cover);

  appendSheet(wb, statementSheetRows(t.summary, [
    ['revenue', th ? 'รายได้รวม' : 'Total revenue'], ['netProfit', th ? 'กำไรสุทธิ' : 'Net profit'], ['asset', th ? 'สินทรัพย์รวม' : 'Total assets'],
    ['liability', th ? 'หนี้สินรวม' : 'Total liabilities'], ['equity', th ? 'ส่วนของเจ้าของ' : 'Equity'], ['netMargin', th ? 'Net margin %' : 'Net margin %'], ['debtToEquity', th ? 'D/E' : 'D/E'],
  ], metricsByYear, actualYears, unit, lang), t.summary);
  appendSheet(wb, statementSheetRows(t.income, rows.income, metricsByYear, actualYears, unit, lang), t.income);
  appendSheet(wb, statementSheetRows(t.balance, rows.balance, metricsByYear, actualYears, unit, lang), t.balance);
  appendSheet(wb, statementSheetRows(t.cashflow, rows.cashflow, metricsByYear, actualYears, unit, lang), t.cashflow);
  appendSheet(wb, statementSheetRows(t.ratios, rows.ratios, metricsByYear, actualYears, 'baht', lang), t.ratios);
  appendJsonSheet(wb, normalizeMappingRows(reviewRows), t.mapping);
  appendJsonSheet(wb, normalizeRawRows(rawRows), t.raw);
  appendJsonSheet(wb, normalizeLineageRows(importBatches), t.lineage);
  return wb;
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
  return fileName;
}
