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

  let query = client
    .from("companies")
    .select("id,name_th,name_en,currency,type,industry,group_id,ticker_symbol,fiscal_year_end,company_mode,legal_entity_type")
    .order("id");
  let { data, error } = await query;

  // Backward compatible fallback for databases that have not run the v1.5 private-company migration yet.
  if (error && /company_mode|legal_entity_type|schema cache|Could not find/i.test(error.message || '')) {
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
    legal_entity_type: company.legalEntityType || (company.companyMode === 'public' || company.tickerSymbol ? 'public_limited' : 'limited_company')
  };
  let { data, error } = await client.from("companies").insert(payload).select("id").single();
  if (error && /company_mode|legal_entity_type|schema cache|Could not find/i.test(error.message || '')) {
    const { company_mode, legal_entity_type, ...fallbackPayload } = payload;
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
    legal_entity_type: company.legalEntityType || (company.companyMode === 'public' || company.tickerSymbol ? 'public_limited' : 'limited_company')
  };
  let { error } = await client.from("companies").update(payload).eq("id", id);
  if (error && /company_mode|legal_entity_type|schema cache|Could not find/i.test(error.message || '')) {
    const { company_mode, legal_entity_type, ...fallbackPayload } = payload;
    const fallback = await client.from("companies").update(fallbackPayload).eq("id", id);
    error = fallback.error;
  }
  if (error) throw error;
}

export async function loadAllNormalizedData() {
  const { data, error } = await requireClient()
    .from("normalized_financial_data")
    .select("*")
    .eq("import_status", "confirmed")
    .order("fiscal_year")
    .order("period");
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
  const store = {};
  (data || []).forEach((record) => {
    store[record.company_id] ||= {};
    store[record.company_id][record.fiscal_year] ||= {};
    const idx = Number(record.month) - 1;
    store[record.company_id][record.fiscal_year][idx] = {
      monthIdx: idx,
      revenue: Number(record.revenue) || 0,
      expense: Number(record.expense) || 0,
      cashIn: Number(record.cash_in) || 0,
      cashOut: Number(record.cash_out) || 0,
      loanBalance: Number(record.loan_balance) || 0,
      _sourceType: 'private_monthly_report',
      _updatedAt: record.updated_at,
    };
  });
  return store;
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
    const { error } = await client.from(table).insert(chunk);
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
  const seen = new Set();
  const mappings = rows
    .filter(row => row.raw_account_name && row.statement_type && row.account_group)
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
      };
    })
    .filter(Boolean)
    .slice(0, 2000);
  if (!mappings.length) return;
  try {
    await client.from('account_mappings').upsert(mappings, { onConflict: 'company_id,raw_account_name,statement_type' });
  } catch (_) {
    // Mapping persistence is helpful but should not block imports.
  }
}

export async function saveImportBatch(companyId, batchDetails, normalizedDataRows) {
  const client = requireClient();
  const safeRows = Array.isArray(normalizedDataRows) ? normalizedDataRows : [];
  if (!safeRows.length) return { batchId: null, rowsImported: 0 };
  
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
    file_hash: batchDetails.fileHash || null,
    file_size: batchDetails.fileSize || null,
    review_count: batchDetails.reviewCount ?? null,
    total_rows: safeRows.length,
    status: 'confirmed'
  };
  let { data: batch, error: batchError } = await client.from("import_batches").insert(batchPayload).select("id").single();
  if (batchError && /source_type|parser_profile|legal_entity_type|file_hash|file_size|storage_path|total_rows|review_count|schema cache|Could not find/i.test(batchError.message || '')) {
    const { source_type, parser_profile, legal_entity_type, file_hash, file_size, storage_path, validation_summary, review_count, total_rows, ...fallbackBatchPayload } = batchPayload;
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
    needs_review: row.needs_review,
    import_status: 'confirmed'
  }));
  
  // Preserve old rows as superseded when the governance migration is installed.
  // Fallback to delete for databases that still have the old check constraint.
  const replaceKeys = new Set(payload.map((row) => [row.fiscal_year, row.period || 'FY', row.statement_scope || 'consolidated'].join('|')));
  for (const key of replaceKeys) {
    const [fiscalYear, period, statementScope] = key.split('|');
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
  
  return { batchId: batch.id, rowsImported };
}


export async function savePrivateImportBatch(companyId, batchDetails, privatePayload = {}) {
  const client = requireClient();
  const monthlyRows = Array.isArray(privatePayload.monthlyRows) ? privatePayload.monthlyRows : [];
  const trialBalanceRows = Array.isArray(privatePayload.trialBalanceRows) ? privatePayload.trialBalanceRows : [];
  const normalizedRows = Array.isArray(privatePayload.normalizedRows) ? privatePayload.normalizedRows : [];
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
    file_hash: batchDetails.fileHash || null,
    file_size: batchDetails.fileSize || null,
    total_rows: totalInputRows,
    review_count: privatePayload.summary?.reviewCount ?? null,
    status: 'confirmed'
  };
  let { data: batch, error: batchError } = await client.from("import_batches").insert(batchPayload).select("id").single();
  if (batchError && /source_type|parser_profile|legal_entity_type|file_hash|file_size|storage_path|total_rows|review_count|schema cache|Could not find/i.test(batchError.message || '')) {
    const { source_type, parser_profile, legal_entity_type, file_hash, file_size, storage_path, validation_summary, review_count, total_rows, ...fallbackBatchPayload } = batchPayload;
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
      needs_review: row.needs_review,
      import_status: 'confirmed'
    }));
    const replaceKeys = new Set(payload.map((row) => [row.fiscal_year, row.period || 'FY', row.statement_scope || 'private_company'].join('|')));
    for (const key of replaceKeys) {
      const [fiscalYear, period, statementScope] = key.split('|');
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
  if (error && /source_type|parser_profile|legal_entity_type|file_hash|file_size|storage_path|total_rows|review_count|schema cache|Could not find/i.test(error.message || '')) {
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
  return { restoredBatchId: previousId || null };
}

export async function loadMappingReviewRows(companyId = null, limit = 500) {
  const client = requireClient();
  let query = client
    .from('normalized_financial_data')
    .select('id,company_id,fiscal_year,statement_type,raw_account_name,account_name,account_group,account_subgroup,mapping_confidence,needs_review,source_file,source_sheet,source_row,companies(name_th,name_en,ticker_symbol)')
    .or('needs_review.eq.true,mapping_confidence.lt.0.86,account_group.eq.other')
    .eq('import_status', 'confirmed')
    .order('fiscal_year', { ascending: false })
    .limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) throw normalizeSupabaseError(error);
  return data || [];
}

export async function updateMappingForRawAccount({ companyId, rawAccountName, statementType, accountGroup, accountSubgroup = null }) {
  const client = requireClient();
  const { error: mapError } = await client.from('account_mappings').upsert({
    company_id: companyId,
    raw_account_name: rawAccountName,
    statement_type: statementType,
    account_group: accountGroup,
    account_subgroup: accountSubgroup,
  }, { onConflict: 'company_id,raw_account_name,statement_type' });
  if (mapError) throw normalizeSupabaseError(mapError);
  const { error: rowError } = await client.from('normalized_financial_data')
    .update({ account_group: accountGroup, account_subgroup: accountSubgroup, needs_review: false, mapping_confidence: 1 })
    .eq('company_id', companyId)
    .eq('raw_account_name', rawAccountName)
    .eq('statement_type', statementType);
  if (rowError) throw normalizeSupabaseError(rowError);
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
