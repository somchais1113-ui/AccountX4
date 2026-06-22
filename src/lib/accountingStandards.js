// TFRS Standards Layer for FinAnalytics / AccountX4.
// This module is intentionally deterministic: it does not create figures, it only
// suggests classification, attaches standards references, and runs data-quality checks.

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const ACCOUNTING_STANDARD_PROFILES = {
  TFRS_PAE: 'TFRS_PAE',
  TFRS_NPAE: 'TFRS_NPAE',
  MANAGEMENT_REPORT: 'MANAGEMENT_REPORT',
  TRIAL_BALANCE: 'TRIAL_BALANCE',
  UNKNOWN: 'UNKNOWN',
};

export function normalizeAccountingText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeForAccountingMatch(value) {
  return normalizeAccountingText(value)
    .toLowerCase()
    .replace(/[()（）\[\]{}]/g, '')
    .replace(/[\s\-–—_:;,.\/]+/g, '')
    .replace(/กํา/g, 'กำ')
    .replace(/ดํา/g, 'ดำ')
    .replace(/จํ/g, 'จำ')
    .replace(/สํ/g, 'สำ')
    .replace(/ำา/g, 'ำ');
}

const kw = (keywords = []) => keywords.map(normalizeForAccountingMatch);
const containsAny = (text, keywords = []) => kw(keywords).some((item) => text.includes(item));
const containsAll = (text, keywords = []) => kw(keywords).every((item) => text.includes(item));

export function inferAccountingStandardProfile(company = {}, row = {}) {
  const legalType = String(company.legalEntityType || company.legal_entity_type || row.legal_entity_type || '').toLowerCase();
  const companyMode = String(company.companyMode || company.company_mode || row.company_mode || '').toLowerCase();
  const ticker = company.tickerSymbol || company.ticker_symbol || row.ticker_symbol;
  const sourceType = String(row.source_type || row.sourceType || '').toLowerCase();

  if (sourceType.includes('trial_balance')) return ACCOUNTING_STANDARD_PROFILES.TRIAL_BALANCE;
  if (sourceType.includes('monthly') || sourceType.includes('management')) return ACCOUNTING_STANDARD_PROFILES.MANAGEMENT_REPORT;
  if (companyMode === 'public' || legalType === 'public_limited' || ticker) return ACCOUNTING_STANDARD_PROFILES.TFRS_PAE;
  if (legalType === 'limited_company' || legalType === 'partnership' || legalType === 'registered_partnership' || companyMode === 'private') return ACCOUNTING_STANDARD_PROFILES.TFRS_NPAE;
  return ACCOUNTING_STANDARD_PROFILES.UNKNOWN;
}

export const TFRS_NPAE_TAXONOMY = {
  cash: { ref: 'TFRS_NPAE_CH6', chapter: '6', th: 'เงินสดและรายการเทียบเท่าเงินสด', en: 'Cash and cash equivalents', statement: 'balance_sheet', section: 'current_assets', keywords: ['เงินสดและรายการเทียบเท่าเงินสด', 'เงินสด', 'cash and cash equivalents'] },
  short_term_investments: { ref: 'TFRS_NPAE_CH9', chapter: '9', th: 'เงินลงทุนระยะสั้น', en: 'Short-term investments', statement: 'balance_sheet', section: 'current_assets', keywords: ['เงินลงทุนระยะสั้น', 'short-term investments'] },
  receivable: { ref: 'TFRS_NPAE_CH7', chapter: '7', th: 'ลูกหนี้', en: 'Receivables', statement: 'balance_sheet', section: 'current_assets', keywords: ['ลูกหนี้การค้า', 'ลูกหนี้อื่น', 'trade receivables', 'accounts receivable'] },
  inventory: { ref: 'TFRS_NPAE_CH8', chapter: '8', th: 'สินค้าคงเหลือ', en: 'Inventories', statement: 'balance_sheet', section: 'current_assets', keywords: ['สินค้าคงเหลือ', 'inventory', 'inventories'] },
  biological_assets_current: { ref: 'TFRS_NPAE_CH22', chapter: '22', th: 'สินทรัพย์ชีวภาพหมุนเวียน', en: 'Current biological assets', statement: 'balance_sheet', section: 'current_assets', keywords: ['สินทรัพย์ชีวภาพหมุนเวียน'] },
  biological_assets_non_current: { ref: 'TFRS_NPAE_CH22', chapter: '22', th: 'สินทรัพย์ชีวภาพไม่หมุนเวียน', en: 'Non-current biological assets', statement: 'balance_sheet', section: 'non_current_assets', keywords: ['สินทรัพย์ชีวภาพไม่หมุนเวียน'] },
  total_current_assets: { ref: 'TFRS_NPAE_CH4_PRESENTATION', chapter: '4', th: 'รวมสินทรัพย์หมุนเวียน', en: 'Total current assets', statement: 'balance_sheet', section: 'current_assets', keywords: ['รวมสินทรัพย์หมุนเวียน', 'total current assets'] },
  property_plant_equipment: { ref: 'TFRS_NPAE_CH10', chapter: '10', th: 'ที่ดิน อาคารและอุปกรณ์', en: 'Property, plant and equipment', statement: 'balance_sheet', section: 'non_current_assets', keywords: ['ที่ดิน อาคารและอุปกรณ์', 'property plant and equipment', 'ppe'] },
  intangible_assets: { ref: 'TFRS_NPAE_CH11', chapter: '11', th: 'สินทรัพย์ไม่มีตัวตน', en: 'Intangible assets', statement: 'balance_sheet', section: 'non_current_assets', keywords: ['สินทรัพย์ไม่มีตัวตน', 'intangible assets'] },
  investment_property: { ref: 'TFRS_NPAE_CH12', chapter: '12', th: 'อสังหาริมทรัพย์เพื่อการลงทุน', en: 'Investment property', statement: 'balance_sheet', section: 'non_current_assets', keywords: ['อสังหาริมทรัพย์เพื่อการลงทุน', 'investment property'] },
  right_of_use_assets: { ref: 'TFRS_NPAE_CH14', chapter: '14', th: 'สินทรัพย์สิทธิการใช้', en: 'Right-of-use assets / lease asset', statement: 'balance_sheet', section: 'non_current_assets', keywords: ['สินทรัพย์สิทธิการใช้', 'right-of-use', 'right of use'] },
  deferred_tax_assets: { ref: 'TFRS_NPAE_CH15', chapter: '15', th: 'สินทรัพย์ภาษีเงินได้รอตัดบัญชี', en: 'Deferred tax assets', statement: 'balance_sheet', section: 'non_current_assets', keywords: ['สินทรัพย์ภาษีเงินได้รอตัดบัญชี', 'สินทรัพย์ภาษีเงินได้รอการตัดบัญชี', 'deferred tax assets'] },
  total_non_current_assets: { ref: 'TFRS_NPAE_CH4_PRESENTATION', chapter: '4', th: 'รวมสินทรัพย์ไม่หมุนเวียน', en: 'Total non-current assets', statement: 'balance_sheet', section: 'non_current_assets', keywords: ['รวมสินทรัพย์ไม่หมุนเวียน', 'total non-current assets'] },
  asset: { ref: 'TFRS_NPAE_CONCEPT_3.18.1', chapter: '3', th: 'สินทรัพย์รวม', en: 'Total assets', statement: 'balance_sheet', section: 'assets', keywords: ['รวมสินทรัพย์', 'total assets'] },
  payable: { ref: 'TFRS_NPAE_CONCEPT_3.18.2', chapter: '3', th: 'เจ้าหนี้การค้าและเจ้าหนี้อื่น', en: 'Trade and other payables', statement: 'balance_sheet', section: 'current_liabilities', keywords: ['เจ้าหนี้การค้า', 'เจ้าหนี้อื่น', 'trade payables', 'accounts payable'] },
  loan: { ref: 'TFRS_NPAE_CH13', chapter: '13', th: 'เงินกู้ยืม / ต้นทุนการกู้ยืม', en: 'Borrowings / borrowing costs', statement: 'balance_sheet', section: 'liabilities', keywords: ['เงินกู้ยืม', 'borrowings', 'loan'] },
  lease_liabilities: { ref: 'TFRS_NPAE_CH14', chapter: '14', th: 'หนี้สินตามสัญญาเช่า', en: 'Lease liabilities', statement: 'balance_sheet', section: 'liabilities', keywords: ['หนี้สินตามสัญญาเช่า', 'lease liabilities'] },
  income_tax_payable: { ref: 'TFRS_NPAE_CH15', chapter: '15', th: 'ภาษีเงินได้ค้างจ่าย', en: 'Income tax payable', statement: 'balance_sheet', section: 'current_liabilities', keywords: ['ภาษีเงินได้ค้างจ่าย', 'ภาษีเงินได้นิติบุคคลค้างจ่าย', 'income tax payable'] },
  provisions: { ref: 'TFRS_NPAE_CH16', chapter: '16', th: 'ประมาณการหนี้สิน', en: 'Provisions', statement: 'balance_sheet', section: 'liabilities', keywords: ['ประมาณการหนี้สิน', 'provisions'] },
  liability: { ref: 'TFRS_NPAE_CONCEPT_3.18.2', chapter: '3', th: 'หนี้สินรวม', en: 'Total liabilities', statement: 'balance_sheet', section: 'liabilities', keywords: ['รวมหนี้สิน', 'total liabilities'] },
  share_premium: { ref: 'TFRS_NPAE_CONCEPT_3.18.3', chapter: '3', th: 'ส่วนเกินมูลค่าหุ้น', en: 'Share premium', statement: 'balance_sheet', section: 'equity', keywords: ['ส่วนเกินมูลค่าหุ้น', 'share premium'] },
  legal_reserve: { ref: 'TFRS_NPAE_CONCEPT_3.18.3', chapter: '3', th: 'ทุนสำรองตามกฎหมาย', en: 'Legal reserve', statement: 'balance_sheet', section: 'equity', keywords: ['ทุนสำรองตามกฎหมาย', 'สำรองตามกฎหมาย', 'legal reserve'] },
  retained_earnings: { ref: 'TFRS_NPAE_CONCEPT_3.18.3', chapter: '3', th: 'กำไรสะสม', en: 'Retained earnings', statement: 'balance_sheet', section: 'equity', keywords: ['กำไรสะสม', 'retained earnings'] },
  equity: { ref: 'TFRS_NPAE_CONCEPT_3.18.3', chapter: '3', th: 'ส่วนของเจ้าของรวม', en: 'Total equity', statement: 'balance_sheet', section: 'equity', keywords: ['รวมส่วนของเจ้าของ', 'รวมส่วนของผู้ถือหุ้น', 'total equity'] },
  revenue: { ref: 'TFRS_NPAE_CH18', chapter: '18', th: 'รายได้', en: 'Revenue', statement: 'income_statement', section: 'income', keywords: ['รายได้', 'รวมรายได้', 'revenue', 'total revenue'] },
  sales_revenue: { ref: 'TFRS_NPAE_CH18', chapter: '18', th: 'รายได้จากการขายหรือบริการ', en: 'Sales or service revenue', statement: 'income_statement', section: 'income', keywords: ['รายได้จากการขาย', 'รายได้จากการให้บริการ', 'sales revenue', 'service revenue'] },
  real_estate_sales_revenue: { ref: 'TFRS_NPAE_CH19', chapter: '19', th: 'รายได้จากการขายอสังหาริมทรัพย์', en: 'Revenue from real estate sales', statement: 'income_statement', section: 'income', keywords: ['รายได้จากการขายอสังหาริมทรัพย์'] },
  construction_revenue: { ref: 'TFRS_NPAE_CH20', chapter: '20', th: 'รายได้จากสัญญาก่อสร้าง', en: 'Construction contract revenue', statement: 'income_statement', section: 'income', keywords: ['รายได้จากสัญญาก่อสร้าง', 'construction revenue'] },
  cogs: { ref: 'TFRS_NPAE_CH18', chapter: '18', th: 'ต้นทุนขาย / ต้นทุนบริการ', en: 'Cost of sales / service cost', statement: 'income_statement', section: 'expense', keywords: ['ต้นทุนขาย', 'ต้นทุนการให้บริการ', 'cost of sales', 'cogs'] },
  sga: { ref: 'TFRS_NPAE_CH4_PRESENTATION', chapter: '4', th: 'ค่าใช้จ่ายขายและบริหาร', en: 'Selling and administrative expenses', statement: 'income_statement', section: 'expense', keywords: ['ค่าใช้จ่ายในการขาย', 'ค่าใช้จ่ายในการบริหาร', 'selling expenses', 'administrative expenses'] },
  finance_cost: { ref: 'TFRS_NPAE_CH13', chapter: '13', th: 'ต้นทุนทางการเงิน', en: 'Finance costs', statement: 'income_statement', section: 'expense', keywords: ['ต้นทุนทางการเงิน', 'ค่าใช้จ่ายดอกเบี้ย', 'finance cost', 'interest expense'] },
  tax: { ref: 'TFRS_NPAE_CH15', chapter: '15', th: 'ค่าใช้จ่ายภาษีเงินได้', en: 'Income tax expense', statement: 'income_statement', section: 'tax', keywords: ['ค่าใช้จ่ายภาษีเงินได้', 'ภาษีเงินได้', 'income tax'] },
  net_profit: { ref: 'TFRS_NPAE_CONCEPT_3.20', chapter: '3', th: 'กำไรหรือขาดทุนสุทธิ', en: 'Net profit or loss', statement: 'income_statement', section: 'profit_loss', keywords: ['กำไรสุทธิ', 'ขาดทุนสุทธิ', 'net profit', 'net income', 'net loss'] },
};

export const TFRS10_CONSOLIDATION_RULES = [
  { any: ['งบการเงินรวม', 'consolidated financial statements'], flag: 'consolidated_statement', group: 'consolidation_presentation', ref: 'TFRS10_CONTROL_MODEL', labelTh: 'งบการเงินรวม', labelEn: 'Consolidated financial statements', confidence: 0.96 },
  { any: ['บริษัทย่อย', 'subsidiaries', 'subsidiary'], flag: 'subsidiary_signal', group: 'investment_in_subsidiaries', ref: 'TFRS10_CONTROL_MODEL', labelTh: 'บริษัทย่อย', labelEn: 'Subsidiaries', confidence: 0.92 },
  { any: ['ส่วนได้เสียที่ไม่มีอำนาจควบคุม', 'ส่วนได้เสียที่ไม่มีอํานาจควบคุม', 'non-controlling interests', 'non controlling interests'], flag: 'non_controlling_interest', group: 'non_controlling_interests', ref: 'TFRS10_NCI', labelTh: 'ส่วนได้เสียที่ไม่มีอำนาจควบคุม', labelEn: 'Non-controlling interests', confidence: 0.95 },
  { any: ['รายการระหว่างกัน', 'ตัดรายการระหว่างกัน', 'intercompany', 'elimination'], flag: 'intercompany_elimination', group: 'consolidation_elimination', ref: 'TFRS10_CONSOLIDATION_PROCEDURES', labelTh: 'รายการระหว่างกัน / elimination', labelEn: 'Intercompany elimination', confidence: 0.9 },
];

export const TFRS3_BUSINESS_COMBINATION_RULES = [
  { any: ['ค่าความนิยม', 'goodwill'], flag: 'goodwill', group: 'goodwill', ref: 'TFRS3_GOODWILL', labelTh: 'ค่าความนิยม', labelEn: 'Goodwill', confidence: 0.95 },
  { any: ['กำไรจากการต่อรองราคาซื้อ', 'กําไรจากการต่อรองราคาซื้อ', 'bargain purchase'], flag: 'bargain_purchase_gain', group: 'gain_on_bargain_purchase', ref: 'TFRS3_BARGAIN_PURCHASE', labelTh: 'กำไรจากการต่อรองราคาซื้อ', labelEn: 'Gain on bargain purchase', confidence: 0.9 },
  { any: ['การรวมธุรกิจ', 'business combination'], flag: 'business_combination', group: 'business_combination_item', ref: 'TFRS3_BUSINESS_COMBINATION', labelTh: 'การรวมธุรกิจ', labelEn: 'Business combination', confidence: 0.9 },
  { any: ['วันซื้อ', 'วันที่ซื้อ', 'acquisition date'], flag: 'acquisition_date', group: 'business_combination_disclosure', ref: 'TFRS3_ACQUISITION_DATE', labelTh: 'วันที่ซื้อ', labelEn: 'Acquisition date', confidence: 0.86 },
  { any: ['มูลค่ายุติธรรม ณ วันที่ซื้อ', 'fair value at acquisition date'], flag: 'fair_value_acquisition', group: 'business_combination_fair_value', ref: 'TFRS3_FAIR_VALUE_MEASUREMENT', labelTh: 'มูลค่ายุติธรรม ณ วันที่ซื้อ', labelEn: 'Fair value at acquisition date', confidence: 0.86 },
];

export function lookupTfrsTaxonomyByGroup(group) {
  return TFRS_NPAE_TAXONOMY[group] || null;
}

export function matchTfrsTaxonomy(label, statementType = '', section = '') {
  const text = normalizeForAccountingMatch(`${label} ${section}`);
  let best = null;
  for (const [group, item] of Object.entries(TFRS_NPAE_TAXONOMY)) {
    if (statementType && item.statement && item.statement !== statementType) {
      // Allow concept-level totals to match regardless of statement when explicitly named.
      if (!['asset', 'liability', 'equity', 'revenue', 'net_profit'].includes(group)) continue;
    }
    if (containsAny(text, item.keywords)) {
      const score = item.keywords.reduce((acc, k) => acc + (text.includes(normalizeForAccountingMatch(k)) ? normalizeForAccountingMatch(k).length : 0), 0);
      if (!best || score > best.score) best = { ...item, group, score };
    }
  }
  return best;
}

function matchSpecialRules(label, rules) {
  const text = normalizeForAccountingMatch(label);
  return rules.find((rule) => {
    if (rule.any && containsAny(text, rule.any)) return true;
    if (rule.all && containsAll(text, rule.all)) return true;
    return false;
  }) || null;
}

export function detectTfrs10Signal(label) {
  return matchSpecialRules(label, TFRS10_CONSOLIDATION_RULES);
}

export function detectTfrs3Signal(label) {
  return matchSpecialRules(label, TFRS3_BUSINESS_COMBINATION_RULES);
}

export function applyTfrsStandardMetadata({ label = '', statementType = '', section = '', mapping = {}, company = {}, row = {} } = {}) {
  const profile = inferAccountingStandardProfile(company, row);
  const base = { ...(mapping || {}) };
  let standard = lookupTfrsTaxonomyByGroup(base.group) || matchTfrsTaxonomy(label, statementType, section);
  const tfrs10 = detectTfrs10Signal(`${label} ${section}`);
  const tfrs3 = detectTfrs3Signal(`${label} ${section}`);

  if (tfrs3 && (!standard || tfrs3.confidence >= Number(base.confidence || 0))) {
    standard = { ref: tfrs3.ref, chapter: 'TFRS3', th: tfrs3.labelTh, en: tfrs3.labelEn, group: tfrs3.group, statement: statementType, section: 'business_combination' };
    if (base.group === 'other' || !base.group || Number(base.confidence || 0) < tfrs3.confidence) {
      base.group = tfrs3.group;
      base.subgroup = base.subgroup || tfrs3.flag;
      base.confidence = Math.max(Number(base.confidence || 0), tfrs3.confidence);
    }
  } else if (tfrs10 && (!standard || tfrs10.confidence >= Number(base.confidence || 0))) {
    standard = { ref: tfrs10.ref, chapter: 'TFRS10', th: tfrs10.labelTh, en: tfrs10.labelEn, group: tfrs10.group, statement: statementType, section: 'consolidation' };
    if ((base.group === 'other' || !base.group) && tfrs10.group) {
      base.group = tfrs10.group;
      base.subgroup = base.subgroup || tfrs10.flag;
      base.confidence = Math.max(Number(base.confidence || 0), tfrs10.confidence);
    }
  }

  if (!standard) {
    return {
      ...base,
      accounting_standard_profile: profile,
      standard_source: null,
      standard_ref: null,
      standard_label_th: null,
      standard_label_en: null,
      standard_chapter: null,
      standard_reason: base.review_reason || null,
      consolidation_indicator: tfrs10?.flag || null,
      business_combination_indicator: tfrs3?.flag || null,
    };
  }

  const isPrivateStandard = profile === ACCOUNTING_STANDARD_PROFILES.TFRS_NPAE || profile === ACCOUNTING_STANDARD_PROFILES.MANAGEMENT_REPORT || profile === ACCOUNTING_STANDARD_PROFILES.TRIAL_BALANCE;
  const standardSource = standard.ref?.startsWith('TFRS10') ? 'TFRS10' : standard.ref?.startsWith('TFRS3') ? 'TFRS3' : (isPrivateStandard ? 'TFRS_NPAE' : 'TFRS_CONCEPTUAL_REFERENCE');
  const reason = `${standardSource}: matched ${standard.th || standard.en || standard.group} (${standard.ref}).`;

  return {
    ...base,
    accounting_standard_profile: profile,
    standard_source: standardSource,
    standard_ref: standard.ref,
    standard_label_th: standard.th,
    standard_label_en: standard.en,
    standard_chapter: standard.chapter,
    standard_reason: reason,
    review_reason: base.review_reason || (base.mapping_source === 'accounting_dictionary' ? `${reason} Human confirmation required before approval.` : null),
    consolidation_indicator: tfrs10?.flag || null,
    business_combination_indicator: tfrs3?.flag || null,
  };
}

export function buildTfrsMappingReferenceRows(rows = []) {
  const seen = new Set();
  return (rows || [])
    .filter((row) => row.standard_ref || row.standard_source || row.consolidation_indicator || row.business_combination_indicator)
    .map((row) => {
      const key = [row.raw_account_name || row.account_name, row.account_group, row.standard_ref, row.fiscal_year].join('|');
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        fiscal_year: row.fiscal_year,
        statement_type: row.statement_type,
        raw_account_name: row.raw_account_name || row.account_name,
        account_group: row.account_group,
        account_subgroup: row.account_subgroup,
        standard_profile: row.accounting_standard_profile,
        standard_source: row.standard_source,
        standard_ref: row.standard_ref,
        standard_label_th: row.standard_label_th,
        standard_label_en: row.standard_label_en,
        standard_reason: row.standard_reason,
        consolidation_indicator: row.consolidation_indicator,
        business_combination_indicator: row.business_combination_indicator,
        needs_review: row.needs_review,
        mapping_confidence: row.mapping_confidence,
      };
    })
    .filter(Boolean);
}

export function evaluateTfrsDataQuality(rows = [], { profile = null } = {}) {
  const activeRows = (rows || []).filter(Boolean);
  const totalRows = activeRows.length;
  const reviewRows = activeRows.filter((row) => row.needs_review || Number(row.mapping_confidence || 0) < 0.86 || row.account_group === 'other');
  const standardRows = activeRows.filter((row) => row.standard_ref || row.standard_source);
  const coreGroups = ['revenue', 'net_profit', 'asset', 'liability', 'equity'];
  const foundCore = new Set(activeRows.map((row) => row.account_group));
  const missingCore = coreGroups.filter((group) => !foundCore.has(group));
  const criticalReview = reviewRows.filter((row) => coreGroups.includes(row.account_group) || coreGroups.includes(row.suggested_account_group));
  const consolidationSignals = activeRows.filter((row) => row.consolidation_indicator);
  const businessCombinationSignals = activeRows.filter((row) => row.business_combination_indicator);

  let score = 100;
  if (totalRows) score -= Math.min(35, (reviewRows.length / totalRows) * 35);
  score -= missingCore.length * 7;
  score -= criticalReview.length ? 12 : 0;
  if (profile === ACCOUNTING_STANDARD_PROFILES.TFRS_NPAE && businessCombinationSignals.length) score -= 3; // still allowed, but needs disclosure attention.

  return {
    score: Math.max(0, Math.round(score)),
    total_rows: totalRows,
    review_rows: reviewRows.length,
    tfrs_referenced_rows: standardRows.length,
    missing_core_metrics: missingCore,
    critical_review_rows: criticalReview.length,
    consolidation_signals: [...new Set(consolidationSignals.map((row) => row.consolidation_indicator))],
    business_combination_signals: [...new Set(businessCombinationSignals.map((row) => row.business_combination_indicator))],
  };
}
