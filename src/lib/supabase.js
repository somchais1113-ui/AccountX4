import { createClient } from "@supabase/supabase-js";

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
  const { data, error } = await client
    .from("companies")
    .select("id,name_th,name_en,currency,type,industry,group_id,ticker_symbol,fiscal_year_end")
    .order("id");
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
    role: roles.get(company.id) || "viewer",
  }));
}

export async function createCompany(company) {
  const { data, error } = await requireClient().from("companies").insert({
    name_th: company.nameTh,
    name_en: company.nameEn,
    currency: company.currency,
    type: company.type,
    industry: company.industry,
    group_id: company.groupId || null,
    ticker_symbol: company.tickerSymbol || null,
    fiscal_year_end: company.fiscalYearEnd || '12-31'
  }).select("id").single();
  if (error) throw error;
  return data;
}

export async function updateCompany(id, company) {
  const { error } = await requireClient().from("companies").update({
    name_th: company.nameTh,
    name_en: company.nameEn,
    currency: company.currency,
    type: company.type,
    industry: company.industry,
    group_id: company.groupId || null,
    ticker_symbol: company.tickerSymbol || null,
    fiscal_year_end: company.fiscalYearEnd || '12-31'
  }).eq("id", id);
  if (error) throw error;
}

export async function loadAllNormalizedData() {
  const { data, error } = await requireClient().from("normalized_financial_data").select("*").order("fiscal_year").order("period");
  if (error) throw error;
  
  // Transform flat rows into a hierarchical store for the dashboard
  const store = {};
  (data || []).forEach((record) => {
    store[record.company_id] ||= {};
    store[record.company_id][record.fiscal_year] ||= {};
    
    // Default period for annual is 'FY'
    const periodKey = record.period || 'FY';
    store[record.company_id][record.fiscal_year][periodKey] ||= {
      _updatedAt: record.updated_at,
      status: record.import_status,
      groups: {}
    };
    
    // Accumulate by group (e.g. revenue, expense)
    const pd = store[record.company_id][record.fiscal_year][periodKey];
    pd.groups[record.account_group] = (pd.groups[record.account_group] || 0) + Number(record.amount);
  });
  return store;
}

export async function saveImportBatch(companyId, batchDetails, normalizedDataRows) {
  const client = requireClient();
  const safeRows = Array.isArray(normalizedDataRows) ? normalizedDataRows : [];
  if (!safeRows.length) return { batchId: null, rowsImported: 0 };
  
  // 1. Create batch
  const { data: batch, error: batchError } = await client.from("import_batches").insert({
    company_id: companyId,
    file_name: batchDetails.fileName,
    fiscal_year: batchDetails.fiscalYear,
    period_type: batchDetails.periodType || 'annual',
    period: batchDetails.period || 'FY',
    statement_scope: batchDetails.statementScope || 'consolidated',
    status: 'confirmed'
  }).select("id").single();
  
  if (batchError) throw batchError;
  
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
    needs_review: row.needs_review,
    import_status: 'confirmed'
  }));
  
  // Clean old data for every year/period/scope found in this upload.
  // Real financial statements commonly contain comparative columns, e.g. 2025 and 2024 in one file.
  const replaceKeys = new Set(payload.map((row) => [row.fiscal_year, row.period || 'FY', row.statement_scope || 'consolidated'].join('|')));
  for (const key of replaceKeys) {
    const [fiscalYear, period, statementScope] = key.split('|');
    const { error: deleteError } = await client.from("normalized_financial_data")
      .delete()
      .eq("company_id", companyId)
      .eq("fiscal_year", Number(fiscalYear))
      .eq("period", period)
      .eq("statement_scope", statementScope);
    if (deleteError) throw deleteError;
  }

  const { error: dataError } = await client.from("normalized_financial_data").insert(payload);
  if (dataError) throw dataError;
  
  return { batchId: batch.id, rowsImported: payload.length };
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
  const { error } = await requireClient().rpc("grant_company_access", {
    target_company_id: companyId,
    target_email: email,
    target_role: role,
  });
  if (error) throw error;
}

export async function revokeCompanyAccess(companyId, userId) {
  const { error } = await requireClient().rpc("revoke_company_access", {
    target_company_id: companyId,
    target_user_id: userId,
  });
  if (error) throw error;
}
