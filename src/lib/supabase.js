import { createClient } from "@supabase/supabase-js";
import { inferAccountingStandardProfile } from "./accountingStandards.js";
import { enrichRowSemantics, analyzeMappingRowSafety, normalizeAccountKey, buildReadinessBundle, flattenMetricSnapshotRows, humanReadinessLabel } from "./accountingEngine.js";
import { evaluateMappingConflict, isSafeForBulkConfirm, isReusableMappingDecision, summarizeMappingConflicts } from "./mappingConflictEngine.js";
import { APP_SCHEMA_VERSION, REQUIRED_MIGRATIONS, buildMissingDoctorRpcStatus, normalizeDoctorStatus } from "./systemDoctor.js";

// Vite exposes only variables that start with VITE_ to browser code.
// Values are embedded at build time, so Vercel/Netlify must be redeployed after env changes.
const cleanEnv = (value) => (typeof value === "string" ? value.trim() : "");

const url = cleanEnv(import.meta.env.VITE_SUPABASE_URL);
const key = cleanEnv(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_KEY
);

export const supabaseEnvStatus = {
  mode: import.meta.env.MODE,
  hasUrl: Boolean(url),
  hasKey: Boolean(key),
};

export const isSupabaseConfigured = Boolean(url && key);
export const supabase = isSupabaseConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

const requireClient = () => {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
};

export { APP_SCHEMA_VERSION, REQUIRED_MIGRATIONS };

function isMissingSystemDoctorRpcError(error) {
  const message = error?.message || error?.details || error?.hint || String(error || '');
  return /system_doctor_status|schema cache|Could not find the function|function .* does not exist|does not exist/i.test(message);
}

export async function loadSystemDoctorStatus() {
  const client = requireClient();
  const { data, error } = await client.rpc('system_doctor_status');
  if (error) {
    if (isMissingSystemDoctorRpcError(error)) {
      return buildMissingDoctorRpcStatus('System Doctor RPC is not installed. Run migration 202606230010_system_doctor_preflight.sql, then refresh this page.');
    }
    throw normalizeSupabaseError(error);
  }
  return normalizeDoctorStatus(data || {});
}

function importRpcRequiredMessage() {
  return [
    'Import transaction RPC is required in v1.9.6. The app will not fall back to the legacy multi-request save flow.',
    'Run Supabase migrations 202606230006_import_transaction_rpc.sql through 202606230010_system_doctor_preflight.sql, then open System Doctor and verify PASS before importing.',
  ].join(' ');
}


const OPTIONAL_MAPPING_COLUMNS = new Set([
  'mapping_source',
  'suggested_account_group',
  'suggested_account_subgroup',
  'review_reason',
  'accounting_standard_profile',
  'standard_source',
  'standard_ref',
  'standard_label_th',
  'standard_label_en',
  'standard_chapter',
  'standard_reason',
  'consolidation_indicator',
  'business_combination_indicator',
  'line_role',
  'metric_role',
  'section_path',
  'parent_heading',
  'risk_flags',
  'mapping_status',
  'approval_scope',
  'approved_mapping_id',
  'is_dashboard_eligible',
  'is_export_eligible',
  'conflict_status',
  'conflict_reasons',
  'conflict_score',
  'approval_policy',
  'manual_approval_reason',
  'mapping_conflict_checked_at',
]);

const OPTIONAL_APPROVAL_COLUMNS = new Set([
  'is_approved',
  'mapping_source',
  'approved_by',
  'approved_at',
  'usage_count',
  'last_used_at',
  'standard_ref',
  'standard_source',
  'standard_label_th',
  'standard_label_en',
  'normalized_account_name',
  'statement_scope',
  'accounting_standard_profile',
  'line_role',
  'risk_flags',
  'approval_scope',
  'approval_reason',
  'approval_policy',
  'conflict_status',
  'conflict_reasons',
  'reusable',
  'reuse_scope',
]);

function stripColumns(row, columns) {
  const next = { ...(row || {}) };
  columns.forEach((col) => delete next[col]);
  return next;
}

function isMissingOptionalColumnError(error, columns) {
  const message = error?.message || String(error || '');
  return /schema cache|Could not find|column|does not exist/i.test(message) && [...columns].some((col) => message.includes(col));
}

function normalizeRawAccountKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function loadApprovedMappingDecisions(client, companyId) {
  if (!companyId) return [];
  try {
    const { data, error } = await client
      .from('mapping_decisions')
      .select('raw_account_name,normalized_account_name,statement_type,statement_scope,accounting_standard_profile,line_role,risk_flags,decision_method,account_group,account_subgroup,approved_at,approval_policy,conflict_status,conflict_reasons,reusable,reuse_scope')
      .eq('company_id', companyId)
      .eq('decision_status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(2000);
    if (error) return [];
    return (data || [])
      .filter((row) => isReusableMappingDecision(row))
      .map((row) => ({
        ...row,
        approval_scope: row.decision_method || 'mapping_decision',
        is_approved: true,
        mapping_source: 'approved_mapping_decision',
        last_used_at: row.approved_at || null,
      }));
  } catch (_) {
    return [];
  }
}

async function loadApprovedAccountMappings(client, companyId) {
  if (!companyId) return [];
  const decisionMappings = await loadApprovedMappingDecisions(client, companyId);
  let { data, error } = await client
    .from('account_mappings')
    .select('raw_account_name,normalized_account_name,statement_type,statement_scope,accounting_standard_profile,line_role,risk_flags,approval_scope,account_group,account_subgroup,industry_metric,is_approved,mapping_source,last_used_at')
    .eq('company_id', companyId)
    .eq('is_approved', true);

  if (error && isMissingOptionalColumnError(error, OPTIONAL_APPROVAL_COLUMNS)) {
    const fallback = await client
      .from('account_mappings')
      .select('raw_account_name,statement_type,account_group,account_subgroup,industry_metric')
      .eq('company_id', companyId);
    data = fallback.data;
    error = fallback.error;
  }
  if (error) return decisionMappings;
  return [...decisionMappings, ...(data || [])];
}

// High-risk accounting term requires manual review before approved mapping can be reused.
function isHighRiskMappingLabel(value = '') {
  const text = normalizeRawAccountKey(value);
  return /(ไม่.?จัดประเภทใหม่|จัดประเภทใหม่.*กำไร|กำไรหรือขาดทุนในภายหลัง|กำไรขาดทุนเบ็ดเสร็จ|other comprehensive|reclassif|hedge|ป้องกันความเสี่ยง|ค่าความนิยม|goodwill|ส่วนได้เสียที่ไม่มีอำนาจควบคุม|non.?controlling|business combination|รวมธุรกิจ|วันที่ซื้อ|มูลค่ายุติธรรม)/i.test(text);
}

function isReusableApprovedMapping(mapping = {}, row = {}) {
  if (!isReusableMappingDecision(mapping)) return false;
  if (!mapping?.account_group || ['other', 'unknown'].includes(mapping.account_group)) return false;
  if (Array.isArray(mapping.risk_flags) && mapping.risk_flags.length) return false;
  if (isHighRiskMappingLabel(row.raw_account_name || row.account_name || mapping.raw_account_name)) return false;

  const rowScope = row.statement_scope || 'unknown';
  const mappingScope = mapping.statement_scope || 'any';
  if (mappingScope !== 'any' && rowScope !== 'unknown' && mappingScope !== rowScope) return false;

  const rowProfile = row.accounting_standard_profile || null;
  const mappingProfile = mapping.accounting_standard_profile || null;
  if (mappingProfile && rowProfile && mappingProfile !== rowProfile) return false;

  const rowRole = row.line_role || null;
  const mappingRole = mapping.line_role || null;
  if (mappingRole && rowRole && mappingRole !== rowRole) return false;
  if (mappingRole && !['detail', 'dashboard_metric', 'validation_line'].includes(mappingRole)) return false;

  return true;
}

function pickApprovedMappingForRow(row = {}, mappings = []) {
  const rowName = normalizeRawAccountKey(row.raw_account_name || row.account_name);
  const rowStatement = row.statement_type || '';
  const candidates = (mappings || []).filter((mapping) =>
    (mapping.statement_type || '') === rowStatement &&
    normalizeRawAccountKey(mapping.raw_account_name) === rowName &&
    isReusableApprovedMapping(mapping, row)
  );
  if (!candidates.length) return null;
  const score = (mapping) => {
    let value = 0;
    if ((mapping.statement_scope || 'any') === (row.statement_scope || 'unknown')) value += 4;
    if (mapping.accounting_standard_profile && mapping.accounting_standard_profile === row.accounting_standard_profile) value += 2;
    if (mapping.line_role && mapping.line_role === row.line_role) value += 2;
    if (mapping.approval_scope && /single|bulk_safe|group|mapping_decision/.test(mapping.approval_scope)) value += 1;
    if (mapping.mapping_source === 'approved_mapping_decision') value += 1;
    return value;
  };
  return [...candidates].sort((a, b) => score(b) - score(a))[0] || null;
}

function applyApprovedAccountMappings(rows = [], approvedMappings = []) {
  if (!approvedMappings.length) return rows.map((row) => {
    const semantic = enrichRowSemantics(row);
    const conflict = evaluateMappingConflict(semantic, { previousDecisions: [], cachedMappings: [] });
    if (conflict.conflict_status !== 'none') {
      return {
        ...semantic,
        needs_review: true,
        mapping_source: semantic.mapping_source || 'risk_guard',
        review_reason: semantic.review_reason || 'Mapping conflict / high-risk accounting term requires review before import memory can be reused.',
        conflict_status: conflict.conflict_status,
        conflict_reasons: conflict.conflict_reasons,
        conflict_score: conflict.conflict_score,
        approval_policy: conflict.approval_policy,
        mapping_conflict_checked_at: new Date().toISOString(),
      };
    }
    return semantic;
  });
  return rows.map((row) => {
    const semantic = enrichRowSemantics(row);
    const conflictBeforeReuse = evaluateMappingConflict(semantic, { previousDecisions: approvedMappings, cachedMappings: [] });
    const mapping = pickApprovedMappingForRow(semantic, approvedMappings);
    if (!mapping) {
      if (conflictBeforeReuse.conflict_status !== 'none' || isHighRiskMappingLabel(semantic.raw_account_name || semantic.account_name)) {
        return {
          ...semantic,
          needs_review: true,
          mapping_source: semantic.mapping_source || 'risk_guard',
          review_reason: semantic.review_reason || 'High-risk/conflicting accounting term requires manual review before approved mapping can be reused.',
          conflict_status: conflictBeforeReuse.conflict_status,
          conflict_reasons: conflictBeforeReuse.conflict_reasons,
          conflict_score: conflictBeforeReuse.conflict_score,
          approval_policy: conflictBeforeReuse.approval_policy,
          mapping_conflict_checked_at: new Date().toISOString(),
        };
      }
      return semantic;
    }
    const mapped = enrichRowSemantics({
      ...semantic,
      account_group: mapping.account_group,
      account_subgroup: mapping.account_subgroup || semantic.account_subgroup || null,
      industry_metric: mapping.industry_metric || semantic.industry_metric || null,
      mapping_confidence: 1,
      mapping_source: 'approved_mapping',
      suggested_account_group: mapping.account_group,
      suggested_account_subgroup: mapping.account_subgroup || null,
      review_reason: null,
      needs_review: false,
    });
    const conflictAfterReuse = evaluateMappingConflict(mapped, { previousDecisions: approvedMappings, cachedMappings: [] });
    if (!isSafeForBulkConfirm(mapped, conflictAfterReuse) && conflictAfterReuse.approval_policy !== 'safe_auto') {
      return {
        ...mapped,
        needs_review: true,
        mapping_source: 'approved_mapping_conflict_guard',
        review_reason: 'Approved mapping memory exists, but this row has conflict/high-risk context and needs human review.',
        conflict_status: conflictAfterReuse.conflict_status,
        conflict_reasons: conflictAfterReuse.conflict_reasons,
        conflict_score: conflictAfterReuse.conflict_score,
        approval_policy: conflictAfterReuse.approval_policy,
        mapping_conflict_checked_at: new Date().toISOString(),
      };
    }
    return {
      ...mapped,
      conflict_status: conflictAfterReuse.conflict_status,
      conflict_reasons: conflictAfterReuse.conflict_reasons,
      conflict_score: conflictAfterReuse.conflict_score,
      approval_policy: conflictAfterReuse.approval_policy,
      mapping_conflict_checked_at: new Date().toISOString(),
    };
  });
}

export async function signIn(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, fullName) {
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data;
}

export async function resetPassword(email) {
  const { error } = await requireClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

export async function loadCompanies() {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;

  let query = client
    .from("companies")
    .select("id,name_th,name_en,currency,type,industry,group_id,ticker_symbol,fiscal_year_end,company_mode,legal_entity_type,accounting_standard_profile")
    .order("id");
  let { data, error } = await query;

  // Backward compatible fallback for databases that have not run the v1.5 private-company migration yet.
  if (error && /company_mode|legal_entity_type|accounting_standard_profile|schema cache|Could not find/i.test(error.message || '')) {
    const fallback = await client
      .from("companies")
      .select("id,name_th,name_en,currency,type,industry,group_id,ticker_symbol,fiscal_year_end")
      .order("id");
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;

  const { data: memberships, error: membershipError } = await client
    .from("company_members")
    .select("company_id,role")
    .eq("user_id", userData.user.id);
  if (membershipError) throw membershipError;
  const roles = new Map((memberships || []).map((membership) => [membership.company_id, membership.role]));
  return (data || []).map((company) => ({
    id: company.id,
    nameTh: company.name_th,
    nameEn: company.name_en,
    currency: company.currency,
    type: company.type,
    industry: company.industry,
    groupId: company.group_id,
    tickerSymbol: company.ticker_symbol,
    fiscalYearEnd: company.fiscal_year_end,
    companyMode: company.company_mode || (company.ticker_symbol ? 'public' : 'private'),
    legalEntityType: company.legal_entity_type || (company.company_mode === 'public' || company.ticker_symbol ? 'public_limited' : 'limited_company'),
    accountingStandardProfile: company.accounting_standard_profile || inferAccountingStandardProfile(company),
    role: roles.get(company.id) || "viewer",
  }));
}

export async function createCompany(company) {
  const client = requireClient();
  const payload = {
    name_th: company.nameTh,
    name_en: company.nameEn,
    currency: company.currency,
    type: company.type,
    industry: company.industry,
    group_id: company.groupId || null,
    ticker_symbol: company.tickerSymbol || null,
    fiscal_year_end: company.fiscalYearEnd || '12-31',
    company_mode: company.companyMode || (company.tickerSymbol ? 'public' : 'private'),
    legal_entity_type: company.legalEntityType || (company.companyMode === 'public' || company.tickerSymbol ? 'public_limited' : 'limited_company'),
    accounting_standard_profile: company.accountingStandardProfile || inferAccountingStandardProfile(company)
  };
  let { data, error } = await client.from("companies").insert(payload).select("id").single();
  if (error && /company_mode|legal_entity_type|accounting_standard_profile|schema cache|Could not find/i.test(error.message || '')) {
    const { company_mode, legal_entity_type, accounting_standard_profile, ...fallbackPayload } = payload;
    const fallback = await client.from("companies").insert(fallbackPayload).select("id").single();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return data;
}

export async function updateCompany(id, company) {
  const client = requireClient();
  const payload = {
    name_th: company.nameTh,
    name_en: company.nameEn,
    currency: company.currency,
    type: company.type,
    industry: company.industry,
    group_id: company.groupId || null,
    ticker_symbol: company.tickerSymbol || null,
    fiscal_year_end: company.fiscalYearEnd || '12-31',
    company_mode: company.companyMode || (company.tickerSymbol ? 'public' : 'private'),
    legal_entity_type: company.legalEntityType || (company.companyMode === 'public' || company.tickerSymbol ? 'public_limited' : 'limited_company'),
    accounting_standard_profile: company.accountingStandardProfile || inferAccountingStandardProfile(company)
  };
  let { error } = await client.from("companies").update(payload).eq("id", id);
  if (error && /company_mode|legal_entity_type|accounting_standard_profile|schema cache|Could not find/i.test(error.message || '')) {
    const { company_mode, legal_entity_type, accounting_standard_profile, ...fallbackPayload } = payload;
    const fallback = await client.from("companies").update(fallbackPayload).eq("id", id);
    error = fallback.error;
  }
  if (error) throw error;
}

async function loadBatchMetaForRows(client, rows = []) {
  const batchIds = [...new Set(rows.map((row) => row.import_batch_id).filter(Boolean))];
  if (!batchIds.length) return new Map();
  const meta = new Map();
  for (let i = 0; i < batchIds.length; i += 100) {
    const ids = batchIds.slice(i, i + 100);
    const { data, error } = await client
      .from('import_batches')
      .select('id,status,imported_at')
      .in('id', ids);
    if (error) return meta;
    (data || []).forEach((batch) => meta.set(batch.id, batch));
  }
  return meta;
}

function batchSortTime(record, batchMeta) {
  const batch = batchMeta.get(record.import_batch_id);
  const stamp = batch?.imported_at || record.updated_at || record.created_at || '';
  const value = Date.parse(stamp);
  return Number.isFinite(value) ? value : 0;
}

function latestConfirmedRowsByReportingKey(rows = [], batchMeta = new Map()) {
  const latestByKey = new Map();
  for (const row of rows) {
    const batch = batchMeta.get(row.import_batch_id);
    if (batch && ['superseded', 'rolled_back', 'rejected'].includes(batch.status)) continue;
    const key = [row.company_id, row.fiscal_year, row.period || 'FY', row.statement_scope || 'consolidated'].join('|');
    const time = batchSortTime(row, batchMeta);
    const current = latestByKey.get(key);
    if (!current || time > current.time) latestByKey.set(key, { batchId: row.import_batch_id || null, time });
  }
  return rows.filter((row) => {
    const batch = batchMeta.get(row.import_batch_id);
    if (batch && ['superseded', 'rolled_back', 'rejected'].includes(batch.status)) return false;
    const key = [row.company_id, row.fiscal_year, row.period || 'FY', row.statement_scope || 'consolidated'].join('|');
    const latest = latestByKey.get(key);
    if (!latest) return false;
    if (!latest.batchId) return batchSortTime(row, batchMeta) === latest.time;
    return row.import_batch_id === latest.batchId;
  });
}


function latestMonthlyRowsByReportingKey(rows = [], batchMeta = new Map()) {
  const latestByKey = new Map();
  for (const row of rows) {
    const batch = batchMeta.get(row.import_batch_id);
    if (batch && ['superseded', 'rolled_back', 'rejected'].includes(batch.status)) continue;
    const key = [row.company_id, row.fiscal_year, row.month].join('|');
    const time = batchSortTime(row, batchMeta);
    const current = latestByKey.get(key);
    if (!current || time > current.time) latestByKey.set(key, { batchId: row.import_batch_id || null, time });
  }
  return rows.filter((row) => {
    const batch = batchMeta.get(row.import_batch_id);
    if (batch && ['superseded', 'rolled_back', 'rejected'].includes(batch.status)) return false;
    const key = [row.company_id, row.fiscal_year, row.month].join('|');
    const latest = latestByKey.get(key);
    if (!latest) return false;
    if (!latest.batchId) return batchSortTime(row, batchMeta) === latest.time;
    return row.import_batch_id === latest.batchId;
  });
}

function buildNormalizedStore(rows = [], batchMeta = new Map()) {
  const store = {};
  (rows || []).forEach((record) => {
    store[record.company_id] ||= {};
    store[record.company_id][record.fiscal_year] ||= {};

    const periodKey = record.period || 'FY';
    const batch = batchMeta.get(record.import_batch_id) || null;
    store[record.company_id][record.fiscal_year][periodKey] ||= {
      _updatedAt: record.updated_at || batch?.imported_at || null,
      _sourceFile: record.source_file || batch?.file_name || null,
      _sourceType: batch?.source_type || record.source_type || 'normalized_financial_data',
      _batchStatus: batch?.status || record.import_status || 'confirmed',
      status: record.import_status || batch?.status || 'confirmed',
      import_batch_id: record.import_batch_id,
      review_count: 0,
      row_count: 0,
      groups: {}
    };

    const pd = store[record.company_id][record.fiscal_year][periodKey];
    const groupKey = record.account_group || 'other';
    pd.groups[groupKey] = (pd.groups[groupKey] || 0) + Number(record.amount || 0);
    pd.row_count = (pd.row_count || 0) + 1;
    if (record.needs_review) pd.review_count = (pd.review_count || 0) + 1;
  });
  return store;
}

function buildMonthlyStore(rows = [], batchMeta = new Map()) {
  const store = {};
  (rows || []).forEach((record) => {
    store[record.company_id] ||= {};
    store[record.company_id][record.fiscal_year] ||= {};
    const idx = Number(record.month) - 1;
    const batch = batchMeta.get(record.import_batch_id) || null;
    store[record.company_id][record.fiscal_year][idx] = {
      monthIdx: idx,
      revenue: Number(record.revenue) || 0,
      expense: Number(record.expense) || 0,
      cashIn: Number(record.cash_in) || 0,
      cashOut: Number(record.cash_out) || 0,
      loanBalance: Number(record.loan_balance) || 0,
      import_batch_id: record.import_batch_id,
      _sourceType: batch?.source_type || 'private_monthly_report',
      _sourceFile: batch?.file_name || null,
      _batchStatus: batch?.status || record.import_status || 'confirmed',
      _updatedAt: record.updated_at || batch?.imported_at || null,
    };
  });
  return store;
}


const SNAPSHOT_STATUS_BLOCKLIST = new Set(['superseded', 'rolled_back', 'rejected']);

function snapshotBatchSortTime(row = {}) {
  const batch = row.import_batches || row.batch || null;
  return new Date(batch?.imported_at || row.created_at || 0).getTime() || 0;
}

function selectCurrentSnapshotRows(rows = [], { exactBatch = null } = {}) {
  const usableRows = (rows || []).filter((row) => {
    const batch = row.import_batches || null;
    if (exactBatch && String(row.import_batch_id || '') !== String(exactBatch)) return false;
    if (batch?.status && SNAPSHOT_STATUS_BLOCKLIST.has(batch.status)) return false;
    if (Object.prototype.hasOwnProperty.call(row, 'is_current') && row.is_current === false) return false;
    if (row.snapshot_status && row.snapshot_status !== 'current') return false;
    return true;
  });
  if (exactBatch) return usableRows;

  const latestKey = new Map();
  for (const row of usableRows) {
    const key = [row.company_id, row.fiscal_year, row.period || 'FY', row.period_type || 'annual', row.statement_scope || 'unknown'].join('|');
    const current = latestKey.get(key);
    const time = snapshotBatchSortTime(row);
    if (!current || time > current.time) latestKey.set(key, { batchId: row.import_batch_id || null, time });
  }
  return usableRows.filter((row) => {
    const key = [row.company_id, row.fiscal_year, row.period || 'FY', row.period_type || 'annual', row.statement_scope || 'unknown'].join('|');
    const latest = latestKey.get(key);
    if (!latest) return false;
    if (!latest.batchId) return snapshotBatchSortTime(row) === latest.time;
    return String(row.import_batch_id || '') === String(latest.batchId || '');
  });
}

function buildSnapshotMetricsStore(rows = []) {
  const store = {};
  (rows || []).forEach((record) => {
    if (!record?.company_id || !record?.fiscal_year || !record?.metric_key) return;
    store[record.company_id] ||= {};
    store[record.company_id][record.fiscal_year] ||= {};
    const periodKey = record.period || 'FY';
    const batch = record.import_batches || null;
    store[record.company_id][record.fiscal_year][periodKey] ||= {
      _updatedAt: record.created_at || batch?.imported_at || null,
      _sourceFile: batch?.file_name || null,
      _sourceType: 'financial_metrics_snapshots',
      _batchStatus: batch?.status || record.source_batch_status || 'confirmed',
      _sourceOfTruth: 'financial_metrics_snapshots',
      _snapshotRunId: record.snapshot_run_id || null,
      _readinessStatus: record.readiness_status || record.validation_status || 'not_validated',
      _readinessScore: record.readiness_score ?? null,
      _statementScope: record.statement_scope || 'unknown',
      status: batch?.status || 'confirmed',
      import_batch_id: record.import_batch_id,
      review_count: 0,
      row_count: 0,
      groups: {},
      metric_lineage: {},
    };
    const period = store[record.company_id][record.fiscal_year][periodKey];
    period.groups[record.metric_key] = Number(record.metric_value || 0);
    period.metric_lineage[record.metric_key] = {
      snapshot_id: record.id,
      snapshot_run_id: record.snapshot_run_id || null,
      import_batch_id: record.import_batch_id || null,
      source_type: record.source_type || 'unknown',
      source_rows: record.source_rows || [],
      validation_status: record.validation_status || null,
      readiness_status: record.readiness_status || null,
      readiness_score: record.readiness_score ?? null,
      created_at: record.created_at || null,
    };
    period.row_count = (period.row_count || 0) + 1;
  });
  return store;
}

async function queryMetricSnapshotRows(client, { companyId = null, batchId = null, limit = 20000 } = {}) {
  let query = client
    .from('financial_metrics_snapshots')
    .select('*,import_batches(id,company_id,file_name,fiscal_year,period,period_type,statement_scope,source_type,status,imported_at,readiness_status,readiness_score,dashboard_ready,export_ready,external_use_ready)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  if (batchId) query = query.eq('import_batch_id', batchId);
  const { data, error } = await query;
  if (error) {
    if (/financial_metrics_snapshots|schema cache|Could not find|does not exist/i.test(error.message || '')) return [];
    throw normalizeSupabaseError(error);
  }
  return data || [];
}

export async function loadAllMetricSnapshotData(companyId = null) {
  const client = requireClient();
  const rows = await queryMetricSnapshotRows(client, { companyId });
  const currentRows = selectCurrentSnapshotRows(rows);
  return buildSnapshotMetricsStore(currentRows);
}

export async function loadMetricSnapshotDataForBatch(batchId) {
  const client = requireClient();
  const rows = await queryMetricSnapshotRows(client, { batchId });
  const currentRows = selectCurrentSnapshotRows(rows, { exactBatch: batchId });
  return buildSnapshotMetricsStore(currentRows);
}

export async function loadAllNormalizedData() {
  const client = requireClient();
  const { data, error } = await client
    .from("normalized_financial_data")
    .select("*")
    .eq("import_status", "confirmed")
    .order("fiscal_year")
    .order("period");
  if (error) throw error;

  // Guardrail: older app versions left multiple confirmed batches for the same
  // company/year/period/scope. The dashboard should use the latest active batch only,
  // otherwise graphs can look unchanged or double-count historical imports.
  const batchMeta = await loadBatchMetaForRows(client, data || []);
  const activeRows = latestConfirmedRowsByReportingKey(data || [], batchMeta);
  return buildNormalizedStore(activeRows, batchMeta);
}


export async function loadAllMonthlyOperatingData() {
  const client = requireClient();
  const { data, error } = await client
    .from("monthly_operating_data")
    .select("*")
    .eq("import_status", "confirmed")
    .order("fiscal_year")
    .order("month");
  if (error) {
    if (/monthly_operating_data|schema cache|Could not find|does not exist/i.test(error.message || '')) return {};
    throw error;
  }
  // Guardrail: keep monthly dashboard values locked to the latest active batch per company/year/month.
  // Older private-company uploads may still have stale confirmed rows until cleanup migrations are run.
  const batchMeta = await loadBatchMetaForRows(client, data || []);
  const activeRows = latestMonthlyRowsByReportingKey(data || [], batchMeta);
  return buildMonthlyStore(activeRows, batchMeta);
}

function mergeStores(...stores) {
  const merged = {};
  for (const store of stores) {
    for (const [companyId, years] of Object.entries(store || {})) {
      merged[companyId] ||= {};
      for (const [year, periods] of Object.entries(years || {})) {
        merged[companyId][year] = { ...(merged[companyId][year] || {}), ...(periods || {}) };
      }
    }
  }
  return merged;
}

export async function loadAllFinancialData() {
  // v1.9.4: Dashboard/Export should use financial_metrics_snapshots as the
  // primary source of truth. Raw normalized/monthly rows remain fallback and
  // drill-down/audit sources only.
  const snapshotStore = await loadAllMetricSnapshotData().catch((error) => {
    console.warn('Snapshot source-of-truth unavailable; falling back to raw stores.', error?.message || error);
    return {};
  });
  if (Object.keys(snapshotStore || {}).length) {
    const monthlyStore = await loadAllMonthlyOperatingData().catch(() => ({}));
    return mergeStores(snapshotStore, monthlyStore);
  }
  const [normalizedStore, monthlyStore] = await Promise.all([
    loadAllNormalizedData(),
    loadAllMonthlyOperatingData(),
  ]);
  return mergeStores(normalizedStore, monthlyStore);
}

export async function loadFinancialDataSnapshot(batchId) {
  const client = requireClient();
  if (!batchId || batchId === 'latest') {
    return { mode: 'latest', batch: null, store: await loadAllFinancialData(), rowCounts: { normalized: 0, monthly: 0, trialBalance: 0 } };
  }

  const { data: batch, error: batchError } = await client
    .from('import_batches')
    .select('id,company_id,file_name,fiscal_year,period_type,period,statement_scope,source_type,parser_profile,legal_entity_type,status,total_rows,review_count,readiness_status,readiness_score,dashboard_ready,export_ready,external_use_ready,last_validated_at,file_hash,file_size,storage_path,imported_at,companies(name_th,name_en,ticker_symbol,industry,currency)')
    .eq('id', batchId)
    .single();
  if (batchError) throw normalizeSupabaseError(batchError);

  const [snapshotRows, normalized, monthly, trial] = await Promise.all([
    queryMetricSnapshotRows(client, { batchId }).catch(() => []),
    client.from('normalized_financial_data').select('*').eq('import_batch_id', batchId).limit(10000),
    client.from('monthly_operating_data').select('*').eq('import_batch_id', batchId).limit(10000),
    client.from('trial_balance_data').select('*').eq('import_batch_id', batchId).limit(10000),
  ]);
  const safe = (res, tableName) => {
    if (!res.error) return res.data || [];
    if (/schema cache|Could not find|does not exist/i.test(res.error.message || '')) return [];
    throw normalizeSupabaseError(res.error);
  };

  const normalizedRows = safe(normalized, 'normalized_financial_data');
  const monthlyRows = safe(monthly, 'monthly_operating_data');
  const trialRows = safe(trial, 'trial_balance_data');
  const currentSnapshotRows = selectCurrentSnapshotRows(snapshotRows, { exactBatch: batchId });
  const batchMeta = new Map([[batch.id, batch]]);
  const snapshotStore = buildSnapshotMetricsStore(currentSnapshotRows);
  const fallbackStore = buildNormalizedStore(normalizedRows, batchMeta);

  return {
    mode: currentSnapshotRows.length
      ? (batch.status === 'confirmed' ? 'metric_snapshot_source_of_truth' : 'archived_metric_snapshot')
      : (batch.status === 'confirmed' ? 'confirmed_raw_fallback' : 'archived_raw_fallback'),
    batch,
    store: mergeStores(Object.keys(snapshotStore).length ? snapshotStore : fallbackStore, buildMonthlyStore(monthlyRows, batchMeta)),
    rowCounts: { normalized: normalizedRows.length, monthly: monthlyRows.length, trialBalance: trialRows.length, metricSnapshots: currentSnapshotRows.length },
    metricSnapshots: currentSnapshotRows,
  };
}

function normalizeSupabaseError(error) {
  if (!error) return error;
  const message = error.message || String(error);
  if (/schema cache|normalized_financial_data|import_batches|account_mappings|does not exist|Could not find/i.test(message)) {
    error.message = `${message} — Supabase schema may be missing normalized/import tables. Run supabase/migrations/202606210001_normalized_schema.sql in SQL Editor, then redeploy/refresh.`;
  }
  if (/row-level security|permission denied|not authorized/i.test(message)) {
    error.message = `${message} — check that your user is owner/admin/editor for this company and RLS policies/grants are installed.`;
  }
  return error;
}

async function insertInChunks(client, table, rows, chunkSize = 500) {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    let { error } = await client.from(table).insert(chunk);
    if (error && table === 'normalized_financial_data' && isMissingOptionalColumnError(error, OPTIONAL_MAPPING_COLUMNS)) {
      const fallbackChunk = chunk.map((row) => stripColumns(row, OPTIONAL_MAPPING_COLUMNS));
      const fallback = await client.from(table).insert(fallbackChunk);
      error = fallback.error;
    }
    if (error) throw normalizeSupabaseError(error);
    inserted += chunk.length;
  }
  return inserted;
}

async function updateIfSupported(queryFactory, fallbackDeleteFactory = null) {
  const { error } = await queryFactory();
  if (!error) return true;
  if (/import_status|status|check constraint|violates check|schema cache|Could not find/i.test(error.message || '') && fallbackDeleteFactory) {
    const fallback = await fallbackDeleteFactory();
    if (fallback.error) throw normalizeSupabaseError(fallback.error);
    return false;
  }
  throw normalizeSupabaseError(error);
}

async function cleanupFailedImportBatch(client, batchId) {
  if (!batchId) return;
  const tables = ['normalized_financial_data', 'monthly_operating_data', 'trial_balance_data'];
  for (const table of tables) {
    try { await client.from(table).delete().eq('import_batch_id', batchId); } catch (_) {}
  }
  try {
    await client.from('import_batches').update({ status: 'rejected' }).eq('id', batchId);
  } catch (_) {}
}

function runImportPostSaveTasks(task) {
  try {
    setTimeout(() => {
      Promise.resolve()
        .then(task)
        .catch((error) => console.warn('Post-save import background task failed', error?.message || error));
    }, 0);
  } catch (error) {
    console.warn('Post-save import task queue failed', error?.message || error);
  }
}


async function getCurrentActor(client) {
  try {
    const { data } = await client.auth.getUser();
    const user = data?.user || null;
    if (!user) return { actor_user_id: null, actor_email: null, actor_name: null };
    return {
      actor_user_id: user.id,
      actor_email: user.email || null,
      actor_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || null,
    };
  } catch (_) {
    return { actor_user_id: null, actor_email: null, actor_name: null };
  }
}

export async function createAlertEvent(event = {}) {
  const client = requireClient();
  const actor = await getCurrentActor(client);
  const payload = {
    event_type: event.eventType || event.event_type || 'system_event',
    severity: event.severity || 'info',
    status: event.status || 'pending',
    company_id: event.companyId ?? event.company_id ?? null,
    import_batch_id: event.importBatchId ?? event.import_batch_id ?? null,
    actor_user_id: event.actorUserId ?? event.actor_user_id ?? actor.actor_user_id,
    actor_email: event.actorEmail ?? event.actor_email ?? actor.actor_email,
    actor_name: event.actorName ?? event.actor_name ?? actor.actor_name,
    title: event.title || 'FinAnalytics Alert',
    message: event.message || null,
    metadata: event.metadata || {},
    delivery_channel: event.deliveryChannel || event.delivery_channel || 'line',
    recipient_type: event.recipientType || event.recipient_type || null,
    recipient_id: event.recipientId || event.recipient_id || null,
  };
  const { data, error } = await client.from('alert_events').insert(payload).select('id').single();
  if (error) {
    // Alerts should never block the core workflow while the alert migration is being installed.
    if (/alert_events|schema cache|Could not find|does not exist/i.test(error.message || '')) return null;
    throw normalizeSupabaseError(error);
  }
  return data;
}

async function createAlertEventSafe(client, event = {}) {
  try {
    const actor = await getCurrentActor(client);
    const { error } = await client.from('alert_events').insert({
      event_type: event.eventType || event.event_type || 'system_event',
      severity: event.severity || 'info',
      status: event.status || 'pending',
      company_id: event.companyId ?? event.company_id ?? null,
      import_batch_id: event.importBatchId ?? event.import_batch_id ?? null,
      actor_user_id: event.actorUserId ?? event.actor_user_id ?? actor.actor_user_id,
      actor_email: event.actorEmail ?? event.actor_email ?? actor.actor_email,
      actor_name: event.actorName ?? event.actor_name ?? actor.actor_name,
      title: event.title || 'FinAnalytics Alert',
      message: event.message || null,
      metadata: event.metadata || {},
      delivery_channel: event.deliveryChannel || event.delivery_channel || 'line',
      recipient_type: event.recipientType || event.recipient_type || null,
      recipient_id: event.recipientId || event.recipient_id || null,
    });
    if (error && !/alert_events|schema cache|Could not find|does not exist/i.test(error.message || '')) {
      console.warn('Could not create alert event:', error.message);
    }
  } catch (error) {
    console.warn('Could not create alert event:', error?.message || error);
  }
}

export async function loadAlertEvents(companyId = null, limit = 200) {
  const client = requireClient();
  let query = client
    .from('alert_events')
    .select('*,companies(name_th,name_en,ticker_symbol)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) {
    if (/alert_events|schema cache|Could not find|does not exist/i.test(error.message || '')) return [];
    throw normalizeSupabaseError(error);
  }
  return data || [];
}

export async function updateAlertEventStatus(alertId, status = 'read') {
  const client = requireClient();
  const payload = { status, updated_at: new Date().toISOString() };
  if (status === 'read') payload.read_at = new Date().toISOString();
  if (status === 'sent') payload.sent_at = new Date().toISOString();
  const { error } = await client.from('alert_events').update(payload).eq('id', alertId);
  if (error) throw normalizeSupabaseError(error);
}

export async function loadLineAlertSettings(companyId) {
  const client = requireClient();
  const { data, error } = await client
    .from('line_alert_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) {
    if (/line_alert_settings|schema cache|Could not find|does not exist/i.test(error.message || '')) return null;
    throw normalizeSupabaseError(error);
  }
  return data || null;
}

export async function saveLineAlertSettings(companyId, settings = {}) {
  const client = requireClient();
  const actor = await getCurrentActor(client);
  const payload = {
    company_id: companyId,
    is_enabled: Boolean(settings.is_enabled),
    recipient_type: settings.recipient_type || 'group',
    recipient_id: settings.recipient_id || null,
    notify_import_success: settings.notify_import_success ?? true,
    notify_import_failed: settings.notify_import_failed ?? true,
    notify_mapping_review: settings.notify_mapping_review ?? true,
    notify_data_quality_warning: settings.notify_data_quality_warning ?? true,
    notify_rollback: settings.notify_rollback ?? true,
    notify_mapping_change: settings.notify_mapping_change ?? true,
    notify_permission_change: settings.notify_permission_change ?? true,
    notify_daily_summary: settings.notify_daily_summary ?? false,
    created_by: actor.actor_user_id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('line_alert_settings').upsert(payload, { onConflict: 'company_id' });
  if (error) throw normalizeSupabaseError(error);
}

async function uploadRawFileForBatch(client, companyId, batchId, batchDetails = {}) {
  const file = batchDetails.rawFile;
  if (!file || typeof client.storage?.from !== 'function') return null;
  const safeName = String(file.name || batchDetails.fileName || 'upload.bin').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const path = `${companyId}/${batchId}/${safeName}`;
  try {
    const { error: uploadError } = await client.storage
      .from('raw-financial-files')
      .upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
    if (uploadError) return null;
    await client.from('import_batches').update({
      storage_path: path,
      file_size: Number(file.size) || null,
      file_hash: batchDetails.fileHash || null,
    }).eq('id', batchId);
    return path;
  } catch (_) {
    return null;
  }
}

async function upsertAccountMappings(client, companyId, rows = []) {
  // Safety rule: never train from parser/AI suggestions during import.
  // Account mappings are persisted only after human approval, or when re-saving an already approved mapping.
  const seen = new Set();
  const mappings = rows
    .filter(row => row.raw_account_name && row.statement_type && row.account_group && row.needs_review === false && row.mapping_source === 'approved_mapping' && isSafeForBulkConfirm(row, evaluateMappingConflict(row)))
    .map(row => {
      const key = `${row.statement_type}|${row.raw_account_name}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        company_id: companyId,
        raw_account_name: row.raw_account_name,
        statement_type: row.statement_type,
        account_group: row.account_group,
        account_subgroup: row.account_subgroup || null,
        normalized_account_name: normalizeAccountKey(row.raw_account_name),
        statement_scope: row.statement_scope || 'any',
        accounting_standard_profile: row.accounting_standard_profile || null,
        line_role: row.line_role || null,
        risk_flags: Array.isArray(row.risk_flags) ? row.risk_flags : [],
        approval_scope: row.approval_scope || 'import_approved_reuse',
        industry_metric: row.industry_metric || null,
        is_approved: true,
        mapping_source: 'approved_mapping',
        standard_ref: row.standard_ref || null,
        standard_source: row.standard_source || null,
        standard_label_th: row.standard_label_th || null,
        standard_label_en: row.standard_label_en || null,
        last_used_at: new Date().toISOString(),
      };
    })
    .filter(Boolean)
    .slice(0, 2000);
  if (!mappings.length) return;
  try {
    let { error } = await client.from('account_mappings').upsert(mappings, { onConflict: 'company_id,raw_account_name,statement_type' });
    if (error && isMissingOptionalColumnError(error, OPTIONAL_APPROVAL_COLUMNS)) {
      const fallback = await client.from('account_mappings').upsert(
        mappings.map((row) => stripColumns(row, OPTIONAL_APPROVAL_COLUMNS)),
        { onConflict: 'company_id,raw_account_name,statement_type' }
      );
      error = fallback.error;
    }
  } catch (_) {
    // Mapping persistence is helpful but should not block imports.
  }
}


async function markPreviousImportBatchesSuperseded(client, companyId, fiscalYear, period, statementScope, excludeBatchId = null) {
  try {
    const { data, error } = await client
      .from('normalized_financial_data')
      .select('import_batch_id')
      .eq('company_id', companyId)
      .eq('fiscal_year', Number(fiscalYear))
      .eq('period', period || 'FY')
      .eq('statement_scope', statementScope || 'consolidated')
      .eq('import_status', 'confirmed');
    if (error) return;
    const batchIds = [...new Set((data || []).map((row) => row.import_batch_id).filter(Boolean))].filter((id) => !excludeBatchId || id !== excludeBatchId);
    if (!batchIds.length) return;
    await client
      .from('import_batches')
      .update({ status: 'superseded' })
      .in('id', batchIds)
      .eq('status', 'confirmed');
  } catch (_) {
    // Best-effort only. Normalized rows are still marked as superseded below.
  }
}

async function markPreviousDataTableImportBatchesSuperseded(client, tableName, applyFilters, excludeBatchId = null) {
  try {
    const baseQuery = client
      .from(tableName)
      .select('import_batch_id')
      .eq('import_status', 'confirmed');
    const { data, error } = await applyFilters(baseQuery);
    if (error) return;
    const batchIds = [...new Set((data || []).map((row) => row.import_batch_id).filter(Boolean))].filter((id) => !excludeBatchId || id !== excludeBatchId);
    if (!batchIds.length) return;
    await client
      .from('import_batches')
      .update({ status: 'superseded' })
      .in('id', batchIds)
      .eq('status', 'confirmed');
  } catch (_) {
    // Best-effort only. Data rows are still marked as superseded or deleted below.
  }
}


async function setRowsImportStatus(client, tableName, batchId, status) {
  if (!batchId) return false;
  return updateIfSupported(
    () => client.from(tableName).update({ import_status: status }).eq('import_batch_id', batchId),
    null
  );
}

async function markCurrentBatchConfirmed(client, batchId, extra = {}) {
  if (!batchId) return;
  const { error } = await client.from('import_batches').update({
    status: 'confirmed',
    ...extra,
  }).eq('id', batchId);
  if (error) throw normalizeSupabaseError(error);
}

async function markOldRowsSuperseded(client, tableName, applyFilters, excludeBatchId = null) {
  const updateFactory = () => {
    let query = client.from(tableName)
      .update({ import_status: 'superseded' })
      .eq('import_status', 'confirmed');
    query = applyFilters(query);
    if (excludeBatchId) query = query.neq('import_batch_id', excludeBatchId);
    return query;
  };
  const deleteFactory = () => {
    let query = client.from(tableName).delete();
    query = applyFilters(query);
    if (excludeBatchId) query = query.neq('import_batch_id', excludeBatchId);
    return query;
  };
  return updateIfSupported(updateFactory, deleteFactory);
}


function isMissingImportCommitRpcError(error) {
  const message = error?.message || error?.details || error?.hint || String(error || '');
  return /commit_import_batch|schema cache|Could not find the function|function .* does not exist|does not exist/i.test(message);
}

async function tryCommitImportBatchViaRpc(client, companyId, batchPayload, { normalizedRows = [], monthlyRows = [], trialBalanceRows = [] } = {}) {
  const { data, error } = await client.rpc('commit_import_batch', {
    p_company_id: companyId,
    p_batch: batchPayload,
    p_normalized_rows: normalizedRows,
    p_monthly_rows: monthlyRows,
    p_trial_balance_rows: trialBalanceRows,
  });
  if (error) {
    if (isMissingImportCommitRpcError(error)) {
      throw new Error(importRpcRequiredMessage());
    }
    throw normalizeSupabaseError(error);
  }
  const result = {
    batchId: data?.import_batch_id || data?.batch_id || data?.id || null,
    rowsImported: Number(data?.rows_imported ?? (normalizedRows.length + monthlyRows.length + trialBalanceRows.length)),
    jobId: data?.job_id || null,
    jobKey: data?.job_key || null,
    usedRpc: true,
  };
  if (!result.batchId) {
    throw new Error('Import transaction RPC returned no import_batch_id. Open System Doctor and verify the database schema before importing again.');
  }
  return result;
}

function buildNormalizedImportPayload(companyId, batchDetails = {}, rows = [], importBatchId = null, defaultStatementScope = 'consolidated') {
  return rows.map(row => ({
    company_id: companyId,
    fiscal_year: row.fiscal_year,
    period_type: row.period_type || 'annual',
    period: row.period || 'FY',
    statement_scope: row.statement_scope || defaultStatementScope,
    statement_type: row.statement_type,
    account_name: row.account_name,
    account_group: row.account_group,
    account_subgroup: row.account_subgroup,
    industry_metric: row.industry_metric,
    note: row.note,
    original_amount: row.original_amount,
    original_unit: row.original_unit,
    amount: row.amount,
    normalized_unit: row.normalized_unit || 'baht',
    raw_account_name: row.raw_account_name,
    raw_amount: row.raw_amount,
    raw_unit: row.raw_unit,
    source_file: row.source_file || batchDetails.fileName,
    source_sheet: row.source_sheet,
    source_row: row.source_row,
    source_column: row.source_column,
    source_cell: row.source_cell,
    import_batch_id: importBatchId,
    mapping_confidence: row.mapping_confidence,
    mapping_source: row.mapping_source || (row.needs_review ? 'unknown' : 'parser_rule'),
    suggested_account_group: row.suggested_account_group || row.account_group,
    suggested_account_subgroup: row.suggested_account_subgroup || row.account_subgroup || null,
    review_reason: row.review_reason || null,
    needs_review: row.needs_review,
    accounting_standard_profile: row.accounting_standard_profile || batchDetails.accountingStandardProfile || inferAccountingStandardProfile({}, batchDetails),
    standard_source: row.standard_source || null,
    standard_ref: row.standard_ref || null,
    standard_label_th: row.standard_label_th || null,
    standard_label_en: row.standard_label_en || null,
    standard_chapter: row.standard_chapter || null,
    standard_reason: row.standard_reason || null,
    consolidation_indicator: row.consolidation_indicator || null,
    business_combination_indicator: row.business_combination_indicator || null,
    line_role: row.line_role || null,
    metric_role: row.metric_role || null,
    section_path: row.section_path || row.section || null,
    parent_heading: row.parent_heading || row.section || null,
    risk_flags: Array.isArray(row.risk_flags) ? row.risk_flags : [],
    mapping_status: row.mapping_status || (row.needs_review ? 'suggested' : 'approved'),
    approval_scope: row.approval_scope || null,
    approved_mapping_id: row.approved_mapping_id || null,
    is_dashboard_eligible: row.is_dashboard_eligible ?? null,
    is_export_eligible: row.is_export_eligible ?? null,
    conflict_status: row.conflict_status || null,
    conflict_reasons: Array.isArray(row.conflict_reasons) ? row.conflict_reasons : [],
    conflict_score: row.conflict_score ?? null,
    approval_policy: row.approval_policy || null,
    manual_approval_reason: row.manual_approval_reason || null,
    mapping_conflict_checked_at: row.mapping_conflict_checked_at || new Date().toISOString(),
    import_status: 'pending'
  }));
}

function buildMonthlyImportPayload(companyId, batchDetails = {}, monthlyRows = [], importBatchId = null) {
  return monthlyRows.map(row => ({
    company_id: companyId,
    fiscal_year: row.fiscal_year,
    month: row.month,
    revenue: row.revenue || 0,
    expense: row.expense || 0,
    cash_in: row.cash_in || 0,
    cash_out: row.cash_out || 0,
    loan_balance: row.loan_balance || 0,
    source_file: row.source_file || batchDetails.fileName,
    source_sheet: row.source_sheet,
    source_row: row.source_row,
    import_batch_id: importBatchId,
    import_status: 'pending'
  }));
}

function buildTrialBalanceImportPayload(companyId, batchDetails = {}, trialBalanceRows = [], importBatchId = null) {
  return trialBalanceRows.map(row => ({
    company_id: companyId,
    fiscal_year: row.fiscal_year,
    period_type: row.period_type || 'annual',
    period: row.period || 'FY',
    account_code: row.account_code || null,
    account_name: row.account_name,
    debit: row.debit || 0,
    credit: row.credit || 0,
    ending_balance: row.ending_balance || 0,
    account_group: row.account_group || 'other',
    source_file: row.source_file || batchDetails.fileName,
    source_sheet: row.source_sheet,
    source_row: row.source_row,
    import_batch_id: importBatchId,
    import_status: 'pending'
  }));
}

export async function saveImportBatch(companyId, batchDetails, normalizedDataRows) {
  const client = requireClient();
  const incomingRows = Array.isArray(normalizedDataRows) ? normalizedDataRows : [];
  if (!incomingRows.length) return { batchId: null, rowsImported: 0 };
  const safeRows = applyApprovedAccountMappings(incomingRows, await loadApprovedAccountMappings(client, companyId));
  const semanticRows = safeRows.map((row) => enrichRowSemantics(row));

  const batchPayload = {
    company_id: companyId,
    file_name: batchDetails.fileName,
    fiscal_year: batchDetails.fiscalYear,
    period_type: batchDetails.periodType || 'annual',
    period: batchDetails.period || 'FY',
    statement_scope: batchDetails.statementScope || 'consolidated',
    source_type: batchDetails.sourceType || 'public_financial_statement',
    parser_profile: batchDetails.parserProfile || null,
    legal_entity_type: batchDetails.legalEntityType || null,
    accounting_standard_profile: batchDetails.accountingStandardProfile || inferAccountingStandardProfile({}, batchDetails),
    standard_validation_summary: batchDetails.standardValidationSummary || batchDetails.standardsQuality || null,
    data_quality_score: batchDetails.dataQualityScore ?? batchDetails.standardsQuality?.score ?? null,
    file_hash: batchDetails.fileHash || null,
    file_size: batchDetails.fileSize || null,
    review_count: batchDetails.reviewCount ?? null,
    total_rows: semanticRows.length,
    status: 'pending'
  };

  const rpcNormalizedPayload = buildNormalizedImportPayload(companyId, batchDetails, semanticRows, null, batchPayload.statement_scope);
  const rpcResult = await tryCommitImportBatchViaRpc(client, companyId, batchPayload, {
    normalizedRows: rpcNormalizedPayload,
    monthlyRows: [],
    trialBalanceRows: [],
  });
  if (rpcResult) {
    runImportPostSaveTasks(async () => {
      await uploadRawFileForBatch(client, companyId, rpcResult.batchId, batchDetails);
      await upsertAccountMappings(client, companyId, semanticRows);
      await createAlertEventSafe(client, {
        eventType: 'import_success',
        severity: batchDetails.reviewCount > 0 ? 'warning' : 'success',
        companyId,
        importBatchId: rpcResult.batchId,
        title: batchDetails.reviewCount > 0 ? 'Import saved with mapping review' : 'Import saved successfully',
        message: `${batchDetails.fileName || 'Financial statement'} saved with ${rpcResult.rowsImported} rows.`,
        metadata: {
          file_name: batchDetails.fileName,
          fiscal_year: batchDetails.fiscalYear,
          period_type: batchDetails.periodType || 'annual',
          period: batchDetails.period || 'FY',
          source_type: batchDetails.sourceType || 'public_financial_statement',
          parser_profile: batchDetails.parserProfile || null,
          review_count: batchDetails.reviewCount ?? 0,
          rows_imported: rpcResult.rowsImported,
          rpc_commit: true,
          job_id: rpcResult.jobId,
          job_key: rpcResult.jobKey,
        },
      });
      if (Number(batchDetails.reviewCount || 0) > 0) {
        await createAlertEventSafe(client, {
          eventType: 'mapping_review_required',
          severity: 'warning',
          companyId,
          importBatchId: rpcResult.batchId,
          title: 'Mapping review required',
          message: `${batchDetails.reviewCount} rows need accounting mapping review.`,
          metadata: { file_name: batchDetails.fileName, review_count: batchDetails.reviewCount, rows_imported: rpcResult.rowsImported, rpc_commit: true },
        });
      }
    });
    return { batchId: rpcResult.batchId, rowsImported: rpcResult.rowsImported, readinessPending: true, usedRpc: true, jobId: rpcResult.jobId };
  }

  throw new Error(importRpcRequiredMessage());

}


export async function savePrivateImportBatch(companyId, batchDetails, privatePayload = {}) {
  const client = requireClient();
  const monthlyRows = Array.isArray(privatePayload.monthlyRows) ? privatePayload.monthlyRows : [];
  const trialBalanceRows = Array.isArray(privatePayload.trialBalanceRows) ? privatePayload.trialBalanceRows : [];
  const incomingNormalizedRows = Array.isArray(privatePayload.normalizedRows) ? privatePayload.normalizedRows : [];
  const normalizedRows = applyApprovedAccountMappings(incomingNormalizedRows, await loadApprovedAccountMappings(client, companyId))
    .map((row) => enrichRowSemantics(row));
  const totalInputRows = monthlyRows.length + trialBalanceRows.length + normalizedRows.length;
  if (!totalInputRows) return { batchId: null, rowsImported: 0 };

  const batchPayload = {
    company_id: companyId,
    file_name: batchDetails.fileName,
    fiscal_year: batchDetails.fiscalYear,
    period_type: batchDetails.periodType || (monthlyRows.length ? 'monthly' : 'annual'),
    period: batchDetails.period || (monthlyRows.length ? 'MIXED' : 'FY'),
    statement_scope: batchDetails.statementScope || 'private_company',
    source_type: batchDetails.sourceType || 'private_company_file',
    parser_profile: batchDetails.parserProfile || 'PRIVATE_COMPANY_IMPORT_PACK_V1',
    legal_entity_type: batchDetails.legalEntityType || null,
    accounting_standard_profile: batchDetails.accountingStandardProfile || inferAccountingStandardProfile({}, batchDetails),
    standard_validation_summary: batchDetails.standardValidationSummary || batchDetails.standardsQuality || null,
    data_quality_score: batchDetails.dataQualityScore ?? batchDetails.standardsQuality?.score ?? null,
    file_hash: batchDetails.fileHash || null,
    file_size: batchDetails.fileSize || null,
    total_rows: totalInputRows,
    review_count: privatePayload.summary?.reviewCount ?? null,
    status: 'pending'
  };

  const rpcMonthlyPayload = buildMonthlyImportPayload(companyId, batchDetails, monthlyRows, null);
  const rpcTrialPayload = buildTrialBalanceImportPayload(companyId, batchDetails, trialBalanceRows, null);
  const rpcNormalizedPayload = buildNormalizedImportPayload(companyId, batchDetails, normalizedRows, null, batchPayload.statement_scope);
  const rpcResult = await tryCommitImportBatchViaRpc(client, companyId, batchPayload, {
    normalizedRows: rpcNormalizedPayload,
    monthlyRows: rpcMonthlyPayload,
    trialBalanceRows: rpcTrialPayload,
  });
  if (rpcResult) {
    runImportPostSaveTasks(async () => {
      await uploadRawFileForBatch(client, companyId, rpcResult.batchId, batchDetails);
      if (normalizedRows.length) await upsertAccountMappings(client, companyId, normalizedRows);
      await createAlertEventSafe(client, {
        eventType: 'import_success',
        severity: (privatePayload.summary?.reviewCount || 0) > 0 ? 'warning' : 'success',
        companyId,
        importBatchId: rpcResult.batchId,
        title: (privatePayload.summary?.reviewCount || 0) > 0 ? 'Private import saved with review' : 'Private import saved successfully',
        message: `${batchDetails.fileName || 'Private company file'} saved with ${rpcResult.rowsImported} rows.`,
        metadata: {
          file_name: batchDetails.fileName,
          fiscal_year: batchDetails.fiscalYear,
          period_type: batchDetails.periodType || (monthlyRows.length ? 'monthly' : 'annual'),
          source_type: batchDetails.sourceType || 'private_company_file',
          parser_profile: batchDetails.parserProfile || 'PRIVATE_COMPANY_IMPORT_PACK_V1',
          review_count: privatePayload.summary?.reviewCount ?? 0,
          rows_imported: rpcResult.rowsImported,
          monthly_rows: monthlyRows.length,
          trial_balance_rows: trialBalanceRows.length,
          normalized_rows: normalizedRows.length,
          rpc_commit: true,
          job_id: rpcResult.jobId,
          job_key: rpcResult.jobKey,
        },
      });
      if (Number(privatePayload.summary?.reviewCount || 0) > 0) {
        await createAlertEventSafe(client, {
          eventType: 'mapping_review_required',
          severity: 'warning',
          companyId,
          importBatchId: rpcResult.batchId,
          title: 'Private company mapping review required',
          message: `${privatePayload.summary.reviewCount} private-company rows need mapping review.`,
          metadata: { file_name: batchDetails.fileName, review_count: privatePayload.summary.reviewCount, rows_imported: rpcResult.rowsImported, rpc_commit: true },
        });
      }
    });
    return { batchId: rpcResult.batchId, rowsImported: rpcResult.rowsImported, readinessPending: true, usedRpc: true, jobId: rpcResult.jobId };
  }

  throw new Error(importRpcRequiredMessage());

}


export async function loadImportHistory(companyId = null, limit = 200) {
  const client = requireClient();
  let query = client
    .from('import_batches')
    .select('id,company_id,file_name,fiscal_year,period_type,period,statement_scope,source_type,parser_profile,legal_entity_type,status,total_rows,review_count,readiness_status,readiness_score,dashboard_ready,export_ready,external_use_ready,last_validated_at,file_hash,file_size,storage_path,imported_at,companies(name_th,name_en,ticker_symbol,industry,currency)')
    .order('imported_at', { ascending: false })
    .limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  let { data, error } = await query;
  if (error && /source_type|parser_profile|legal_entity_type|accounting_standard_profile|standard_validation_summary|data_quality_score|readiness_status|readiness_score|dashboard_ready|export_ready|external_use_ready|last_validated_at|file_hash|file_size|storage_path|total_rows|review_count|schema cache|Could not find/i.test(error.message || '')) {
    let fallback = client
      .from('import_batches')
      .select('id,company_id,file_name,fiscal_year,period_type,period,statement_scope,status,imported_at,companies(name_th,name_en,ticker_symbol,industry,currency)')
      .order('imported_at', { ascending: false })
      .limit(limit);
    if (companyId) fallback = fallback.eq('company_id', companyId);
    const res = await fallback;
    data = res.data;
    error = res.error;
  }
  if (error) throw normalizeSupabaseError(error);
  return data || [];
}

export async function loadImportBatchRows(batchId, limit = 500) {
  const client = requireClient();
  const [normalized, monthly, trial] = await Promise.all([
    client.from('normalized_financial_data').select('*').eq('import_batch_id', batchId).limit(limit),
    client.from('monthly_operating_data').select('*').eq('import_batch_id', batchId).limit(limit),
    client.from('trial_balance_data').select('*').eq('import_batch_id', batchId).limit(limit),
  ]);
  const safe = (res) => res.error ? [] : (res.data || []);
  return {
    normalized: safe(normalized),
    monthly: safe(monthly),
    trialBalance: safe(trial),
  };
}


export function classifyImportJob(job = {}, { staleMinutes = 30 } = {}) {
  const status = job.status || 'unknown';
  const active = ['pending', 'processing'].includes(status);
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : null;
  const ageMinutes = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 60000)) : null;
  const stale = Boolean(active && ageMinutes !== null && ageMinutes >= Number(staleMinutes || 30));
  const batchStatus = job.import_batches?.status || null;
  const hasPendingBatch = ['pending'].includes(batchStatus || '');
  return {
    ...job,
    active,
    stale,
    age_minutes: ageMinutes,
    batch_status: batchStatus,
    needs_recovery: stale || status === 'failed' || hasPendingBatch,
    recovery_hint: stale
      ? 'stuck_active_job'
      : hasPendingBatch
        ? 'pending_batch_attached'
        : status === 'failed'
          ? 'failed_import_job'
          : 'none',
  };
}

export async function loadImportJobs({ companyId = null, status = null, limit = 200, staleMinutes = 30 } = {}) {
  const client = requireClient();
  let query = client
    .from('import_jobs')
    .select('id,company_id,job_key,file_name,file_hash,fiscal_year,period_type,period,statement_scope,source_type,import_batch_id,status,error_message,metadata,started_by,started_at,finished_at,created_at,updated_at,recovery_action,recovery_note,recovered_at,recovered_by,retry_count,companies(name_th,name_en,ticker_symbol),import_batches(id,status,total_rows,review_count,readiness_status,readiness_score,dashboard_ready,export_ready,file_name,imported_at)')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  if (status && status !== 'all') query = query.eq('status', status);
  let { data, error } = await query;
  if (error && /recovery_action|recovery_note|recovered_at|recovered_by|retry_count|schema cache|Could not find|column/i.test(error.message || '')) {
    let fallback = client
      .from('import_jobs')
      .select('id,company_id,job_key,file_name,file_hash,fiscal_year,period_type,period,statement_scope,source_type,import_batch_id,status,error_message,metadata,started_by,started_at,finished_at,created_at,updated_at,companies(name_th,name_en,ticker_symbol),import_batches(id,status,total_rows,review_count,readiness_status,readiness_score,dashboard_ready,export_ready,file_name,imported_at)')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (companyId) fallback = fallback.eq('company_id', companyId);
    if (status && status !== 'all') fallback = fallback.eq('status', status);
    const res = await fallback;
    data = res.data;
    error = res.error;
  }
  if (error && /relation .*import_jobs.* does not exist|Could not find the table|schema cache/i.test(error.message || '')) {
    throw new Error('Import Jobs table not found. Run migration 202606230006_import_transaction_rpc.sql and 202606230007_import_job_recovery_center.sql first.');
  }
  if (error) throw normalizeSupabaseError(error);
  return (data || []).map((job) => classifyImportJob(job, { staleMinutes }));
}

function isMissingImportRecoveryRpcError(error) {
  const message = error?.message || error?.details || error?.hint || String(error || '');
  return /recover_import_job|recover_stuck_import_jobs|schema cache|Could not find the function|function .* does not exist|does not exist/i.test(message);
}

export async function recoverImportJob({ jobId, action = 'mark_failed', note = '' } = {}) {
  if (!jobId) throw new Error('Import job id is required.');
  const client = requireClient();
  const { data, error } = await client.rpc('recover_import_job', {
    p_job_id: jobId,
    p_action: action,
    p_note: note || null,
  });
  if (error) {
    if (isMissingImportRecoveryRpcError(error)) {
      throw new Error('Import recovery RPC is not installed. Run migration 202606230007_import_job_recovery_center.sql.');
    }
    throw normalizeSupabaseError(error);
  }
  return data || { ok: true, job_id: jobId, action };
}

export async function recoverStuckImportJobs({ companyId = null, olderThanMinutes = 30, note = '' } = {}) {
  const client = requireClient();
  const { data, error } = await client.rpc('recover_stuck_import_jobs', {
    p_company_id: companyId || null,
    p_older_than_minutes: Number(olderThanMinutes || 30),
    p_note: note || null,
  });
  if (error) {
    if (isMissingImportRecoveryRpcError(error)) {
      throw new Error('Import recovery RPC is not installed. Run migration 202606230007_import_job_recovery_center.sql.');
    }
    throw normalizeSupabaseError(error);
  }
  return data || { ok: true, recovered_count: 0, jobs: [] };
}


const READINESS_IMPORT_BATCH_COLUMNS = new Set([
  'readiness_status', 'readiness_score', 'dashboard_ready', 'export_ready', 'external_use_ready',
  'validation_summary', 'last_validated_at', 'export_warning_ack_required'
]);
const READINESS_SNAPSHOT_COLUMNS = new Set([
  'readiness_status', 'readiness_score', 'snapshot_run_id', 'snapshot_status', 'is_current',
  'superseded_at', 'superseded_by', 'source_metric_role', 'source_line_role',
  'source_batch_status', 'snapshot_metadata'
]);

function summarizeReadinessForBatch(bundle = {}) {
  if (!bundle.summaries?.length) {
    return {
      readiness_status: 'not_ready', readiness_score: 0, dashboard_ready: false, export_ready: false, external_use_ready: false,
      validation_summary: { message: 'No normalized rows available for readiness validation.' },
    };
  }
  const order = { not_ready: 0, mapping_review_required: 1, dashboard_ready: 2, export_ready: 3, external_use_ready: 4 };
  const weakest = [...bundle.summaries].sort((a, b) => (order[a.readiness_status] || 0) - (order[b.readiness_status] || 0))[0];
  const score = Math.round(bundle.summaries.reduce((sum, item) => sum + Number(item.readiness_score || 0), 0) / bundle.summaries.length);
  return {
    readiness_status: weakest.readiness_status || 'not_ready',
    readiness_score: score,
    dashboard_ready: bundle.summaries.every((item) => item.dashboard_ready),
    export_ready: bundle.summaries.every((item) => item.export_ready),
    external_use_ready: bundle.summaries.every((item) => item.external_use_ready),
    export_warning_ack_required: bundle.summaries.some((item) => item.warnings?.length || item.blocking_reasons?.length),
    validation_summary: {
      summaries: bundle.summaries.map((item) => ({
        fiscal_year: item.fiscal_year, period: item.period, period_type: item.period_type, statement_scope: item.statement_scope,
        readiness_status: item.readiness_status, readiness_score: item.readiness_score,
        dashboard_ready: item.dashboard_ready, export_ready: item.export_ready, external_use_ready: item.external_use_ready,
        missing_core_metrics: item.missing_core_metrics, review_rows: item.review_rows,
        risk_flags: item.risk_flags, blocking_reasons: item.blocking_reasons, warnings: item.warnings,
        validation_counts: item.validation_counts,
      })),
      validation_result_count: bundle.results?.length || 0,
      generated_by: 'accounting_engine_v1_9_1',
    },
  };
}

function makeSnapshotRunId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch (_) {}
  return `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function safeDeleteReadinessRows(client, batchId) {
  if (!batchId) return;
  try { await client.from('validation_results').delete().eq('import_batch_id', batchId); } catch (_) {}
  // v1.9.4: keep snapshot history when the migration is installed. Older
  // schemas fall back to delete/upsert so existing projects remain usable.
  try {
    const res = await client.from('financial_metrics_snapshots')
      .update({ is_current: false, snapshot_status: 'superseded', superseded_at: new Date().toISOString() })
      .eq('import_batch_id', batchId)
      .eq('is_current', true);
    if (res.error && isMissingOptionalColumnError(res.error, READINESS_SNAPSHOT_COLUMNS)) {
      await client.from('financial_metrics_snapshots').delete().eq('import_batch_id', batchId);
    }
  } catch (_) {
    try { await client.from('financial_metrics_snapshots').delete().eq('import_batch_id', batchId); } catch (_) {}
  }
}

export async function rebuildAccountingReadiness({ companyId = null, batchId = null, strictAnnual = true } = {}) {
  const client = requireClient();
  // Company/all rebuild must not create metric snapshots with import_batch_id = null.
  // Rebuild each confirmed batch independently so validation_results and
  // financial_metrics_snapshots remain batch-exact and auditable.
  if (!batchId) {
    let batchQuery = client.from('import_batches').select('id').eq('status', 'confirmed').order('imported_at', { ascending: false }).limit(100);
    if (companyId) batchQuery = batchQuery.eq('company_id', companyId);
    let { data: batches, error: batchError } = await batchQuery;
    if (batchError) {
      let rowQuery = client.from('normalized_financial_data').select('import_batch_id').eq('import_status', 'confirmed').limit(5000);
      if (companyId) rowQuery = rowQuery.eq('company_id', companyId);
      const rowRes = await rowQuery;
      batches = [...new Set((rowRes.data || []).map((r) => r.import_batch_id).filter(Boolean))].map((id) => ({ id }));
    }
    const batchIds = [...new Set((batches || []).map((b) => b.id).filter(Boolean))];
    const results = [];
    for (const id of batchIds) {
      try { results.push(await rebuildAccountingReadiness({ companyId, batchId: id, strictAnnual })); }
      catch (error) { results.push({ batchId: id, error: error?.message || String(error) }); }
    }
    return {
      companyId,
      batchCount: batchIds.length,
      batches: results,
      rowsAnalyzed: results.reduce((sum, item) => sum + Number(item.rowsAnalyzed || 0), 0),
      validationRows: results.reduce((sum, item) => sum + Number(item.validationRows || 0), 0),
      snapshotRows: results.reduce((sum, item) => sum + Number(item.snapshotRows || 0), 0),
    };
  }
  let query = client.from('normalized_financial_data').select('*').eq('import_status', 'confirmed');
  if (batchId) query = query.eq('import_batch_id', batchId);
  if (companyId) query = query.eq('company_id', companyId);
  const { data: rows, error } = await query.limit(5000);
  if (error) throw normalizeSupabaseError(error);
  const semanticRows = (rows || []).map(enrichRowSemantics);

  // Best-effort backfill semantic columns. This is intentionally row-by-row and non-blocking
  // because older projects may not have run the v1.9.0/1.9.1 migrations yet.
  for (const row of semanticRows.slice(0, 1000)) {
    try {
      const patch = {
        line_role: row.line_role,
        metric_role: row.metric_role,
        risk_flags: Array.isArray(row.risk_flags) ? row.risk_flags : [],
        mapping_status: row.mapping_status,
        is_dashboard_eligible: Boolean(row.is_dashboard_eligible),
        is_export_eligible: Boolean(row.is_export_eligible),
        account_group: row.account_group,
        account_subgroup: row.account_subgroup,
        suggested_account_group: row.suggested_account_group,
        suggested_account_subgroup: row.suggested_account_subgroup,
        review_reason: row.review_reason,
        needs_review: Boolean(row.needs_review),
      };
      const res = await client.from('normalized_financial_data').update(patch).eq('id', row.id);
      if (res.error && !isMissingOptionalColumnError(res.error, OPTIONAL_MAPPING_COLUMNS)) throw res.error;
    } catch (_) {}
  }

  const bundle = buildReadinessBundle(semanticRows, { strictAnnual });
  if (batchId) await safeDeleteReadinessRows(client, batchId);

  const validationPayload = (bundle.results || []).map((result) => ({
    company_id: result.company_id || companyId || null,
    import_batch_id: batchId || null,
    fiscal_year: result.fiscal_year || null,
    period: result.period || 'FY',
    period_type: result.period_type || 'annual',
    statement_scope: result.statement_scope || 'unknown',
    validation_type: result.validation_type || 'unknown',
    severity: result.severity || 'info',
    difference: result.difference ?? null,
    message: result.message || null,
    metadata: { engine: 'accounting_engine_v1_9_1' },
  }));
  if (validationPayload.length) {
    try { await client.from('validation_results').insert(validationPayload); } catch (_) {}
  }

  const snapshotPayload = [];
  const snapshotRunId = makeSnapshotRunId();
  for (const summary of bundle.summaries || []) {
    const key = [summary.company_id || '', summary.fiscal_year || '', summary.period || 'FY', summary.period_type || 'annual', summary.statement_scope || 'unknown'].join('|');
    const bucket = bundle.buckets?.[key];
    if (!bucket) continue;
    snapshotPayload.push(...flattenMetricSnapshotRows({ bucket, summary, importBatchId: batchId, snapshotRunId, current: true }));
  }
  if (snapshotPayload.length) {
    let { error: snapError } = await client.from('financial_metrics_snapshots').insert(snapshotPayload);
    if (snapError && isMissingOptionalColumnError(snapError, READINESS_SNAPSHOT_COLUMNS)) {
      const fallback = snapshotPayload.map((row) => stripColumns(row, READINESS_SNAPSHOT_COLUMNS));
      const res = await client.from('financial_metrics_snapshots').upsert(fallback, { onConflict: 'company_id,import_batch_id,fiscal_year,period,period_type,statement_scope,metric_key' });
      snapError = res.error;
    } else if (snapError && /duplicate key|unique constraint/i.test(snapError.message || '')) {
      const fallback = snapshotPayload.map((row) => stripColumns(row, new Set(['snapshot_run_id','snapshot_status','is_current','superseded_at','superseded_by','source_metric_role','source_line_role','source_batch_status','snapshot_metadata'])));
      const res = await client.from('financial_metrics_snapshots').upsert(fallback, { onConflict: 'company_id,import_batch_id,fiscal_year,period,period_type,statement_scope,metric_key' });
      snapError = res.error;
    }
    if (snapError) console.warn('Metric snapshot insert failed', snapError.message || snapError);
  }

  const summary = summarizeReadinessForBatch(bundle);
  if (batchId) {
    const batchPatch = { ...summary, last_validated_at: new Date().toISOString() };
    let { error: batchError } = await client.from('import_batches').update(batchPatch).eq('id', batchId);
    if (batchError && isMissingOptionalColumnError(batchError, READINESS_IMPORT_BATCH_COLUMNS)) {
      const res = await client.from('import_batches').update(stripColumns(batchPatch, READINESS_IMPORT_BATCH_COLUMNS)).eq('id', batchId);
      batchError = res.error;
    }
    if (batchError) console.warn('Import batch readiness update failed', batchError.message || batchError);
  }
  return { bundle, summary, rowsAnalyzed: semanticRows.length, validationRows: validationPayload.length, snapshotRows: snapshotPayload.length };
}

export async function loadAccountingReadiness(companyId = null, limit = 300) {
  const client = requireClient();
  let query = client
    .from('import_batches')
    .select('id,company_id,file_name,fiscal_year,period,period_type,statement_scope,status,total_rows,review_count,readiness_status,readiness_score,dashboard_ready,export_ready,external_use_ready,validation_summary,last_validated_at,imported_at,companies(name_th,name_en,ticker_symbol,industry,currency)')
    .order('imported_at', { ascending: false })
    .limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  let { data, error } = await query;
  if (error && isMissingOptionalColumnError(error, READINESS_IMPORT_BATCH_COLUMNS)) {
    let fallback = client
      .from('import_batches')
      .select('id,company_id,file_name,fiscal_year,period,period_type,statement_scope,status,total_rows,review_count,imported_at,companies(name_th,name_en,ticker_symbol,industry,currency)')
      .order('imported_at', { ascending: false })
      .limit(limit);
    if (companyId) fallback = fallback.eq('company_id', companyId);
    const res = await fallback;
    data = (res.data || []).map((row) => ({ ...row, readiness_status: 'not_validated', readiness_score: null, dashboard_ready: false, export_ready: false, external_use_ready: false }));
    error = res.error;
  }
  if (error) throw normalizeSupabaseError(error);
  return data || [];
}

export async function loadValidationResults({ companyId = null, batchId = null, limit = 500 } = {}) {
  const client = requireClient();
  let query = client.from('validation_results').select('*').order('created_at', { ascending: false }).limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  if (batchId) query = query.eq('import_batch_id', batchId);
  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

export async function loadFinancialMetricSnapshots({ companyId = null, batchId = null, limit = 2000, currentOnly = true } = {}) {
  const client = requireClient();
  let query = client
    .from('financial_metrics_snapshots')
    .select('*,import_batches(id,file_name,status,imported_at,source_type)')
    .order('fiscal_year', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  if (batchId) query = query.eq('import_batch_id', batchId);
  if (currentOnly) query = query.eq('is_current', true);
  const { data, error } = await query;
  if (error) {
    if (currentOnly && isMissingOptionalColumnError(error, READINESS_SNAPSHOT_COLUMNS)) {
      return loadFinancialMetricSnapshots({ companyId, batchId, limit, currentOnly: false });
    }
    return [];
  }
  return data || [];
}

export async function rollbackImportBatch(batchId) {
  const client = requireClient();
  const { data: batch, error: batchError } = await client.from('import_batches').select('*').eq('id', batchId).single();
  if (batchError) throw normalizeSupabaseError(batchError);

  await Promise.all([
    client.from('normalized_financial_data').update({ import_status: 'rolled_back' }).eq('import_batch_id', batchId),
    client.from('monthly_operating_data').update({ import_status: 'rolled_back' }).eq('import_batch_id', batchId),
    client.from('trial_balance_data').update({ import_status: 'rolled_back' }).eq('import_batch_id', batchId),
  ]);
  await client.from('import_batches').update({ status: 'rolled_back' }).eq('id', batchId);

  // Best-effort restore the most recent superseded batch for the same company/year/period.
  const { data: previous } = await client
    .from('import_batches')
    .select('id')
    .eq('company_id', batch.company_id)
    .eq('fiscal_year', batch.fiscal_year)
    .eq('period', batch.period || 'FY')
    .eq('status', 'superseded')
    .order('imported_at', { ascending: false })
    .limit(1);
  const previousId = previous?.[0]?.id;
  if (previousId) {
    await Promise.all([
      client.from('normalized_financial_data').update({ import_status: 'confirmed' }).eq('import_batch_id', previousId),
      client.from('monthly_operating_data').update({ import_status: 'confirmed' }).eq('import_batch_id', previousId),
      client.from('trial_balance_data').update({ import_status: 'confirmed' }).eq('import_batch_id', previousId),
    ]);
    await client.from('import_batches').update({ status: 'confirmed' }).eq('id', previousId);
  }
  await createAlertEventSafe(client, {
    eventType: 'import_rollback',
    severity: 'critical',
    companyId: batch.company_id,
    importBatchId: batchId,
    title: 'Import rolled back',
    message: previousId ? 'Import was rolled back and previous batch was restored.' : 'Import was rolled back. No previous batch was restored.',
    metadata: { batch_id: batchId, restored_batch_id: previousId || null, fiscal_year: batch.fiscal_year, period: batch.period },
  });
  return { restoredBatchId: previousId || null };
}

export async function loadMappingReviewRows(companyId = null, limit = 500) {
  const client = requireClient();
  const baseQuery = () => client
    .from('normalized_financial_data')
    .select('id,company_id,import_batch_id,fiscal_year,period,period_type,statement_scope,statement_type,raw_account_name,account_name,account_group,account_subgroup,mapping_confidence,mapping_source,suggested_account_group,suggested_account_subgroup,review_reason,needs_review,source_file,source_sheet,source_row,accounting_standard_profile,standard_ref,standard_source,standard_reason,standard_label_th,standard_label_en,line_role,metric_role,risk_flags,mapping_status,is_dashboard_eligible,is_export_eligible,conflict_status,conflict_reasons,conflict_score,approval_policy,manual_approval_reason,mapping_conflict_checked_at,companies(name_th,name_en,ticker_symbol)')
    .or('needs_review.eq.true,mapping_confidence.lt.0.86,account_group.eq.other,mapping_source.in.(accounting_dictionary,ai_similarity,unknown,approved_mapping_conflict_guard),conflict_status.in.(potential_conflict,confirmed_conflict,high_risk_term,manual_required,blocked),approval_policy.in.(manual_required,blocked,row_only_manual)')
    .eq('import_status', 'confirmed')
    .order('fiscal_year', { ascending: false })
    .limit(limit);
  let query = baseQuery();
  if (companyId) query = query.eq('company_id', companyId);
  let { data, error } = await query;

  if (error && isMissingOptionalColumnError(error, OPTIONAL_MAPPING_COLUMNS)) {
    let fallbackQuery = client
      .from('normalized_financial_data')
      .select('id,company_id,import_batch_id,fiscal_year,statement_type,raw_account_name,account_name,account_group,account_subgroup,mapping_confidence,needs_review,source_file,source_sheet,source_row,companies(name_th,name_en,ticker_symbol)')
      .or('needs_review.eq.true,mapping_confidence.lt.0.86,account_group.eq.other')
      .eq('import_status', 'confirmed')
      .order('fiscal_year', { ascending: false })
      .limit(limit);
    if (companyId) fallbackQuery = fallbackQuery.eq('company_id', companyId);
    const fallback = await fallbackQuery;
    data = (fallback.data || []).map((row) => ({
      ...row,
      mapping_source: row.account_group === 'other' ? 'unknown' : 'parser_rule',
      suggested_account_group: row.account_group,
      suggested_account_subgroup: row.account_subgroup,
      review_reason: row.account_group === 'other' ? 'Unknown or low-confidence accounting mapping.' : null,
    }));
    error = fallback.error;
  }
  if (error) throw normalizeSupabaseError(error);
  return data || [];
}

export async function updateMappingForRawAccount({
  companyId,
  rawAccountName,
  statementType,
  accountGroup,
  accountSubgroup = null,
  statementScope = null,
  accountingStandardProfile = null,
  lineRole = null,
  approvalScope = 'single_row',
  normalizedFinancialDataId = null,
  importBatchId = null,
  skipReadinessRebuild = false,
  approvalReason = '',
}) {
  const client = requireClient();
  const actor = await getCurrentActor(client);
  const semanticApproved = enrichRowSemantics({
    raw_account_name: rawAccountName,
    account_name: rawAccountName,
    statement_type: statementType,
    statement_scope: statementScope || 'unknown',
    accounting_standard_profile: accountingStandardProfile || null,
    account_group: accountGroup,
    suggested_account_group: accountGroup,
    account_subgroup: accountSubgroup,
    suggested_account_subgroup: accountSubgroup,
    line_role: lineRole || null,
    mapping_confidence: 1,
    mapping_source: 'approved_mapping',
    needs_review: false,
  });
  const semanticFlags = Array.isArray(semanticApproved.risk_flags) ? semanticApproved.risk_flags : [];
  const conflict = evaluateMappingConflict(semanticApproved);
  const requiresReason = ['manual_required', 'row_only_manual', 'blocked'].includes(conflict.approval_policy) || conflict.conflict_status !== 'none';
  if (requiresReason && !String(approvalReason || '').trim()) {
    throw new Error('Manual approval reason is required for risky or conflicting mapping rows.');
  }
  const reusableForFutureImports = !isHighRiskMappingLabel(rawAccountName) &&
    isSafeForBulkConfirm(semanticApproved, conflict) &&
    semanticApproved.line_role === 'detail' &&
    semanticFlags.length === 0 &&
    !['other', 'unknown'].includes(semanticApproved.account_group || accountGroup || 'other');

  // Only safe, low-risk decisions become reusable mapping memory. High-risk/manual
  // approvals are still written to mapping_decisions, but are not auto-reused in future imports.
  if (reusableForFutureImports) {
    const mapPayload = {
      company_id: companyId,
      raw_account_name: rawAccountName,
      statement_type: statementType,
      account_group: semanticApproved.account_group || accountGroup,
      account_subgroup: semanticApproved.account_subgroup || accountSubgroup,
      normalized_account_name: normalizeAccountKey(rawAccountName),
      statement_scope: statementScope || 'any',
      accounting_standard_profile: accountingStandardProfile || null,
      line_role: semanticApproved.line_role || lineRole || null,
      risk_flags: [],
      approval_scope: approvalScope,
      approval_policy: conflict.approval_policy,
      conflict_status: conflict.conflict_status,
      conflict_reasons: conflict.conflict_reasons || [],
      reusable: true,
      reuse_scope: conflict.reuse_scope || 'company_standard_scope',
      is_approved: true,
      mapping_source: 'approved_mapping',
      approved_by: actor.actor_user_id || null,
      approved_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    };
    let { error: mapError } = await client.from('account_mappings').upsert(mapPayload, { onConflict: 'company_id,raw_account_name,statement_type' });
    if (mapError && isMissingOptionalColumnError(mapError, OPTIONAL_APPROVAL_COLUMNS)) {
      const fallback = await client.from('account_mappings').upsert(stripColumns(mapPayload, OPTIONAL_APPROVAL_COLUMNS), { onConflict: 'company_id,raw_account_name,statement_type' });
      mapError = fallback.error;
    }
    if (mapError) throw normalizeSupabaseError(mapError);
  }

  const rowUpdate = {
    account_group: semanticApproved.account_group || accountGroup,
    account_subgroup: semanticApproved.account_subgroup || accountSubgroup,
    needs_review: false,
    mapping_confidence: 1,
    mapping_source: 'approved_mapping',
    suggested_account_group: semanticApproved.suggested_account_group || semanticApproved.account_group || accountGroup,
    suggested_account_subgroup: semanticApproved.suggested_account_subgroup || semanticApproved.account_subgroup || accountSubgroup,
    review_reason: reusableForFutureImports ? null : (approvalReason || 'Approved for this row/batch only. Not auto-reused because the account label, line role, or semantic risk is high-risk.'),
    mapping_status: conflict.approval_policy === 'blocked' ? 'blocked' : 'approved',
    approval_scope: reusableForFutureImports ? approvalScope : 'row_only_manual_approval',
    conflict_status: conflict.conflict_status,
    conflict_reasons: conflict.conflict_reasons || [],
    conflict_score: conflict.conflict_score ?? null,
    approval_policy: reusableForFutureImports ? 'safe_auto' : 'row_only_manual',
    manual_approval_reason: approvalReason || null,
    mapping_conflict_checked_at: new Date().toISOString(),
    line_role: semanticApproved.line_role || lineRole || null,
    metric_role: semanticApproved.metric_role || null,
    risk_flags: reusableForFutureImports ? [] : [...new Set([...semanticFlags, 'manual_row_only_mapping'])],
    is_dashboard_eligible: Boolean(semanticApproved.is_dashboard_eligible) && reusableForFutureImports,
    is_export_eligible: Boolean(semanticApproved.is_export_eligible),
  };

  const buildScopedRowUpdateQuery = (payload) => {
    let query = client.from('normalized_financial_data').update(payload).eq('company_id', companyId);
    if (normalizedFinancialDataId) return query.eq('id', normalizedFinancialDataId);
    query = query.eq('raw_account_name', rawAccountName).eq('statement_type', statementType);
    if (importBatchId) query = query.eq('import_batch_id', importBatchId);
    if (statementScope) query = query.eq('statement_scope', statementScope);
    if (accountingStandardProfile) query = query.eq('accounting_standard_profile', accountingStandardProfile);
    if (lineRole) query = query.eq('line_role', lineRole);
    return query;
  };

  let { error: rowError } = await buildScopedRowUpdateQuery(rowUpdate);
  if (rowError && isMissingOptionalColumnError(rowError, OPTIONAL_MAPPING_COLUMNS)) {
    const fallback = await buildScopedRowUpdateQuery(stripColumns(rowUpdate, OPTIONAL_MAPPING_COLUMNS));
    rowError = fallback.error;
  }
  if (rowError) throw normalizeSupabaseError(rowError);

  // Best-effort readiness rebuild for affected batches so Mapping Center changes
  // immediately flow into Dashboard/Data Quality/Export gates. Bulk flows can skip
  // this and rebuild each affected batch once at the end.
  if (!skipReadinessRebuild) {
    try {
      let affectedQuery = client.from('normalized_financial_data')
        .select('import_batch_id')
        .eq('company_id', companyId)
        .eq('import_status', 'confirmed');
      if (normalizedFinancialDataId) affectedQuery = affectedQuery.eq('id', normalizedFinancialDataId);
      else {
        affectedQuery = affectedQuery.eq('raw_account_name', rawAccountName).eq('statement_type', statementType);
        if (importBatchId) affectedQuery = affectedQuery.eq('import_batch_id', importBatchId);
        if (statementScope) affectedQuery = affectedQuery.eq('statement_scope', statementScope);
      }
      const { data: affectedRows } = await affectedQuery;
      const batchIds = [...new Set((affectedRows || []).map((r) => r.import_batch_id).filter(Boolean))];
      for (const id of batchIds) await rebuildAccountingReadiness({ companyId, batchId: id, strictAnnual: true });
    } catch (error) { console.warn('Readiness rebuild failed after mapping approval', error?.message || error); }
  }

  // Best-effort decision ledger for v1.9.0 Accounting Engine Foundation.
  // It is intentionally non-blocking so older databases that have not run 004 yet still work.
  try {
    await client.from('mapping_decisions').insert({
      company_id: companyId,
      normalized_financial_data_id: normalizedFinancialDataId || null,
      import_batch_id: importBatchId || null,
      raw_account_name: rawAccountName,
      normalized_account_name: normalizeAccountKey(rawAccountName),
      statement_type: statementType,
      statement_scope: statementScope || 'any',
      accounting_standard_profile: accountingStandardProfile || null,
      line_role: lineRole || null,
      metric_role: null,
      account_group: accountGroup,
      account_subgroup: accountSubgroup,
      risk_flags: reusableForFutureImports ? [] : ['manual_row_only_mapping'],
      approval_reason: approvalReason || null,
      approval_policy: reusableForFutureImports ? 'safe_auto' : 'row_only_manual',
      conflict_status: conflict.conflict_status,
      conflict_reasons: conflict.conflict_reasons || [],
      reusable: Boolean(reusableForFutureImports),
      reuse_scope: reusableForFutureImports ? 'company_standard_scope' : 'row_only',
      confidence: 1,
      decision_status: 'approved',
      decision_method: reusableForFutureImports ? approvalScope : 'row_only_manual_approval',
      decision_reason: reusableForFutureImports
        ? 'Human approved reusable account mapping from Account Mapping Center.'
        : (approvalReason || 'Human approved this high-risk mapping only for the selected row/batch; it will not be auto-reused.'),
      approved_by: actor.actor_user_id || null,
    });
  } catch (_) {}

  await createAlertEventSafe(client, {
    eventType: 'mapping_changed',
    severity: reusableForFutureImports ? 'warning' : 'critical',
    companyId,
    importBatchId,
    title: reusableForFutureImports ? 'Account mapping approved' : 'Row-only high-risk mapping approved',
    message: `${rawAccountName} approved as ${accountGroup}.`,
    metadata: { raw_account_name: rawAccountName, statement_type: statementType, account_group: accountGroup, account_subgroup: accountSubgroup, mapping_source: 'approved_mapping', reusable_for_future_imports: reusableForFutureImports },
  });
}

export async function bulkApproveMappingRows({ rows = [], selectedGroups = {}, approvalScope = 'bulk_safe_confirm' } = {}) {
  const client = requireClient();
  const actor = await getCurrentActor(client);
  const safeRows = rows
    .map((row) => {
      const selectedGroup = selectedGroups[row.id] || row.suggested_account_group || row.account_group || 'other';
      const safety = analyzeMappingRowSafety(row, selectedGroup);
      return { row, selectedGroup, safety };
    })
    .filter((item) => item.safety.safe);
  if (!safeRows.length) return { approved: 0, skipped: rows.length };

  for (const { row, selectedGroup, safety } of safeRows) {
    const subgroup = row.suggested_account_subgroup || row.account_subgroup || safety.adjusted.account_subgroup || selectedGroup;
    await updateMappingForRawAccount({
      companyId: row.company_id,
      rawAccountName: row.raw_account_name,
      statementType: row.statement_type,
      accountGroup: selectedGroup,
      accountSubgroup: subgroup,
      statementScope: row.statement_scope || null,
      accountingStandardProfile: row.accounting_standard_profile || null,
      lineRole: safety.lineRole || row.line_role || null,
      approvalScope,
      normalizedFinancialDataId: row.id || null,
      importBatchId: row.import_batch_id || null,
      skipReadinessRebuild: true,
    });
  }

  const affectedBatchIds = [...new Set(safeRows.map(({ row }) => row.import_batch_id).filter(Boolean))];
  for (const id of affectedBatchIds) {
    try { await rebuildAccountingReadiness({ companyId: safeRows[0]?.row?.company_id || null, batchId: id, strictAnnual: true }); }
    catch (error) { console.warn('Readiness rebuild failed after bulk approval', error?.message || error); }
  }

  await createAlertEventSafe(client, {
    eventType: 'mapping_changed',
    severity: 'info',
    companyId: safeRows[0]?.row?.company_id || null,
    title: 'Bulk safe mapping approved',
    message: `${safeRows.length} safe mapping row(s) approved by ${actor.actor_email || 'current user'}.`,
    metadata: { approval_scope: approvalScope, approved_rows: safeRows.length, skipped_rows: rows.length - safeRows.length },
  });
  return { approved: safeRows.length, skipped: rows.length - safeRows.length };
}

export async function getRawFileSignedUrl(storagePath, expiresIn = 300) {
  if (!storagePath) return null;
  const { data, error } = await requireClient().storage.from('raw-financial-files').createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function loadExchangeRates(year) {
  const { data, error } = await requireClient()
    .from("exchange_rates")
    .select("currency,rate_to_thb,effective_date")
    .lte("effective_date", `${year}-12-31`)
    .order("effective_date", { ascending: false });
  if (error) throw error;
  const rates = { THB: 1 };
  (data || []).forEach((row) => {
    if (!rates[row.currency]) rates[row.currency] = Number(row.rate_to_thb);
  });
  return rates;
}

export async function saveExchangeRate(currency, rate, effectiveDate) {
  const { error } = await requireClient().from("exchange_rates").upsert({
    currency,
    rate_to_thb: rate,
    effective_date: effectiveDate,
  }, { onConflict: "currency,effective_date" });
  if (error) throw error;
}

export async function loadAuditLog(limit = 100) {
  const { data, error } = await requireClient()
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function loadCompanyMembers(companyId) {
  const { data, error } = await requireClient()
    .from("company_members")
    .select("user_id,role,created_at,profiles(full_name,email)")
    .eq("company_id", companyId)
    .order("created_at");
  if (error) throw error;
  return data || [];
}

export async function grantCompanyAccess(companyId, email, role) {
  const client = requireClient();
  const { error } = await client.rpc("grant_company_access", {
    target_company_id: companyId,
    target_email: email,
    target_role: role,
  });
  if (error) throw error;
  await createAlertEventSafe(client, {
    eventType: 'permission_changed',
    severity: 'security',
    companyId,
    title: 'User access granted',
    message: `${email} was granted ${role} access.`,
    metadata: { target_email: email, target_role: role, action: 'grant' },
  });
}

export async function revokeCompanyAccess(companyId, userId) {
  const client = requireClient();
  const { error } = await client.rpc("revoke_company_access", {
    target_company_id: companyId,
    target_user_id: userId,
  });
  if (error) throw error;
  await createAlertEventSafe(client, {
    eventType: 'permission_changed',
    severity: 'security',
    companyId,
    title: 'User access revoked',
    message: `Access was revoked for user ${userId}.`,
    metadata: { target_user_id: userId, action: 'revoke' },
  });
}
