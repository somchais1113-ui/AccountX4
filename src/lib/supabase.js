import { createClient } from "@supabase/supabase-js";
import { inferAccountingStandardProfile } from "./accountingStandards.js";

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

async function loadApprovedAccountMappings(client, companyId) {
  if (!companyId) return [];
  let { data, error } = await client
    .from('account_mappings')
    .select('raw_account_name,statement_type,account_group,account_subgroup,industry_metric,is_approved,mapping_source')
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
  if (error) return [];
  return data || [];
}

function applyApprovedAccountMappings(rows = [], approvedMappings = []) {
  if (!approvedMappings.length) return rows;
  const lookup = new Map();
  approvedMappings.forEach((mapping) => {
    const key = `${mapping.statement_type || ''}|${normalizeRawAccountKey(mapping.raw_account_name)}`;
    lookup.set(key, mapping);
  });
  return rows.map((row) => {
    const key = `${row.statement_type || ''}|${normalizeRawAccountKey(row.raw_account_name || row.account_name)}`;
    const mapping = lookup.get(key);
    if (!mapping) return row;
    return {
      ...row,
      account_group: mapping.account_group,
      account_subgroup: mapping.account_subgroup || row.account_subgroup || null,
      industry_metric: mapping.industry_metric || row.industry_metric || null,
      mapping_confidence: 1,
      mapping_source: 'approved_mapping',
      suggested_account_group: mapping.account_group,
      suggested_account_subgroup: mapping.account_subgroup || null,
      review_reason: null,
      needs_review: false,
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
    .select('id,company_id,file_name,fiscal_year,period_type,period,statement_scope,source_type,parser_profile,legal_entity_type,status,total_rows,review_count,file_hash,file_size,storage_path,imported_at,companies(name_th,name_en,ticker_symbol,industry,currency)')
    .eq('id', batchId)
    .single();
  if (batchError) throw normalizeSupabaseError(batchError);

  const [normalized, monthly, trial] = await Promise.all([
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
  const batchMeta = new Map([[batch.id, batch]]);

  return {
    mode: batch.status === 'confirmed' ? 'confirmed_snapshot' : 'archived_snapshot',
    batch,
    store: mergeStores(buildNormalizedStore(normalizedRows, batchMeta), buildMonthlyStore(monthlyRows, batchMeta)),
    rowCounts: { normalized: normalizedRows.length, monthly: monthlyRows.length, trialBalance: trialRows.length },
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
    .filter(row => row.raw_account_name && row.statement_type && row.account_group && row.needs_review === false && row.mapping_source === 'approved_mapping')
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


async function markPreviousImportBatchesSuperseded(client, companyId, fiscalYear, period, statementScope) {
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
    const batchIds = [...new Set((data || []).map((row) => row.import_batch_id).filter(Boolean))];
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

async function markPreviousDataTableImportBatchesSuperseded(client, tableName, applyFilters) {
  try {
    const baseQuery = client
      .from(tableName)
      .select('import_batch_id')
      .eq('import_status', 'confirmed');
    const { data, error } = await applyFilters(baseQuery);
    if (error) return;
    const batchIds = [...new Set((data || []).map((row) => row.import_batch_id).filter(Boolean))];
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

export async function saveImportBatch(companyId, batchDetails, normalizedDataRows) {
  const client = requireClient();
  const incomingRows = Array.isArray(normalizedDataRows) ? normalizedDataRows : [];
  if (!incomingRows.length) return { batchId: null, rowsImported: 0 };
  const safeRows = applyApprovedAccountMappings(incomingRows, await loadApprovedAccountMappings(client, companyId));
  
  // 1. Create batch
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
    total_rows: safeRows.length,
    status: 'confirmed'
  };
  let { data: batch, error: batchError } = await client.from("import_batches").insert(batchPayload).select("id").single();
  if (batchError && /source_type|parser_profile|legal_entity_type|accounting_standard_profile|standard_validation_summary|data_quality_score|file_hash|file_size|storage_path|total_rows|review_count|schema cache|Could not find/i.test(batchError.message || '')) {
    const { source_type, parser_profile, legal_entity_type, accounting_standard_profile, standard_validation_summary, data_quality_score, file_hash, file_size, storage_path, validation_summary, review_count, total_rows, ...fallbackBatchPayload } = batchPayload;
    const fallback = await client.from("import_batches").insert(fallbackBatchPayload).select("id").single();
    batch = fallback.data;
    batchError = fallback.error;
  }
  if (batchError) throw normalizeSupabaseError(batchError);
  
  // 2. Insert normalized data
  const payload = safeRows.map(row => ({
    company_id: companyId,
    fiscal_year: row.fiscal_year,
    period_type: row.period_type || 'annual',
    period: row.period || 'FY',
    statement_scope: row.statement_scope || 'consolidated',
    statement_type: row.statement_type,
    account_name: row.account_name,
    account_group: row.account_group,
    account_subgroup: row.account_subgroup,
    industry_metric: row.industry_metric,
    note: row.note,
    original_amount: row.original_amount,
    original_unit: row.original_unit,
    amount: row.amount,
    normalized_unit: row.normalized_unit,
    raw_account_name: row.raw_account_name,
    raw_amount: row.raw_amount,
    raw_unit: row.raw_unit,
    source_file: row.source_file || batchDetails.fileName,
    source_sheet: row.source_sheet,
    source_row: row.source_row,
    source_column: row.source_column,
    source_cell: row.source_cell,
    import_batch_id: batch.id,
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
    import_status: 'confirmed'
  }));
  
  // Preserve old rows as superseded when the governance migration is installed.
  // Fallback to delete for databases that still have the old check constraint.
  const replaceKeys = new Set(payload.map((row) => [row.fiscal_year, row.period || 'FY', row.statement_scope || 'consolidated'].join('|')));
  for (const key of replaceKeys) {
    const [fiscalYear, period, statementScope] = key.split('|');
    await markPreviousImportBatchesSuperseded(client, companyId, fiscalYear, period, statementScope);
    await updateIfSupported(
      () => client.from("normalized_financial_data")
        .update({ import_status: 'superseded' })
        .eq("company_id", companyId)
        .eq("fiscal_year", Number(fiscalYear))
        .eq("period", period)
        .eq("statement_scope", statementScope)
        .eq("import_status", 'confirmed'),
      () => client.from("normalized_financial_data")
        .delete()
        .eq("company_id", companyId)
        .eq("fiscal_year", Number(fiscalYear))
        .eq("period", period)
        .eq("statement_scope", statementScope)
    );
  }

  const rowsImported = await insertInChunks(client, "normalized_financial_data", payload);
  await uploadRawFileForBatch(client, companyId, batch.id, batchDetails);
  await upsertAccountMappings(client, companyId, safeRows);

  await createAlertEventSafe(client, {
    eventType: 'import_success',
    severity: batchDetails.reviewCount > 0 ? 'warning' : 'success',
    companyId,
    importBatchId: batch.id,
    title: batchDetails.reviewCount > 0 ? 'Import saved with mapping review' : 'Import saved successfully',
    message: `${batchDetails.fileName || 'Financial statement'} saved with ${rowsImported} rows.`,
    metadata: {
      file_name: batchDetails.fileName,
      fiscal_year: batchDetails.fiscalYear,
      period_type: batchDetails.periodType || 'annual',
      period: batchDetails.period || 'FY',
      source_type: batchDetails.sourceType || 'public_financial_statement',
      parser_profile: batchDetails.parserProfile || null,
      review_count: batchDetails.reviewCount ?? 0,
      rows_imported: rowsImported,
    },
  });
  if (Number(batchDetails.reviewCount || 0) > 0) {
    await createAlertEventSafe(client, {
      eventType: 'mapping_review_required',
      severity: 'warning',
      companyId,
      importBatchId: batch.id,
      title: 'Mapping review required',
      message: `${batchDetails.reviewCount} rows need accounting mapping review.`,
      metadata: { file_name: batchDetails.fileName, review_count: batchDetails.reviewCount, rows_imported: rowsImported },
    });
  }
  
  return { batchId: batch.id, rowsImported };
}


export async function savePrivateImportBatch(companyId, batchDetails, privatePayload = {}) {
  const client = requireClient();
  const monthlyRows = Array.isArray(privatePayload.monthlyRows) ? privatePayload.monthlyRows : [];
  const trialBalanceRows = Array.isArray(privatePayload.trialBalanceRows) ? privatePayload.trialBalanceRows : [];
  const incomingNormalizedRows = Array.isArray(privatePayload.normalizedRows) ? privatePayload.normalizedRows : [];
  const normalizedRows = applyApprovedAccountMappings(incomingNormalizedRows, await loadApprovedAccountMappings(client, companyId));
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
    status: 'confirmed'
  };
  let { data: batch, error: batchError } = await client.from("import_batches").insert(batchPayload).select("id").single();
  if (batchError && /source_type|parser_profile|legal_entity_type|accounting_standard_profile|standard_validation_summary|data_quality_score|file_hash|file_size|storage_path|total_rows|review_count|schema cache|Could not find/i.test(batchError.message || '')) {
    const { source_type, parser_profile, legal_entity_type, accounting_standard_profile, standard_validation_summary, data_quality_score, file_hash, file_size, storage_path, validation_summary, review_count, total_rows, ...fallbackBatchPayload } = batchPayload;
    const fallback = await client.from("import_batches").insert(fallbackBatchPayload).select("id").single();
    batch = fallback.data;
    batchError = fallback.error;
  }
  if (batchError) throw normalizeSupabaseError(batchError);

  let rowsImported = 0;

  if (monthlyRows.length) {
    const deleteKeys = new Set(monthlyRows.map(row => [row.fiscal_year, row.month].join('|')));
    for (const key of deleteKeys) {
      const [fiscalYear, month] = key.split('|');
      await markPreviousDataTableImportBatchesSuperseded(client, 'monthly_operating_data', (query) => query
        .eq("company_id", companyId)
        .eq("fiscal_year", Number(fiscalYear))
        .eq("month", Number(month))
      );
      await updateIfSupported(
        () => client.from("monthly_operating_data")
          .update({ import_status: 'superseded' })
          .eq("company_id", companyId)
          .eq("fiscal_year", Number(fiscalYear))
          .eq("month", Number(month))
          .eq("import_status", 'confirmed'),
        () => client.from("monthly_operating_data")
          .delete()
          .eq("company_id", companyId)
          .eq("fiscal_year", Number(fiscalYear))
          .eq("month", Number(month))
      );
    }
    const payload = monthlyRows.map(row => ({
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
      import_batch_id: batch.id,
      import_status: 'confirmed'
    }));
    rowsImported += await insertInChunks(client, "monthly_operating_data", payload);
  }

  if (trialBalanceRows.length) {
    const deleteYears = new Set(trialBalanceRows.map(row => row.fiscal_year));
    for (const fiscalYear of deleteYears) {
      await markPreviousDataTableImportBatchesSuperseded(client, 'trial_balance_data', (query) => query
        .eq("company_id", companyId)
        .eq("fiscal_year", Number(fiscalYear))
      );
      await updateIfSupported(
        () => client.from("trial_balance_data")
          .update({ import_status: 'superseded' })
          .eq("company_id", companyId)
          .eq("fiscal_year", Number(fiscalYear))
          .eq("import_status", 'confirmed'),
        () => client.from("trial_balance_data")
          .delete()
          .eq("company_id", companyId)
          .eq("fiscal_year", Number(fiscalYear))
      );
    }
    const payload = trialBalanceRows.map(row => ({
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
      import_batch_id: batch.id,
      import_status: 'confirmed'
    }));
    rowsImported += await insertInChunks(client, "trial_balance_data", payload);
  }

  if (normalizedRows.length) {
    const payload = normalizedRows.map(row => ({
      company_id: companyId,
      fiscal_year: row.fiscal_year,
      period_type: row.period_type || 'annual',
      period: row.period || 'FY',
      statement_scope: row.statement_scope || 'private_company',
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
      import_batch_id: batch.id,
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
      import_status: 'confirmed'
    }));
    const replaceKeys = new Set(payload.map((row) => [row.fiscal_year, row.period || 'FY', row.statement_scope || 'private_company'].join('|')));
    for (const key of replaceKeys) {
      const [fiscalYear, period, statementScope] = key.split('|');
      await markPreviousImportBatchesSuperseded(client, companyId, fiscalYear, period, statementScope);
      await updateIfSupported(
        () => client.from("normalized_financial_data")
          .update({ import_status: 'superseded' })
          .eq("company_id", companyId)
          .eq("fiscal_year", Number(fiscalYear))
          .eq("period", period)
          .eq("statement_scope", statementScope)
          .eq("import_status", 'confirmed'),
        () => client.from("normalized_financial_data")
          .delete()
          .eq("company_id", companyId)
          .eq("fiscal_year", Number(fiscalYear))
          .eq("period", period)
          .eq("statement_scope", statementScope)
      );
    }
    rowsImported += await insertInChunks(client, "normalized_financial_data", payload);
  }

  await uploadRawFileForBatch(client, companyId, batch.id, batchDetails);
  if (normalizedRows.length) await upsertAccountMappings(client, companyId, normalizedRows);

  await createAlertEventSafe(client, {
    eventType: 'import_success',
    severity: (privatePayload.summary?.reviewCount || 0) > 0 ? 'warning' : 'success',
    companyId,
    importBatchId: batch.id,
    title: (privatePayload.summary?.reviewCount || 0) > 0 ? 'Private import saved with review' : 'Private import saved successfully',
    message: `${batchDetails.fileName || 'Private company file'} saved with ${rowsImported} rows.`,
    metadata: {
      file_name: batchDetails.fileName,
      fiscal_year: batchDetails.fiscalYear,
      period_type: batchDetails.periodType || (monthlyRows.length ? 'monthly' : 'annual'),
      source_type: batchDetails.sourceType || 'private_company_file',
      parser_profile: batchDetails.parserProfile || 'PRIVATE_COMPANY_IMPORT_PACK_V1',
      review_count: privatePayload.summary?.reviewCount ?? 0,
      rows_imported: rowsImported,
      monthly_rows: monthlyRows.length,
      trial_balance_rows: trialBalanceRows.length,
      normalized_rows: normalizedRows.length,
    },
  });
  if (Number(privatePayload.summary?.reviewCount || 0) > 0) {
    await createAlertEventSafe(client, {
      eventType: 'mapping_review_required',
      severity: 'warning',
      companyId,
      importBatchId: batch.id,
      title: 'Private company mapping review required',
      message: `${privatePayload.summary.reviewCount} rows need mapping review.`,
      metadata: { file_name: batchDetails.fileName, review_count: privatePayload.summary.reviewCount },
    });
  }
  return { batchId: batch.id, rowsImported };
}

export async function loadImportHistory(companyId = null, limit = 200) {
  const client = requireClient();
  let query = client
    .from('import_batches')
    .select('id,company_id,file_name,fiscal_year,period_type,period,statement_scope,source_type,parser_profile,legal_entity_type,status,total_rows,review_count,file_hash,file_size,storage_path,imported_at,companies(name_th,name_en,ticker_symbol,industry,currency)')
    .order('imported_at', { ascending: false })
    .limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  let { data, error } = await query;
  if (error && /source_type|parser_profile|legal_entity_type|accounting_standard_profile|standard_validation_summary|data_quality_score|file_hash|file_size|storage_path|total_rows|review_count|schema cache|Could not find/i.test(error.message || '')) {
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
    .select('id,company_id,fiscal_year,statement_type,raw_account_name,account_name,account_group,account_subgroup,mapping_confidence,mapping_source,suggested_account_group,suggested_account_subgroup,review_reason,needs_review,source_file,source_sheet,source_row,companies(name_th,name_en,ticker_symbol)')
    .or('needs_review.eq.true,mapping_confidence.lt.0.86,account_group.eq.other,mapping_source.in.(accounting_dictionary,ai_similarity,unknown)')
    .eq('import_status', 'confirmed')
    .order('fiscal_year', { ascending: false })
    .limit(limit);
  let query = baseQuery();
  if (companyId) query = query.eq('company_id', companyId);
  let { data, error } = await query;

  if (error && isMissingOptionalColumnError(error, OPTIONAL_MAPPING_COLUMNS)) {
    let fallbackQuery = client
      .from('normalized_financial_data')
      .select('id,company_id,fiscal_year,statement_type,raw_account_name,account_name,account_group,account_subgroup,mapping_confidence,needs_review,source_file,source_sheet,source_row,companies(name_th,name_en,ticker_symbol)')
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

export async function updateMappingForRawAccount({ companyId, rawAccountName, statementType, accountGroup, accountSubgroup = null }) {
  const client = requireClient();
  const actor = await getCurrentActor(client);
  const mapPayload = {
    company_id: companyId,
    raw_account_name: rawAccountName,
    statement_type: statementType,
    account_group: accountGroup,
    account_subgroup: accountSubgroup,
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

  const rowUpdate = {
    account_group: accountGroup,
    account_subgroup: accountSubgroup,
    needs_review: false,
    mapping_confidence: 1,
    mapping_source: 'approved_mapping',
    suggested_account_group: accountGroup,
    suggested_account_subgroup: accountSubgroup,
    review_reason: null,
  };
  let { error: rowError } = await client.from('normalized_financial_data')
    .update(rowUpdate)
    .eq('company_id', companyId)
    .eq('raw_account_name', rawAccountName)
    .eq('statement_type', statementType);
  if (rowError && isMissingOptionalColumnError(rowError, OPTIONAL_MAPPING_COLUMNS)) {
    const fallback = await client.from('normalized_financial_data')
      .update(stripColumns(rowUpdate, OPTIONAL_MAPPING_COLUMNS))
      .eq('company_id', companyId)
      .eq('raw_account_name', rawAccountName)
      .eq('statement_type', statementType);
    rowError = fallback.error;
  }
  if (rowError) throw normalizeSupabaseError(rowError);
  await createAlertEventSafe(client, {
    eventType: 'mapping_changed',
    severity: 'warning',
    companyId,
    title: 'Account mapping approved',
    message: `${rawAccountName} approved as ${accountGroup}.`,
    metadata: { raw_account_name: rawAccountName, statement_type: statementType, account_group: accountGroup, account_subgroup: accountSubgroup, mapping_source: 'approved_mapping' },
  });
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
