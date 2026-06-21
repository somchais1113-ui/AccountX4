import * as XLSX from 'xlsx';

/**
 * Import Parser v2
 *
 * Goal: accept real Thai public-company financial statements with report-style Excel layouts,
 * not only rigid CSV templates. The parser reads the original workbook into normalized rows,
 * keeps source traceability, and maps only dashboard-level metrics to core groups to avoid
 * double-counting line-item details.
 */

export const STATEMENT_TYPES = {
  balance_sheet: [
    'งบฐานะการเงิน',
    'ฐานะการเงิน',
    'statement of financial position',
    'balance sheet',
  ],
  income_statement: [
    'งบกำไรขาดทุนเบ็ดเสร็จ',
    'งบกําไรขาดทุนเบ็ดเสร็จ',
    'งบกำไรขาดทุน',
    'งบกําไรขาดทุน',
    'statement of comprehensive income',
    'income statement',
    'profit and loss',
  ],
  cash_flow: [
    'งบกระแสเงินสด',
    'statement of cash flows',
    'cash flow',
  ],
  equity_statement: [
    'งบการเปลี่ยนแปลงส่วนของเจ้าของ',
    'statement of changes in equity',
  ],
};

export const PERIOD_SCOPES = {
  consolidated: ['งบการเงินรวม', 'consolidated'],
  separate: ['งบเฉพาะกิจการ', 'เฉพาะกิจการ', 'separate'],
};

// Keep dashboard groups stable. Other details are retained as `other` + account_subgroup.
export const CORE_GROUPS = {
  revenue: ['รวมรายได้', 'total revenue', 'total income', 'revenue', 'sales'],
  cogs: ['ต้นทุนขาย', 'ต้นทุนการให้บริการ', 'cost of sales', 'cost of goods sold', 'cogs'],
  sga: ['ค่าใช้จ่ายในการขาย', 'ต้นทุนในการจัดจำหน่าย', 'ค่าใช้จ่ายในการบริหาร', 'selling', 'administrative', 'sga'],
  expense: ['รวมค่าใช้จ่าย', 'total expenses'],
  finance_cost: ['ต้นทุนทางการเงิน', 'ค่าใช้จ่ายดอกเบี้ย', 'finance cost', 'interest expense'],
  tax: ['ค่าใช้จ่ายภาษีเงินได้', 'ภาษีเงินได้', 'income tax', 'tax expense'],
  net_profit: ['กำไรสุทธิ', 'กําไรสุทธิ', 'ขาดทุนสุทธิ', 'net profit', 'net income', 'net loss'],
  asset: ['รวมสินทรัพย์', 'total assets'],
  liability: ['รวมหนี้สิน', 'total liabilities'],
  equity: ['รวมส่วนของเจ้าของ', 'รวมส่วนของผู้ถือหุ้น', 'total equity', 'shareholders equity'],
  cash: ['เงินสดและรายการเทียบเท่าเงินสดปลายปี', 'cash and cash equivalents at end', 'cash at end'],
  inventory: ['สินค้าคงเหลือ', 'inventory', 'inventories'],
  receivable: ['ลูกหนี้การค้า', 'trade receivables', 'accounts receivable'],
  payable: ['เจ้าหนี้การค้า', 'trade payables', 'accounts payable'],
  loan: ['เงินกู้ยืม', 'borrowings', 'loan'],
  operating_cash_flow: ['เงินสดสุทธิได้มาจากกิจกรรมดำเนินงาน', 'เงินสดสุทธิใช้ไปในกิจกรรมดำเนินงาน', 'net cash from operating activities'],
  investing_cash_flow: ['เงินสดสุทธิได้มาจากกิจกรรมลงทุน', 'เงินสดสุทธิใช้ไปในกิจกรรมลงทุน', 'net cash from investing activities'],
  financing_cash_flow: ['เงินสดสุทธิได้มาจากกิจกรรมจัดหาเงิน', 'เงินสดสุทธิใช้ไปในกิจกรรมจัดหาเงิน', 'net cash from financing activities'],
  eps_basic: ['กำไรต่อหุ้นขั้นพื้นฐาน', 'basic earnings per share'],
};

const SECTION_LABELS = {
  current_assets: ['สินทรัพย์หมุนเวียน', 'current assets'],
  non_current_assets: ['สินทรัพย์ไม่หมุนเวียน', 'non-current assets', 'non current assets'],
  current_liabilities: ['หนี้สินหมุนเวียน', 'current liabilities'],
  non_current_liabilities: ['หนี้สินไม่หมุนเวียน', 'non-current liabilities', 'non current liabilities'],
  equity: ['ส่วนของเจ้าของ', 'ส่วนของผู้ถือหุ้น', 'equity'],
  revenue: ['รายได้', 'revenue', 'income'],
  expenses: ['ค่าใช้จ่าย', 'expenses'],
  operating_cash_flow: ['กิจกรรมดำเนินงาน', 'operating activities'],
  investing_cash_flow: ['กิจกรรมลงทุน', 'investing activities'],
  financing_cash_flow: ['กิจกรรมจัดหาเงิน', 'financing activities'],
};

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[()（）\[\]{}]/g, '')
    .replace(/[\s\-–—_:;,.]+/g, '')
    .replace(/กํา/g, 'กำ')
    .replace(/ดํา/g, 'ดำ')
    .replace(/จํ/g, 'จำ')
    .replace(/สํ/g, 'สำ');
}

function rowToText(row) {
  return (row || []).map(normalizeText).filter(Boolean).join(' ');
}

function keywordMatch(text, keywords) {
  const t = normalizeForMatch(text);
  return keywords.some((keyword) => t.includes(normalizeForMatch(keyword)));
}

export function detectStatementType(text) {
  if (!text) return 'unknown';
  const t = normalizeText(text);
  // More specific names first to avoid "งบกำไรขาดทุน" winning over comprehensive income.
  if (keywordMatch(t, STATEMENT_TYPES.equity_statement)) return 'equity_statement';
  if (keywordMatch(t, STATEMENT_TYPES.cash_flow)) return 'cash_flow';
  if (keywordMatch(t, STATEMENT_TYPES.income_statement)) return 'income_statement';
  if (keywordMatch(t, STATEMENT_TYPES.balance_sheet)) return 'balance_sheet';
  return 'unknown';
}

function detectScope(text, fallback = 'consolidated') {
  if (!text) return fallback;
  if (keywordMatch(text, PERIOD_SCOPES.separate)) return 'separate';
  if (keywordMatch(text, PERIOD_SCOPES.consolidated)) return 'consolidated';
  return fallback;
}

function detectUnit(text, fallback = { unit: 'baht', multiplier: 1 }) {
  if (!text) return fallback;
  const t = normalizeForMatch(text);
  if (t.includes('ล้านบาท') || t.includes('millionbaht') || t.includes('thbmillion')) return { unit: 'million_baht', multiplier: 1000000 };
  if (t.includes('พันบาท') || t.includes('thousandbaht') || t.includes('thbthousand')) return { unit: 'thousand_baht', multiplier: 1000 };
  if (t.includes('บาท') || t.includes('baht') || t.includes('thb')) return { unit: 'baht', multiplier: 1 };
  return fallback;
}

export function extractPeriodInfo(value) {
  const t = normalizeText(value).toUpperCase().replace(/,/g, '').trim();
  if (!t) return null;

  let year = null;
  const fullYearMatch = t.match(/(?:^|[^0-9])(?:พ\.?ศ\.?\s*)?(25[0-9]{2}|20[0-9]{2})(?:[^0-9]|$)/);
  if (fullYearMatch) {
    year = Number(fullYearMatch[1]);
  } else {
    const shortThai = t.match(/(?:ปี|FY|Q[1-4]|ไตรมาส(?:ที่)?)\s*([6-9][0-9])\b/) || t.match(/^([6-9][0-9])$/);
    if (shortThai) year = 2500 + Number(shortThai[1]);
  }

  if (!year) return null;
  if (year >= 2400) year -= 543;

  let period_type = 'FY';
  if (/Q1|ไตรมาส\s*(?:ที่)?\s*1/.test(t)) period_type = 'Q1';
  else if (/Q2|ไตรมาส\s*(?:ที่)?\s*2/.test(t)) period_type = 'Q2';
  else if (/Q3|ไตรมาส\s*(?:ที่)?\s*3/.test(t)) period_type = 'Q3';
  else if (/Q4|ไตรมาส\s*(?:ที่)?\s*4/.test(t)) period_type = 'Q4';
  else if (/6M|6\s*เดือน/.test(t)) period_type = '6M';
  else if (/9M|9\s*เดือน/.test(t)) period_type = '9M';

  return { year, period_type };
}

function parseNumberCell(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  let str = normalizeText(value);
  if (!str || str === '-' || str === '—') return null;
  if (/พ\.?ศ\.?/.test(str) || /หมายเหตุ/.test(str)) return null;

  let negative = false;
  if (/^\(.+\)$/.test(str)) {
    negative = true;
    str = str.slice(1, -1);
  }
  str = str
    .replace(/[฿,$€£]/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/−/g, '-');

  if (!/^-?\d+(\.\d+)?$/.test(str)) return null;
  const number = Number(str);
  if (!Number.isFinite(number)) return null;
  return negative ? -Math.abs(number) : number;
}

function isLikelyNoteRef(value) {
  const t = normalizeText(value);
  if (!t) return false;
  return /^(หมายเหตุ|note)$/i.test(t) || /^\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*$/.test(t);
}

function isHeaderOrFooter(rowText, statementType) {
  const t = normalizeForMatch(rowText);
  if (!t) return true;
  if (t.includes('หมายเหตุประกอบงบการเงินเป็นส่วนหนึ่งของงบการเงินนี้')) return true;
  if (t.includes('บริษัท') && !/[0-9]/.test(t)) return true;
  if (t.includes('สำหรับปีสิ้นสุด') || t.includes('ณวันที่')) return true;
  if (t === 'หมายเหตุ' || t === 'บาท') return true;
  // Repeated statement title rows should not be line items.
  if (statementType !== 'unknown' && detectStatementType(rowText) === statementType) return true;
  return false;
}

function cellsWithPeriods(row) {
  const periods = [];
  (row || []).forEach((cell, index) => {
    if (index === 0) return; // Date rows usually store the date in column A; value-year headers are later columns.
    const info = extractPeriodInfo(cell);
    if (info) periods.push({ colIdx: index, year: info.year, period_type: info.period_type });
  });
  return periods;
}

function hasNumericBelow(rows, rowIdx, colIdx, lookahead = 40) {
  const end = Math.min(rows.length, rowIdx + lookahead + 1);
  for (let i = rowIdx + 1; i < end; i++) {
    if (parseNumberCell(rows[i]?.[colIdx]) !== null) return true;
  }
  return false;
}

function getValueAmounts(row, yearColumns) {
  return yearColumns
    .map((col) => ({ ...col, value: parseNumberCell(row[col.colIdx]), raw: row[col.colIdx] }))
    .filter((item) => item.value !== null);
}

function findFirstValueCol(yearColumns) {
  if (!yearColumns.length) return null;
  return Math.min(...yearColumns.map((col) => col.colIdx));
}

function labelInfo(row, firstValueCol = row?.length || 0) {
  const max = Math.max(0, firstValueCol);
  for (let index = 0; index < max; index++) {
    const text = normalizeText(row?.[index]);
    if (!text) continue;
    if (isLikelyNoteRef(text)) continue;
    if (extractPeriodInfo(text)) continue;
    if (keywordMatch(text, ['บาท', 'พันบาท', 'ล้านบาท'])) continue;
    return { label: text, colIdx: index };
  }
  return { label: '', colIdx: null };
}

function findNote(row, labelColIdx, firstValueCol) {
  const notes = [];
  for (let index = 0; index < firstValueCol; index++) {
    if (index === labelColIdx) continue;
    const text = normalizeText(row?.[index]);
    if (!text) continue;
    if (isLikelyNoteRef(text) && !/^หมายเหตุ$/i.test(text)) notes.push(text);
  }
  return notes.length ? notes.join(', ') : null;
}

function detectSubgroupFromText(text, fallback = null) {
  for (const [key, keywords] of Object.entries(SECTION_LABELS)) {
    if (keywordMatch(text, keywords)) return key;
  }
  return fallback;
}

function isLineContinuationCandidate(label, rows, rowIdx, yearColumns) {
  if (!label || normalizeText(label).length < 32) return false;
  if (keywordMatch(label, ['รวม', 'total', 'รายได้', 'ค่าใช้จ่าย', 'สินทรัพย์หมุนเวียน', 'หนี้สินหมุนเวียน', 'ส่วนของเจ้าของ'])) return false;
  const end = Math.min(rows.length, rowIdx + 4);
  for (let i = rowIdx + 1; i < end; i++) {
    const row = rows[i] || [];
    const amounts = getValueAmounts(row, yearColumns);
    const firstValueCol = findFirstValueCol(yearColumns) ?? row.length;
    const nextLabel = labelInfo(row, firstValueCol);
    if (amounts.length && nextLabel.label) return true;
    if (rowToText(row)) return false;
  }
  return false;
}

function mapIncomeStatement(label, section) {
  const t = normalizeForMatch(label);
  const s = normalizeForMatch(section);

  if (t.includes('รวมรายได้') || t === 'totalrevenue' || t === 'totalincome') return { group: 'revenue', subgroup: 'total_revenue', confidence: 0.97 };
  if (t.includes('รายได้จากการขาย') || t.includes('รายได้จากการให้บริการ') || t.includes('salesrevenue')) return { group: 'other', subgroup: 'revenue_detail', confidence: 0.82 };
  if (t.includes('รายได้อื่น') || t.includes('otherincome')) return { group: 'other', subgroup: 'other_income', confidence: 0.82 };
  if (t.includes('กำไรก่อนต้นทุนทางการเงิน') || t.includes('profitbeforefinancecost') || t.includes('profitbeforefinancecostsandtax')) return { group: 'other', subgroup: 'profit_before_finance_cost_and_tax', confidence: 0.82 };
  if (t.includes('กำไรก่อนภาษี') || t.includes('profitbeforetax')) return { group: 'other', subgroup: 'profit_before_tax', confidence: 0.82 };
  if (t.includes('ต้นทุนขาย') || t.includes('ต้นทุนการให้บริการ') || t.includes('costofsales') || t.includes('cogs')) return { group: 'cogs', subgroup: 'cost_of_sales', confidence: 0.94 };
  if (t.includes('ค่าใช้จ่ายในการขาย') || t.includes('ต้นทุนในการจัดจำหน่าย') || t.includes('sellingexpense')) return { group: 'sga', subgroup: 'selling_distribution_expense', confidence: 0.93 };
  if (t.includes('ค่าใช้จ่ายในการบริหาร') || t.includes('administrativeexpense')) return { group: 'sga', subgroup: 'administrative_expense', confidence: 0.93 };
  if (t.includes('รวมค่าใช้จ่าย') || t.includes('totalexpenses')) return { group: 'expense', subgroup: 'total_expense', confidence: 0.9 };
  if (t.includes('ต้นทุนทางการเงิน') || t.includes('financecost')) return { group: 'finance_cost', subgroup: 'finance_cost', confidence: 0.95 };
  if (t.includes('ภาษีเงินได้') || t.includes('incometax')) return { group: 'tax', subgroup: 'tax_expense', confidence: 0.92 };
  if ((t.includes('กำไรสุทธิ') || t.includes('ขาดทุนสุทธิ') || t.includes('netprofit') || t.includes('netincome')) && !t.includes('ต่อหุ้น')) return { group: 'net_profit', subgroup: 'net_profit', confidence: 0.97 };
  if (t.includes('กำไรก่อนต้นทุนทางการเงิน') || t.includes('operatingprofit')) return { group: 'other', subgroup: 'operating_profit', confidence: 0.82 };
  if (t.includes('กำไรต่อหุ้นขั้นพื้นฐาน') || t.includes('basicearningspershare')) return { group: 'eps_basic', subgroup: 'eps_basic', confidence: 0.96 };
  if (s.includes('ค่าใช้จ่าย')) return { group: 'other', subgroup: 'expense_detail', confidence: 0.65 };
  if (s.includes('รายได้')) return { group: 'other', subgroup: 'revenue_detail', confidence: 0.65 };
  return null;
}

function mapBalanceSheet(label, section) {
  const t = normalizeForMatch(label);
  const s = normalizeForMatch(section);

  if (t === 'รวมสินทรัพย์' || t === 'totalassets') return { group: 'asset', subgroup: 'total_assets', confidence: 0.98 };
  if (t === 'รวมหนี้สิน' || t === 'totalliabilities') return { group: 'liability', subgroup: 'total_liabilities', confidence: 0.98 };
  if (t.includes('รวมส่วนของเจ้าของ') || t.includes('รวมส่วนของผู้ถือหุ้น') || t === 'totalequity' || t === 'totalshareholdersequity') return { group: 'equity', subgroup: 'total_equity', confidence: 0.98 };
  if (t.includes('รวมหนี้สินและส่วนของเจ้าของ') || t.includes('totalliabilitiesandequity')) return { group: 'other', subgroup: 'balance_check_total', confidence: 0.85 };
  if (t.includes('รวมสินทรัพย์หมุนเวียน')) return { group: 'other', subgroup: 'current_assets_total', confidence: 0.86 };
  if (t.includes('รวมสินทรัพย์ไม่หมุนเวียน')) return { group: 'other', subgroup: 'non_current_assets_total', confidence: 0.86 };
  if (t.includes('รวมหนี้สินหมุนเวียน')) return { group: 'other', subgroup: 'current_liabilities_total', confidence: 0.86 };
  if (t.includes('รวมหนี้สินไม่หมุนเวียน')) return { group: 'other', subgroup: 'non_current_liabilities_total', confidence: 0.86 };
  if (t.includes('เงินสดและรายการเทียบเท่าเงินสด')) return { group: 'cash', subgroup: 'cash_and_cash_equivalents', confidence: 0.93 };
  if (t.includes('สินค้าคงเหลือ') || t.includes('inventory')) return { group: 'inventory', subgroup: 'inventory', confidence: 0.9 };
  if (t.includes('ลูกหนี้การค้า') || t.includes('tradereceivable')) return { group: 'receivable', subgroup: 'trade_receivables', confidence: 0.9 };
  if (t.includes('เจ้าหนี้การค้า') || t.includes('tradepayable')) return { group: 'payable', subgroup: 'trade_payables', confidence: 0.9 };
  if (t.includes('เงินกู้ยืม') || t.includes('borrowings') || t.includes('loan')) return { group: 'loan', subgroup: 'borrowings', confidence: 0.9 };
  const subgroup = detectSubgroupFromText(section) || detectSubgroupFromText(label) || (s.includes('สินทรัพย์') ? 'asset_detail' : null);
  return { group: 'other', subgroup, confidence: 0.62 };
}

function mapCashFlow(label, section) {
  const t = normalizeForMatch(label);
  const s = normalizeForMatch(section);
  if (t.includes('เงินสดสุทธิได้มาจากกิจกรรมดำเนินงาน') || t.includes('เงินสดสุทธิใช้ไปในกิจกรรมดำเนินงาน') || t.includes('netcashfromoperating')) return { group: 'operating_cash_flow', subgroup: 'net_operating_cash_flow', confidence: 0.98 };
  if (t.includes('เงินสดสุทธิได้มาจากกิจกรรมลงทุน') || t.includes('เงินสดสุทธิใช้ไปในกิจกรรมลงทุน') || t.includes('netcashfrominvesting')) return { group: 'investing_cash_flow', subgroup: 'net_investing_cash_flow', confidence: 0.98 };
  if (t.includes('เงินสดสุทธิได้มาจากกิจกรรมจัดหาเงิน') || t.includes('เงินสดสุทธิใช้ไปในกิจกรรมจัดหาเงิน') || t.includes('netcashfromfinancing')) return { group: 'financing_cash_flow', subgroup: 'net_financing_cash_flow', confidence: 0.98 };
  if (t.includes('เงินสดและรายการเทียบเท่าเงินสดปลายปี') || t.includes('cashandcashequivalentsatend')) return { group: 'other', subgroup: 'ending_cash', confidence: 0.88 };
  if (t.includes('เงินสดและรายการเทียบเท่าเงินสดต้นปี') || t.includes('cashandcashequivalentsatbeginning')) return { group: 'other', subgroup: 'beginning_cash', confidence: 0.85 };
  if (s.includes('กิจกรรมดำเนินงาน')) return { group: 'other', subgroup: 'operating_cash_flow_detail', confidence: 0.68 };
  if (s.includes('กิจกรรมลงทุน')) return { group: 'other', subgroup: 'investing_cash_flow_detail', confidence: 0.68 };
  if (s.includes('กิจกรรมจัดหาเงิน')) return { group: 'other', subgroup: 'financing_cash_flow_detail', confidence: 0.68 };
  return { group: 'other', subgroup: 'cash_flow_detail', confidence: 0.6 };
}

function autoMapAccount(accountName, statementType, section = '') {
  const label = normalizeText(accountName);
  if (!label) return { group: 'other', subgroup: null, confidence: 0.3 };

  if (statementType === 'income_statement') return mapIncomeStatement(label, section) || { group: 'other', subgroup: 'income_statement_detail', confidence: 0.55 };
  if (statementType === 'balance_sheet') return mapBalanceSheet(label, section) || { group: 'other', subgroup: 'balance_sheet_detail', confidence: 0.55 };
  if (statementType === 'cash_flow') return mapCashFlow(label, section) || { group: 'other', subgroup: 'cash_flow_detail', confidence: 0.55 };
  if (statementType === 'equity_statement') return { group: 'other', subgroup: 'equity_statement_detail', confidence: 0.55 };

  // Generic fallback for simple CSV templates.
  const t = normalizeForMatch(label);
  for (const [group, keywords] of Object.entries(CORE_GROUPS)) {
    if (keywords.some((keyword) => t === normalizeForMatch(keyword))) return { group, subgroup: group, confidence: 0.92 };
    if (keywords.some((keyword) => t.includes(normalizeForMatch(keyword)))) return { group, subgroup: group, confidence: 0.72 };
  }
  return { group: 'other', subgroup: null, confidence: 0.5 };
}

function promoteRevenueFallback(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    if (row.statement_type !== 'income_statement') return;
    const key = [row.company_id, row.fiscal_year, row.period, row.statement_scope].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  grouped.forEach((items) => {
    if (items.some((row) => row.account_group === 'revenue')) return;
    const candidates = items.filter((row) => row.account_subgroup === 'revenue_detail');
    if (candidates.length === 1) {
      candidates[0].account_group = 'revenue';
      candidates[0].mapping_confidence = Math.max(candidates[0].mapping_confidence, 0.88);
      candidates[0].needs_review = false;
    }
  });
}

function detectWorkbookContext(rows, sheetName) {
  let companyName = null;
  let statementType = detectStatementType(sheetName);
  let scope = 'consolidated';
  let unitInfo = { unit: 'baht', multiplier: 1 };
  const contextRows = Math.min(rows.length, 60);

  for (let i = 0; i < contextRows; i++) {
    const rowText = rowToText(rows[i]);
    if (!rowText) continue;
    if (!companyName && keywordMatch(rowText, ['บริษัท', 'company'])) companyName = normalizeText(rows[i].find(Boolean));
    const detectedType = detectStatementType(rowText);
    if (statementType === 'unknown' && detectedType !== 'unknown') statementType = detectedType;
    scope = detectScope(rowText, scope);
    unitInfo = detectUnit(rowText, unitInfo);
  }

  return { companyName, statementType, scope, unitInfo };
}

function normalizeAmountForDashboard(value, group, statementType) {
  if (statementType === 'income_statement' && ['cogs', 'sga', 'expense', 'finance_cost', 'tax'].includes(group)) {
    return Math.abs(value);
  }
  return value;
}

function parseStandardStatementSheet(rows, sheetName, companyId, fileName) {
  const parsedRows = [];
  const context = detectWorkbookContext(rows, sheetName);
  let currentStatementType = context.statementType;
  let currentScope = context.scope;
  let unitInfo = context.unitInfo;
  let yearColumns = [];
  let currentSection = null;
  let currentSubsection = null;
  let pendingPrefix = null;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] || [];
    const rowText = rowToText(row);
    if (!rowText) continue;

    const detectedStatement = detectStatementType(rowText);
    if (detectedStatement !== 'unknown') currentStatementType = detectedStatement;
    currentScope = detectScope(rowText, currentScope);
    unitInfo = detectUnit(rowText, unitInfo);

    const detectedPeriods = cellsWithPeriods(row).filter((col) => hasNumericBelow(rows, rowIdx, col.colIdx));
    if (detectedPeriods.length) {
      yearColumns = detectedPeriods;
      pendingPrefix = null;
      continue;
    }

    if (!yearColumns.length) continue;
    if (isHeaderOrFooter(rowText, currentStatementType)) continue;

    const firstValueCol = findFirstValueCol(yearColumns) ?? row.length;
    const amounts = getValueAmounts(row, yearColumns);
    const info = labelInfo(row, firstValueCol);

    if (!amounts.length) {
      if (!info.label) continue;
      if (isLineContinuationCandidate(info.label, rows, rowIdx, yearColumns)) {
        pendingPrefix = { label: info.label, colIdx: info.colIdx };
        continue;
      }
      if (info.colIdx === 0) {
        currentSection = info.label;
        currentSubsection = null;
      } else {
        currentSubsection = info.label;
      }
      continue;
    }

    if (!info.label) continue;

    let cleanLabel = info.label;
    if (pendingPrefix && info.colIdx !== null && info.colIdx >= pendingPrefix.colIdx) {
      cleanLabel = `${pendingPrefix.label} ${cleanLabel}`;
      pendingPrefix = null;
    }

    const sectionText = [currentSection, currentSubsection].filter(Boolean).join(' / ');
    const mapping = autoMapAccount(cleanLabel, currentStatementType, sectionText);
    const note = findNote(row, info.colIdx, firstValueCol);

    amounts.forEach(({ colIdx, year, period_type, value, raw }) => {
      const rawNormalizedAmount = value * unitInfo.multiplier;
      const amount = normalizeAmountForDashboard(rawNormalizedAmount, mapping.group, currentStatementType);
      parsedRows.push({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${sheetName}-${rowIdx + 1}-${colIdx}-${year}`,
        company_id: companyId,
        company_name: context.companyName,
        fiscal_year: year,
        period_type: period_type === 'FY' ? 'annual' : 'period',
        period: period_type,
        statement_scope: currentScope,
        statement_type: currentStatementType !== 'unknown' ? currentStatementType : 'unknown',
        account_name: cleanLabel,
        account_group: mapping.group,
        account_subgroup: mapping.subgroup || detectSubgroupFromText(sectionText),
        industry_metric: null,
        note,
        original_amount: value,
        original_unit: unitInfo.unit,
        amount,
        normalized_unit: 'baht',
        raw_account_name: cleanLabel,
        raw_amount: raw,
        raw_unit: unitInfo.unit,
        source_file: fileName || null,
        source_sheet: sheetName,
        source_row: rowIdx + 1,
        source_column: XLSX.utils.encode_col(colIdx),
        source_cell: `${XLSX.utils.encode_col(colIdx)}${rowIdx + 1}`,
        section: currentSection,
        subsection: currentSubsection,
        mapping_confidence: mapping.confidence,
        needs_review: mapping.confidence < 0.85 || mapping.group === 'other',
      });
    });
  }

  return parsedRows;
}

function parseEquityStatementSheet(rows, sheetName, companyId, fileName) {
  const parsedRows = [];
  const context = detectWorkbookContext(rows, sheetName);
  // Equity statements have years in row labels and equity components in columns.
  // We keep them as source-traceable rows under `other` so they do not distort dashboard totals.
  const headerRows = rows.slice(0, Math.min(rows.length, 9));
  const componentByCol = new Map();
  for (let colIdx = 1; colIdx < 30; colIdx++) {
    const pieces = headerRows.map((row) => normalizeText(row?.[colIdx])).filter((text) => text && !isLikelyNoteRef(text) && !keywordMatch(text, ['บาท']));
    const header = normalizeText(pieces.join(' '));
    if (header) componentByCol.set(colIdx, header);
  }

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] || [];
    const label = normalizeText(row[0]);
    if (!label) continue;
    const periodInfo = extractPeriodInfo(label);
    if (!periodInfo) continue;

    for (const [colIdx, component] of componentByCol.entries()) {
      const value = parseNumberCell(row[colIdx]);
      if (value === null) continue;
      parsedRows.push({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${sheetName}-${rowIdx + 1}-${colIdx}`,
        company_id: companyId,
        company_name: context.companyName,
        fiscal_year: periodInfo.year,
        period_type: 'annual',
        period: 'FY',
        statement_scope: context.scope,
        statement_type: 'equity_statement',
        account_name: `${label} - ${component}`,
        account_group: 'other',
        account_subgroup: 'equity_statement_detail',
        industry_metric: null,
        note: findNote(row, 0, colIdx) || null,
        original_amount: value,
        original_unit: context.unitInfo.unit,
        amount: value * context.unitInfo.multiplier,
        normalized_unit: 'baht',
        raw_account_name: `${label} - ${component}`,
        raw_amount: row[colIdx],
        raw_unit: context.unitInfo.unit,
        source_file: fileName || null,
        source_sheet: sheetName,
        source_row: rowIdx + 1,
        source_column: XLSX.utils.encode_col(colIdx),
        source_cell: `${XLSX.utils.encode_col(colIdx)}${rowIdx + 1}`,
        section: 'งบการเปลี่ยนแปลงส่วนของเจ้าของ',
        subsection: component,
        mapping_confidence: 0.75,
        needs_review: true,
      });
    }
  }
  return parsedRows;
}

function makeSummary(rows, workbook, fileName) {
  const sheets = workbook.SheetNames || [];
  const years = [...new Set(rows.map((row) => row.fiscal_year))].filter(Boolean).sort((a, b) => b - a);
  const statements = [...new Set(rows.map((row) => row.statement_type))].filter(Boolean);
  const mappedCount = rows.filter((row) => !row.needs_review).length;
  const reviewCount = rows.length - mappedCount;
  return {
    fileName,
    parserVersion: 'IMPORT_PARSER_V2_SET_TH_LAYOUT',
    sheets,
    years,
    primaryYear: years[0] || new Date().getFullYear(),
    statements,
    rows: rows.length,
    mappedCount,
    reviewCount,
  };
}

export function parseFinancialWorkbook(workbook, companyId, fileName = '') {
  const results = [];

  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
    if (!rows || !rows.length) continue;

    const context = detectWorkbookContext(rows, sheetName);
    const topText = rows.slice(0, 12).map(rowToText).join(' ');
    const topStatementType = detectStatementType(`${sheetName} ${topText}`);
    const effectiveStatementType = topStatementType !== 'unknown' ? topStatementType : context.statementType;
    if (effectiveStatementType === 'equity_statement') {
      results.push(...parseEquityStatementSheet(rows, sheetName, companyId, fileName));
    } else {
      results.push(...parseStandardStatementSheet(rows, sheetName, companyId, fileName));
    }
  }

  promoteRevenueFallback(results);
  results.summary = makeSummary(results, workbook, fileName);
  return results;
}

export async function parseFinancialFile(file, companyId) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        if (!event.target?.result) throw new Error('Cannot read file data.');
        const workbook = XLSX.read(event.target.result, { type: 'array', cellDates: false });
        resolve(parseFinancialWorkbook(workbook, companyId, file?.name || 'upload'));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error || new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}
