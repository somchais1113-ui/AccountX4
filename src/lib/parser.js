import * as XLSX from 'xlsx';

/**
 * Flexible Parser for Public Company Financial Statements
 */

export const STATEMENT_TYPES = {
  balance_sheet: ['งบฐานะการเงิน', 'สินทรัพย์', 'หนี้สินและส่วนของเจ้าของ', 'balance sheet', 'statement of financial position'],
  income_statement: ['งบกำไรขาดทุน', 'งบกำไรขาดทุนเบ็ดเสร็จ', 'income statement', 'statement of comprehensive income', 'profit and loss'],
  cash_flow: ['งบกระแสเงินสด', 'statement of cash flows', 'cash flow'],
  equity_statement: ['งบการเปลี่ยนแปลงส่วนของเจ้าของ', 'statement of changes in equity']
};

export const PERIOD_SCOPES = {
  consolidated: ['งบการเงินรวม', 'รวม', 'consolidated'],
  separate: ['งบเฉพาะกิจการ', 'เฉพาะกิจการ', 'separate']
};

export const CORE_GROUPS = {
  revenue: ['รายได้', 'รายรับ', 'ยอดขาย', 'revenue', 'sales', 'income'],
  cogs: ['ต้นทุนขาย', 'ต้นทุนการให้บริการ', 'cogs', 'cost of goods sold', 'cost of sales'],
  sga: ['ค่าใช้จ่ายในการขาย', 'ค่าใช้จ่ายในการบริหาร', 'sga', 'selling and administrative'],
  expense: ['ค่าใช้จ่าย', 'expense', 'costs'],
  finance_cost: ['ต้นทุนทางการเงิน', 'ดอกเบี้ยจ่าย', 'finance cost', 'interest expense'],
  tax: ['ภาษีเงินได้', 'income tax', 'tax expense'],
  net_profit: ['กำไรสุทธิ', 'ขาดทุนสุทธิ', 'กำไร(ขาดทุน)', 'net profit', 'net loss', 'net income'],
  asset: ['รวมสินทรัพย์', 'สินทรัพย์รวม', 'total assets', 'assets'],
  liability: ['รวมหนี้สิน', 'หนี้สินรวม', 'total liabilities', 'liabilities'],
  equity: ['รวมส่วนของเจ้าของ', 'ส่วนของผู้ถือหุ้น', 'total equity', 'shareholders equity'],
  cash: ['เงินสดและรายการเทียบเท่าเงินสด', 'เงินสด', 'cash and cash equivalents'],
  inventory: ['สินค้าคงเหลือ', 'inventories', 'inventory'],
  receivable: ['ลูกหนี้การค้า', 'trade receivables', 'accounts receivable'],
  payable: ['เจ้าหนี้การค้า', 'trade payables', 'accounts payable'],
  loan: ['เงินกู้ยืม', 'borrowings', 'loans', 'หนี้สินที่มีภาระดอกเบี้ย'],
  operating_cash_flow: ['กระแสเงินสดจากกิจกรรมดำเนินงาน', 'operating activities'],
  investing_cash_flow: ['กระแสเงินสดจากกิจกรรมลงทุน', 'investing activities'],
  financing_cash_flow: ['กระแสเงินสดจากกิจกรรมจัดหาเงิน', 'financing activities']
};

function detectStatementType(text) {
  if (!text) return 'unknown';
  const t = String(text).toLowerCase();
  for (const [key, keywords] of Object.entries(STATEMENT_TYPES)) {
    if (keywords.some(k => t.includes(k))) return key;
  }
  return 'unknown';
}

function detectScope(text) {
  if (!text) return 'consolidated'; // Default
  const t = String(text).toLowerCase();
  for (const [key, keywords] of Object.entries(PERIOD_SCOPES)) {
    if (keywords.some(k => t.includes(k))) return key;
  }
  return 'consolidated'; // fallback
}

function detectUnit(text) {
  if (!text) return { unit: 'baht', multiplier: 1 };
  const t = String(text).toLowerCase();
  if (t.includes('ล้านบาท') || t.includes('million')) return { unit: 'million_baht', multiplier: 1000000 };
  if (t.includes('พันบาท') || t.includes('thousand')) return { unit: 'thousand_baht', multiplier: 1000 };
  return { unit: 'baht', multiplier: 1 };
}

function extractPeriodInfo(text) {
  // Remove commas to handle formatting like "2,566" or "2,024"
  const t = String(text).toUpperCase().replace(/,/g, '').trim();
  
  let year = null;
  // Match 25xx or 20xx anywhere in the string
  const yearMatch = t.match(/(?:พ\.ศ\.\s*)?(25[5-9]\d|20[1-3]\d)/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  } else {
    // Match exact short year strings: "ปี 66", "งบปี 67", or exactly "66"
    const shortMatch = t.match(/ปี\s*([6-9]\d)/) || (t.match(/^([6-9]\d)$/) ? t.match(/^([6-9]\d)$/) : null);
    if (shortMatch) {
      year = 2500 + parseInt(shortMatch[1], 10);
    } else {
      // Fallback for short English years like FY23, FY24
      const fyMatch = t.match(/FY\s*([2-9]\d)/);
      if (fyMatch) year = 2000 + parseInt(fyMatch[1], 10);
    }
  }

  if (!year) return null;
  if (year > 2500) year -= 543; // Convert BE to CE

  let period_type = 'FY';
  if (t.includes('Q1') || t.includes('ไตรมาส 1') || t.match(/ไตรมาสที่\s*1/)) period_type = 'Q1';
  else if (t.includes('Q2') || t.includes('ไตรมาส 2') || t.match(/ไตรมาสที่\s*2/)) period_type = 'Q2';
  else if (t.includes('Q3') || t.includes('ไตรมาส 3') || t.match(/ไตรมาสที่\s*3/)) period_type = 'Q3';
  else if (t.includes('Q4') || t.includes('ไตรมาส 4') || t.match(/ไตรมาสที่\s*4/)) period_type = 'Q4';
  else if (t.includes('6M') || t.includes('6 เดือน')) period_type = '6M';
  else if (t.includes('9M') || t.includes('9 เดือน')) period_type = '9M';

  return { year, period_type };
}

function autoMapAccount(accountName) {
  const t = String(accountName).toLowerCase().replace(/\s+/g, '');
  let bestMatch = 'other';
  let confidence = 0.5;

  for (const [group, keywords] of Object.entries(CORE_GROUPS)) {
    for (const keyword of keywords) {
      const kw = keyword.toLowerCase().replace(/\s+/g, '');
      if (t === kw) {
        return { group, confidence: 0.95 }; // Exact match
      }
      if (t.includes(kw)) {
        bestMatch = group;
        confidence = 0.75; // Partial match
      }
    }
  }
  return { group: bestMatch, confidence: confidence };
}

export async function parseFinancialFile(file, companyId) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!(e.target.result instanceof ArrayBuffer)) {
          throw new Error('Could not read file as binary data');
        }
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const results = [];

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
          if (!json || json.length === 0) continue;

          let currentStatementType = detectStatementType(sheetName);
          let currentScope = 'consolidated';
          let unitInfo = { unit: 'baht', multiplier: 1 };
          
          // Scan first 30 rows for context
          const contextRows = Math.min(json.length, 30);
          for (let i = 0; i < contextRows; i++) {
            const row = json[i];
            const rowText = row.join(' ');
            
            if (currentStatementType === 'unknown') {
              const detected = detectStatementType(rowText);
              if (detected !== 'unknown') currentStatementType = detected;
            }
            if (!rowText.includes('พัน') && !rowText.includes('ล้าน')) {
              // keep looking
            } else {
              const detectedUnit = detectUnit(rowText);
              if (detectedUnit.multiplier !== 1) unitInfo = detectedUnit;
            }
            
            if (rowText.includes('งบการเงินรวม') || rowText.includes('รวม')) {
              currentScope = 'consolidated';
            } else if (rowText.includes('เฉพาะกิจการ')) {
              currentScope = 'separate';
            }
          }

          // Find header row (the one with years)
          let headerRowIdx = -1;
          let yearColumns = []; // Array of { colIdx, year }

          for (let i = 0; i < contextRows; i++) {
            const row = json[i];
            for (let j = 0; j < row.length; j++) {
              const cell = row[j];
              const periodInfo = extractPeriodInfo(cell);
              if (periodInfo) {
                if (headerRowIdx === -1 || headerRowIdx === i) {
                  headerRowIdx = i;
                  yearColumns.push({ colIdx: j, year: periodInfo.year, period_type: periodInfo.period_type });
                }
              }
            }
            if (headerRowIdx !== -1) break; // Found header
          }

          if (headerRowIdx === -1 || yearColumns.length === 0) {
            // FALLBACK: Find the first row that has numbers in columns > 0
            for (let i = 0; i < contextRows; i++) {
              const row = json[i];
              let hasNumbers = false;
              let tempCols = [];
              let validNumCount = 0;
              for (let j = 1; j < row.length; j++) {
                const val = String(row[j] || '').replace(/,/g, '');
                if (val && !isNaN(parseFloat(val))) {
                  validNumCount++;
                  tempCols.push({ colIdx: j, year: new Date().getFullYear() - (j - 1), period_type: 'FY' });
                }
              }
              if (validNumCount > 0 && typeof row[0] === 'string' && row[0].trim().length > 0) {
                headerRowIdx = i > 0 ? i - 1 : 0; // Header is probably above or same row
                yearColumns = tempCols;
                break;
              }
            }
            
            if (yearColumns.length === 0) {
              console.warn(`Could not detect years or numeric data in sheet ${sheetName}`);
              continue; // Skip sheet if no data found
            }
          }

          // Parse data rows
          for (let i = headerRowIdx + 1; i < json.length; i++) {
            const row = json[i];
            const rawAccountName = row[0]; // Assuming column A is the account name
            
            if (!rawAccountName || typeof rawAccountName !== 'string' || rawAccountName.trim() === '') continue;

            const mapping = autoMapAccount(rawAccountName);

            for (const { colIdx, year, period_type } of yearColumns) {
              let rawAmount = row[colIdx];
              if (rawAmount === null || rawAmount === undefined || rawAmount === '') continue;
              
              // Handle parenthesis for negative values e.g. (1,250.00)
              let isNegative = false;
              let strVal = String(rawAmount).trim();
              if (strVal.startsWith('(') && strVal.endsWith(')')) {
                isNegative = true;
                strVal = strVal.substring(1, strVal.length - 1);
              }
              
              // Remove commas
              strVal = strVal.replace(/,/g, '');
              
              let numericAmount = parseFloat(strVal);
              if (isNaN(numericAmount)) continue;
              
              if (isNegative) numericAmount = -Math.abs(numericAmount);

              const normalizedAmount = numericAmount * unitInfo.multiplier;

              results.push({
                id: crypto.randomUUID(), // Temp ID for UI
                company_id: companyId,
                fiscal_year: year,
                period_type: period_type,
                period: period_type,
                statement_scope: currentScope,
                statement_type: currentStatementType !== 'unknown' ? currentStatementType : 'balance_sheet',
                account_name: rawAccountName.trim(),
                account_group: mapping.group,
                account_subgroup: null,
                industry_metric: null,
                note: row[1] && typeof row[1] === 'string' && row[1].length < 10 ? row[1] : null, // Assuming col B might be Note
                original_amount: numericAmount,
                original_unit: unitInfo.unit,
                amount: normalizedAmount,
                normalized_unit: 'baht',
                raw_account_name: rawAccountName.trim(),
                raw_amount: rawAmount,
                raw_unit: unitInfo.unit,
                source_sheet: sheetName,
                source_row: i + 1, // 1-indexed
                source_column: XLSX.utils.encode_col(colIdx),
                mapping_confidence: mapping.confidence,
                needs_review: mapping.confidence < 0.90,
              });
            }
          }
        }
        resolve(results);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
