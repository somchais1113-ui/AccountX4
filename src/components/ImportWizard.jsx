import React, { useState, useRef } from 'react';
import { parseFinancialFile, CORE_GROUPS } from '../lib/parser';

export default function ImportWizard({ companyId, onImportSuccess, lang, theme, C }) {
  const th = lang === 'th';
  const [step, setStep] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [parsedData, setParsedData] = useState([]);
  const [parseSummary, setParseSummary] = useState(null);
  const [batchDetails, setBatchDetails] = useState({ fileName: '', fiscalYear: new Date().getFullYear(), periodType: 'annual', period: 'FY', statementScope: 'consolidated' });
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setStatus({ type: 'loading', msg: th ? 'กำลังวิเคราะห์โครงสร้างไฟล์...' : 'Analyzing file structure...' });
    try {
      setBatchDetails(prev => ({ ...prev, fileName: file.name }));
      const rows = await parseFinancialFile(file, companyId);
      const summary = rows.summary || null;
      if (!rows.length) {
        setParseSummary(summary);
        setStatus({ type: 'error', msg: th ? 'ยังไม่พบตัวเลขงบการเงินที่อ่านได้ ระบบรองรับ Excel/CSV ที่มีปี พ.ศ./ค.ศ. และคอลัมน์ตัวเลขงบการเงิน' : 'No readable financial statement rows found. The file needs year columns and financial amounts.' });
        return;
      }
      const primaryYear = summary?.primaryYear || rows[0].fiscal_year;
      setBatchDetails(prev => ({ ...prev, fiscalYear: primaryYear, periodType: 'annual', period: 'FY', statementScope: rows[0].statement_scope || 'consolidated' }));
      setParseSummary(summary);
      setParsedData(rows);
      setStep(2);
      setStatus(null);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: err.message });
    }
  };

  const formatErrorMessage = (err) => {
    const raw = err?.message || String(err || 'Unknown error');
    if (/import_batches|normalized_financial_data|account_mappings|relation .* does not exist|schema cache/i.test(raw)) {
      return th
        ? 'บันทึกไม่สำเร็จ: Supabase ยังไม่มีตาราง normalized/import_batches หรือ schema cache ยังไม่อัปเดต กรุณารัน migration 202606210001_normalized_schema.sql ใน Supabase SQL Editor แล้วลองใหม่'
        : 'Save failed: Supabase normalized/import_batches tables are missing or schema cache is stale. Run migration 202606210001_normalized_schema.sql in Supabase SQL Editor and try again.';
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
    setSaving(true);
    setStatus({ type: 'loading', msg: th ? `กำลังบันทึกข้อมูล ${parsedData.length.toLocaleString()} แถว...` : `Saving ${parsedData.length.toLocaleString()} rows...` });
    try {
      const result = await onImportSuccess(batchDetails, parsedData);
      const rowsImported = result?.rowsImported || parsedData.length;
      setStatus({ type: 'success', msg: th ? `บันทึกสำเร็จ ${rowsImported.toLocaleString()} แถว` : `Saved ${rowsImported.toLocaleString()} rows successfully.` });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => {
        setStep(1);
        setParsedData([]);
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
    // Auto clear needs_review if group is selected
    if (field === 'account_group') newData[idx].needs_review = false;
    setParsedData(newData);
  };

  if (step === 1) {
    return (
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{th ? "อัปโหลดงบการเงิน" : "Upload Financial Statement"}</div>
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
          <input ref={inputRef} type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 36, marginBottom: 16 }}>📄</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{th ? "ลากไฟล์ Excel หรือ CSV มาวางที่นี่" : "Drag Excel or CSV here"}</div>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 8 }}>{th ? "ระบบจะวิเคราะห์โครงสร้างอัตโนมัติ" : "System will analyze structure automatically"}</div>
        </div>
        <div style={{ marginTop: 12, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
          {th ? 'รองรับไฟล์งบการเงินจริงหลาย sheet, header ซ้ำ, ปี พ.ศ./ค.ศ., หน่วย บาท/พันบาท/ล้านบาท และรายการบัญชีที่เยื้องหลายระดับ' : 'Supports multi-sheet statements, repeated headers, BE/CE years, baht/thousand/million units, and indented account lines.'}
        </div>
        {status && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: status.type === 'error' ? C.redLo : C.accentLo, color: status.type === 'error' ? C.red : C.accent }}>
            {status.msg}
          </div>
        )}
      </div>
    );
  }

  const groupOptions = Array.from(new Set([...Object.keys(CORE_GROUPS), ...parsedData.map(row => row.account_group).filter(Boolean)])).sort();

  return (
    <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{th ? "ตรวจสอบการจับคู่บัญชี (Mapping Preview)" : "Mapping Preview"}</div>
          <div style={{ fontSize: 14, color: C.muted }}>{batchDetails.fileName}</div>
        </div>
        <button
          onClick={handleConfirm}
          disabled={saving || !parsedData.length}
          style={{ background: saving ? C.muted : C.accent, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.75 : 1 }}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'ปีที่พบ' : 'Years Detected'}</div>
            <div style={{ fontWeight: 800 }}>{parseSummary.years?.map(y => th ? y + 543 : y).join(', ') || '-'}</div>
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'งบที่พบ' : 'Statements'}</div>
            <div style={{ fontWeight: 800 }}>{parseSummary.statements?.length || 0}</div>
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'แถวที่อ่านได้' : 'Parsed Rows'}</div>
            <div style={{ fontWeight: 800 }}>{parseSummary.rows}</div>
          </div>
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.muted }}>{th ? 'ต้องตรวจสอบ' : 'Needs Review'}</div>
            <div style={{ fontWeight: 800, color: parseSummary.reviewCount ? C.amber : C.green }}>{parseSummary.reviewCount}</div>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.border}`, textAlign: 'left' }}>
              <th style={{ padding: '12px 8px' }}>Status</th>
              <th style={{ padding: '12px 8px' }}>Statement</th>
              <th style={{ padding: '12px 8px' }}>Source</th>
              <th style={{ padding: '12px 8px' }}>Account Name (Raw)</th>
              <th style={{ padding: '12px 8px' }}>Year</th>
              <th style={{ padding: '12px 8px', textAlign: 'right' }}>Amount</th>
              <th style={{ padding: '12px 8px' }}>Mapped Group</th>
            </tr>
          </thead>
          <tbody>
            {parsedData.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: `1px solid ${C.border}`, background: row.needs_review ? C.amberLo : 'transparent' }}>
                <td style={{ padding: '12px 8px', color: row.needs_review ? C.amber : C.green, fontWeight: 600 }}>
                  {row.needs_review ? '⚠ Review' : '✓ OK'}
                </td>
                <td style={{ padding: '12px 8px', color: C.muted }}>{row.statement_type}</td>
                <td style={{ padding: '12px 8px', color: C.muted }}>{row.source_sheet}{row.source_cell ? `!${row.source_cell}` : ''}</td>
                <td style={{ padding: '12px 8px', fontWeight: 500 }}>{row.raw_account_name}</td>
                <td style={{ padding: '12px 8px', color: C.muted }}>{row.fiscal_year}</td>
                <td style={{ padding: '12px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {Number.isFinite(Number(row.amount)) ? new Intl.NumberFormat().format(row.amount) : '-'}
                </td>
                <td style={{ padding: '12px 8px' }}>
                  <select 
                    value={row.account_group}
                    onChange={(e) => updateRow(idx, 'account_group', e.target.value)}
                    style={{ background: C.bg, border: `1px solid ${row.needs_review ? C.amber : C.border}`, padding: '6px 12px', borderRadius: 6, width: '100%', color: C.text }}
                  >
                    <option value="other">Other</option>
                    {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
