import { normalizeAccountingText, normalizeForAccountingMatch } from './accountingStandards.js';
import { evaluateMappingConflict, isSafeForBulkConfirm, summarizeMappingConflicts } from './mappingConflictEngine.js';

const asNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const hasWord = (text, words = []) => words.some((word) => text.includes(normalizeForAccountingMatch(word)));
const hasAll = (text, words = []) => words.every((word) => text.includes(normalizeForAccountingMatch(word)));
const uniq = (items = []) => [...new Set(items.filter(Boolean))];
const toRiskArray = (value) => Array.isArray(value) ? value : String(value || '').split(',').map((x) => x.trim()).filter(Boolean);

export const LINE_ROLES = {
  DETAIL: 'detail',
  SUBTOTAL: 'subtotal',
  TOTAL: 'total',
  GRAND_TOTAL: 'grand_total',
  DISCLOSURE: 'disclosure',
  ATTRIBUTION: 'attribution',
  MOVEMENT: 'movement',
  OCI: 'oci',
  NOTE: 'note',
  DERIVED: 'derived',
};

export const METRIC_ROLES = {
  DASHBOARD_METRIC: 'dashboard_metric',
  SUPPORTING_LINE: 'supporting_line',
  PRESENTATION_LINE: 'presentation_line',
  VALIDATION_LINE: 'validation_line',
  IGNORED_LINE: 'ignored_line',
};

export const MAPPING_STATUSES = {
  SUGGESTED: 'suggested',
  DRAFT_EDITED: 'draft_edited',
  APPROVED: 'approved',
  BLOCKED: 'blocked',
  NEEDS_MANUAL_REVIEW: 'needs_manual_review',
};

export const CORE_DASHBOARD_GROUPS = new Set(['revenue', 'net_profit', 'asset', 'liability', 'equity']);
export const SUMMARY_OR_TOTAL_GROUPS = new Set([
  'revenue', 'expense', 'asset', 'liability', 'equity', 'net_profit', 'profit_before_tax', 'gross_profit',
  'operating_profit', 'total_current_assets', 'total_non_current_assets', 'total_current_liabilities',
  'total_non_current_liabilities', 'total_comprehensive_income',
]);
export const DETAIL_GROUPS = new Set([
  'sales_revenue', 'product_sales_revenue', 'service_revenue', 'healthcare_patient_revenue', 'real_estate_sales_revenue',
  'bank_net_interest_income', 'bank_net_fee_income', 'dividend_income', 'other_income', 'finance_income',
  'cogs', 'sga', 'finance_cost', 'tax', 'cash', 'inventory', 'receivable', 'payable', 'loan', 'deferred_tax_assets',
  'deferred_tax_liabilities', 'legal_reserve', 'retained_earnings', 'share_capital', 'share_premium',
  'operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow', 'goodwill', 'non_controlling_interests',
]);

export function normalizeAccountKey(value) {
  return normalizeForAccountingMatch(value || '');
}

export function normalizeRiskFlags(value) {
  return toRiskArray(value);
}

export function hasOciKeyword(label = '') {
  const text = normalizeAccountKey(label);
  return hasWord(text, [
    'กำไรขาดทุนเบ็ดเสร็จอื่น', 'กําไรขาดทุนเบ็ดเสร็จอื่น', 'other comprehensive income', 'OCI',
    'จะไม่จัดประเภทใหม่ไปยังกำไรหรือขาดทุน', 'จะไม่จัดประเภทใหม่ไปยังกําไรหรือขาดทุน',
    'จะจัดประเภทใหม่ไปยังกำไรหรือขาดทุน', 'จะจัดประเภทใหม่ไปยังกําไรหรือขาดทุน',
    'reclassified to profit or loss', 'not reclassified to profit or loss',
    'สำรองรายการป้องกันความเสี่ยง', 'สํารองรายการป้องกันความเสี่ยง', 'hedge reserve', 'cash flow hedge',
  ]);
}

export function hasSubtotalKeyword(label = '') {
  const text = normalizeAccountKey(label);
  return hasWord(text, ['รวม', 'total', 'subtotal']) && !hasWord(text, ['ไม่รวม', 'excluding']);
}

export function hasGrandTotalKeyword(label = '', group = '') {
  const text = normalizeAccountKey(label);
  return hasWord(text, ['รวมสินทรัพย์', 'รวมหนีสิน', 'รวมหนี้สิน', 'รวมส่วนของเจ้าของ', 'รวมส่วนของผู้ถือหุ้น', 'รวมรายได้', 'รวมค่าใช้จ่าย', 'total assets', 'total liabilities', 'total equity', 'total revenue', 'total expenses']) || ['asset', 'liability', 'equity', 'revenue', 'expense'].includes(group);
}

export function hasMovementKeyword(label = '') {
  const text = normalizeAccountKey(label);
  return hasWord(text, ['โอน', 'การเปลี่ยนแปลง', 'เปลี่ยนแปลง', 'movement', 'transfer', 'reclassification', 'ปรับปรุง']);
}

export function hasDisclosureKeyword(label = '') {
  const text = normalizeAccountKey(label);
  return hasWord(text, ['หมายเหตุ', 'นโยบาย', 'เปิดเผย', 'รายละเอียด', 'ตาราง', 'note', 'disclosure', 'policy', 'วันที่ซื้อ', 'วันซื้อ', 'acquisition date', 'มูลค่ายุติธรรม']);
}

export function hasAttributionKeyword(label = '') {
  const text = normalizeAccountKey(label);
  return hasWord(text, ['ส่วนที่เป็นของบริษัทใหญ่', 'ส่วนที่เป็นของผู้ถือหุ้นของบริษัทใหญ่', 'ผู้ถือหุ้นของบริษัทใหญ่', 'non-controlling', 'ไม่มีอำนาจควบคุม', 'ไม่มีอํานาจควบคุม', 'owners of the parent']);
}

export function hasBusinessCombinationKeyword(label = '') {
  const text = normalizeAccountKey(label);
  return hasWord(text, ['ค่าความนิยม', 'goodwill', 'การรวมธุรกิจ', 'business combination', 'กำไรจากการต่อรองราคาซื้อ', 'กําไรจากการต่อรองราคาซื้อ', 'bargain purchase', 'วันที่ซื้อ', 'วันซื้อ', 'acquisition date', 'มูลค่ายุติธรรม ณ วันที่ซื้อ']);
}

export function hasConsolidationKeyword(label = '') {
  const text = normalizeAccountKey(label);
  return hasWord(text, ['งบการเงินรวม', 'consolidated', 'บริษัทย่อย', 'subsidiary', 'รายการระหว่างกัน', 'intercompany', 'elimination', 'ส่วนได้เสียที่ไม่มีอำนาจควบคุม', 'ส่วนได้เสียที่ไม่มีอํานาจควบคุม']);
}

export function detectAccountSubgroup(label = '', group = '') {
  const text = normalizeAccountKey(label);
  if (group === 'sga') {
    if (hasWord(text, ['ขาย', 'selling', 'distribution'])) return 'selling_expenses';
    if (hasWord(text, ['บริหาร', 'administrative', 'admin'])) return 'administrative_expenses';
  }
  if (group === 'tax') {
    if (hasOciKeyword(label)) return 'other_comprehensive_income_tax';
    if (hasWord(text, ['ค้างจ่าย', 'payable'])) return 'income_tax_payable';
    return 'income_tax_expense';
  }
  if (group === 'other_comprehensive_income' || group === 'oci_tax') {
    if (hasWord(text, ['จะไม่จัดประเภทใหม่', 'not reclassified'])) return 'oci_not_reclassified';
    if (hasWord(text, ['จะจัดประเภทใหม่', 'reclassified'])) return 'oci_reclassified';
    if (hasWord(text, ['hedge', 'ป้องกันความเสี่ยง'])) return 'oci_hedge_reserve';
  }
  if (group === 'asset') {
    if (hasWord(text, ['หมุนเวียน', 'current']) && !hasWord(text, ['ไม่หมุนเวียน', 'noncurrent', 'non-current'])) return 'current_assets';
    if (hasWord(text, ['ไม่หมุนเวียน', 'noncurrent', 'non-current'])) return 'non_current_assets';
  }
  if (group === 'liability') {
    if (hasWord(text, ['หมุนเวียน', 'current']) && !hasWord(text, ['ไม่หมุนเวียน', 'noncurrent', 'non-current'])) return 'current_liabilities';
    if (hasWord(text, ['ไม่หมุนเวียน', 'noncurrent', 'non-current'])) return 'non_current_liabilities';
  }
  return null;
}

export function detectLineRole(row = {}) {
  const rawLabel = `${row.raw_account_name || row.account_name || ''}`;
  const contextLabel = `${rawLabel} ${row.section || ''} ${row.subsection || ''}`;
  const group = row.suggested_account_group || row.account_group || 'other';
  if (hasDisclosureKeyword(contextLabel)) return LINE_ROLES.DISCLOSURE;
  if (hasAttributionKeyword(contextLabel) && !['non_controlling_interests'].includes(group)) return LINE_ROLES.ATTRIBUTION;
  if (hasOciKeyword(contextLabel) || group === 'other_comprehensive_income' || group === 'oci_tax') return LINE_ROLES.OCI;
  if (hasMovementKeyword(contextLabel) && ['equity_statement', 'income_statement'].includes(row.statement_type)) return LINE_ROLES.MOVEMENT;
  // Total/subtotal status must come from the account line itself or from known total groups.
  // Section headings such as "รวมหนี้สิน" can surround a normal detail line like "เงินรับฝาก".
  if (hasGrandTotalKeyword(rawLabel, group)) return LINE_ROLES.GRAND_TOTAL;
  if (hasSubtotalKeyword(rawLabel) || SUMMARY_OR_TOTAL_GROUPS.has(group)) return LINE_ROLES.TOTAL;
  return LINE_ROLES.DETAIL;
}

export function detectMetricRole(row = {}, lineRole = null) {
  const group = row.suggested_account_group || row.account_group || 'other';
  const role = lineRole || row.line_role || detectLineRole(row);
  if (role === LINE_ROLES.NOTE || role === LINE_ROLES.DISCLOSURE) return METRIC_ROLES.IGNORED_LINE;
  if (role === LINE_ROLES.OCI || role === LINE_ROLES.ATTRIBUTION || role === LINE_ROLES.MOVEMENT) return METRIC_ROLES.PRESENTATION_LINE;
  if (CORE_DASHBOARD_GROUPS.has(group) && [LINE_ROLES.TOTAL, LINE_ROLES.GRAND_TOTAL].includes(role)) return METRIC_ROLES.DASHBOARD_METRIC;
  if (['total_current_assets', 'total_non_current_assets', 'total_current_liabilities', 'total_non_current_liabilities'].includes(group)) return METRIC_ROLES.VALIDATION_LINE;
  return METRIC_ROLES.SUPPORTING_LINE;
}

export function detectRiskFlags(row = {}, lineRole = null) {
  const label = `${row.raw_account_name || row.account_name || ''} ${row.section || ''} ${row.subsection || ''}`;
  const group = row.suggested_account_group || row.account_group || 'other';
  const role = lineRole || row.line_role || detectLineRole(row);
  const flags = [];
  if (group === 'other' || group === 'unknown') flags.push('unknown_mapping');
  if (role === LINE_ROLES.TOTAL || role === LINE_ROLES.SUBTOTAL || role === LINE_ROLES.GRAND_TOTAL) flags.push('subtotal_or_total_line');
  if (role === LINE_ROLES.GRAND_TOTAL && ['revenue', 'expense', 'asset', 'liability', 'equity'].includes(group)) flags.push('double_count_guard');
  if (hasOciKeyword(label) || role === LINE_ROLES.OCI || group === 'oci_tax') flags.push('oci_presentation_risk');
  if ((group === 'tax' || group === 'oci_tax') && hasOciKeyword(label)) flags.push('tax_not_regular_income_tax');
  if (hasBusinessCombinationKeyword(label) || row.business_combination_indicator) flags.push('business_combination_risk');
  if (hasConsolidationKeyword(label) || row.consolidation_indicator) flags.push('consolidation_scope_risk');
  if (CORE_DASHBOARD_GROUPS.has(group) && (row.needs_review || Number(row.mapping_confidence || 0) < 0.9)) flags.push('critical_metric_review');
  if (Number(row.amount || 0) < 0 && ['revenue', 'asset', 'liability', 'equity'].includes(group)) flags.push('unexpected_negative_sign');
  if (row.period && row.period !== 'FY' && row.period_type !== 'annual') flags.push('non_annual_period');
  return uniq([...(normalizeRiskFlags(row.risk_flags)), ...flags]);
}

export function riskLevelFromFlags(flags = []) {
  const set = new Set(normalizeRiskFlags(flags));
  if ([...set].some((f) => ['unknown_mapping', 'tax_not_regular_income_tax', 'business_combination_risk', 'consolidation_scope_risk', 'critical_metric_review', 'non_annual_period'].includes(f))) return 'high';
  if ([...set].some((f) => ['oci_presentation_risk', 'subtotal_or_total_line', 'double_count_guard', 'unexpected_negative_sign'].includes(f))) return 'medium';
  return 'low';
}

export function computeMappingStatus(row = {}, flags = []) {
  if (row.mapping_source === 'approved_mapping' && row.needs_review === false) return MAPPING_STATUSES.APPROVED;
  const riskLevel = riskLevelFromFlags(flags);
  if (riskLevel === 'high') return MAPPING_STATUSES.NEEDS_MANUAL_REVIEW;
  if (row.mapping_status) return row.mapping_status;
  return MAPPING_STATUSES.SUGGESTED;
}

export function isDashboardEligible(row = {}, lineRole = null, metricRole = null, flags = []) {
  const group = row.account_group || row.suggested_account_group || 'other';
  const role = lineRole || row.line_role || detectLineRole(row);
  const metric = metricRole || row.metric_role || detectMetricRole(row, role);
  if (group === 'other') return false;
  if (['disclosure', 'note', 'oci', 'attribution', 'movement'].includes(role)) return false;
  if (normalizeRiskFlags(flags).some((flag) => ['unknown_mapping', 'business_combination_risk', 'consolidation_scope_risk', 'tax_not_regular_income_tax'].includes(flag))) return false;
  if (CORE_DASHBOARD_GROUPS.has(group)) return metric === METRIC_ROLES.DASHBOARD_METRIC;
  return metric !== METRIC_ROLES.IGNORED_LINE;
}

export function isExportEligible(row = {}, lineRole = null, metricRole = null, flags = []) {
  const role = lineRole || row.line_role || detectLineRole(row);
  if (['note'].includes(role)) return false;
  if (normalizeRiskFlags(flags).includes('unknown_mapping')) return false;
  return true;
}

export function enrichRowSemantics(row = {}) {
  const rawLabel = row.raw_account_name || row.account_name || '';
  let next = { ...row };
  const initialGroup = next.account_group || next.suggested_account_group || 'other';
  const subgroup = detectAccountSubgroup(rawLabel, initialGroup) || next.account_subgroup || next.suggested_account_subgroup || null;
  if (initialGroup === 'tax' && hasOciKeyword(rawLabel)) {
    next.account_group = 'oci_tax';
    next.suggested_account_group = 'oci_tax';
    next.account_subgroup = 'other_comprehensive_income_tax';
    next.suggested_account_subgroup = 'other_comprehensive_income_tax';
    next.needs_review = true;
    next.review_reason = next.review_reason || 'OCI tax line detected. Do not treat it as regular income tax expense without review.';
  } else if (subgroup) {
    next.account_subgroup = next.account_subgroup || subgroup;
    next.suggested_account_subgroup = next.suggested_account_subgroup || subgroup;
  }
  const lineRole = next.line_role || detectLineRole(next);
  const metricRole = next.metric_role || detectMetricRole(next, lineRole);
  const riskFlags = detectRiskFlags(next, lineRole);
  const mappingStatus = computeMappingStatus(next, riskFlags);
  const reasonParts = [];
  if (riskFlags.includes('subtotal_or_total_line') || riskFlags.includes('double_count_guard')) reasonParts.push('Total/subtotal line detected; metric builder will prevent double-counting.');
  if (riskFlags.includes('tax_not_regular_income_tax')) reasonParts.push('Tax line belongs to OCI / comprehensive income presentation, not regular tax expense.');
  if (riskFlags.includes('business_combination_risk')) reasonParts.push('Business combination / goodwill signal requires manual review.');
  if (riskFlags.includes('consolidation_scope_risk')) reasonParts.push('Consolidation / NCI signal requires scope-aware review.');
  if (riskFlags.includes('critical_metric_review')) reasonParts.push('Core dashboard metric still needs human confirmation.');
  const combinedReason = [next.review_reason, ...reasonParts].filter(Boolean).join(' ');
  const conflict = evaluateMappingConflict({ ...next, line_role: lineRole, metric_role: metricRole, risk_flags: riskFlags });
  const conflictReview = conflict.conflict_status && conflict.conflict_status !== 'none';
  const finalNeedsReview = Boolean(next.needs_review || conflictReview || conflict.approval_policy === 'manual_required' || conflict.approval_policy === 'blocked');
  return {
    ...next,
    line_role: lineRole,
    metric_role: metricRole,
    risk_flags: riskFlags,
    mapping_status: conflict.approval_policy === 'blocked' ? MAPPING_STATUSES.BLOCKED : mappingStatus,
    review_reason: combinedReason || (conflict.conflict_reasons?.length ? `Mapping conflict: ${conflict.conflict_reasons.join(', ')}` : null),
    needs_review: finalNeedsReview,
    conflict_status: next.conflict_status || conflict.conflict_status,
    conflict_reasons: next.conflict_reasons || conflict.conflict_reasons,
    conflict_score: next.conflict_score ?? conflict.conflict_score,
    approval_policy: next.approval_policy || conflict.approval_policy,
    is_dashboard_eligible: isDashboardEligible(next, lineRole, metricRole, riskFlags) && !['blocked', 'confirmed_conflict'].includes(conflict.conflict_status),
    is_export_eligible: isExportEligible(next, lineRole, metricRole, riskFlags) && !['blocked', 'confirmed_conflict'].includes(conflict.conflict_status),
  };
}

export function analyzeMappingRowSafety(row = {}, selectedGroup = null) {
  const adjusted = enrichRowSemantics({
    ...row,
    account_group: selectedGroup || row.suggested_account_group || row.account_group,
    suggested_account_group: selectedGroup || row.suggested_account_group || row.account_group,
  });
  const confidence = Number(adjusted.mapping_confidence || 0);
  const flags = normalizeRiskFlags(adjusted.risk_flags);
  const riskLevel = riskLevelFromFlags(flags);
  const conflict = evaluateMappingConflict({ ...adjusted, risk_flags: flags });
  const safe = confidence >= 0.9
    && riskLevel === 'low'
    && isSafeForBulkConfirm({ ...adjusted, risk_flags: flags }, conflict);
  const conflictReason = conflict.conflict_reasons?.length ? `Conflict: ${conflict.conflict_reasons.join(', ')}` : '';
  return {
    safe,
    riskLevel,
    flags,
    lineRole: adjusted.line_role,
    metricRole: adjusted.metric_role,
    mappingStatus: safe ? 'safe_suggestion' : adjusted.mapping_status,
    conflictStatus: conflict.conflict_status,
    conflictReasons: conflict.conflict_reasons || [],
    conflictScore: conflict.conflict_score || 0,
    approvalPolicy: conflict.approval_policy,
    requiresManualReason: conflict.requires_manual_reason,
    reusable: conflict.reusable,
    reason: safe ? 'High-confidence detail line with no conflict or risk flags.' : (adjusted.review_reason || conflictReason || flags.join(', ') || 'Manual review recommended.'),
    adjusted: {
      ...adjusted,
      conflict_status: adjusted.conflict_status || conflict.conflict_status,
      conflict_reasons: adjusted.conflict_reasons || conflict.conflict_reasons,
      conflict_score: adjusted.conflict_score ?? conflict.conflict_score,
      approval_policy: adjusted.approval_policy || conflict.approval_policy,
    },
  };
}

export function mappingGroupKey(row = {}, selectedGroup = null) {
  const normalizedName = normalizeAccountKey(row.raw_account_name || row.account_name || '');
  return [
    row.company_id || '',
    normalizedName,
    row.statement_type || '',
    row.statement_scope || 'unknown',
    row.accounting_standard_profile || 'UNKNOWN',
    selectedGroup || row.suggested_account_group || row.account_group || 'other',
    row.line_role || '',
  ].join('|');
}

export function groupMappingRows(rows = [], draftGroups = {}) {
  const groups = new Map();
  rows.forEach((row) => {
    const selectedGroup = draftGroups[row.id] || row.suggested_account_group || row.account_group || 'other';
    const enriched = enrichRowSemantics({ ...row, account_group: selectedGroup, suggested_account_group: selectedGroup });
    const key = mappingGroupKey(enriched, selectedGroup);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        company_id: row.company_id,
        ticker: row.companies?.ticker_symbol || row.company_id,
        raw_account_name: row.raw_account_name || row.account_name,
        normalized_account_name: normalizeAccountKey(row.raw_account_name || row.account_name),
        statement_type: row.statement_type,
        statement_scope: row.statement_scope || 'unknown',
        accounting_standard_profile: row.accounting_standard_profile || 'UNKNOWN',
        selected_group: selectedGroup,
        selected_subgroup: enriched.suggested_account_subgroup || enriched.account_subgroup || detectAccountSubgroup(row.raw_account_name || row.account_name, selectedGroup) || selectedGroup,
        line_role: enriched.line_role,
        metric_role: enriched.metric_role,
        risk_flags: [],
        risk_level: 'low',
        conflict_reasons: [],
        conflict_status: 'none',
        approval_policy: 'safe_review',
        conflict_count: 0,
        manual_required_count: 0,
        blocked_count: 0,
        rows: [],
        years: new Set(),
        confidence_values: [],
        source_files: new Set(),
        standard_ref: row.standard_ref,
        standard_reason: row.standard_reason,
      });
    }
    const group = groups.get(key);
    const safety = analyzeMappingRowSafety(enriched, selectedGroup);
    group.rows.push(enriched);
    group.years.add(enriched.fiscal_year);
    group.confidence_values.push(Number(enriched.mapping_confidence || 0));
    if (enriched.source_file) group.source_files.add(enriched.source_file);
    group.risk_flags = uniq([...group.risk_flags, ...safety.flags]);
    group.conflict_reasons = uniq([...group.conflict_reasons, ...(safety.conflictReasons || [])]);
    if (safety.conflictStatus && safety.conflictStatus !== 'none') group.conflict_count += 1;
    if (safety.approvalPolicy === 'manual_required') group.manual_required_count += 1;
    if (safety.approvalPolicy === 'blocked' || safety.conflictStatus === 'blocked') group.blocked_count += 1;
    if (safety.approvalPolicy === 'blocked') group.approval_policy = 'blocked';
    else if (safety.approvalPolicy === 'manual_required' && group.approval_policy !== 'blocked') group.approval_policy = 'manual_required';
    else if (safety.approvalPolicy === 'safe_auto' && group.approval_policy === 'safe_review') group.approval_policy = 'safe_auto';
    group.risk_level = ['high', 'medium'].includes(safety.riskLevel) && safety.riskLevel !== group.risk_level ? safety.riskLevel : group.risk_level;
    if (safety.riskLevel === 'high' || safety.approvalPolicy === 'blocked' || safety.approvalPolicy === 'manual_required') group.risk_level = 'high';
  });
  return [...groups.values()].map((group) => {
    const avgConfidence = group.confidence_values.length
      ? group.confidence_values.reduce((a, b) => a + b, 0) / group.confidence_values.length
      : 0;
    const safeRows = group.rows.filter((row) => analyzeMappingRowSafety(row, group.selected_group).safe).length;
    const safe = safeRows === group.rows.length && group.rows.length > 0 && group.conflict_count === 0 && group.blocked_count === 0;
    const conflictStatus = group.blocked_count ? 'blocked' : group.manual_required_count ? 'manual_required' : group.conflict_count ? 'potential_conflict' : 'none';
    return {
      ...group,
      conflict_status: conflictStatus,
      years: [...group.years].filter(Boolean).sort((a, b) => a - b),
      source_files: [...group.source_files],
      avg_confidence: Number(avgConfidence.toFixed(3)),
      safe_to_bulk_confirm: safe,
      row_count: group.rows.length,
      safe_row_count: safeRows,
    };
  }).sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    return (riskOrder[a.risk_level] - riskOrder[b.risk_level]) || String(a.raw_account_name).localeCompare(String(b.raw_account_name), 'th');
  });
}

export function summarizeMappingGroups(groups = []) {
  const rows = groups.flatMap((g) => g.rows || []);
  const conflictSummary = summarizeMappingConflicts(rows);
  return {
    total_groups: groups.length,
    safe_groups: groups.filter((g) => g.safe_to_bulk_confirm).length,
    high_risk_groups: groups.filter((g) => g.risk_level === 'high').length,
    medium_risk_groups: groups.filter((g) => g.risk_level === 'medium').length,
    conflict_groups: groups.filter((g) => g.conflict_count > 0 || g.conflict_status !== 'none').length,
    manual_required_groups: groups.filter((g) => g.manual_required_count > 0 || g.approval_policy === 'manual_required').length,
    blocked_groups: groups.filter((g) => g.blocked_count > 0 || g.approval_policy === 'blocked').length,
    rows: groups.reduce((acc, g) => acc + g.row_count, 0),
    safe_rows: groups.reduce((acc, g) => acc + g.safe_row_count, 0),
    conflict_rows: conflictSummary.conflict_count,
    manual_required_rows: conflictSummary.manual_required_count,
    blocked_rows: conflictSummary.blocked_count,
  };
}

function addMetric(target, key, amount, sourceRow) {
  if (!key) return;
  if (!target[key]) target[key] = { amount: 0, source_rows: [], source_type: 'detail_sum' };
  target[key].amount += asNumber(amount);
  if (sourceRow) target[key].source_rows.push(sourceRow.id || sourceRow.source_cell || sourceRow.raw_account_name);
}

function setMetric(target, key, amount, sourceRow, sourceType = 'reported_total') {
  if (!key) return;
  target[key] = { amount: asNumber(amount), source_rows: sourceRow ? [sourceRow.id || sourceRow.source_cell || sourceRow.raw_account_name] : [], source_type: sourceType };
}

export function buildFinancialMetricsFromRows(rows = [], { strictAnnual = true } = {}) {
  const buckets = new Map();
  (rows || []).map(enrichRowSemantics).forEach((row) => {
    if (row.import_status && row.import_status !== 'confirmed') return;
    if (strictAnnual && row.period && row.period !== 'FY') return;
    const key = [row.company_id || '', row.fiscal_year || '', row.period || 'FY', row.period_type || 'annual', row.statement_scope || 'unknown'].join('|');
    if (!buckets.has(key)) buckets.set(key, { rows: [], metrics: {}, detail: {}, validation: {}, warnings: [] });
    buckets.get(key).rows.push(row);
  });

  for (const bucket of buckets.values()) {
    const totalsSeen = new Set();
    for (const row of bucket.rows) {
      const group = row.account_group || 'other';
      if (!row.is_export_eligible && !row.is_dashboard_eligible) continue;
      if ([LINE_ROLES.GRAND_TOTAL, LINE_ROLES.TOTAL].includes(row.line_role) && SUMMARY_OR_TOTAL_GROUPS.has(group)) {
        setMetric(bucket.metrics, group, row.amount, row, 'reported_total');
        totalsSeen.add(group);
      } else if (row.line_role === LINE_ROLES.DETAIL && DETAIL_GROUPS.has(group)) {
        addMetric(bucket.detail, group, row.amount, row);
      } else if (row.metric_role === METRIC_ROLES.VALIDATION_LINE) {
        setMetric(bucket.validation, group, row.amount, row, 'validation_total');
      }
    }
    // Derived metrics only when reported total is absent.
    const revenueDetailKeys = ['sales_revenue', 'product_sales_revenue', 'service_revenue', 'other_income', 'finance_income', 'dividend_income'];
    if (!bucket.metrics.revenue) {
      const amount = revenueDetailKeys.reduce((acc, key) => acc + asNumber(bucket.detail[key]?.amount), 0);
      if (amount) bucket.metrics.revenue = { amount, source_rows: revenueDetailKeys.flatMap((k) => bucket.detail[k]?.source_rows || []), source_type: 'derived_from_details' };
    }
    if (!bucket.metrics.expense) {
      const amount = ['cogs', 'sga', 'finance_cost', 'tax'].reduce((acc, key) => acc + Math.abs(asNumber(bucket.detail[key]?.amount)), 0);
      if (amount) bucket.metrics.expense = { amount, source_rows: ['cogs','sga','finance_cost','tax'].flatMap((k) => bucket.detail[k]?.source_rows || []), source_type: 'derived_from_details' };
    }
    if (!bucket.metrics.net_profit && bucket.metrics.revenue && bucket.metrics.expense) {
      setMetric(bucket.metrics, 'net_profit', bucket.metrics.revenue.amount - bucket.metrics.expense.amount, null, 'derived_from_revenue_minus_expense');
    }
    bucket.warnings = bucket.rows.flatMap((row) => normalizeRiskFlags(row.risk_flags).map((flag) => ({ flag, row_id: row.id, account: row.raw_account_name })));
  }
  return Object.fromEntries([...buckets.entries()].map(([key, bucket]) => [key, bucket]));
}

export function runValidationEngine(rows = [], { strictAnnual = true } = {}) {
  const buckets = buildFinancialMetricsFromRows(rows, { strictAnnual });
  const results = [];
  const tolerance = (a, b) => Math.max(Math.abs(asNumber(a)), Math.abs(asNumber(b))) * 0.01 + 1;
  for (const [key, bucket] of Object.entries(buckets)) {
    const [companyId, fiscalYear, period, periodType, scope] = key.split('|');
    const get = (metric) => bucket.metrics[metric]?.amount ?? bucket.validation[metric]?.amount;
    const asset = get('asset');
    const liability = get('liability');
    const equity = get('equity');
    if ([asset, liability, equity].every((v) => v !== undefined)) {
      const diff = asNumber(asset) - (asNumber(liability) + asNumber(equity));
      results.push({ company_id: companyId, fiscal_year: Number(fiscalYear), period, period_type: periodType, statement_scope: scope, validation_type: 'balance_sheet_equation', severity: Math.abs(diff) > tolerance(asset, asNumber(liability) + asNumber(equity)) ? 'error' : 'pass', difference: diff, message: Math.abs(diff) > tolerance(asset, asNumber(liability) + asNumber(equity)) ? 'Assets do not equal liabilities plus equity.' : 'Balance sheet equation passed.' });
    } else {
      results.push({ company_id: companyId, fiscal_year: Number(fiscalYear), period, period_type: periodType, statement_scope: scope, validation_type: 'balance_sheet_equation', severity: 'warning', difference: null, message: 'Missing asset/liability/equity total for validation.' });
    }
    const revenue = get('revenue');
    const netProfit = get('net_profit');
    ['revenue', 'net_profit', 'asset', 'liability', 'equity'].forEach((metric) => {
      const value = get(metric);
      results.push({ company_id: companyId, fiscal_year: Number(fiscalYear), period, period_type: periodType, statement_scope: scope, validation_type: `core_metric_${metric}`, severity: value === undefined ? 'warning' : 'pass', difference: null, message: value === undefined ? `Missing core metric: ${metric}` : `Core metric exists: ${metric}` });
    });
    if (revenue !== undefined && asNumber(revenue) < 0) {
      results.push({ company_id: companyId, fiscal_year: Number(fiscalYear), period, period_type: periodType, statement_scope: scope, validation_type: 'revenue_sign', severity: 'error', difference: revenue, message: 'Revenue total is negative.' });
    }
    if (bucket.warnings.length) {
      results.push({ company_id: companyId, fiscal_year: Number(fiscalYear), period, period_type: periodType, statement_scope: scope, validation_type: 'risk_flags', severity: bucket.warnings.some((w) => ['unknown_mapping','business_combination_risk','tax_not_regular_income_tax'].includes(w.flag)) ? 'warning' : 'info', difference: null, message: `${bucket.warnings.length} semantic risk flag(s) detected.` });
    }
  }
  return { passed: results.every((r) => ['pass', 'info'].includes(r.severity)), results, buckets };
}


// ═══════════════════════════════════════════════════════════
// v1.9.1 Readiness Gate / Metrics Snapshot Helpers
// These helpers turn semantic rows into one shared source of truth for
// Dashboard, Export, Import History, and Data Quality.
// ═══════════════════════════════════════════════════════════

export const READINESS_STATUSES = {
  NOT_READY: 'not_ready',
  MAPPING_REVIEW_REQUIRED: 'mapping_review_required',
  DASHBOARD_READY: 'dashboard_ready',
  EXPORT_READY: 'export_ready',
  EXTERNAL_USE_READY: 'external_use_ready',
};

export const CORE_METRICS = ['revenue', 'net_profit', 'asset', 'liability', 'equity'];
export const EXPORT_BLOCKING_FLAGS = new Set([
  'unknown_mapping',
  'tax_not_regular_income_tax',
  'business_combination_risk',
  'consolidation_scope_risk',
  'critical_metric_review',
  'non_annual_period',
]);

function bucketKeyParts(key = '') {
  const [companyId, fiscalYear, period, periodType, statementScope] = String(key).split('|');
  return { company_id: companyId ? Number(companyId) : null, fiscal_year: fiscalYear ? Number(fiscalYear) : null, period: period || 'FY', period_type: periodType || 'annual', statement_scope: statementScope || 'unknown' };
}

function validationIssueWeight(result = {}) {
  if (result.severity === 'blocking') return 40;
  if (result.severity === 'error') return 25;
  if (result.severity === 'warning') return 10;
  return 0;
}

export function deriveReadinessGate({ bucket = {}, validationResults = [], reviewCount = null } = {}) {
  const metrics = bucket.metrics || {};
  const rows = bucket.rows || [];
  const bucketFlags = uniq([
    ...(bucket.warnings || []).map((w) => w.flag),
    ...rows.flatMap((row) => normalizeRiskFlags(row.risk_flags)),
  ]);
  const missingCoreMetrics = CORE_METRICS.filter((metric) => metrics[metric]?.amount === undefined && bucket.validation?.[metric]?.amount === undefined);
  const criticalReviewRows = rows.filter((row) => row.needs_review && CORE_DASHBOARD_GROUPS.has(row.account_group || row.suggested_account_group || 'other')).length;
  const conflictSummary = summarizeMappingConflicts(rows);
  const reviewRows = reviewCount ?? rows.filter((row) => row.needs_review || row.mapping_status === MAPPING_STATUSES.NEEDS_MANUAL_REVIEW || row.account_group === 'other' || row.conflict_status && row.conflict_status !== 'none').length;
  const blockingValidations = validationResults.filter((r) => r.severity === 'blocking');
  const errorValidations = validationResults.filter((r) => r.severity === 'error');
  const warningValidations = validationResults.filter((r) => r.severity === 'warning');
  const blockingFlags = bucketFlags.filter((flag) => EXPORT_BLOCKING_FLAGS.has(flag));

  const blockingConflicts = conflictSummary.blocked_count + conflictSummary.manual_required_count;
  const dashboardReady = missingCoreMetrics.length === 0 && criticalReviewRows === 0 && blockingValidations.length === 0 && conflictSummary.blocked_count === 0;
  const exportReady = dashboardReady && errorValidations.length === 0 && blockingFlags.length === 0 && reviewRows === 0 && blockingConflicts === 0;
  const externalUseReady = exportReady && warningValidations.length === 0;
  let readinessStatus = READINESS_STATUSES.NOT_READY;
  if (externalUseReady) readinessStatus = READINESS_STATUSES.EXTERNAL_USE_READY;
  else if (exportReady) readinessStatus = READINESS_STATUSES.EXPORT_READY;
  else if (dashboardReady) readinessStatus = READINESS_STATUSES.DASHBOARD_READY;
  else if (rows.length && (reviewRows > 0 || warningValidations.length || errorValidations.length || blockingFlags.length)) readinessStatus = READINESS_STATUSES.MAPPING_REVIEW_REQUIRED;

  const penalty = validationResults.reduce((sum, result) => sum + validationIssueWeight(result), 0)
    + missingCoreMetrics.length * 12
    + Math.min(reviewRows, 20) * 2
    + conflictSummary.conflict_count * 5
    + conflictSummary.manual_required_count * 10
    + conflictSummary.blocked_count * 20
    + blockingFlags.length * 8
    + criticalReviewRows * 10;
  const readinessScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const blockingReasons = [
    ...missingCoreMetrics.map((metric) => `Missing core metric: ${metric}`),
    ...blockingValidations.map((r) => r.message || r.validation_type),
    ...errorValidations.map((r) => r.message || r.validation_type),
    ...blockingFlags.map((flag) => `Blocking risk flag: ${flag}`),
    ...(conflictSummary.blocked_count > 0 ? [`${conflictSummary.blocked_count} blocked mapping conflict(s).`] : []),
    ...(conflictSummary.manual_required_count > 0 ? [`${conflictSummary.manual_required_count} manual mapping approval(s) required.`] : []),
  ];
  const warnings = [
    ...warningValidations.map((r) => r.message || r.validation_type),
    ...(reviewRows > 0 ? [`${reviewRows} mapping row(s) still need review.`] : []),
    ...(criticalReviewRows > 0 ? [`${criticalReviewRows} critical metric row(s) still need review.`] : []),
    ...(conflictSummary.conflict_count > 0 ? [`${conflictSummary.conflict_count} mapping conflict / high-risk row(s) detected.`] : []),
  ];

  return {
    readiness_status: readinessStatus,
    readiness_score: readinessScore,
    dashboard_ready: dashboardReady,
    export_ready: exportReady,
    external_use_ready: externalUseReady,
    missing_core_metrics: missingCoreMetrics,
    review_rows: reviewRows,
    critical_review_rows: criticalReviewRows,
    risk_flags: bucketFlags,
    blocking_flags: blockingFlags,
    blocking_reasons: uniq(blockingReasons),
    warnings: uniq(warnings),
    mapping_conflict_summary: conflictSummary,
    validation_counts: {
      pass: validationResults.filter((r) => r.severity === 'pass').length,
      info: validationResults.filter((r) => r.severity === 'info').length,
      warning: warningValidations.length,
      error: errorValidations.length,
      blocking: blockingValidations.length,
    },
  };
}

export function buildReadinessBundle(rows = [], options = {}) {
  const validation = runValidationEngine(rows, options);
  const validationByKey = new Map();
  validation.results.forEach((result) => {
    const key = [result.company_id || '', result.fiscal_year || '', result.period || 'FY', result.period_type || 'annual', result.statement_scope || 'unknown'].join('|');
    if (!validationByKey.has(key)) validationByKey.set(key, []);
    validationByKey.get(key).push(result);
  });
  const buckets = validation.buckets || {};
  const summaries = Object.entries(buckets).map(([key, bucket]) => {
    const parts = bucketKeyParts(key);
    const validationResults = validationByKey.get(key) || [];
    return { key, ...parts, ...deriveReadinessGate({ bucket, validationResults }), metrics: bucket.metrics || {}, validation: bucket.validation || {}, metric_source_count: Object.keys(bucket.metrics || {}).length };
  });
  return { ...validation, summaries };
}

function mergeSnapshotMetricBuckets(bucket = {}) {
  // v1.9.4: Dashboard/Export need one complete source of truth. Store both
  // reported core metrics and supporting detail/validation metrics in the same
  // snapshot table so the UI does not need to re-sum raw rows for COGS, SG&A,
  // cash-flow or validation totals. Later sources intentionally override earlier
  // ones: reported metrics > validation totals > detail sums.
  return {
    ...(bucket.detail || {}),
    ...(bucket.validation || {}),
    ...(bucket.metrics || {}),
  };
}

export function flattenMetricSnapshotRows({ bucket = {}, summary = {}, importBatchId = null, snapshotRunId = null, current = true } = {}) {
  const metrics = mergeSnapshotMetricBuckets(bucket);
  return Object.entries(metrics).map(([metricKey, metric]) => ({
    company_id: summary.company_id,
    import_batch_id: importBatchId,
    fiscal_year: summary.fiscal_year,
    period: summary.period || 'FY',
    period_type: summary.period_type || 'annual',
    statement_scope: summary.statement_scope || 'unknown',
    metric_key: metricKey,
    metric_value: asNumber(metric.amount),
    source_type: metric.source_type || 'unknown',
    source_rows: metric.source_rows || [],
    validation_status: summary.readiness_status || READINESS_STATUSES.NOT_READY,
    readiness_status: summary.readiness_status || READINESS_STATUSES.NOT_READY,
    readiness_score: summary.readiness_score ?? null,
    snapshot_run_id: snapshotRunId,
    snapshot_status: current ? 'current' : 'superseded',
    is_current: Boolean(current),
    source_metric_role: metric.source_type === 'validation_total' ? 'validation_line' : (metric.source_type === 'reported_total' ? 'dashboard_metric' : 'supporting_line'),
    snapshot_metadata: {
      engine: 'accounting_engine_v1_9_4',
      generated_at: new Date().toISOString(),
      source_rows_count: Array.isArray(metric.source_rows) ? metric.source_rows.length : 0,
      batch_exact: Boolean(importBatchId),
      mapping_conflict_summary: summary.mapping_conflict_summary || null,
    },
  }));
}

export function humanReadinessLabel(status = '', lang = 'th') {
  const th = lang === 'th';
  const map = {
    [READINESS_STATUSES.NOT_READY]: th ? 'ยังไม่พร้อม' : 'Not ready',
    [READINESS_STATUSES.MAPPING_REVIEW_REQUIRED]: th ? 'ต้องตรวจ Mapping' : 'Mapping review required',
    [READINESS_STATUSES.DASHBOARD_READY]: th ? 'Dashboard พร้อม' : 'Dashboard ready',
    [READINESS_STATUSES.EXPORT_READY]: th ? 'Export พร้อม' : 'Export ready',
    [READINESS_STATUSES.EXTERNAL_USE_READY]: th ? 'พร้อมใช้งานภายนอก' : 'External use ready',
  };
  return map[status] || (th ? 'ยังไม่ตรวจ' : 'Unvalidated');
}
