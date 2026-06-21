import React, { useState, useRef } from 'react';
import { parseFinancialFile, CORE_GROUPS } from '../lib/parser';

export default function ImportWizard({ companyId, onImportSuccess, lang, theme, C }) {
  const th = lang === 'th';
  const [step, setStep] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);
  const [parsedData, setParsedData] = useState([]);
  const [batchDetails, setBatchDetails] = useState({ fileName: '', fiscalYear: new Date().getFullYear() });
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setStatus({ type: 'loading', msg: th ? 'กำลังวิเคราะห์โครงสร้างไฟล์...' : 'Analyzing file structure...' });
    try {
      setBatchDetails(prev => ({ ...prev, fileName: file.name }));
      const rows = await parseFinancialFile(file, companyId);
      if (!rows.length) {
        setStatus({ type: 'error', msg: th ? 'ไม่พบข้อมูล หรือไม่สามารถวิเคราะห์โครงสร้างได้' : 'No data found or structure unrecognizable.' });
        return;
      }
      // Assuming single year in file for simplicity of batch, but parser gives rows with specific years.
      // We will set batch fiscalYear to the first row's year
      const primaryYear = rows[0].fiscal_year;
      setBatchDetails(prev => ({ ...prev, fiscalYear: primaryYear }));
      setParsedData(rows);
      setStep(2);
      setStatus(null);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: err.message });
    }
  };

  const handleConfirm = async () => {
    setStatus({ type: 'loading', msg: th ? 'กำลังบันทึกข้อมูล...' : 'Saving data...' });
    try {
      await onImportSuccess(batchDetails, parsedData);
      setStatus({ type: 'success', msg: th ? 'บันทึกสำเร็จ!' : 'Saved successfully!' });
      setTimeout(() => {
        setStep(1);
        setParsedData([]);
        setStatus(null);
      }, 2000);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: err.message });
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
        {status && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: status.type === 'error' ? C.redLo : C.accentLo, color: status.type === 'error' ? C.red : C.accent }}>
            {status.msg}
          </div>
        )}
      </div>
    );
  }

  const groupOptions = Object.keys(CORE_GROUPS);

  return (
    <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{th ? "ตรวจสอบการจับคู่บัญชี (Mapping Preview)" : "Mapping Preview"}</div>
          <div style={{ fontSize: 14, color: C.muted }}>{batchDetails.fileName}</div>
        </div>
        <button onClick={handleConfirm} style={{ background: C.accent, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
          {th ? "ยืนยันและบันทึก" : "Confirm & Save"}
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.border}`, textAlign: 'left' }}>
              <th style={{ padding: '12px 8px' }}>Status</th>
              <th style={{ padding: '12px 8px' }}>Statement</th>
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
                <td style={{ padding: '12px 8px', fontWeight: 500 }}>{row.raw_account_name}</td>
                <td style={{ padding: '12px 8px', color: C.muted }}>{row.fiscal_year}</td>
                <td style={{ padding: '12px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {new Intl.NumberFormat().format(row.amount)}
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
      {status && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: status.type === 'error' ? C.redLo : C.greenLo, color: status.type === 'error' ? C.red : C.green }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
