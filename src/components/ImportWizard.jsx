import React, { useEffect, useState, useRef } from 'react';
import { parseFinancialFile, CORE_GROUPS } from '../lib/parser';
import { parsePrivateFile } from '../lib/privateParser';

const SOURCE_OPTIONS = {
  public: [
    { id: 'public_financial_statement', icon: '🏛️', th: 'งบ SET / บริษัทมหาชน', en: 'SET / Public financial statement', hintTh: 'งบปี/ไตรมาสจากแหล่งทางการ', hintEn: 'Annual/quarterly official statements' },
  ],
  private: [
    { id: 'private_financial_statement', icon: '📄', th: 'งบการเงินนิติบุคคล', en: 'Private financial statement', hintTh: 'งบปีจากสำนักงานบัญชี', hintEn: 'Annual statements from accountant' },
    { id: 'private_monthly_report', icon: '📆', th: 'รายงานรายเดือน', en: 'Monthly management report', hintTh: 'รายได้/ค่าใช้จ่าย/เงินสดรายเดือน', hintEn: 'Monthly revenue, expense and cash data' },
    { id: 'private_trial_balance', icon: '🧾', th: 'งบทดลอง', en: 'Trial balance', hintTh: 'รหัสบัญชี เดบิต เครดิต ยอดคงเหลือ', hintEn: 'Account code, debit, credit, ending balance' },
  ],
};

function sourceToParserType(sourceType) {
  if (sourceType === 'private_financial_statement') return 'financial_statement';
  if (sourceType === 'private_monthly_report') return 'monthly_report';
  if (sourceType === 'private_trial_balance') return 'trial_balance';
  return 'auto';
}

export default function ImportWizard({ companyId, company, onImportSuccess, lang, theme, C }) {
  const th = lang === 'th';
  const companyMode = company?.companyMode || (company?.tickerSymbol ? 'public' : 'private');
  const [sourceType, setSourceType] = useState(companyMode === 'private' ? 'private_financial_statement' : 'public_financial_statement');
  const [step, setStep] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [parsedData, setParsedData] = useState([]);
  const [privatePayload, setPrivatePayload] = useState(null);
  const [parseSummary, setParseSummary] = useState(null);
  const [batchDetails, setBatchDetails] = useState({ fileName: '', fiscalYear: new Date().getFullYear(), periodType: 'annual', period: 'FY', statementScope: 'consolidated', sourceType: 'public_financial_statement' });
  const inputRef = useRef();

  const sourceOptions = SOURCE_OPTIONS[companyMode] || SOURCE_OPTIONS.private;
  const activeSource = sourceOptions.find(item => item.id === sourceType) || sourceOptions[0];

  useEffect(() => {
    const defaultSource = companyMode === 'private' ? 'private_financial_statement' : 'public_financial_statement';
    setSourceType(defaultSource);
    setStep(1);
    setParsedData([]);
    setPrivatePayload(null);
    setParseSummary(null);
    setStatus(null);
  }, [companyId, companyMode]);

  const handleFile = async (file) => {
    if (!file) return;
    setStatus({ type: 'loading', msg: th ? 'กำลังวิเคราะห์โครงสร้างไฟล์...' : 'Analyzing file structure...' });
    try {
      setBatchDetails(prev => ({ ...prev, fileName: file.name, sourceType }));

      if (sourceType === 'public_financial_statement') {
        const rows = await parseFinancialFile(file, companyId);
        const summary = rows.summary || null;
        if (!rows.length) {
          setParseSummary(summary);
          setStatus({ type: 'error', msg: th ? 'ยังไม่พบตัวเลขงบการเงินที่อ่านได้ ระบบรองรับ Excel/CSV ที่มีปี พ.ศ./ค.ศ. และคอลัมน์ตัวเลขงบการเงิน' : 'No readable financial statement rows found. The file needs year columns and financial amounts.' });
          return;
        }
        const primaryYear = summary?.primaryYear || rows[0].fiscal_year;
        setBatchDetails(prev => ({ ...prev, fiscalYear: primaryYear, periodType: 'annual', period: 'FY', statementScope: rows[0].statement_scope || 'consolidated', sourceType, parserProfile: summary?.parserVersion || 'IMPORT_PARSER_V3_INDUSTRY_PACK_V1' }));
        setPrivatePayload(null);
        setParseSummary(summary);
        setParsedData(rows);
        setStep(2);
        setStatus(null);
        return;
      }

      const payload = await parsePrivateFile(file, companyId, sourceToParserType(sourceType));
      const summary = payload.summary || null;
      const previewRows = sourceType === 'private_monthly_report'
        ? payload.monthlyRows.map(row => ({
          statement_type: 'monthly_report',
          source_sheet: row.source_sheet,
          source_cell: `row ${row.source_row}`,
          raw_account_name: `${th ? 'เดือน' : 'Month'} ${row.month}`,
          fiscal_year: row.fiscal_year,
          amount: row.revenue || row.expense || row.cash_in || row.cash_out || row.loan_balance || 0,
          account_group: 'monthly_operating',
          needs_review: false,
        }))
        : sourceType === 'private_trial_balance'
          ? payload.trialBalanceRows.map(row => ({
            statement_type: 'trial_balance',
            source_sheet: row.source_sheet,
            source_cell: `row ${row.source_row}`,
            raw_account_name: row.account_name,
            fiscal_year: row.fiscal_year,
            amount: row.ending_balance,
            account_group: row.account_group || 'other',
            needs_review: row.account_group === 'other',
          }))
          : payload.normalizedRows;

      if (!summary?.rows) {
        setParseSummary(summary);
        setStatus({ type: 'error', msg: th ? 'ยังไม่พบข้อมูลที่อ่านได้สำหรับโหมดนี้ ลองเลือกประเภทไฟล์ให้ตรง เช่น งบทดลอง/รายงานรายเดือน/งบการเงิน' : 'No readable data found for this mode. Try selecting the matching file type.' });
        return;
      }
      const primaryYear = summary.primaryYear || new Date().getFullYear();
      setBatchDetails(prev => ({
        ...prev,
        fiscalYear: primaryYear,
        periodType: sourceType === 'private_monthly_report' ? 'monthly' : 'annual',
        period: sourceType === 'private_monthly_report' ? 'MIXED' : 'FY',
        statementScope: 'private_company',
        sourceType,
        parserProfile: summary.parserVersion || 'PRIVATE_COMPANY_IMPORT_PACK_V1',
      }));
      setPrivatePayload(payload);
      setParsedData(previewRows);
      setParseSummary(summary);
      setStep(2);
      setStatus(null);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: err.message });
    }
  };

  const formatErrorMessage = (err) => {
    const raw = err?.message || String(err || 'Unknown error');
    if (/monthly_operating_data|trial_balance_data|company_mode|source_type|import_batches|normalized_financial_data|account_mappings|relation .* does not exist|schema cache/i.test(raw)) {
      return th
        ? 'บันทึกไม่สำเร็จ: Supabase ยังไม่มีตาราง/คอลัมน์สำหรับ Private Company Pack กรุณารัน migration 202606220001_private_company_pack.sql แล้ว reload schema'
        : 'Save failed: Supabase is missing Private Company Pack tables/columns. Run migration 202606220001_private_company_pack.sql and reload schema.';
    }
    if (/permission denied|row-level security|violates row-level security|not authorized|Only owners/i.test(raw)) {
      return th
        ? 'บันทึกไม่สำเร็จ: สิทธิ์ Supabase ไม่พอ ต้องเป็น owner/admin/editor ของบริษัทนี้ หรือเช็ก RLS policy'
        : 'Save failed: Supabase permission is not enough. You must be owner/admin/editor for this company, or check RLS policies.';
    }
    if (/network|fetch|Failed to fetch/i.test(raw)) {
      return th
        ? 'บันทึกไม่สำเร็จ: เชื่อมต่อ Supabase ไม่ได้ชั่วคราว กรุณาเช็กอินเทอร์เน็ตแล้วลองใหม่'
        : 'Save failed: cannot reach Supabase. Check your connection and try again.';
    }
    return raw;
  };

  const handleConfirm = async () => {
    if (saving) return;
    const savePayload = sourceType.startsWith('private_') ? privatePayload : parsedData;
    const rowsCount = sourceType.startsWith('private_') ? (privatePayload?.summary?.rows || 0) : parsedData.length;
    setSaving(true);
    setStatus({ type: 'loading', msg: th ? `กำลังบันทึกข้อมูล ${rowsCount.toLocaleString()} แถว...` : `Saving ${rowsCount.toLocaleString()} rows...` });
    try {
      const result = await onImportSuccess(batchDetails, savePayload);
      const rowsImported = result?.rowsImported || rowsCount;
      setStatus({ type: 'success', msg: th ? `บันทึกสำเร็จ ${rowsImported.toLocaleString()} แถว` : `Saved ${rowsImported.toLocaleString()} rows successfully.` });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => {
        setStep(1);
        setParsedData([]);
        setPrivatePayload(null);
        setParseSummary(null);
        setStatus(null);
        setSaving(false);
      }, 1800);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: formatErrorMessage(err) });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setSaving(false);
    }
  };

  const updateRow = (idx, field, value) => {
    const newData = [...parsedData];
    newData[idx][field] = value;
    if (field === 'account_group') newData[idx].needs_review = false;
    setParsedData(newData);
  };

  if (step === 1) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{th ? "อัปโหลดข้อมูลการเงิน" : "Upload Financial Data"}</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                {companyMode === 'private'
                  ? (th ? 'โหมดนิติบุคคลทั่วไป: รองรับงบการเงิน งบทดลอง และรายงานรายเดือน' : 'Private mode: supports financial statements, trial balance and monthly reports')
                  : (th ? 'โหมดบริษัทมหาชน: รองรับงบ SET / งบประจำปี / งบไตรมาส' : 'Public mode: supports SET-style annual/quarterly statements')}
              </div>
            </div>
            <div style={{ padding: '7px 12px', borderRadius: 999, background: companyMode === 'private' ? C.purpleLo : C.accentLo, color: companyMode === 'private' ? C.purple : C.accent, fontWeight: 800, fontSize: 12 }}>
              {companyMode === 'private' ? (th ? 'นิติบุคคลทั่วไป' : 'Private') : (th ? 'บริษัทมหาชน' : 'Public')}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginBottom: 18 }}>
            {sourceOptions.map(option => (
              <button key={option.id} type="button" onClick={() => setSourceType(option.id)} style={{ textAlign: 'left', border: `1px solid ${sourceType === option.id ? C.accent : C.border}`, background: sourceType === option.id ? C.accentLo : C.card, color: C.text, borderRadius: 12, padding: 14, cursor: 'pointer' }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{option.icon}</div>
                <div style={{ fontWeight: 850, marginBottom: 4 }}>{th ? option.th : option.en}</div>
                <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.5 }}>{th ? option.hintTh : option.hintEn}</div>
              </button>
            ))}
          </div>

          <div 
            style={{
              border: `2px dashed ${dragging ? C.accent : C.border}`,
              borderRadius: 12, padding: 48, textAlign: "center", cursor: "pointer",
              background: dragging ? C.accentLo : "transparent"
            }}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => inputRef.current.click()}
          >
            <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            <div style={{ fontSize: 36, marginBottom: 16 }}>{activeSource?.icon || '📄'}</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{th ? "ลากไฟล์ Excel / CSV มาวางที่นี่" : "Drag Excel / CSV here"}</div>
            <div style={{ fontSize: 14, color: C.muted, marginTop: 8 }}>{th ? "ระบบจะเลือก parser ตามประเภทไฟล์ที่เลือกด้านบน" : "The selected parser mode will be used for this upload"}</div>
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
            {sourceType === 'private_monthly_report'
              ? (th ? 'แนะนำหัวคอลัมน์: เดือน, ปี, รายได้, ค่าใช้จ่าย, เงินสดเข้า, เงินสดออก, เงินกู้ หรือใช้รูปแบบบัญชีด้านซ้าย + เดือน ม.ค.–ธ.ค. ด้านบน' : 'Recommended columns: month, year, revenue, expense, cash_in, cash_out, loan_balance or account rows with Jan–Dec columns.')
              : sourceType === 'private_trial_balance'
                ? (th ? 'แนะนำหัวคอลัมน์: รหัสบัญชี, ชื่อบัญชี, เดบิต, เครดิต, ยอดคงเหลือ' : 'Recommended columns: account_code, account_name, debit, credit, ending_balance.')
                : (th ? 'รองรับไฟล์งบการเงินหลาย sheet, ปี พ.ศ./ค.ศ., หน่วย บาท/พันบาท/ล้านบาท และรายการบัญชีที่เยื้องหลายระดับ' : 'Supports multi-sheet statements, BE/CE years, baht/thousand/million units, and indented account lines.')}
          </div>
          {status && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: status.type === 'error' ? C.redLo : C.accentLo, color: status.type === 'error' ? C.red : C.accent }}>
              {status.msg}
            </div>
          )}
        </div>
      </div>
    );
  }

  const groupOptions = Array.from(new Set([...Object.keys(CORE_GROUPS), ...parsedData.map(row => row.account_group).filter(Boolean)])).sort();

  return (
    <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{th ? "ตรวจสอบข้อมูลก่อนบันทึก" : "Review Before Save"}</div>
          <div style={{ fontSize: 14, color: C.muted }}>{batchDetails.fileName} · {th ? activeSource?.th : activeSource?.en}</div>
        </div>
        <button
          onClick={handleConfirm}
          disabled={saving || !parsedData.length}
          style={{ background: saving ? C.muted : C.accent, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.75 : 1 }}
        >
          {saving ? (th ? "กำลังบันทึก..." : "Saving...") : (th ? "ยืนยันและบันทึก" : "Confirm & Save")}
        </button>
      </div>

      {status && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, border: `1px solid ${status.type === 'error' ? C.red : status.type === 'success' ? C.green : C.accent}`, background: status.type === 'error' ? C.redLo : status.type === 'success' ? C.greenLo : C.accentLo, color: status.type === 'error' ? C.red : status.type === 'success' ? C.green : C.accent, fontWeight: 700 }}>
          {status.msg}
        </div>
      )}

      {parseSummary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'ปีที่พบ' : 'Years'}</div>
            <div style={{ fontWeight: 800 }}>{parseSummary.years?.map(y => th ? y + 543 : y).join(', ') || '-'}</div>
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'รายงานรายเดือน' : 'Monthly Rows'}</div>
            <div style={{ fontWeight: 800 }}>{parseSummary.monthlyRows || 0}</div>
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'งบทดลอง' : 'Trial Balance'}</div>
            <div style={{ fontWeight: 800 }}>{parseSummary.trialBalanceRows || 0}</div>
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'งบ normalized' : 'Normalized Rows'}</div>
            <div style={{ fontWeight: 800 }}>{parseSummary.normalizedRows || parseSummary.rows || 0}</div>
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'ต้องตรวจสอบ' : 'Needs Review'}</div>
            <div style={{ fontWeight: 800, color: parseSummary.reviewCount ? C.amber : C.green }}>{parseSummary.reviewCount || 0}</div>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.border}`, textAlign: 'left' }}>
              <th style={{ padding: '12px 8px' }}>Status</th>
              <th style={{ padding: '12px 8px' }}>Type</th>
              <th style={{ padding: '12px 8px' }}>Source</th>
              <th style={{ padding: '12px 8px' }}>Account / Month</th>
              <th style={{ padding: '12px 8px' }}>Year</th>
              <th style={{ padding: '12px 8px', textAlign: 'right' }}>Amount</th>
              <th style={{ padding: '12px 8px' }}>Mapped Group</th>
            </tr>
          </thead>
          <tbody>
            {parsedData.slice(0, 500).map((row, idx) => (
              <tr key={idx} style={{ borderBottom: `1px solid ${C.border}`, background: row.needs_review ? C.amberLo : 'transparent' }}>
                <td style={{ padding: '12px 8px', color: row.needs_review ? C.amber : C.green, fontWeight: 600 }}>{row.needs_review ? '⚠ Review' : '✓ OK'}</td>
                <td style={{ padding: '12px 8px', color: C.muted }}>{row.statement_type}</td>
                <td style={{ padding: '12px 8px', color: C.muted }}>{row.source_sheet}{row.source_cell ? `!${row.source_cell}` : ''}</td>
                <td style={{ padding: '12px 8px', fontWeight: 500 }}>{row.raw_account_name}</td>
                <td style={{ padding: '12px 8px', color: C.muted }}>{row.fiscal_year}</td>
                <td style={{ padding: '12px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{Number.isFinite(Number(row.amount)) ? new Intl.NumberFormat().format(row.amount) : '-'}</td>
                <td style={{ padding: '12px 8px' }}>
                  <select value={row.account_group} onChange={(e) => updateRow(idx, 'account_group', e.target.value)} style={{ background: C.bg, border: `1px solid ${row.needs_review ? C.amber : C.border}`, padding: '6px 12px', borderRadius: 6, width: '100%', color: C.text }}>
                    <option value="other">Other</option>
                    {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {parsedData.length > 500 && <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>{th ? `แสดงตัวอย่าง 500 แถวแรก จากทั้งหมด ${parsedData.length.toLocaleString()} แถว` : `Showing first 500 of ${parsedData.length.toLocaleString()} rows.`}</div>}
      </div>
    </div>
  );
}
