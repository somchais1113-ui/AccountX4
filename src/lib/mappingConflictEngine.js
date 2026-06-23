import { normalizeForAccountingMatch } from './accountingStandards.js';

const uniq = (items = []) => [...new Set(items.filter(Boolean))];
const toArray = (value) => Array.isArray(value) ? value : String(value || '').split(',').map((x) => x.trim()).filter(Boolean);

export const CONFLICT_STATUSES = {
  NONE: 'none',
  POTENTIAL_CONFLICT: 'potential_conflict',
  CONFIRMED_CONFLICT: 'confirmed_conflict',
  HIGH_RISK_TERM: 'high_risk_term',
  MANUAL_REQUIRED: 'manual_required',
  BLOCKED: 'blocked',
};

export const APPROVAL_POLICIES = {
  SAFE_AUTO: 'safe_auto',
  SAFE_REVIEW: 'safe_review',
  MANUAL_REQUIRED: 'manual_required',
  ROW_ONLY_MANUAL: 'row_only_manual',
  BLOCKED: 'blocked',
};

const HIGH_RISK_RULES = [
  { code: 'oci_term', severity: 35, patterns: ['กำไรขาดทุนเบ็ดเสร็จ', 'กําไรขาดทุนเบ็ดเสร็จ', 'other comprehensive income', 'oci', 'ไม่จัดประเภทใหม่', 'ไม่ถูกจัดประเภทใหม่', 'จัดประเภทใหม่ไปยังกำไรหรือขาดทุน', 'จัดประเภทใหม่ไปยังกําไรหรือขาดทุน', 'reclassified to profit or loss', 'not reclassified to profit or loss'] },
  { code: 'tax_context_risk', severity: 25, patterns: ['ภาษีเงินได้รอการตัดบัญชี', 'deferred tax', 'ภาษีเงินได้ค้างจ่าย', 'tax payable', 'ภาษีเงินได้จ่าย', 'tax paid', 'ภาษีของรายการ', 'tax effect'] },
  { code: 'consolidation_nci_risk', severity: 30, patterns: ['ส่วนได้เสียที่ไม่มีอำนาจควบคุม', 'ส่วนได้เสียที่ไม่มีอํานาจควบคุม', 'non controlling', 'non-controlling', 'nci', 'บริษัทใหญ่', 'owners of the parent'] },
  { code: 'business_combination_goodwill_risk', severity: 35, patterns: ['ค่าความนิยม', 'goodwill', 'การรวมธุรกิจ', 'business combination', 'กำไรจากการซื้อในราคาต่ำกว่ามูลค่ายุติธรรม', 'กําไรจากการซื้อในราคาต่ำกว่ามูลค่ายุติธรรม', 'bargain purchase'] },
  { code: 'fair_value_risk', severity: 20, patterns: ['มูลค่ายุติธรรม', 'fair value', 'การวัดมูลค่าใหม่', 'remeasurement'] },
  { code: 'hedge_risk', severity: 25, patterns: ['hedge', 'ป้องกันความเสี่ยง', 'สำรองรายการป้องกันความเสี่ยง', 'สํารองรายการป้องกันความเสี่ยง'] },
];

const BLOCKING_GROUPS = new Set(['other', 'unknown']);
const HIGH_RISK_GROUPS = new Set(['oci_tax', 'other_comprehensive_income', 'non_controlling_interests', 'goodwill', 'gain_on_bargain_purchase', 'deferred_tax_assets', 'deferred_tax_liabilities']);
const HIGH_RISK_LINE_ROLES = new Set(['oci', 'disclosure', 'attribution', 'movement']);
const SAFE_DETAIL_ROLES = new Set(['detail']);
const CLEAR_CORE_TOTAL_GROUPS = new Set(['revenue', 'expense', 'asset', 'liability', 'equity', 'net_profit', 'profit_before_tax', 'gross_profit', 'operating_profit', 'total_current_assets', 'total_non_current_assets', 'total_current_liabilities', 'total_non_current_liabilities']);

export function normalizeAccountLabel(label = '') {
  return normalizeForAccountingMatch(label || '');
}

function includesAny(text = '', patterns = []) {
  return patterns.some((pattern) => text.includes(normalizeAccountLabel(pattern)));
}

export function detectHighRiskAccountingTerms(row = {}) {
  const text = normalizeAccountLabel([
    row.raw_account_name,
    row.account_name,
    row.section,
    row.subsection,
    row.section_path,
    row.parent_heading,
    row.review_reason,
  ].filter(Boolean).join(' '));
  const hits = HIGH_RISK_RULES.filter((rule) => includesAny(text, rule.patterns)).map((rule) => ({
    code: rule.code,
    severity: rule.severity,
  }));
  const group = row.account_group || row.suggested_account_group || '';
  if (HIGH_RISK_GROUPS.has(group)) hits.push({ code: `high_risk_group_${group}`, severity: 30 });
  const role = row.line_role || '';
  if (HIGH_RISK_LINE_ROLES.has(role)) hits.push({ code: `high_risk_line_role_${role}`, severity: 25 });
  return {
    hasHighRiskTerm: hits.length > 0,
    terms: uniq(hits.map((hit) => hit.code)),
    score: hits.reduce((sum, hit) => sum + hit.severity, 0),
  };
}

function normalizedDecisionKey(decision = {}) {
  return [
    normalizeAccountLabel(decision.raw_account_name || decision.normalized_account_name || decision.account_name),
    decision.statement_type || '',
    decision.statement_scope || 'any',
    decision.accounting_standard_profile || 'any',
    decision.line_role || 'any',
  ].join('|');
}

function sameRawName(row = {}, decision = {}) {
  const rowName = normalizeAccountLabel(row.raw_account_name || row.account_name || row.normalized_account_name);
  const decisionName = normalizeAccountLabel(decision.raw_account_name || decision.account_name || decision.normalized_account_name);
  return Boolean(rowName && decisionName && rowName === decisionName);
}

function contextMatches(row = {}, decision = {}) {
  if (!sameRawName(row, decision)) return false;
  if ((decision.statement_type || '') && (row.statement_type || '') && decision.statement_type !== row.statement_type) return false;
  const decisionScope = decision.statement_scope || 'any';
  const rowScope = row.statement_scope || 'unknown';
  if (!['any', 'unknown'].includes(decisionScope) && rowScope !== 'unknown' && decisionScope !== rowScope) return false;
  const decisionProfile = decision.accounting_standard_profile || null;
  const rowProfile = row.accounting_standard_profile || null;
  if (decisionProfile && rowProfile && decisionProfile !== rowProfile) return false;
  return true;
}

function isDecisionReusable(decision = {}) {
  if (decision.reusable === false) return false;
  if (['row_only', 'batch_only', 'global_never'].includes(decision.reuse_scope)) return false;
  if (/row_only|manual_row_only/i.test(decision.decision_method || decision.approval_scope || '')) return false;
  if (['blocked', 'confirmed_conflict', 'manual_required', 'high_risk_term'].includes(decision.conflict_status)) return false;
  if (['blocked', 'manual_required', 'row_only_manual'].includes(decision.approval_policy)) return false;
  if (toArray(decision.risk_flags).length) return false;
  if (BLOCKING_GROUPS.has(decision.account_group)) return false;
  return true;
}

export function isReusableMappingDecision(decision = {}) {
  return isDecisionReusable(decision);
}

function findPreviousMappingConflicts(row = {}, previousDecisions = [], cachedMappings = []) {
  const all = [...(previousDecisions || []), ...(cachedMappings || [])].filter(Boolean);
  const sameLabel = all.filter((decision) => sameRawName(row, decision));
  const relevant = sameLabel.filter((decision) => contextMatches(row, decision));
  const groups = uniq(relevant.map((decision) => decision.account_group).filter(Boolean));
  const allGroups = uniq(sameLabel.map((decision) => decision.account_group).filter(Boolean));
  const currentGroup = row.account_group || row.suggested_account_group || 'other';
  const conflictingRelevant = relevant.filter((decision) => decision.account_group && currentGroup && decision.account_group !== currentGroup);
  const conflictingAnyContext = sameLabel.filter((decision) => decision.account_group && currentGroup && decision.account_group !== currentGroup);
  return {
    same_label_decision_count: sameLabel.length,
    relevant_decision_count: relevant.length,
    relevant_groups: groups,
    all_groups: allGroups,
    conflicting_relevant_count: conflictingRelevant.length,
    conflicting_any_context_count: conflictingAnyContext.length,
    previous_decision_keys: uniq(relevant.map(normalizedDecisionKey)).slice(0, 20),
    reusable_decision_count: relevant.filter(isDecisionReusable).length,
  };
}

export function detectMappingConflict(row = {}, previousDecisions = [], cachedMappings = []) {
  const group = row.account_group || row.suggested_account_group || 'other';
  const lineRole = row.line_role || '';
  const riskFlags = toArray(row.risk_flags);
  const confidence = Number(row.mapping_confidence || 0);
  const highRisk = detectHighRiskAccountingTerms(row);
  const rawLabel = normalizeAccountLabel(row.raw_account_name || row.account_name || row.normalized_account_name || '');
  const syntheticCoreMetric = !rawLabel && CLEAR_CORE_TOTAL_GROUPS.has(group);
  const previous = findPreviousMappingConflicts(row, previousDecisions, cachedMappings);
  const reasons = [];
  let status = CONFLICT_STATUSES.NONE;
  let score = 0;

  if (BLOCKING_GROUPS.has(group)) {
    reasons.push('unknown_or_other_mapping');
    status = CONFLICT_STATUSES.BLOCKED;
    score += 45;
  }
  if ((!row.statement_type || row.statement_type === 'unknown') && !syntheticCoreMetric) {
    reasons.push('unknown_statement_type');
    status = CONFLICT_STATUSES.BLOCKED;
    score += 35;
  }
  if (highRisk.hasHighRiskTerm) {
    reasons.push(...highRisk.terms);
    if (status !== CONFLICT_STATUSES.BLOCKED) status = CONFLICT_STATUSES.HIGH_RISK_TERM;
    score += highRisk.score;
  }
  if (previous.conflicting_relevant_count > 0) {
    reasons.push('previous_approved_mapping_conflicts_same_context');
    status = CONFLICT_STATUSES.CONFIRMED_CONFLICT;
    score += 60;
  } else if (previous.conflicting_any_context_count > 0 || previous.all_groups.length > 1) {
    reasons.push('previous_approved_mapping_varies_by_context');
    if (![CONFLICT_STATUSES.BLOCKED, CONFLICT_STATUSES.CONFIRMED_CONFLICT].includes(status)) status = CONFLICT_STATUSES.POTENTIAL_CONFLICT;
    score += 25;
  }
  if (riskFlags.some((flag) => ['tax_not_regular_income_tax', 'business_combination_risk', 'consolidation_scope_risk', 'unknown_mapping'].includes(flag))) {
    reasons.push(...riskFlags.filter((flag) => ['tax_not_regular_income_tax', 'business_combination_risk', 'consolidation_scope_risk', 'unknown_mapping'].includes(flag)));
    if (status === CONFLICT_STATUSES.NONE) status = CONFLICT_STATUSES.MANUAL_REQUIRED;
    score += 30;
  }
  if (['total', 'subtotal', 'grand_total'].includes(lineRole)) {
    const clearCoreTotal = syntheticCoreMetric || (CLEAR_CORE_TOTAL_GROUPS.has(group) && confidence >= 0.95 && row.needs_review === false);
    if (!clearCoreTotal) {
      reasons.push('subtotal_or_total_requires_human_review');
      if (status === CONFLICT_STATUSES.NONE) status = CONFLICT_STATUSES.MANUAL_REQUIRED;
      score += 15;
    }
  }
  if (confidence > 0 && confidence < 0.86) {
    reasons.push('low_mapping_confidence');
    if (status === CONFLICT_STATUSES.NONE) status = CONFLICT_STATUSES.MANUAL_REQUIRED;
    score += 12;
  }

  return {
    conflict_status: status,
    conflict_score: Math.min(100, Math.round(score)),
    conflict_reasons: uniq(reasons),
    high_risk_terms: highRisk.terms,
    previous_mapping_summary: previous,
  };
}

export function computeApprovalPolicy(row = {}, conflictResult = null) {
  const conflict = conflictResult || detectMappingConflict(row);
  const group = row.account_group || row.suggested_account_group || 'other';
  const confidence = Number(row.mapping_confidence || 0);
  const riskFlags = toArray(row.risk_flags);
  const lineRole = row.line_role || 'detail';

  if (conflict.conflict_status === CONFLICT_STATUSES.BLOCKED) return APPROVAL_POLICIES.BLOCKED;
  if ([CONFLICT_STATUSES.CONFIRMED_CONFLICT, CONFLICT_STATUSES.HIGH_RISK_TERM].includes(conflict.conflict_status)) return APPROVAL_POLICIES.MANUAL_REQUIRED;
  if (conflict.conflict_status === CONFLICT_STATUSES.MANUAL_REQUIRED) return APPROVAL_POLICIES.MANUAL_REQUIRED;
  if (conflict.conflict_status === CONFLICT_STATUSES.POTENTIAL_CONFLICT) return APPROVAL_POLICIES.SAFE_REVIEW;
  if (confidence >= 0.9 && !riskFlags.length && SAFE_DETAIL_ROLES.has(lineRole) && !BLOCKING_GROUPS.has(group) && !HIGH_RISK_GROUPS.has(group)) return APPROVAL_POLICIES.SAFE_AUTO;
  return APPROVAL_POLICIES.SAFE_REVIEW;
}

export function evaluateMappingConflict(row = {}, { previousDecisions = [], cachedMappings = [] } = {}) {
  const conflict = detectMappingConflict(row, previousDecisions, cachedMappings);
  const approvalPolicy = computeApprovalPolicy(row, conflict);
  return {
    ...conflict,
    approval_policy: approvalPolicy,
    requires_manual_reason: [APPROVAL_POLICIES.MANUAL_REQUIRED, APPROVAL_POLICIES.ROW_ONLY_MANUAL, APPROVAL_POLICIES.BLOCKED].includes(approvalPolicy),
    reusable: approvalPolicy === APPROVAL_POLICIES.SAFE_AUTO && conflict.conflict_status === CONFLICT_STATUSES.NONE,
    reuse_scope: approvalPolicy === APPROVAL_POLICIES.SAFE_AUTO ? 'company_standard_scope' : 'row_only',
  };
}

export function isSafeForBulkConfirm(row = {}, evaluation = null) {
  const result = evaluation || evaluateMappingConflict(row);
  const riskFlags = toArray(row.risk_flags);
  const group = row.account_group || row.suggested_account_group || 'other';
  const lineRole = row.line_role || 'detail';
  return result.approval_policy === APPROVAL_POLICIES.SAFE_AUTO
    && result.conflict_status === CONFLICT_STATUSES.NONE
    && !riskFlags.length
    && !BLOCKING_GROUPS.has(group)
    && SAFE_DETAIL_ROLES.has(lineRole);
}

export function summarizeMappingConflicts(rows = []) {
  const counts = {
    total: rows.length,
    conflict_count: 0,
    manual_required_count: 0,
    blocked_count: 0,
    high_risk_count: 0,
    row_only_approval_count: 0,
    missing_approval_reason_count: 0,
  };
  (rows || []).forEach((row) => {
    const status = row.conflict_status || 'none';
    const policy = row.approval_policy || 'safe_review';
    if (status && status !== CONFLICT_STATUSES.NONE) counts.conflict_count += 1;
    if (status === CONFLICT_STATUSES.HIGH_RISK_TERM) counts.high_risk_count += 1;
    if (policy === APPROVAL_POLICIES.MANUAL_REQUIRED || status === CONFLICT_STATUSES.MANUAL_REQUIRED) counts.manual_required_count += 1;
    if (policy === APPROVAL_POLICIES.BLOCKED || status === CONFLICT_STATUSES.BLOCKED) counts.blocked_count += 1;
    if (policy === APPROVAL_POLICIES.ROW_ONLY_MANUAL || /row_only/i.test(row.approval_scope || row.decision_method || '')) counts.row_only_approval_count += 1;
    if ((policy === APPROVAL_POLICIES.MANUAL_REQUIRED || policy === APPROVAL_POLICIES.ROW_ONLY_MANUAL) && !row.manual_approval_reason && !row.approval_reason) counts.missing_approval_reason_count += 1;
  });
  return counts;
}
