import * as XLSX from 'xlsx';
import { parseFinancialWorkbook } from './parser.js';

const MONTH_ALIASES = new Map([
  ['มค', 1], ['ม.ค', 1], ['มกราคม', 1], ['jan', 1], ['january', 1], ['1', 1], ['01', 1],
  ['กพ', 2], ['ก.พ', 2], ['กุมภาพันธ์', 2], ['feb', 2], ['february', 2], ['2', 2], ['02', 2],
  ['มีค', 3], ['มี.ค', 3], ['มีนาคม', 3], ['mar', 3], ['march', 3], ['3', 3], ['03', 3],
  ['เมย', 4], ['เม.ย', 4], ['เมษายน', 4], ['apr', 4], ['april', 4], ['4', 4], ['04', 4],
  ['พค', 5], ['พ.ค', 5], ['พฤษภาคม', 5], ['may', 5], ['5', 5], ['05', 5],
  ['มิย', 6], ['มิ.ย', 6], ['มิถุนายน', 6], ['jun', 6], ['june', 6], ['6', 6], ['06', 6],
  ['กค', 7], ['ก.ค', 7], ['กรกฎาคม', 7], ['jul', 7], ['july', 7], ['7', 7], ['07', 7],
  ['สค', 8], ['ส.ค', 8], ['สิงหาคม', 8], ['aug', 8], ['august', 8], ['8', 8], ['08', 8],
  ['กย', 9], ['ก.ย', 9], ['กันยายน', 9], ['sep', 9], ['sept', 9], ['september', 9], ['9', 9], ['09', 9],
  ['ตค', 10], ['ต.ค', 10], ['ตุลาคม', 10], ['oct', 10], ['october', 10], ['10', 10],
  ['พย', 11], ['พ.ย', 11], ['พฤศจิกายน', 11], ['nov', 11], ['november', 11], ['11', 11],
  ['ธค', 12], ['ธ.ค', 12], ['ธันวาคม', 12], ['dec', 12], ['december', 12], ['12', 12],
]);

const clean = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/\u00a0/g, ' ')
  .replace(/[\r\n]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const norm = (value) => clean(value)
  .toLowerCase()
  .replace(/[.()\[\]{}\s\-–—_:;,]+/g, '')
  .replace(/กํา/g, 'กำ')
  .replace(/ดํา/g, 'ดำ')
  .replace(/จํ/g, 'จำ')
  .replace(/สํ/g, 'สำ');

const parseNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let text = String(value).trim();
  if (!text || text === '-' || text === '–') return null;
  const negative = /^\(.*\)$/.test(text) || text.includes('−');
  text = text
    .replace(/[(),]/g, '')
    .replace(/[฿บาท\s]/g, '')
    .replace(/−/g, '-')
    .replace(/[^0-9.\-]/g, '');
  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  return negative && num > 0 ? -num : num;
};

const findYear = (rows, fallbackYear = new Date().getFullYear()) => {
  const text = rows.slice(0, 25).flat().map(clean).join(' ');
  const be = text.match(/25\d{2}/g)?.map(Number)?.find(y => y >= 2540 && y <= 2600);
  if (be) return be - 543;
  const ce = text.match(/20\d{2}/g)?.map(Number)?.find(y => y >= 2015 && y <= 2100);
  return ce || fallbackYear;
};

const monthFromHeader = (value) => {
  const n = norm(value).replace(/ปี|เดือน|month|period/g, '');
  if (MONTH_ALIASES.has(n)) return MONTH_ALIASES.get(n);
  const m = clean(value).match(/(?:^|\D)(1[0-2]|0?[1-9])(?:\D|$)/);
  return m ? Number(m[1]) : null;
};

const metricFromLabel = (label) => {
  const t = norm(label);
  if (!t) return null;
  if (/(รายได้|ยอดขาย|sales|revenue|income)/.test(t)) return 'revenue';
  if (/(ต้นทุนขาย|costofsales|cogs)/.test(t)) return 'cogs';
  if (/(ค่าใช้จ่าย|expense|ค่าใช้จ่ายขาย|ค่าใช้จ่ายบริหาร|sga|administrative|selling)/.test(t)) return 'expense';
  if (/(กำไรสุทธิ|กําไรสุทธิ|netprofit|netincome)/.test(t)) return 'net_profit';
  if (/(เงินสดและรายการเทียบเท่าเงินสด|cashandcashequivalents|cash equivalents|เงินสด$|^cash$)/.test(t)) return 'cash';
  if (/(เงินสดเข้า|รับเงิน|cashin|cashreceipt|receipt)/.test(t)) return 'cash_in';
  if (/(เงินสดออก|จ่ายเงิน|cashout|payment|cashpayment)/.test(t)) return 'cash_out';
  if (/(เงินกู้|loan|borrow|debt)/.test(t)) return 'loan';
  if (/(สินทรัพย์|asset)/.test(t)) return 'asset';
  if (/(หนี้สิน|liabilit)/.test(t)) return 'liability';
  if (/(ทุน|ส่วนของเจ้าของ|equity)/.test(t)) return 'equity';
  if (/(ลูกหนี้|receivable|ar)/.test(t)) return 'receivable';
  if (/(เจ้าหนี้|payable|ap)/.test(t)) return 'payable';
  if (/(สินค้าคงเหลือ|inventory)/.test(t)) return 'inventory';
  return 'other';
};

const statementTypeForMetric = (metric) => {
  if (['asset', 'liability', 'equity', 'loan', 'cash', 'inventory', 'receivable', 'payable'].includes(metric)) return 'balance_sheet';
  if (['cash_in', 'cash_out'].includes(metric)) return 'cash_flow';
  return 'income_statement';
};

function sheetRows(workbook, sheetName) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true, blankrows: false });
}

function detectMonthlyTable(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r += 1) {
    const normalized = (rows[r] || []).map(norm);
    const monthIdx = normalized.findIndex(v => ['month', 'เดือน', 'period', 'งวด'].includes(v));
    const revenueIdx = normalized.findIndex(v => /revenue|sales|รายได้|ยอดขาย/.test(v));
    const expenseIdx = normalized.findIndex(v => /expense|ค่าใช้จ่าย/.test(v));
    if (monthIdx >= 0 && (revenueIdx >= 0 || expenseIdx >= 0)) {
      return { headerRow: r, normalized };
    }
  }
  return null;
}

function parseMonthlyTable(rows, sheetName, fileName, companyId, fallbackYear) {
  const header = detectMonthlyTable(rows);
  if (!header) return [];
  const { headerRow, normalized } = header;
  const idx = (patterns) => normalized.findIndex(v => patterns.some(p => p.test(v)));
  const cols = {
    month: idx([/^month$/, /^เดือน$/, /^period$/, /^งวด$/]),
    year: idx([/^year$/, /^ปี$/]),
    revenue: idx([/revenue|sales|รายได้|ยอดขาย/]),
    expense: idx([/expense|ค่าใช้จ่าย/]),
    cashIn: idx([/cashin|เงินสดเข้า|รับเงิน/]),
    cashOut: idx([/cashout|เงินสดออก|จ่ายเงิน/]),
    loan: idx([/loan|เงินกู้|borrow|debt/]),
  };
  const parsed = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const month = monthFromHeader(row[cols.month]);
    if (!month) continue;
    const yearCell = parseNumber(row[cols.year]);
    const fiscalYear = yearCell ? (yearCell > 2400 ? yearCell - 543 : yearCell) : fallbackYear;
    parsed.push({
      company_id: companyId,
      fiscal_year: Number(fiscalYear),
      month,
      revenue: parseNumber(row[cols.revenue]) || 0,
      expense: parseNumber(row[cols.expense]) || 0,
      cash_in: parseNumber(row[cols.cashIn]) || 0,
      cash_out: parseNumber(row[cols.cashOut]) || 0,
      loan_balance: parseNumber(row[cols.loan]) || 0,
      source_file: fileName,
      source_sheet: sheetName,
      source_row: r + 1,
      import_status: 'confirmed',
    });
  }
  return parsed;
}

function parseMonthlyMatrix(rows, sheetName, fileName, companyId, fallbackYear) {
  let headerRow = -1;
  let monthCols = [];
  for (let r = 0; r < Math.min(rows.length, 40); r += 1) {
    const found = (rows[r] || []).map((v, colIdx) => ({ colIdx, month: monthFromHeader(v) })).filter(v => v.month);
    if (found.length >= 3) {
      headerRow = r;
      monthCols = found;
      break;
    }
  }
  if (headerRow < 0) return [];
  const monthly = new Map(monthCols.map(({ month }) => [month, {
    company_id: companyId,
    fiscal_year: fallbackYear,
    month,
    revenue: 0,
    expense: 0,
    cash_in: 0,
    cash_out: 0,
    loan_balance: 0,
    source_file: fileName,
    source_sheet: sheetName,
    source_row: headerRow + 1,
    import_status: 'confirmed',
  }]));
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const label = clean(row.slice(0, 3).find(v => clean(v)));
    if (!label) continue;
    const metric = metricFromLabel(label);
    if (!metric || metric === 'other') continue;
    monthCols.forEach(({ colIdx, month }) => {
      const value = parseNumber(row[colIdx]);
      if (value === null) return;
      const target = monthly.get(month);
      if (metric === 'revenue') target.revenue += value;
      else if (['expense', 'cogs'].includes(metric)) target.expense += Math.abs(value);
      else if (metric === 'net_profit') {
        // Net profit is informative but not stored in monthly operating rows to avoid double counting.
      } else if (metric === 'cash_in') target.cash_in += value;
      else if (metric === 'cash_out') target.cash_out += Math.abs(value);
      else if (metric === 'loan') target.loan_balance += value;
    });
  }
  return [...monthly.values()].filter(row => row.revenue || row.expense || row.cash_in || row.cash_out || row.loan_balance);
}

function detectTrialBalanceHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 50); r += 1) {
    const h = (rows[r] || []).map(norm);
    const accountCode = h.findIndex(v => /accountcode|รหัสบัญชี|เลขที่บัญชี/.test(v));
    let accountName = h.findIndex(v => /accountname|ชื่อบัญชี|รายการบัญชี|ชื่อรายการ/.test(v));
    if (accountName < 0) accountName = h.findIndex((v, idx) => idx !== accountCode && /บัญชี|account/.test(v));
    const debit = h.findIndex(v => /^debit$|เดบิต/.test(v));
    const credit = h.findIndex(v => /^credit$|เครดิต/.test(v));
    const ending = h.findIndex(v => /ending|balance|ยอดคงเหลือ|ยอดยกไป/.test(v));
    if (accountName >= 0 && (ending >= 0 || debit >= 0 || credit >= 0)) {
      return { headerRow: r, accountCode, accountName, debit, credit, ending };
    }
  }
  return null;
}

function normalizeTrialBalanceRows(rows, sheetName, fileName, companyId, fallbackYear) {
  const header = detectTrialBalanceHeader(rows);
  if (!header) return [];
  const out = [];
  for (let r = header.headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const accountName = clean(row[header.accountName]);
    if (!accountName) continue;
    const debit = parseNumber(row[header.debit]) || 0;
    const credit = parseNumber(row[header.credit]) || 0;
    const endingBalance = header.ending >= 0 ? (parseNumber(row[header.ending]) || 0) : debit - credit;
    if (!debit && !credit && !endingBalance) continue;
    out.push({
      company_id: companyId,
      fiscal_year: fallbackYear,
      period_type: 'annual',
      period: 'FY',
      account_code: clean(row[header.accountCode]),
      account_name: accountName,
      debit,
      credit,
      ending_balance: endingBalance,
      account_group: metricFromLabel(accountName) || 'other',
      source_file: fileName,
      source_sheet: sheetName,
      source_row: r + 1,
    });
  }
  return out;
}

function trialBalanceToNormalized(tbRows, fileName) {
  return tbRows
    .filter(row => row.account_group && row.account_group !== 'other')
    .map(row => {
      const group = row.account_group;
      const amount = ['revenue', 'liability', 'equity'].includes(group)
        ? Math.abs(row.credit || row.ending_balance)
        : Math.abs(row.debit || row.ending_balance);
      return {
        company_id: row.company_id,
        fiscal_year: row.fiscal_year,
        period_type: row.period_type || 'annual',
        period: row.period || 'FY',
        statement_scope: 'private_company',
        statement_type: statementTypeForMetric(group),
        account_name: row.account_name,
        account_group: group,
        account_subgroup: null,
        industry_metric: 'private_trial_balance',
        note: 'Derived from private company trial balance',
        original_amount: amount,
        original_unit: 'baht',
        amount,
        normalized_unit: 'baht',
        raw_account_name: row.account_name,
        raw_amount: row.ending_balance,
        raw_unit: 'baht',
        source_file: fileName,
        source_sheet: row.source_sheet,
        source_row: row.source_row,
        source_column: null,
        source_cell: null,
        mapping_confidence: group === 'other' ? 0.3 : 0.85,
        needs_review: group === 'other',
      };
    });
}

export function parsePrivateWorkbook(workbook, companyId, fileName = '', sourceType = 'auto') {
  const summary = {
    fileName,
    parserVersion: 'PRIVATE_COMPANY_IMPORT_PACK_V1',
    sourceType,
    sheets: [],
    years: [],
    monthlyRows: 0,
    trialBalanceRows: 0,
    normalizedRows: 0,
    reviewCount: 0,
  };
  const monthlyRows = [];
  const trialBalanceRows = [];
  const normalizedRows = [];

  for (const sheetName of workbook.SheetNames || []) {
    if (/^DS_INTERNAL|^Recovered_/i.test(sheetName)) continue;
    const rows = sheetRows(workbook, sheetName);
    if (!rows.length) continue;
    summary.sheets.push(sheetName);
    const fallbackYear = findYear(rows);

    if (sourceType === 'financial_statement') {
      const parsed = parseFinancialWorkbook({ SheetNames: [sheetName], Sheets: { [sheetName]: workbook.Sheets[sheetName] } }, companyId, fileName);
      normalizedRows.push(...parsed);
      continue;
    }

    if (sourceType === 'monthly_report' || sourceType === 'auto') {
      const tableRows = parseMonthlyTable(rows, sheetName, fileName, companyId, fallbackYear);
      const matrixRows = tableRows.length ? [] : parseMonthlyMatrix(rows, sheetName, fileName, companyId, fallbackYear);
      monthlyRows.push(...tableRows, ...matrixRows);
    }

    if (sourceType === 'trial_balance' || sourceType === 'auto') {
      const tbRows = normalizeTrialBalanceRows(rows, sheetName, fileName, companyId, fallbackYear);
      trialBalanceRows.push(...tbRows);
      normalizedRows.push(...trialBalanceToNormalized(tbRows, fileName));
    }
  }

  const years = new Set([
    ...monthlyRows.map(row => row.fiscal_year),
    ...trialBalanceRows.map(row => row.fiscal_year),
    ...normalizedRows.map(row => row.fiscal_year),
  ].filter(Boolean));
  summary.years = [...years].sort((a, b) => b - a);
  summary.primaryYear = summary.years[0] || new Date().getFullYear();
  summary.monthlyRows = monthlyRows.length;
  summary.trialBalanceRows = trialBalanceRows.length;
  summary.normalizedRows = normalizedRows.length;
  summary.rows = monthlyRows.length + trialBalanceRows.length + normalizedRows.length;
  summary.reviewCount = normalizedRows.filter(row => row.needs_review).length;

  return { monthlyRows, trialBalanceRows, normalizedRows, summary };
}

export async function parsePrivateFile(file, companyId, sourceType = 'auto') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'array', cellDates: false });
        resolve(parsePrivateWorkbook(workbook, companyId, file?.name || 'upload', sourceType));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error || new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}
