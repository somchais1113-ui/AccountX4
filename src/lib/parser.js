import * as XLSX from 'xlsx';
import { applyTfrsStandardMetadata, evaluateTfrsDataQuality } from './accountingStandards.js';
import { enrichRowSemantics, runValidationEngine } from './accountingEngine.js';

/**
 * Industry Import Parser v3 / Industry Parser Pack v1
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
    'งบการเปลี่ยนแปลงส่วนของผู้ถือหุ้น',
    'งบการเปลี่ยนแปลง',
    'changes in equity',
    'statement of changes in equity',
  ],
};

export const PERIOD_SCOPES = {
  consolidated: ['งบการเงินรวม', 'consolidated'],
  separate: ['งบเฉพาะกิจการ', 'เฉพาะกิจการ', 'separate'],
};

// Keep dashboard groups stable for core metrics, while allowing supporting groups to be
// stored separately. This prevents double-counting details into dashboard totals and reduces
// unnecessary manual review for known Thai financial-statement line items.
export const CORE_GROUPS = {
  // Dashboard core groups
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
  cash: ['เงินสดและรายการเทียบเท่าเงินสด', 'cash and cash equivalents'],
  inventory: ['สินค้าคงเหลือ', 'inventory', 'inventories'],
  receivable: ['ลูกหนี้การค้า', 'trade receivables', 'accounts receivable'],
  payable: ['เจ้าหนี้การค้า', 'trade payables', 'accounts payable'],
  loan: ['เงินกู้ยืม', 'borrowings', 'loan'],
  operating_cash_flow: ['เงินสดสุทธิได้มาจากกิจกรรมดำเนินงาน', 'เงินสดสุทธิใช้ไปในกิจกรรมดำเนินงาน', 'net cash from operating activities'],
  investing_cash_flow: ['เงินสดสุทธิได้มาจากกิจกรรมลงทุน', 'เงินสดสุทธิใช้ไปในกิจกรรมลงทุน', 'net cash from investing activities'],
  financing_cash_flow: ['เงินสดสุทธิได้มาจากกิจกรรมจัดหาเงิน', 'เงินสดสุทธิใช้ไปในกิจกรรมจัดหาเงิน', 'net cash from financing activities'],
  eps_basic: ['กำไรต่อหุ้นขั้นพื้นฐาน', 'basic earnings per share'],

  // Supporting balance-sheet groups
  short_term_investments: ['เงินลงทุนระยะสั้น', 'short-term investments'],
  long_term_investments: ['เงินลงทุนระยะยาว', 'long-term investments'],
  other_current_assets: ['สินทรัพย์หมุนเวียนอื่น', 'other current assets'],
  total_current_assets: ['รวมสินทรัพย์หมุนเวียน', 'total current assets'],
  property_plant_equipment: ['ที่ดิน อาคารและอุปกรณ์', 'property plant and equipment'],
  investment_property: ['อสังหาริมทรัพย์เพื่อการลงทุน', 'investment property'],
  right_of_use_assets: ['สินทรัพย์สิทธิการใช้', 'right-of-use assets'],
  intangible_assets: ['สินทรัพย์ไม่มีตัวตน', 'intangible assets'],
  deferred_tax_assets: ['สินทรัพย์ภาษีเงินได้รอการตัดบัญชี', 'สินทรัพย์ภาษีเงินได้รอตัดบัญชี', 'deferred tax assets'],
  deposits: ['เงินประกัน', 'deposits'],
  total_non_current_assets: ['รวมสินทรัพย์ไม่หมุนเวียน', 'total non-current assets'],
  contract_liabilities: ['หนี้สินที่เกิดจากสัญญา', 'contract liabilities'],
  lease_liabilities_current: ['หนี้สินตามสัญญาเช่า ส่วนที่ถึงกำหนดชำระภายในหนึ่งปี', 'current lease liabilities'],
  income_tax_payable: ['ภาษีเงินได้นิติบุคคลค้างจ่าย', 'income tax payable'],
  other_current_liabilities: ['หนี้สินหมุนเวียนอื่น', 'other current liabilities'],
  total_current_liabilities: ['รวมหนี้สินหมุนเวียน', 'total current liabilities'],
  lease_liabilities: ['หนี้สินตามสัญญาเช่า', 'lease liabilities'],
  employee_benefit_obligations: ['ภาระผูกพันผลประโยชน์พนักงาน', 'employee benefit obligations'],
  decommissioning_provision: ['ประมาณการหนี้สินค่ารื้อถอน', 'decommissioning provision'],
  other_non_current_liabilities: ['หนี้สินไม่หมุนเวียนอื่น', 'other non-current liabilities'],
  total_non_current_liabilities: ['รวมหนี้สินไม่หมุนเวียน', 'total non-current liabilities'],
  share_premium: ['ส่วนเกินมูลค่าหุ้นสามัญ', 'share premium'],
  legal_reserve: ['ทุนสำรองตามกฎหมาย', 'legal reserve'],
  retained_earnings: ['กำไรสะสม', 'retained earnings'],
  balance_check_total: ['รวมหนี้สินและส่วนของเจ้าของ', 'total liabilities and equity'],

  // Supporting income statement / OCI groups
  sales_revenue: ['รายได้จากการขายและการให้บริการ', 'sales and service revenue'],
  other_income: ['รายได้อื่น', 'other income'],
  other_gain_loss: ['กำไร ขาดทุน อื่น สุทธิ', 'other gain loss'],
  profit_before_finance_tax: ['กำไรก่อนต้นทุนทางการเงินและภาษีเงินได้', 'profit before finance cost and tax'],
  profit_before_tax: ['กำไรก่อนภาษีเงินได้', 'profit before tax'],
  other_comprehensive_income: ['กำไรขาดทุนเบ็ดเสร็จอื่น', 'กําไรขาดทุนเบ็ดเสร็จอื่น', 'other comprehensive income'],
  total_comprehensive_income: ['กำไรขาดทุนเบ็ดเสร็จรวม', 'กําไรขาดทุนเบ็ดเสร็จรวม', 'รวมกำไรขาดทุนเบ็ดเสร็จ', 'รวมกําไรขาดทุนเบ็ดเสร็จ', 'total comprehensive income'],

  // Supporting cash-flow groups
  depreciation: ['ค่าเสื่อมราคา', 'depreciation'],
  amortization: ['ค่าตัดจำหน่าย', 'amortization'],
  impairment_loss: ['ด้อยค่า', 'impairment'],
  fair_value_gain_loss: ['มูลค่ายุติธรรม', 'fair value'],
  fixed_asset_gain_loss: ['สินทรัพย์ถาวร', 'fixed assets'],
  forex_gain_loss: ['อัตราแลกเปลี่ยน', 'foreign exchange'],
  interest_paid: ['ดอกเบี้ยจ่าย', 'interest paid'],
  interest_received: ['ดอกเบี้ยรับ', 'interest received'],
  working_capital_change: ['การเปลี่ยนแปลงในเงินทุนหมุนเวียน', 'working capital changes'],
  cash_from_operations: ['กระแสเงินสดได้มาจากการดำเนินงาน', 'cash generated from operations'],
  income_tax_paid: ['จ่ายภาษีเงินได้', 'income tax paid'],
  financial_asset_purchase: ['เงินสดจ่ายเพื่อซื้อสินทรัพย์ทางการเงิน', 'purchase of financial assets'],
  financial_asset_sale: ['เงินสดรับจากการจำหน่ายสินทรัพย์ทางการเงิน', 'proceeds from financial assets'],
  ppe_purchase: ['เงินสดจ่ายเพื่อซื้อสินทรัพย์ถาวร', 'purchase of fixed assets'],
  ppe_sale: ['เงินสดรับจากการจำหน่ายสินทรัพย์ถาวร', 'proceeds from fixed assets'],
  intangible_purchase: ['เงินสดจ่ายเพื่อซื้อสินทรัพย์ไม่มีตัวตน', 'purchase of intangible assets'],
  lease_payment: ['เงินสดจ่ายชำระหนี้สินตามสัญญาเช่า', 'lease payments'],
  dividend_paid: ['เงินปันผลจ่าย', 'dividend paid'],
  cash_net_change: ['เงินสดและรายการเทียบเท่าเงินสดเพิ่มขึ้น ลดลง สุทธิ', 'net increase decrease in cash'],
  cash_beginning: ['เงินสดและรายการเทียบเท่าเงินสดต้นปี', 'cash at beginning'],
  cash_ending: ['เงินสดและรายการเทียบเท่าเงินสดปลายปี', 'cash at end'],
  non_cash_transactions: ['รายการที่ไม่ใช่เงินสด', 'non-cash transactions'],

  // TFRS standards-layer supporting groups
  goodwill: ['ค่าความนิยม', 'goodwill'],
  non_controlling_interests: ['ส่วนได้เสียที่ไม่มีอำนาจควบคุม', 'non-controlling interests'],
  gain_on_bargain_purchase: ['กำไรจากการต่อรองราคาซื้อ', 'bargain purchase'],
  business_combination_item: ['การรวมธุรกิจ', 'business combination'],
  consolidation_elimination: ['รายการระหว่างกัน', 'intercompany', 'elimination'],
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
    .replace(/สํ/g, 'สำ')
    .replace(/ำา/g, 'ำ');
}

function rowToText(row) {
  return (row || []).map(normalizeText).filter(Boolean).join(' ');
}

function keywordMatch(text, keywords) {
  const t = normalizeForMatch(text);
  return keywords.some((keyword) => t.includes(normalizeForMatch(keyword)));
}


const REVIEW_REQUIRED_SOURCES = new Set(['accounting_dictionary', 'ai_similarity', 'unknown']);

function withMappingMeta(mapping, source = 'parser_rule', reviewReason = null) {
  const cleanMapping = mapping || { group: 'other', subgroup: null, confidence: 0.3 };
  return {
    ...cleanMapping,
    mapping_source: cleanMapping.mapping_source || source,
    review_reason: cleanMapping.review_reason || reviewReason,
  };
}

function shouldReviewMapping(mapping) {
  if (!mapping) return true;
  if (mapping.mapping_source === 'approved_mapping') return false;
  if (REVIEW_REQUIRED_SOURCES.has(mapping.mapping_source)) return true;
  return Number(mapping.confidence || 0) < 0.85 || mapping.group === 'other';
}

function reviewReasonForMapping(mapping) {
  if (!mapping) return 'No mapping suggestion was available.';
  if (mapping.review_reason) return mapping.review_reason;
  if (mapping.mapping_source === 'accounting_dictionary') return 'Suggested from accounting dictionary; human confirmation required.';
  if (mapping.mapping_source === 'ai_similarity') return 'Suggested from similar approved mapping; human confirmation required.';
  if (mapping.mapping_source === 'unknown' || mapping.group === 'other') return 'Unknown or low-confidence accounting mapping.';
  if (Number(mapping.confidence || 0) < 0.85) return 'Low confidence parser mapping.';
  return null;
}

const ACCOUNTING_DICTIONARY_RULES = [
  { any: ['สินทรัพย์ภาษีเงินได้รอตัดบัญชี', 'สินทรัพย์ภาษีเงินได้รอการตัดบัญชี', 'deferred tax assets'], group: 'deferred_tax_assets', subgroup: 'deferred_tax_assets', confidence: 0.92 },
  { any: ['หนี้สินภาษีเงินได้รอตัดบัญชี', 'หนี้สินภาษีเงินได้รอการตัดบัญชี', 'deferred tax liabilities'], group: 'deferred_tax_liabilities', subgroup: 'deferred_tax_liabilities', confidence: 0.92 },
  { any: ['กำไรสะสม', 'กําไรสะสม', 'retained earnings'], group: 'retained_earnings', subgroup: 'retained_earnings', confidence: 0.9 },
  { any: ['สำรองตามกฎหมาย', 'สํารองตามกฎหมาย', 'ทุนสำรองตามกฎหมาย', 'ทุนสํารองตามกฎหมาย', 'legal reserve'], group: 'legal_reserve', subgroup: 'legal_reserve', confidence: 0.9 },
  { any: ['กำไร (ขาดทุน) สุทธิ', 'กําไร (ขาดทุน) สุทธิ', 'กำไรขาดทุนสุทธิ', 'กําไรขาดทุนสุทธิ', 'กำไรสุทธิ', 'กําไรสุทธิ', 'ขาดทุนสุทธิ', 'net profit', 'net income'], group: 'net_profit', subgroup: 'net_profit', confidence: 0.94 },
  { any: ['กำไรขาดทุนเบ็ดเสร็จอื่น', 'กําไรขาดทุนเบ็ดเสร็จอื่น', 'other comprehensive income'], group: 'other_comprehensive_income', subgroup: 'other_comprehensive_income', confidence: 0.9 },
  { any: ['รวมกำไรขาดทุนเบ็ดเสร็จ', 'รวมกําไรขาดทุนเบ็ดเสร็จ', 'กำไรเบ็ดเสร็จรวมสำหรับปี', 'กําไรเบ็ดเสร็จรวมสําหรับปี', 'total comprehensive income'], group: 'total_comprehensive_income', subgroup: 'total_comprehensive_income', confidence: 0.9 },
  { any: ['ส่วนได้เสียที่ไม่มีอำนาจควบคุม', 'ส่วนได้เสียที่ไม่มีอํานาจควบคุม', 'non-controlling interests', 'non controlling interests'], group: 'non_controlling_interests', subgroup: 'non_controlling_interests', confidence: 0.9 },
  { any: ['ค่าความนิยม', 'goodwill'], group: 'goodwill', subgroup: 'goodwill', confidence: 0.93 },
  { any: ['กำไรจากการต่อรองราคาซื้อ', 'กําไรจากการต่อรองราคาซื้อ', 'bargain purchase'], group: 'gain_on_bargain_purchase', subgroup: 'bargain_purchase_gain', confidence: 0.9 },
  { any: ['การรวมธุรกิจ', 'business combination'], group: 'business_combination_item', subgroup: 'business_combination', confidence: 0.86 },
  { any: ['รายการระหว่างกัน', 'ตัดรายการระหว่างกัน', 'intercompany', 'elimination'], group: 'consolidation_elimination', subgroup: 'intercompany_elimination', confidence: 0.86 },
  { any: ['สำรองรายการป้องกันความเสี่ยง', 'สํารองรายการป้องกันความเสี่ยง', 'สำรองรายการประกันความเสี่ยง', 'สํารองรายการประกันความเสี่ยง', 'cash flow hedge reserve', 'hedging reserve'], group: 'oci_cash_flow_hedge', subgroup: 'cash_flow_hedge_oci', confidence: 0.88 },
  { any: ['การเปลี่ยนแปลงในสำรองรายการป้องกันความเสี่ยง', 'การเปลี่ยนแปลงในสํารองรายการป้องกันความเสี่ยง', 'การเปลี่ยนแปลงในสำรองรายการประกันความเสี่ยง', 'การเปลี่ยนแปลงในสํารองรายการประกันความเสี่ยง'], group: 'oci_cash_flow_hedge', subgroup: 'cash_flow_hedge_oci', confidence: 0.88 },
  { all: ['กำไรจากการขายเงินลงทุน', 'มูลค่ายุติธรรม'], group: 'other_comprehensive_income', subgroup: 'fair_value_oci_investment_gain', confidence: 0.86 },
  { all: ['กําไรจากการขายเงินลงทุน', 'มูลค่ายุติธรรม'], group: 'other_comprehensive_income', subgroup: 'fair_value_oci_investment_gain', confidence: 0.86 },
  { any: ['โอนไปทุนสำรองตามกฎหมาย', 'โอนไปทุนสํารองตามกฎหมาย'], group: 'legal_reserve', subgroup: 'legal_reserve_transfer', confidence: 0.86 },
  { any: ['โอนไปกำไรสะสม', 'โอนไปกําไรสะสม'], group: 'retained_earnings', subgroup: 'retained_earnings_transfer', confidence: 0.86 },
];

function dictionaryMapAccount(accountName) {
  const matched = matchRule(normalizeForMatch(accountName), ACCOUNTING_DICTIONARY_RULES);
  return matched ? withMappingMeta(matched, 'accounting_dictionary') : null;
}

function cleanAccountLabel(value) {
  return normalizeText(value)
    .replace(/^[\-–—•·]+\s*/, '')
    .replace(/^(?:และ|and)\s+/i, '')
    .trim();
}

function workbookIndustryProfile(fileName = '', sheetName = '', rows = []) {
  // Detect industry from the financial-statement CONTENT (account-line signals), not from a
  // hardcoded company name. Company/ticker keywords are kept only as a weak tie-breaker so
  // existing master fixtures still resolve, but any new company is classified by its lines.
  const sample = `${fileName} ${sheetName} ${rows.slice(0, 60).map(rowToText).join(' ')}`;
  const t = normalizeForMatch(sample);
  const count = (keywords) => keywords.reduce((acc, kw) => acc + (t.includes(normalizeForMatch(kw)) ? 1 : 0), 0);

  // Strong, statement-content signals per industry.
  const scores = {
    banking: count(['เงินรับฝาก', 'เงินให้สินเชื่อ', 'รายได้ดอกเบี้ยสุทธิ', 'รายการระหว่างธนาคารและตลาดเงิน', 'ผลขาดทุนด้านเครดิตที่คาดว่าจะเกิดขึ้น', 'ตราสารหนี้ที่ออกและเงินกู้ยืม']) * 2,
    healthcare: count(['รายได้ค่ารักษาพยาบาล', 'ต้นทุนค่ารักษาพยาบาล', 'โรงพยาบาล']) * 2,
    real_estate: count(['ต้นทุนการพัฒนาอสังหาริมทรัพย์', 'รายได้จากการขายอสังหาริมทรัพย์', 'เงินมัดจำค่าซื้อที่ดิน', 'ต้นทุนในการได้มาซึ่งสัญญา', 'อสังหาริมทรัพย์เพื่อการลงทุน']) * 2,
    manufacturing: count(['สินทรัพย์ชีวภาพ', 'รายได้จากการจำหน่ายสินค้า', 'สินค้าระหว่างผลิต', 'วัตถุดิบ']) * 2,
    retail: count(['รายได้จากการขายและการให้บริการ', 'สินค้าคงเหลือ', 'รายได้จากการขายสินค้า']),
  };

  // Weak tie-breaker from file/company naming, lower weight than content.
  if (t.includes('kbank') || t.includes('ธนาคาร')) scores.banking += 1;
  if (t.includes('bdms')) scores.healthcare += 1;
  if (t.includes('spali')) scores.real_estate += 1;
  if (t.includes('cpf') || t.includes('เจริญโภคภัณฑ์อาหาร')) scores.manufacturing += 1;
  if (t.includes('moshi') || t.includes('โมชิ')) scores.retail += 1;

  let best = 'general', bestScore = 0;
  for (const [profile, score] of Object.entries(scores)) {
    if (score > bestScore) { best = profile; bestScore = score; }
  }
  return bestScore >= 2 ? best : 'general';
}

function shouldIgnoreSheet(sheetName, workbookSheetNames = []) {
  const t = normalizeForMatch(sheetName);
  if (!t) return true;
  if (t.startsWith('dsinternal')) return true;
  if (t.includes('recoveredsheet')) return true;
  // BDMS-style workbooks include 3-month Thai and English analysis sheets beside the annual sheet.
  // Default import is annual consolidated/separate data; quarterly sheets should be imported by a future quarter mode.
  const hasAnnualHealthcareSheet = workbookSheetNames.some((name) => /PL-T\s*\(12\)/i.test(name));
  if (hasAnnualHealthcareSheet && (/PL-T\s*\(3\)/i.test(sheetName) || /PL-E\s*\(3\)/i.test(sheetName))) return true;
  return false;
}

function rowLooksLikePeriodHeader(rowText, candidateCount) {
  const t = normalizeForMatch(rowText);
  if (candidateCount >= 2) return true;
  return [
    'รายการ', 'บัญชี', 'account', 'item', 'year', 'fy', 'period',
    'พศ', 'ปี', 'สำหรับปี', 'สําหรับปี', 'สิ้นสุด', 'งวด', 'ไตรมาส',
    'ณวันที่', '31ธันวาคม', 'งบการเงินรวม', 'งบการเงินเฉพาะ'
  ].some((keyword) => t.includes(normalizeForMatch(keyword)));
}

function detectScopeForColumn(rows, headerRowIdx, colIdx, fallback = 'consolidated') {
  let best = { distance: Infinity, scope: fallback };
  const start = Math.max(0, headerRowIdx - 8);
  for (let r = headerRowIdx; r >= start; r--) {
    const row = rows[r] || [];
    for (let c = 0; c <= colIdx; c++) {
      const text = normalizeText(row[c]);
      if (!text) continue;
      const scope = detectScope(text, null);
      if (!scope) continue;
      const distance = (headerRowIdx - r) * 100 + Math.abs(colIdx - c);
      if (distance < best.distance) best = { distance, scope };
    }
  }
  return best.scope;
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


function extractLikelyFiscalYearFromText(value) {
  const t = normalizeText(value).replace(/,/g, ' ');
  if (!t) return null;
  const matches = [...t.matchAll(/(?:^|[^0-9])((?:25|20)[0-9]{2})(?:[^0-9]|$)/g)];
  for (const match of matches) {
    let year = Number(match[1]);
    if (year >= 2400) year -= 543;
    if (year >= 1990 && year <= 2035) return year;
  }
  return null;
}

function applyFileNameFiscalYearFallback(rows = [], fileName = '') {
  const fileYear = extractLikelyFiscalYearFromText(fileName);
  if (!fileYear || !rows.length) return rows;
  const years = [...new Set(rows.map((row) => Number(row.fiscal_year)).filter(Number.isFinite))];
  const currentYear = new Date().getFullYear();
  // Some SET-style exports have weak/no year headers; in that case the parser may fall back to
  // the current calendar year. If the file name clearly carries a fiscal year (e.g. SCB_2566),
  // use it instead of silently saving the batch to the wrong FY.
  if (years.length === 1 && years[0] === currentYear && fileYear !== currentYear) {
    rows.forEach((row) => { row.fiscal_year = fileYear; });
  }
  return rows;
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

function cellsWithPeriods(row, rows = [], rowIdx = 0, fallbackScope = 'consolidated') {
  const rawCandidates = [];
  (row || []).forEach((cell, index) => {
    if (index === 0) return; // Date rows usually store the date in column A; value-year headers are later columns.
    const info = extractPeriodInfo(cell);
    if (info) rawCandidates.push({ colIdx: index, year: info.year, period_type: info.period_type });
  });
  if (!rawCandidates.length) return [];

  const rowText = rowToText(row);
  if (!rowLooksLikePeriodHeader(rowText, rawCandidates.length)) return [];

  return rawCandidates
    .filter((item) => item.year >= 1990 && item.year <= 2035)
    .map((item) => ({
      ...item,
      scope: detectScopeForColumn(rows, rowIdx, item.colIdx, fallbackScope),
    }));
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
    return { label: cleanAccountLabel(text), colIdx: index };
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

function matchRule(text, rules) {
  for (const rule of rules) {
    if (rule.all && !rule.all.every((keyword) => text.includes(normalizeForMatch(keyword)))) continue;
    if (rule.any && !rule.any.some((keyword) => text.includes(normalizeForMatch(keyword)))) continue;
    if (rule.none && rule.none.some((keyword) => text.includes(normalizeForMatch(keyword)))) continue;
    return {
      group: rule.group,
      subgroup: rule.subgroup || rule.group,
      confidence: rule.confidence ?? 0.9,
      mapping_source: rule.mapping_source || 'parser_rule',
    };
  }
  return null;
}

function mapIncomeStatement(label, section) {
  const t = normalizeForMatch(label);
  const s = normalizeForMatch(section);

  const exactRules = [
    { any: ['รวมรายได้', 'total revenue', 'total income'], group: 'revenue', subgroup: 'total_revenue', confidence: 0.97 },
    { any: ['รวมค่าใช้จ่าย', 'total expenses'], group: 'expense', subgroup: 'total_expense', confidence: 0.9 },
    { any: ['กำไรก่อนต้นทุนทางการเงินและภาษีเงินได้', 'กําไรก่อนต้นทุนทางการเงินและภาษีเงินได้', 'profit before finance cost and tax'], group: 'profit_before_finance_tax', subgroup: 'profit_before_finance_tax', confidence: 0.9 },
    { any: ['กำไรก่อนภาษีเงินได้', 'กําไรก่อนภาษีเงินได้', 'profit before tax'], group: 'profit_before_tax', subgroup: 'profit_before_tax', confidence: 0.9 },
  ];
  const exactMatch = matchRule(t, exactRules);
  if (exactMatch) return exactMatch;

  if (t.includes('รายได้ค่ารักษาพยาบาล')) return { group: 'healthcare_patient_revenue', subgroup: 'patient_service_revenue', confidence: 0.96 };
  if (t.includes('รายได้จากการจำหน่ายสินค้า') || t.includes('รายได้จากการจําหน่ายสินค้า')) return { group: 'product_sales_revenue', subgroup: 'product_sales_revenue', confidence: 0.92 };
  if (t.includes('รายได้จากการขายอสังหาริมทรัพย์') || t.includes('รายได้จากการขายที่ดิน') || t.includes('รายได้จากการขายโครงการ')) return { group: 'real_estate_sales_revenue', subgroup: 'property_sales_revenue', confidence: 0.96 };
  if (t.includes('ต้นทุนค่ารักษาพยาบาล')) return { group: 'healthcare_service_cost', subgroup: 'healthcare_cogs', confidence: 0.96 };
  if (t.includes('ต้นทุนขายอสังหาริมทรัพย์') || t.includes('ต้นทุนขายที่ดิน') || t.includes('ต้นทุนจากการขายอสังหาริมทรัพย์')) return { group: 'real_estate_cogs', subgroup: 'property_sales_cost', confidence: 0.96 };
  if (t.includes('รายได้ดอกเบี้ยสุทธิ')) return { group: 'bank_net_interest_income', subgroup: 'net_interest_income', confidence: 0.97 };
  if (t.includes('รายได้ดอกเบี้ย')) return { group: 'bank_interest_income', subgroup: 'interest_income', confidence: 0.96 };
  if (t.includes('ค่าใช้จ่ายดอกเบี้ย')) return { group: 'bank_interest_expense', subgroup: 'interest_expense', confidence: 0.96 };
  if (t.includes('รายได้ค่าธรรมเนียมและบริการสุทธิ')) return { group: 'bank_net_fee_income', subgroup: 'net_fee_income', confidence: 0.96 };
  if (t.includes('รายได้ค่าธรรมเนียมและบริการ')) return { group: 'bank_fee_income', subgroup: 'fee_income', confidence: 0.94 };
  if (t.includes('ค่าใช้จ่ายค่าธรรมเนียมและบริการ')) return { group: 'bank_fee_expense', subgroup: 'fee_expense', confidence: 0.94 };
  if (t.includes('รายได้เงินปันผล')) return { group: 'dividend_income', subgroup: 'dividend_income', confidence: 0.9 };
  if (t.includes('ผลขาดทุนด้านเครดิตที่คาดว่าจะเกิดขึ้น')) return { group: 'bank_expected_credit_loss', subgroup: 'expected_credit_loss', confidence: 0.96 };
  if (t.includes('ค่าใช้จ่ายจากการดำเนินงานอื่น') || t.includes('ค่าใช้จ่ายจากการดําเนินงานอื่น')) return { group: 'bank_other_operating_expenses', subgroup: 'other_operating_expenses', confidence: 0.92 };
  if (t.includes('ผลการดำเนินงานการบริการประกันภัย') || t.includes('ผลการดําเนินงานการบริการประกันภัย')) return { group: 'insurance_service_result', subgroup: 'insurance_service_result', confidence: 0.88 };
  if (t.includes('รายได้จากการดำเนินงานอื่น') || t.includes('รายได้จากการดําเนินงานอื่น')) return { group: 'bank_other_operating_income', subgroup: 'other_operating_income', confidence: 0.9 };
  if (t.includes('ค่าใช้จ่ายทางการเงินจากการประกันภัยสุทธิ') || t.includes('ค่าใช้จ่ายทางการเงินจากสัญญาประกันภัย')) return { group: 'insurance_finance_expense', subgroup: 'insurance_finance_expense', confidence: 0.88 };
  if (t.includes('รายได้จากการขาย') || t.includes('รายได้จากการให้บริการ') || t.includes('salesrevenue')) return { group: 'sales_revenue', subgroup: 'revenue_detail', confidence: 0.9 };
  if (t.includes('รายได้ทางการเงิน')) return { group: 'finance_income', subgroup: 'finance_income', confidence: 0.9 };
  if (t.includes('ส่วนแบ่งกำไรจากเงินลงทุน') || t.includes('ส่วนแบ่งกําไรจากเงินลงทุน') || t.includes('วิธีส่วนได้เสีย')) return { group: 'share_of_profit_associates', subgroup: 'share_of_profit_associates', confidence: 0.9 };
  if (t.includes('กำไรจากการดำเนินงาน') || t.includes('กําไรจากการดําเนินงาน') || t.includes('กำไรจากกิจกรรมดำเนินงาน') || t.includes('กำไรจากกิจกรรมดําเนินงาน')) return { group: 'operating_profit', subgroup: 'operating_profit', confidence: 0.9 };
  if (t.includes('กำไรจากเงินลงทุน') || t.includes('กําไรจากเงินลงทุน')) return { group: 'investment_gain_loss', subgroup: 'investment_gain_loss', confidence: 0.88 };
  if (t.includes('เปลี่ยนแปลงมูลค่ายุติธรรม') && t.includes('อสังหาริมทรัพย์')) return { group: 'investment_property_fair_value_gain_loss', subgroup: 'investment_property_fair_value_gain_loss', confidence: 0.9 };
  if (t.includes('อัตราแลกเปลี่ยน')) return { group: 'forex_gain_loss', subgroup: 'forex_gain_loss', confidence: 0.88 };
  if (t.includes('ต้นทุนในการจัดจำหน่าย') || t.includes('ต้นทุนในการจัดจําหน่าย')) return { group: 'sga', subgroup: 'distribution_cost', confidence: 0.9 };
  if (t.includes('รายได้อื่น') || t.includes('otherincome')) return { group: 'other_income', subgroup: 'other_income', confidence: 0.88 };
  if (t.includes('ต้นทุนขาย') || t.includes('ต้นทุนการให้บริการ') || t.includes('costofsales') || t.includes('cogs')) return { group: 'cogs', subgroup: 'cost_of_sales', confidence: 0.94 };
  if (t.includes('ค่าใช้จ่ายในการขาย') || t.includes('ต้นทุนในการจัดจำหน่าย') || t.includes('ต้นทุนในการจัดจําหน่าย') || t.includes('sellingexpense')) return { group: 'sga', subgroup: 'selling_distribution_expense', confidence: 0.93 };
  if (t.includes('ค่าใช้จ่ายในการบริหาร') || t.includes('administrativeexpense')) return { group: 'sga', subgroup: 'administrative_expense', confidence: 0.93 };
  if (t.includes('กำไรเบ็ดเสร็จรวมสำหรับปี') || t.includes('กําไรเบ็ดเสร็จรวมสําหรับปี') || t.includes('กำไรขาดทุนเบ็ดเสร็จรวม') || t.includes('กําไรขาดทุนเบ็ดเสร็จรวม') || t.includes('totalcomprehensiveincome')) return { group: 'total_comprehensive_income', subgroup: 'total_comprehensive_income', confidence: 0.9 };
  if (t.includes('ส่วนที่เป็นของบริษัทใหญ่') || t.includes('ส่วนที่เป็นของผู้ถือหุ้นของบริษัท') || t.includes('ส่วนที่เป็นของธนาคาร')) return { group: 'profit_attributable_parent', subgroup: 'profit_attributable_parent', confidence: 0.88 };
  if (t.includes('ส่วนที่เป็นของส่วนได้เสียที่ไม่มีอำนาจควบคุม') || t.includes('ส่วนที่เป็นของส่วนได้เสียที่ไม่มีอํานาจควบคุม') || t.includes('ส่วนที่เป็นของผู้มีส่วนได้เสียที่ไม่มีอำนาจควบคุม') || t.includes('ส่วนที่เป็นของผู้มีส่วนได้เสียที่ไม่มีอํานาจควบคุม')) return { group: 'profit_attributable_nci', subgroup: 'profit_attributable_nci', confidence: 0.88 };
  if (t.includes('กำไรส่วนที่เป็นของผู้ถือหุ้น') || t.includes('กําไรส่วนที่เป็นของผู้ถือหุ้น')) return { group: 'eps_profit_attributable_parent', subgroup: 'eps_profit_attributable_parent', confidence: 0.88 };
  if (t.includes('จำนวนหุ้นสามัญถัวเฉลี่ย') || t.includes('จํานวนหุ้นสามัญถัวเฉลี่ย')) return { group: 'weighted_average_shares', subgroup: 'weighted_average_shares', confidence: 0.88 };
  if (t.includes('ป้องกันความเสี่ยงในกระแสเงินสด') || t.includes('ป้องกันความเสี่ยงกระแสเงินสด') || t.includes('ต้นทุนในการป้องกันความเสี่ยง')) return { group: 'oci_cash_flow_hedge', subgroup: 'cash_flow_hedge_oci', confidence: 0.88 };
  if (t.includes('แปลงค่างบการเงิน') || t.includes('การดำเนินงานในต่างประเทศ') || t.includes('การดําเนินงานในต่างประเทศ')) return { group: 'oci_foreign_currency_translation', subgroup: 'foreign_currency_translation_oci', confidence: 0.88 };
  if (t.includes('ตีราคาสินทรัพย์ใหม่') || t.includes('ตีราคาที่ดิน') || t.includes('ส่วนเกินทุนจากการตีราคา')) return { group: 'oci_revaluation_surplus', subgroup: 'revaluation_surplus_oci', confidence: 0.88 };
  if (t.includes('กำไรขาดทุนเบ็ดเสร็จอื่น') || t.includes('กําไรขาดทุนเบ็ดเสร็จอื่น') || t.includes('othercomprehensiveincome')) return { group: 'other_comprehensive_income', subgroup: 'other_comprehensive_income', confidence: 0.88 };
  if (t.includes('กำไรขาดทุนอื่น') || t.includes('กําไรขาดทุนอื่น') || t.includes('กำไรขาดทุน') || t.includes('กําไรขาดทุน')) return { group: 'other_gain_loss', subgroup: 'other_gain_loss', confidence: 0.86 };
  if (t.includes('ต้นทุนทางการเงิน') || t.includes('financecost')) return { group: 'finance_cost', subgroup: 'finance_cost', confidence: 0.95 };
  if (t.includes('ภาษีเงินได้') || t.includes('incometax')) return { group: 'tax', subgroup: 'tax_expense', confidence: 0.92 };
  if ((t.includes('กำไรสุทธิ') || t.includes('กําไรสุทธิ') || t.includes('ขาดทุนสุทธิ') || t.includes('กำไรสำหรับปี') || t.includes('กําไรสำหรับปี') || t.includes('กำไรสําหรับปี') || t.includes('กําไรสําหรับปี') || t.includes('netprofit') || t.includes('netincome')) && !t.includes('ต่อหุ้น')) return { group: 'net_profit', subgroup: 'net_profit', confidence: 0.97 };
  if (t.includes('กำไรต่อหุ้นขั้นพื้นฐาน') || t.includes('กําไรต่อหุ้นขั้นพื้นฐาน') || t.includes('basicearningspershare')) return { group: 'eps_basic', subgroup: 'eps_basic', confidence: 0.96 };
  if (t.includes('ผลประโยชน์หลังออกจากงาน')) return { group: 'other_comprehensive_income', subgroup: 'post_employment_benefit_oci', confidence: 0.86 };
  if (t.includes('กำไรหรือขาดทุนในภายหลัง') || t.includes('กําไรหรือขาดทุนในภายหลัง')) return { group: 'other_comprehensive_income', subgroup: 'oci_reclassification_line', confidence: 0.86 };
  if (t.includes('รายการที่จะจัดประเภทใหม่') || t.includes('รายการที่จะไม่จัดประเภท')) return { group: 'other_comprehensive_income', subgroup: 'oci_classification_line', confidence: 0.86 };
  if (s.includes('ค่าใช้จ่าย')) return { group: 'income_expense_detail', subgroup: 'expense_detail', confidence: 0.86 };
  if (s.includes('รายได้')) return { group: 'income_revenue_detail', subgroup: 'revenue_detail', confidence: 0.86 };
  return null;
}

function mapBalanceSheet(label, section) {
  const t = normalizeForMatch(label);
  const s = normalizeForMatch(section);

  // Totals and dashboard-critical metrics first.
  if (t === 'รวมสินทรัพย์' || t === 'totalassets') return { group: 'asset', subgroup: 'total_assets', confidence: 0.98 };
  if (t === 'รวมหนี้สิน' || t === 'totalliabilities') return { group: 'liability', subgroup: 'total_liabilities', confidence: 0.98 };
  if (t.includes('รวมส่วนของเจ้าของ') || t.includes('รวมส่วนของผู้ถือหุ้น') || t === 'totalequity' || t === 'totalshareholdersequity') return { group: 'equity', subgroup: 'total_equity', confidence: 0.98 };
  if (t.includes('รวมหนี้สินและส่วนของเจ้าของ') || t.includes('totalliabilitiesandequity')) return { group: 'balance_check_total', subgroup: 'balance_check_total', confidence: 0.9 };
  if (t.includes('รวมสินทรัพย์หมุนเวียน')) return { group: 'total_current_assets', subgroup: 'total_current_assets', confidence: 0.91 };
  if (t.includes('รวมสินทรัพย์ไม่หมุนเวียน')) return { group: 'total_non_current_assets', subgroup: 'total_non_current_assets', confidence: 0.91 };
  if (t.includes('รวมหนี้สินหมุนเวียน')) return { group: 'total_current_liabilities', subgroup: 'total_current_liabilities', confidence: 0.91 };
  if (t.includes('รวมเงินรับฝาก')) return { group: 'bank_deposits', subgroup: 'total_deposits', confidence: 0.94 };
  if (t === 'เงินสด' || t === 'cash') return { group: 'cash', subgroup: 'cash_on_hand', confidence: 0.92 };

  const rules = [
    { any: ['เงินสดและรายการเทียบเท่าเงินสด'], group: 'cash', subgroup: 'cash_and_cash_equivalents', confidence: 0.93 },
    { any: ['เงินฝากสถาบันการเงินที่มีข้อจำกัด', 'เงินฝากสถาบันการเงินที่มีข้อจํากัด', 'เงินฝากสถาบันการเงินที่มีภาระค้ำประกัน', 'เงินฝากสถาบันการเงินที่มีภาระค้ําประกัน'], group: 'restricted_deposits', subgroup: 'restricted_deposits', confidence: 0.88 },
    { any: ['เงินลงทุนระยะสั้น'], group: 'short_term_investments', subgroup: 'short_term_investments', confidence: 0.9 },
    { any: ['เงินลงทุนระยะยาว'], group: 'long_term_investments', subgroup: 'long_term_investments', confidence: 0.9 },
    { any: ['ลูกหนี้การค้า'], group: 'receivable', subgroup: 'trade_receivables', confidence: 0.9 },
    { any: ['สินค้าคงเหลือ', 'inventory'], group: 'inventory', subgroup: 'inventory', confidence: 0.9 },
    { any: ['สินทรัพย์หมุนเวียนอื่น'], group: 'other_current_assets', subgroup: 'other_current_assets', confidence: 0.88 },
    { any: ['ที่ดิน อาคารและอุปกรณ์', 'property plant and equipment'], group: 'property_plant_equipment', subgroup: 'property_plant_equipment', confidence: 0.9 },
    { any: ['อสังหาริมทรัพย์เพื่อการลงทุน', 'investment property'], group: 'investment_property', subgroup: 'investment_property', confidence: 0.9 },
    { any: ['สินทรัพย์สิทธิการใช้', 'right of use'], group: 'right_of_use_assets', subgroup: 'right_of_use_assets', confidence: 0.9 },
    { any: ['สินทรัพย์ไม่มีตัวตน', 'intangible'], group: 'intangible_assets', subgroup: 'intangible_assets', confidence: 0.9 },
    { any: ['สินทรัพย์ภาษีเงินได้รอการตัดบัญชี', 'deferred tax asset'], group: 'deferred_tax_assets', subgroup: 'deferred_tax_assets', confidence: 0.9 },
    { any: ['เงินประกัน'], group: 'deposits', subgroup: 'deposits', confidence: 0.88 },
    { any: ['เงินให้กู้ยืมระยะสั้น'], group: 'short_term_loans_to_related_parties', subgroup: 'short_term_loans', confidence: 0.88 },
    { any: ['เงินให้กู้ยืมระยะยาว'], group: 'long_term_loans_to_related_parties', subgroup: 'long_term_loans', confidence: 0.88 },
    { any: ['ค่าใช้จ่ายจ่ายล่วงหน้า'], group: 'prepaid_expenses', subgroup: 'prepaid_expenses', confidence: 0.87 },
    { any: ['เงินปันผลค้างรับ'], group: 'dividend_receivable', subgroup: 'dividend_receivable', confidence: 0.87 },
    { any: ['รายได้ค้างรับ'], group: 'accrued_income', subgroup: 'accrued_income', confidence: 0.87 },
    { any: ['เงินจ่ายล่วงหน้าค่าสินค้า', 'เงินจ่ายล่วงหน้าค่าวัสดุก่อสร้าง'], group: 'advances_to_suppliers', subgroup: 'advances_to_suppliers', confidence: 0.87 },
    { any: ['สินทรัพย์ชีวภาพหมุนเวียน'], group: 'biological_assets_current', subgroup: 'biological_assets_current', confidence: 0.9 },
    { any: ['สินทรัพย์ชีวภาพไม่หมุนเวียน'], group: 'biological_assets_non_current', subgroup: 'biological_assets_non_current', confidence: 0.9 },
    { any: ['สินทรัพย์ทางการเงินหมุนเวียนอื่น'], group: 'other_current_financial_assets', subgroup: 'other_current_financial_assets', confidence: 0.9 },
    { any: ['สินทรัพย์ทางการเงินไม่หมุนเวียนอื่น'], group: 'other_non_current_financial_assets', subgroup: 'other_non_current_financial_assets', confidence: 0.9 },
    { any: ['สินทรัพย์ไม่หมุนเวียนที่จัดประเภทเป็น สินทรัพย์ที่ถือไว้เพื่อขาย', 'สินทรัพย์ที่ถือไว้เพื่อขาย'], group: 'assets_held_for_sale', subgroup: 'assets_held_for_sale', confidence: 0.9 },
    { any: ['เงินลงทุนในตราสารทุน'], group: 'equity_investments', subgroup: 'equity_investments', confidence: 0.88 },
    { any: ['เงินลงทุนในบริษัทย่อย'], group: 'investment_in_subsidiaries', subgroup: 'investment_in_subsidiaries', confidence: 0.9 },
    { any: ['เงินลงทุนในบริษัทร่วม'], group: 'investment_in_associates', subgroup: 'investment_in_associates', confidence: 0.9 },
    { any: ['เงินลงทุนในการร่วมค้า'], group: 'investment_in_joint_ventures', subgroup: 'investment_in_joint_ventures', confidence: 0.9 },
    { any: ['ค่าความนิยม'], group: 'goodwill', subgroup: 'goodwill', confidence: 0.9 },
    { any: ['ต้นทุนการพัฒนาอสังหาริมทรัพย์'], group: 'real_estate_development_costs', subgroup: 'property_inventory', confidence: 0.94 },
    { any: ['เงินมัดจำค่าซื้อที่ดิน', 'เงินมัดจําค่าซื้อที่ดิน'], group: 'land_purchase_deposits', subgroup: 'land_purchase_deposits', confidence: 0.9 },
    { any: ['ต้นทุนในการได้มาซึ่งสัญญา'], group: 'contract_acquisition_costs', subgroup: 'contract_acquisition_costs', confidence: 0.88 },
    { any: ['รายการระหว่างธนาคารและตลาดเงินสุทธิ'], group: 'bank_interbank_assets', subgroup: 'interbank_and_money_market_assets', confidence: 0.94 },
    { any: ['สินทรัพย์ทางการเงินที่วัดมูลค่าด้วยมูลค่ายุติธรรมผ่านกำไรหรือขาดทุน', 'สินทรัพย์ทางการเงินที่วัดมูลค่าด้วยมูลค่ายุติธรรมผ่านกําไรหรือขาดทุน'], group: 'bank_fvtpl_assets', subgroup: 'fvtpl_assets', confidence: 0.94 },
    { any: ['สินทรัพย์อนุพันธ์'], group: 'bank_derivative_assets', subgroup: 'derivative_assets', confidence: 0.93 },
    { any: ['เงินลงทุนสุทธิ'], group: 'bank_net_investments', subgroup: 'net_investments', confidence: 0.93 },
    { any: ['เงินให้สินเชื่อแก่ลูกหนี้และดอกเบี้ยค้างรับสุทธิ'], group: 'bank_loans_to_customers', subgroup: 'loans_to_customers_net', confidence: 0.96 },
    { any: ['ทรัพย์สินรอการขายสุทธิ'], group: 'bank_foreclosed_properties', subgroup: 'foreclosed_properties_net', confidence: 0.92 },
    { any: ['หลักประกันตามสัญญาเครดิตซัพพอร์ทแอนเน็กซ์', 'หลักประกันเจ้าหนี้ตามสัญญาเครดิตซัพพอร์ทแอนเน็กซ์'], group: 'bank_credit_support_collateral', subgroup: 'credit_support_collateral', confidence: 0.88 },
    { any: ['สินทรัพย์อื่นสุทธิ'], group: 'other_assets', subgroup: 'other_assets_net', confidence: 0.88 },
    { any: ['เงินรับฝาก'], group: 'bank_deposits', subgroup: 'customer_deposits', confidence: 0.96 },
    { any: ['รายการระหว่างธนาคารและตลาดเงิน'], group: 'bank_interbank_liabilities', subgroup: 'interbank_and_money_market_liabilities', confidence: 0.9 },
    { any: ['หนี้สินจ่ายคืนเมื่อทวงถาม'], group: 'bank_liabilities_payable_on_demand', subgroup: 'payable_on_demand', confidence: 0.9 },
    { any: ['หนี้สินทางการเงินที่วัดมูลค่าด้วยมูลค่ายุติธรรมผ่านกำไรหรือขาดทุน', 'หนี้สินทางการเงินที่วัดมูลค่าด้วยมูลค่ายุติธรรมผ่านกําไรหรือขาดทุน'], group: 'bank_fvtpl_liabilities', subgroup: 'fvtpl_liabilities', confidence: 0.9 },
    { any: ['หนี้สินอนุพันธ์'], group: 'bank_derivative_liabilities', subgroup: 'derivative_liabilities', confidence: 0.9 },
    { any: ['ตราสารหนี้ที่ออกและเงินกู้ยืม'], group: 'bank_debt_issued_and_borrowings', subgroup: 'debt_issued_and_borrowings', confidence: 0.93 },
    { any: ['ประมาณการหนี้สิน'], group: 'provisions', subgroup: 'provisions', confidence: 0.88 },
    { any: ['หนี้สินอื่น'], group: 'other_liabilities', subgroup: 'other_liabilities', confidence: 0.88 },
    { any: ['เจ้าหนี้การค้า'], group: 'payable', subgroup: 'trade_payables', confidence: 0.9 },
    { any: ['หนี้สินที่เกิดจากสัญญา'], group: 'contract_liabilities', subgroup: 'contract_liabilities', confidence: 0.9 },
    { all: ['หนี้สินตามสัญญาเช่า', 'ภายในหนึ่งปี'], group: 'lease_liabilities_current', subgroup: 'lease_liabilities_current', confidence: 0.9 },
    { any: ['ภาษีเงินได้นิติบุคคลค้างจ่าย'], group: 'income_tax_payable', subgroup: 'income_tax_payable', confidence: 0.9 },
    { any: ['หนี้สินหมุนเวียนอื่น'], group: 'other_current_liabilities', subgroup: 'other_current_liabilities', confidence: 0.88 },
    { any: ['หนี้สินตามสัญญาเช่า'], group: 'lease_liabilities', subgroup: 'lease_liabilities', confidence: 0.88 },
    { any: ['ภาระผูกพันผลประโยชน์พนักงาน'], group: 'employee_benefit_obligations', subgroup: 'employee_benefit_obligations', confidence: 0.9 },
    { any: ['ประมาณการหนี้สินค่ารื้อถอน'], group: 'decommissioning_provision', subgroup: 'decommissioning_provision', confidence: 0.9 },
    { any: ['หนี้สินไม่หมุนเวียนอื่น'], group: 'other_non_current_liabilities', subgroup: 'other_non_current_liabilities', confidence: 0.88 },
    { any: ['เงินกู้ยืม', 'borrowings', 'loan'], group: 'loan', subgroup: 'borrowings', confidence: 0.9 },
    { any: ['ส่วนเกินมูลค่าหุ้นสามัญ'], group: 'share_premium', subgroup: 'share_premium', confidence: 0.9 },
    { any: ['ทุนสำรองตามกฎหมาย', 'ทุนสํารองตามกฎหมาย'], group: 'legal_reserve', subgroup: 'legal_reserve', confidence: 0.9 },
    { any: ['ส่วนเกิน (ต่ำกว่า) ทุนจากการเปลี่ยนแปลงส่วนได้เสีย', 'ส่วนเกิน ต่ำกว่า ทุนจากการเปลี่ยนแปลงส่วนได้เสีย', 'ส่วนเกินทุนจากการเปลี่ยนแปลงส่วนได้เสีย'], group: 'equity_change_in_ownership_surplus', subgroup: 'change_in_ownership_surplus', confidence: 0.88 },
    { any: ['ภายใต้การควบคุมเดียวกัน'], group: 'equity_common_control_reserve', subgroup: 'common_control_reserve', confidence: 0.88 },
    { any: ['ผลต่างจากการปรับโครงสร้างการถือหุ้น'], group: 'equity_restructuring_difference', subgroup: 'shareholding_restructuring_difference', confidence: 0.88 },
    { any: ['ส่วนเกินมูลค่าเงินลงทุนที่สูงกว่ามูลค่าตามบัญชี'], group: 'equity_investment_surplus', subgroup: 'investment_surplus_over_book_value', confidence: 0.88 },
    { any: ['ส่วนเกินทุนอื่น'], group: 'equity_other_surplus', subgroup: 'other_capital_surplus', confidence: 0.88 },
    { any: ['สำรองตามกฎหมาย', 'สํารองตามกฎหมาย'], group: 'legal_reserve', subgroup: 'legal_reserve', confidence: 0.9 },
    { any: ['สำรองหุ้นทุนซื้อคืน', 'สํารองหุ้นทุนซื้อคืน', 'ส่วนเกินทุนหุ้นสามัญซื้อคืน'], group: 'treasury_stock_reserve', subgroup: 'treasury_stock_reserve', confidence: 0.88 },
    { any: ['หุ้นทุนซื้อคืน'], group: 'treasury_stock', subgroup: 'treasury_stock', confidence: 0.88 },
    { any: ['หุ้นกู้ด้อยสิทธิที่มีลักษณะคล้ายทุน'], group: 'perpetual_subordinated_debentures', subgroup: 'perpetual_subordinated_debentures', confidence: 0.88 },
    { any: ['รวมส่วนของบริษัทใหญ่', 'รวมส่วนของผู้ถือหุ้นของบริษัท'], group: 'equity_parent_total', subgroup: 'equity_parent_total', confidence: 0.9 },
    { any: ['ส่วนได้เสียที่ไม่มีอำนาจควบคุม', 'ส่วนได้เสียที่ไม่มีอํานาจควบคุม', 'ส่วนของผู้มีส่วนได้เสียที่ไม่มีอำนาจควบคุม', 'ส่วนของผู้มีส่วนได้เสียที่ไม่มีอํานาจควบคุม'], group: 'non_controlling_interests', subgroup: 'non_controlling_interests', confidence: 0.9 },
    { any: ['ยังไม่ได้จัดสรร'], group: 'retained_earnings', subgroup: 'unappropriated_retained_earnings', confidence: 0.88 },
    { any: ['กำไรสะสม', 'กําไรสะสม'], group: 'retained_earnings', subgroup: 'retained_earnings', confidence: 0.88 },
  ];
  const match = matchRule(t, rules);
  if (match) return match;

  const subgroup = detectSubgroupFromText(section) || detectSubgroupFromText(label) || (s.includes('สินทรัพย์') ? 'asset_detail' : null);
  return { group: subgroup || 'balance_sheet_detail', subgroup, confidence: subgroup ? 0.86 : 0.7 };
}

function mapCashFlow(label, section) {
  const t = normalizeForMatch(label);
  const s = normalizeForMatch(section);

  if (t.includes('เงินสดสุทธิได้มาจากกิจกรรมดำเนินงาน') || t.includes('เงินสดสุทธิได้มาจากกิจกรรมดําเนินงาน') || t.includes('เงินสดสุทธิใช้ไปในกิจกรรมดำเนินงาน') || t.includes('เงินสดสุทธิใช้ไปในกิจกรรมดําเนินงาน') || t.includes('netcashfromoperating')) return { group: 'operating_cash_flow', subgroup: 'net_operating_cash_flow', confidence: 0.98 };
  if (t.includes('เงินสดสุทธิได้มาจากกิจกรรมลงทุน') || t.includes('เงินสดสุทธิใช้ไปในกิจกรรมลงทุน') || t.includes('netcashfrominvesting')) return { group: 'investing_cash_flow', subgroup: 'net_investing_cash_flow', confidence: 0.98 };
  if (t.includes('เงินสดสุทธิได้มาจากกิจกรรมจัดหาเงิน') || t.includes('เงินสดสุทธิใช้ไปในกิจกรรมจัดหาเงิน') || t.includes('netcashfromfinancing')) return { group: 'financing_cash_flow', subgroup: 'net_financing_cash_flow', confidence: 0.98 };
  if (t.includes('กำไรก่อนภาษีเงินได้') || t.includes('กําไรก่อนภาษีเงินได้') || t.includes('กำไรก่อนค่าใช้จ่ายภาษีเงินได้') || t.includes('กําไรก่อนค่าใช้จ่ายภาษีเงินได้') || t.includes('profitbeforetax')) return { group: 'profit_before_tax', subgroup: 'cash_flow_profit_before_tax', confidence: 0.9 };

  const rules = [
    { any: ['รายได้ดอกเบี้ยสุทธิ'], group: 'bank_net_interest_income', subgroup: 'cash_flow_net_interest_income_adjustment', confidence: 0.9 },
    { any: ['ผลขาดทุนด้านเครดิตที่คาดว่าจะเกิดขึ้น'], group: 'bank_expected_credit_loss', subgroup: 'expected_credit_loss_adjustment', confidence: 0.92 },
    { any: ['เงินสดรับดอกเบี้ย'], group: 'interest_received', subgroup: 'interest_received', confidence: 0.92 },
    { any: ['เงินสดจ่ายดอกเบี้ย'], group: 'interest_paid', subgroup: 'interest_paid', confidence: 0.92 },
    { any: ['เงินสดรับเงินปันผล', 'เงินปันผลรับ'], group: 'dividend_received', subgroup: 'dividend_received', confidence: 0.9 },
    { any: ['เงินให้สินเชื่อแก่ลูกหนี้'], group: 'bank_loans_change', subgroup: 'loans_to_customers_change', confidence: 0.9 },
    { any: ['เงินรับฝาก'], group: 'bank_deposits_change', subgroup: 'deposits_change', confidence: 0.9 },
    { any: ['รายการระหว่างธนาคารและตลาดเงิน'], group: 'bank_interbank_change', subgroup: 'interbank_change', confidence: 0.88 },
    { any: ['ตราสารหนี้ที่ออกและเงินกู้ยืม'], group: 'bank_debt_issued_borrowings_cash_flow', subgroup: 'debt_issued_borrowings_cash_flow', confidence: 0.88 },
    { any: ['เงินสดและรายการเทียบเท่าเงินสดปลายปี', 'cash and cash equivalents at end'], group: 'cash_ending', subgroup: 'cash_ending', confidence: 0.92 },
    { any: ['เงินสดและรายการเทียบเท่าเงินสดต้นปี', 'cash and cash equivalents at beginning'], group: 'cash_beginning', subgroup: 'cash_beginning', confidence: 0.9 },
    { any: ['เงินสดและรายการเทียบเท่าเงินสดเพิ่มขึ้น', 'เงินสดและรายการเทียบเท่าเงินสดลดลง', 'net increase decrease in cash'], group: 'cash_net_change', subgroup: 'cash_net_change', confidence: 0.9 },
    { all: ['รายการปรับกระทบ', 'ค่าเสื่อมราคา'], group: 'depreciation', subgroup: 'depreciation', confidence: 0.9 },
    { any: ['ค่าเสื่อมราคา'], group: 'depreciation', subgroup: 'depreciation', confidence: 0.9 },
    { any: ['ค่าตัดจำหน่าย', 'ค่าตัดจําหน่าย'], group: 'amortization', subgroup: 'amortization', confidence: 0.9 },
    { any: ['ค่าเผื่อสินค้าเสื่อมสภาพ', 'สินค้าเสื่อมสภาพและล้าสมัย'], group: 'inventory_obsolescence_loss', subgroup: 'inventory_obsolescence_loss', confidence: 0.88 },
    { any: ['มูลค่ายุติธรรม'], group: 'fair_value_gain_loss', subgroup: 'fair_value_gain_loss', confidence: 0.88 },
    { any: ['จำหน่ายสินทรัพย์ถาวร', 'จําหน่ายสินทรัพย์ถาวร', 'ตัดจำหน่ายสินทรัพย์ถาวร', 'ตัดจําหน่ายสินทรัพย์ถาวร'], group: 'fixed_asset_gain_loss', subgroup: 'fixed_asset_gain_loss', confidence: 0.88 },
    { any: ['ตัดจำหน่ายสินทรัพย์ไม่มีตัวตน', 'ตัดจําหน่ายสินทรัพย์ไม่มีตัวตน'], group: 'intangible_writeoff', subgroup: 'intangible_writeoff', confidence: 0.88 },
    { any: ['ด้อยค่าสินทรัพย์'], group: 'impairment_loss', subgroup: 'impairment_loss', confidence: 0.88 },
    { any: ['ภาระผูกพันผลประโยชน์พนักงาน'], group: 'employee_benefit_obligations', subgroup: 'employee_benefit_cash_flow', confidence: 0.88 },
    { any: ['อัตราแลกเปลี่ยน'], group: 'forex_gain_loss', subgroup: 'unrealized_forex_gain_loss', confidence: 0.88 },
    { any: ['ยกเลิกสัญญาเช่า'], group: 'lease_termination_effect', subgroup: 'lease_termination_effect', confidence: 0.88 },
    { any: ['กลับรายการประมาณการหนี้สินค่ารื้อถอน'], group: 'decommissioning_provision_reversal', subgroup: 'decommissioning_provision_reversal', confidence: 0.88 },
    { any: ['ค่าใช้จ่ายดอกเบี้ย'], group: 'finance_cost', subgroup: 'interest_expense_adjustment', confidence: 0.88 },
    { any: ['รายได้ดอกเบี้ย'], group: 'interest_income', subgroup: 'interest_income_adjustment', confidence: 0.88 },
    { any: ['กำไรจากการดำเนินงานก่อนการเปลี่ยนแปลงในเงินทุนหมุนเวียน', 'กําไรจากการดําเนินงานก่อนการเปลี่ยนแปลงในเงินทุนหมุนเวียน'], group: 'cash_from_operations_before_wc', subgroup: 'cash_from_operations_before_wc', confidence: 0.9 },
    { any: ['การเปลี่ยนแปลงในเงินทุนหมุนเวียน'], group: 'working_capital_change', subgroup: 'working_capital_change', confidence: 0.88 },
    { any: ['ลูกหนี้การค้า'], group: 'working_capital_change', subgroup: 'receivable_change', confidence: 0.86 },
    { any: ['สินค้าคงเหลือ'], group: 'working_capital_change', subgroup: 'inventory_change', confidence: 0.86 },
    { any: ['สินทรัพย์หมุนเวียนอื่น'], group: 'working_capital_change', subgroup: 'other_current_assets_change', confidence: 0.86 },
    { any: ['เงินประกัน'], group: 'working_capital_change', subgroup: 'deposits_change', confidence: 0.86 },
    { any: ['เจ้าหนี้การค้า'], group: 'working_capital_change', subgroup: 'payable_change', confidence: 0.86 },
    { any: ['หนี้สินที่เกิดจากสัญญา'], group: 'working_capital_change', subgroup: 'contract_liabilities_change', confidence: 0.86 },
    { any: ['หนี้สินหมุนเวียนอื่น'], group: 'working_capital_change', subgroup: 'other_current_liabilities_change', confidence: 0.86 },
    { any: ['หนี้สินไม่หมุนเวียนอื่น'], group: 'working_capital_change', subgroup: 'other_non_current_liabilities_change', confidence: 0.86 },
    { any: ['จ่ายภาระผูกพันผลประโยชน์พนักงาน'], group: 'employee_benefit_paid', subgroup: 'employee_benefit_paid', confidence: 0.88 },
    { any: ['กระแสเงินสดได้มาจากการดำเนินงาน', 'กระแสเงินสดได้มาจากการดําเนินงาน'], group: 'cash_from_operations', subgroup: 'cash_from_operations', confidence: 0.9 },
    { any: ['จ่ายภาษีเงินได้'], group: 'income_tax_paid', subgroup: 'income_tax_paid', confidence: 0.9 },
    { any: ['ดอกเบี้ยรับ'], group: 'interest_received', subgroup: 'interest_received', confidence: 0.9 },
    { any: ['ดอกเบี้ยจ่าย'], group: 'interest_paid', subgroup: 'interest_paid', confidence: 0.9 },
    { all: ['เงินสดจ่ายเพื่อซื้อสินทรัพย์ทางการเงิน'], group: 'financial_asset_purchase', subgroup: 'financial_asset_purchase', confidence: 0.9 },
    { all: ['เงินสดรับจากการจำหน่ายสินทรัพย์ทางการเงิน'], group: 'financial_asset_sale', subgroup: 'financial_asset_sale', confidence: 0.9 },
    { all: ['เงินสดรับจากการจําหน่ายสินทรัพย์ทางการเงิน'], group: 'financial_asset_sale', subgroup: 'financial_asset_sale', confidence: 0.9 },
    { all: ['เงินสดรับจากการไถ่ถอนสินทรัพย์ทางการเงิน'], group: 'financial_asset_redemption', subgroup: 'financial_asset_redemption', confidence: 0.9 },
    { any: ['เงินสดจ่ายเพื่อซื้อสินทรัพย์ถาวร', 'เงินสดจ่ายในการซื้อที่ดิน อาคารและอุปกรณ์', 'เงินสดจ่ายเพื่อซื้อที่ดิน อาคารและอุปกรณ์'], group: 'ppe_purchase', subgroup: 'ppe_purchase', confidence: 0.9 },
    { any: ['เงินสดรับจากการจำหน่ายสินทรัพย์ถาวร', 'เงินสดรับจากการจําหน่ายสินทรัพย์ถาวร', 'เงินสดรับจากการจำหน่ายที่ดิน อาคารและอุปกรณ์', 'เงินสดรับจากการจําหน่ายที่ดิน อาคารและอุปกรณ์'], group: 'ppe_sale', subgroup: 'ppe_sale', confidence: 0.9 },
    { all: ['เงินสดรับจากการจําหน่ายสินทรัพย์ถาวร'], group: 'ppe_sale', subgroup: 'ppe_sale', confidence: 0.9 },
    { any: ['เงินสดจ่ายเพื่อซื้อสินทรัพย์ไม่มีตัวตน', 'เงินสดจ่ายในการซื้อสินทรัพย์ไม่มีตัวตน'], group: 'intangible_purchase', subgroup: 'intangible_purchase', confidence: 0.9 },
    { any: ['เงินสดจ่ายค่ารื้อถอน'], group: 'decommissioning_payment', subgroup: 'decommissioning_payment', confidence: 0.88 },
    { any: ['เงินสดจ่ายชำระหนี้สินตามสัญญาเช่า', 'เงินสดจ่ายชําระหนี้สินตามสัญญาเช่า'], group: 'lease_payment', subgroup: 'lease_payment', confidence: 0.9 },
    { any: ['เงินปันผลจ่าย'], group: 'dividend_paid', subgroup: 'dividend_paid', confidence: 0.9 },
    { any: ['การเพิ่มขึ้นของสินทรัพย์สิทธิการใช้'], group: 'non_cash_transactions', subgroup: 'right_of_use_asset_non_cash_addition', confidence: 0.88 },
    { any: ['เจ้าหนี้ค่าซื้อสินทรัพย์ถาวร', 'เจ้าหนี้ค่าซื้อสินทรัพย์ไม่มีตัวตน'], group: 'non_cash_transactions', subgroup: 'ppe_intangible_payable_non_cash', confidence: 0.88 },
  ];
  const match = matchRule(t, rules);
  if (match) return match;

  if (s.includes('กิจกรรมดำเนินงาน') || s.includes('กิจกรรมดําเนินงาน')) return { group: 'operating_cash_flow_detail', subgroup: 'operating_cash_flow_detail', confidence: 0.86 };
  if (s.includes('กิจกรรมลงทุน')) return { group: 'investing_cash_flow_detail', subgroup: 'investing_cash_flow_detail', confidence: 0.86 };
  if (s.includes('กิจกรรมจัดหาเงิน')) return { group: 'financing_cash_flow_detail', subgroup: 'financing_cash_flow_detail', confidence: 0.86 };
  return { group: 'cash_flow_detail', subgroup: 'cash_flow_detail', confidence: 0.86 };
}

function mapEquityComponent(component) {
  const t = normalizeForMatch(component);
  if (t.includes('ทุนจดทะเบียน') || t.includes('paidupcapital')) return { group: 'equity_paid_up_capital', subgroup: 'paid_up_capital', confidence: 0.9 };
  if (t.includes('ส่วนเกินมูลค่าหุ้นสามัญ') || t.includes('sharepremium')) return { group: 'equity_share_premium', subgroup: 'share_premium', confidence: 0.9 };
  if (t.includes('ทุนสำรองตามกฎหมาย') || t.includes('ทุนสํารองตามกฎหมาย') || t.includes('legalreserve')) return { group: 'equity_legal_reserve', subgroup: 'legal_reserve', confidence: 0.9 };
  if (t.includes('ยังไม่ได้จัดสรร') || t.includes('กำไรสะสม') || t.includes('กําไรสะสม') || t.includes('retainedearnings')) return { group: 'equity_retained_earnings', subgroup: 'retained_earnings', confidence: 0.9 };
  if (t.includes('รวมส่วนของ') || t.includes('totalequity')) return { group: 'equity_statement_total', subgroup: 'equity_statement_total', confidence: 0.9 };
  return { group: 'equity_statement_detail', subgroup: 'equity_statement_detail', confidence: 0.82 };
}

function autoMapAccount(accountName, statementType, section = '') {
  const label = normalizeText(accountName);
  const standardize = (mapping) => applyTfrsStandardMetadata({ label, statementType, section, mapping });
  if (!label) return standardize(withMappingMeta({ group: 'other', subgroup: null, confidence: 0.3 }, 'unknown', 'Blank account name.'));

  const dictionaryMatch = dictionaryMapAccount(label);
  let parserMatch = null;
  if (statementType === 'income_statement') parserMatch = mapIncomeStatement(label, section);
  else if (statementType === 'balance_sheet') parserMatch = mapBalanceSheet(label, section);
  else if (statementType === 'cash_flow') parserMatch = mapCashFlow(label, section);
  else if (statementType === 'equity_statement') parserMatch = { group: 'other', subgroup: 'equity_statement_detail', confidence: 0.55, mapping_source: 'unknown' };

  // Keep existing high-confidence parser behavior for stable master files, but attach
  // TFRS metadata so Mapping Center and Export can explain the basis.
  if (parserMatch && parserMatch.group !== 'other' && Number(parserMatch.confidence || 0) >= 0.9) return standardize(withMappingMeta(parserMatch, 'parser_rule'));
  if (dictionaryMatch && (!parserMatch || parserMatch.group === 'other' || Number(dictionaryMatch.confidence || 0) >= Number(parserMatch.confidence || 0))) return standardize(dictionaryMatch);
  if (parserMatch) return standardize(withMappingMeta(parserMatch, 'parser_rule'));

  // Generic fallback for simple CSV templates.
  const t = normalizeForMatch(label);
  for (const [group, keywords] of Object.entries(CORE_GROUPS)) {
    if (keywords.some((keyword) => t === normalizeForMatch(keyword))) return standardize(withMappingMeta({ group, subgroup: group, confidence: 0.92 }, 'parser_rule'));
    if (keywords.some((keyword) => t.includes(normalizeForMatch(keyword)))) return standardize(withMappingMeta({ group, subgroup: group, confidence: 0.72 }, 'ai_similarity'));
  }
  return standardize(withMappingMeta({ group: 'other', subgroup: null, confidence: 0.5 }, 'unknown'));
}

function removeOutOfWindowHistoricalRows(rows) {
  const reportingYears = rows
    .filter((row) => row.statement_type !== 'equity_statement')
    .map((row) => row.fiscal_year)
    .filter((year) => Number.isFinite(year));
  if (!reportingYears.length) return rows;
  const primaryYear = Math.max(...reportingYears);
  const minYear = primaryYear - 3;
  return rows.filter((row) => row.fiscal_year >= minYear && row.fiscal_year <= primaryYear);
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
      candidates[0].mapping_source = candidates[0].mapping_source || 'parser_rule';
      candidates[0].suggested_account_group = candidates[0].account_group;
      candidates[0].suggested_account_subgroup = candidates[0].account_subgroup;
      // This is an inferred promotion, not a confirmed mapping. Keep it flagged for review
      // so a wrong guess never silently lands in the dashboard/export as confirmed revenue.
      candidates[0].review_reason = 'Revenue total was inferred from a single detail line; please confirm.';
      candidates[0].needs_review = true;
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
  // Expenses are stored as positive magnitudes for dashboard aggregation. Some statements
  // present them as negatives, some as positives. We normalize to positive, but we report
  // whether a sign flip actually happened so the row can be flagged for review instead of
  // silently changing a figure's sign.
  if (statementType === 'income_statement' && ['cogs', 'sga', 'expense', 'finance_cost', 'tax'].includes(group)) {
    const normalized = Math.abs(value);
    return { amount: normalized, signFlipped: value < 0 };
  }
  return { amount: value, signFlipped: false };
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

    const detectedPeriods = cellsWithPeriods(row, rows, rowIdx, currentScope).filter((col) => hasNumericBelow(rows, rowIdx, col.colIdx));
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

    amounts.forEach(({ colIdx, year, period_type, scope, value, raw }) => {
      const rawNormalizedAmount = value * unitInfo.multiplier;
      const { amount, signFlipped } = normalizeAmountForDashboard(rawNormalizedAmount, mapping.group, currentStatementType);
      const needsReview = shouldReviewMapping(mapping) || signFlipped;
      const reviewReason = signFlipped
        ? (reviewReasonForMapping(mapping) || 'Expense sign was normalized to positive; please confirm the original sign.')
        : reviewReasonForMapping(mapping);
      parsedRows.push({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${sheetName}-${rowIdx + 1}-${colIdx}-${year}`,
        company_id: companyId,
        company_name: context.companyName,
        fiscal_year: year,
        period_type: period_type === 'FY' ? 'annual' : 'period',
        period: period_type,
        statement_scope: scope || currentScope,
        statement_type: currentStatementType !== 'unknown' ? currentStatementType : 'unknown',
        account_name: cleanLabel,
        account_group: mapping.group,
        account_subgroup: mapping.subgroup || detectSubgroupFromText(sectionText),
        industry_metric: null,
        industry_profile: workbookIndustryProfile(fileName, sheetName, rows),
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
        mapping_source: mapping.mapping_source || 'parser_rule',
        suggested_account_group: mapping.group,
        suggested_account_subgroup: mapping.subgroup || detectSubgroupFromText(sectionText),
        review_reason: reviewReason,
        needs_review: needsReview,
        accounting_standard_profile: mapping.accounting_standard_profile || null,
        standard_source: mapping.standard_source || null,
        standard_ref: mapping.standard_ref || null,
        standard_label_th: mapping.standard_label_th || null,
        standard_label_en: mapping.standard_label_en || null,
        standard_chapter: mapping.standard_chapter || null,
        standard_reason: mapping.standard_reason || null,
        consolidation_indicator: mapping.consolidation_indicator || null,
        business_combination_indicator: mapping.business_combination_indicator || null,
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
        account_group: mapEquityComponent(component).group,
        account_subgroup: mapEquityComponent(component).subgroup,
        industry_metric: null,
        industry_profile: workbookIndustryProfile(fileName, sheetName, rows),
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
        mapping_confidence: mapEquityComponent(component).confidence,
        mapping_source: 'parser_rule',
        suggested_account_group: mapEquityComponent(component).group,
        suggested_account_subgroup: mapEquityComponent(component).subgroup,
        review_reason: null,
        needs_review: false,
        accounting_standard_profile: 'TFRS_NPAE',
        standard_source: 'TFRS_NPAE',
        standard_ref: mapEquityComponent(component).group === 'equity_legal_reserve' ? 'TFRS_NPAE_CONCEPT_3.18.3' : null,
        standard_label_th: mapEquityComponent(component).group === 'equity_legal_reserve' ? 'ทุนสำรองตามกฎหมาย' : null,
        standard_label_en: mapEquityComponent(component).group === 'equity_legal_reserve' ? 'Legal reserve' : null,
        standard_chapter: mapEquityComponent(component).group === 'equity_legal_reserve' ? '3' : null,
        standard_reason: mapEquityComponent(component).group === 'equity_legal_reserve' ? 'TFRS_NPAE: equity component matched legal reserve concept.' : null,
        consolidation_indicator: null,
        business_combination_indicator: null,
      });
    }
  }
  return parsedRows;
}

// Post-parse integrity validation. Cross-checks the parsed totals per fiscal year/scope so
// a row eaten or mis-mapped by the parser surfaces as a warning instead of a silent error.
function validateParsedIntegrity(rows) {
  const byKey = new Map();
  rows.forEach((row) => {
    if (!Number.isFinite(row.fiscal_year)) return;
    const key = `${row.fiscal_year}|${row.period || 'FY'}|${row.period_type || 'annual'}|${row.statement_scope || 'consolidated'}`;
    if (!byKey.has(key)) byKey.set(key, {});
    const acc = byKey.get(key);
    const g = row.account_group;
    if (g === 'asset') acc.asset = (acc.asset || 0) + row.amount;
    else if (g === 'liability') acc.liability = (acc.liability || 0) + row.amount;
    else if (g === 'equity') acc.equity = (acc.equity || 0) + row.amount;
    else if (g === 'total_current_assets') acc.currentAssets = (acc.currentAssets || 0) + row.amount;
    else if (g === 'total_non_current_assets') acc.nonCurrentAssets = (acc.nonCurrentAssets || 0) + row.amount;
    else if (g === 'revenue') acc.revenue = (acc.revenue || 0) + row.amount;
  });

  const issues = [];
  const tol = (a, b) => Math.max(Math.abs(a), Math.abs(b)) * 0.01 + 1;
  for (const [key, acc] of byKey.entries()) {
    const [year, period, periodType, scope] = key.split('|');
    if ((acc.asset || acc.liability || acc.equity)) {
      const diff = (acc.asset || 0) - ((acc.liability || 0) + (acc.equity || 0));
      if (Math.abs(diff) > tol(acc.asset || 0, (acc.liability || 0) + (acc.equity || 0))) {
        issues.push({ year: Number(year), period, periodType, scope, check: 'balance_sheet', difference: diff, message: 'Assets do not equal Liabilities + Equity.' });
      }
    }
    if (acc.currentAssets && acc.nonCurrentAssets && acc.asset) {
      const diff = (acc.currentAssets + acc.nonCurrentAssets) - acc.asset;
      if (Math.abs(diff) > tol(acc.currentAssets + acc.nonCurrentAssets, acc.asset)) {
        issues.push({ year: Number(year), period, periodType, scope, check: 'current_assets_subtotal', difference: diff, message: 'Current + Non-current assets do not equal Total assets.' });
      }
    }
    if (acc.revenue !== undefined && acc.revenue < 0) {
      issues.push({ year: Number(year), period, periodType, scope, check: 'revenue_sign', difference: acc.revenue, message: 'Total revenue is negative.' });
    }
  }
  return { passed: issues.length === 0, issues };
}

function makeSummary(rows, workbook, fileName) {
  const sheets = [...new Set(rows.map((row) => row.source_sheet))];
  const years = [...new Set(rows.map((row) => row.fiscal_year))].filter(Boolean).sort((a, b) => b - a);
  const statements = [...new Set(rows.map((row) => row.statement_type))].filter(Boolean);
  const companyNames = [...new Set(rows.map((row) => normalizeText(row.company_name)).filter(Boolean))].slice(0, 6);
  const mappedCount = rows.filter((row) => !row.needs_review).length;
  const reviewCount = rows.length - mappedCount;
  const integrity = validateParsedIntegrity(rows);
  const standardsQuality = evaluateTfrsDataQuality(rows);
  return {
    fileName,
    parserVersion: 'IMPORT_PARSER_V4_TFRS_STANDARDS_LAYER_V1',
    sheets,
    years,
    primaryYear: years[0] || new Date().getFullYear(),
    statements,
    companyNames,
    rows: rows.length,
    mappedCount,
    reviewCount,
    integrity,
    standardsQuality,
  };
}

export function parseFinancialWorkbook(workbook, companyId, fileName = '') {
  const results = [];

  for (const sheetName of workbook.SheetNames || []) {
    if (shouldIgnoreSheet(sheetName, workbook.SheetNames || [])) continue;
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

  applyFileNameFiscalYearFallback(results, fileName);
  const filteredResults = removeOutOfWindowHistoricalRows(results);
  promoteRevenueFallback(filteredResults);
  const semanticResults = filteredResults.map((row) => enrichRowSemantics(row));
  const validation = runValidationEngine(semanticResults, { strictAnnual: false });
  semanticResults.summary = makeSummary(semanticResults, workbook, fileName);
  semanticResults.summary.accountingEngineVersion = 'ACCOUNTING_ENGINE_FOUNDATION_V1_9_0';
  semanticResults.summary.validation = validation.results;
  semanticResults.summary.validationPassed = validation.passed;
  return semanticResults;
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
