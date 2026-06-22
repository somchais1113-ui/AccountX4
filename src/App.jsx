import { useState, useMemo, useRef, useEffect, Fragment, createContext, useContext } from "react";
import {
  AreaChart, Area, BarChart, Bar, Line, ComposedChart, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from "recharts";
import { FinanceMath, convertToTHB } from "./lib/finance.js";
import { normalizeFinancialCSV } from "./lib/csv.js";
import { exportBackup, exportRecordsCSV, parseBackup } from "./lib/backup.js";
import {
  isSupabaseConfigured, supabase, signIn, signUp, resetPassword, signOut,
  loadCompanies, createCompany, updateCompany, loadAllFinancialData, saveImportBatch, savePrivateImportBatch, loadExchangeRates, saveExchangeRate,
  loadAuditLog, loadCompanyMembers, grantCompanyAccess, revokeCompanyAccess,
} from "./lib/supabase.js";
import ImportWizard from "./components/ImportWizard";
import MomentumDashboard from "./components/Dashboard";

// ═══════════════════════════════════════════════════════════
// THEME SYSTEM — Dark / Light (realtime)
// ═══════════════════════════════════════════════════════════
const THEMES = {
  dark: {
    bg:"#0B0E1A", surface:"#13172A", card:"#1A1F35", border:"#252A42",
    accent:"#5B7CFA", accentLo:"#5B7CFA18", green:"#1FD9A4", greenLo:"#1FD9A415",
    red:"#F7637C", redLo:"#F7637C15", amber:"#F7B84F", amberLo:"#F7B84F15",
    purple:"#A78BFA", purpleLo:"#A78BFA18", blue:"#38BDF8", blueLo:"#38BDF818",
    text:"#E4E8FF", muted:"#6B7299", white:"#FFFFFF",
    slideBg:"#0F1528", overlay:"#ffffff08", overlay2:"#ffffff06",
  },
  light: {
    bg:"#F4F6FB", surface:"#FFFFFF", card:"#FFFFFF", border:"#E2E6F0",
    accent:"#3A5BE0", accentLo:"#3A5BE012", green:"#0FA67E", greenLo:"#0FA67E12",
    red:"#E0445F", redLo:"#E0445F12", amber:"#C77F15", amberLo:"#C77F1512",
    purple:"#7C5BD4", purpleLo:"#7C5BD412", blue:"#0284C7", blueLo:"#0284C712",
    text:"#1A1F35", muted:"#7A8199", white:"#1A1F35",
    slideBg:"#0F1528", overlay:"#ffffff08", overlay2:"#ffffff06",
  },
};
const ThemeCtx = createContext(THEMES.dark);
const useC = () => useContext(ThemeCtx);
const F = { sans:"'Inter','Noto Sans Thai',sans-serif" };

const MONTHS = [
  {th:"ม.ค.",en:"Jan"},{th:"ก.พ.",en:"Feb"},{th:"มี.ค.",en:"Mar"},
  {th:"เม.ย.",en:"Apr"},{th:"พ.ค.",en:"May"},{th:"มิ.ย.",en:"Jun"},
  {th:"ก.ค.",en:"Jul"},{th:"ส.ค.",en:"Aug"},{th:"ก.ย.",en:"Sep"},
  {th:"ต.ค.",en:"Oct"},{th:"พ.ย.",en:"Nov"},{th:"ธ.ค.",en:"Dec"},
];

// INDUSTRY DEFINITIONS
const INDUSTRIES = {
  retail:        { th:"ค้าปลีก", en:"Retail", icon:"🛒", color:"#5B7CFA" },
  manufacturing: { th:"การผลิต", en:"Manufacturing", icon:"🏭", color:"#1FD9A4" },
  service:       { th:"บริการ", en:"Service", icon:"💼", color:"#A78BFA" },
  tech:          { th:"เทคโนโลยี", en:"Technology", icon:"💻", color:"#F7B84F" },
  realestate:    { th:"อสังหาฯ", en:"Real Estate", icon:"🏗", color:"#F7637C" },
};

const LEGAL_ENTITY_TYPES = {
  public_limited: { th:"บริษัทมหาชนจำกัด", en:"Public Limited Company", icon:"🏛️", companyMode:"public", tone:"accent" },
  limited_company: { th:"บริษัทจำกัด", en:"Limited Company", icon:"🏢", companyMode:"private", tone:"purple" },
  limited_partnership: { th:"ห้างหุ้นส่วนจำกัด", en:"Limited Partnership", icon:"🤝", companyMode:"private", tone:"purple" },
};
const legalModeFromType = (legalEntityType) => LEGAL_ENTITY_TYPES[legalEntityType]?.companyMode || "private";
const defaultLegalEntityType = (company = {}) => company.legalEntityType || (company.companyMode === "public" || company.tickerSymbol ? "public_limited" : "limited_company");

// DATA ENGINE
const METRIC_GROUPS = {
  revenue: [
    "revenue", "sales_revenue", "healthcare_patient_revenue", "product_sales_revenue",
    "real_estate_sales_revenue", "bank_net_interest_income", "bank_interest_income",
    "bank_net_fee_income", "bank_fee_income", "other_income"
  ],
  expense: [
    "expense", "cogs", "sga", "healthcare_service_cost", "real_estate_cogs",
    "finance_cost", "tax", "bank_interest_expense", "bank_expected_credit_loss",
    "bank_other_operating_expenses"
  ],
  netProfit: ["net_profit"],
  cash: ["cash", "cash_ending", "cash_beginning"],
  asset: ["asset"],
  liability: ["liability"],
  equity: ["equity"],
  loan: ["loan", "bank_borrowings", "borrowings"],
  cogs: ["cogs", "healthcare_service_cost", "real_estate_cogs"],
  sga: ["sga", "bank_other_operating_expenses"],
  operatingCashFlow: ["operating_cash_flow"],
  investingCashFlow: ["investing_cash_flow"],
  financingCashFlow: ["financing_cash_flow"],
};

const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const firstMetric = (groups = {}, keys = []) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(groups, key)) return num(groups[key]);
  }
  return 0;
};
const sumMetrics = (groups = {}, keys = []) => keys.reduce((sum, key) => sum + num(groups[key]), 0);
const deriveAnnualMetrics = (groups = {}) => {
  const revenue = firstMetric(groups, ["revenue"]) || sumMetrics(groups, METRIC_GROUPS.revenue.filter(k => k !== "revenue"));
  const cogs = sumMetrics(groups, METRIC_GROUPS.cogs);
  const sga = sumMetrics(groups, METRIC_GROUPS.sga);
  const expense = firstMetric(groups, ["expense"]) || sumMetrics(groups, METRIC_GROUPS.expense.filter(k => k !== "expense"));
  const netProfit = firstMetric(groups, METRIC_GROUPS.netProfit) || (revenue ? revenue - expense : 0);
  const cash = firstMetric(groups, METRIC_GROUPS.cash);
  const asset = firstMetric(groups, METRIC_GROUPS.asset);
  const liability = firstMetric(groups, METRIC_GROUPS.liability);
  const equity = firstMetric(groups, METRIC_GROUPS.equity);
  const loan = firstMetric(groups, METRIC_GROUPS.loan);
  const cfo = firstMetric(groups, METRIC_GROUPS.operatingCashFlow);
  const cfi = firstMetric(groups, METRIC_GROUPS.investingCashFlow);
  const cff = firstMetric(groups, METRIC_GROUPS.financingCashFlow);
  return {
    revenue,
    cogs,
    sga,
    expense,
    netProfit,
    cash,
    asset,
    liability,
    equity,
    loan,
    operatingCashFlow: cfo,
    investingCashFlow: cfi,
    financingCashFlow: cff,
    cashIn: cfo > 0 ? cfo : 0,
    cashOut: cfo < 0 ? Math.abs(cfo) : 0,
    margin: revenue ? (netProfit / revenue) * 100 : 0,
  };
};

const DataEngine = {
  getYearData(store, companyId, year) {
    const yearData = store?.[companyId]?.[year] || {};

    // Legacy demo/local shape: { 0: {monthIdx, revenue, ...}, 1: ... }
    const legacyRows = Object.values(yearData)
      .filter((record) => record && typeof record === "object" && Number.isInteger(record.monthIdx))
      .sort((a, b) => a.monthIdx - b.monthIdx);
    if (legacyRows.length) return legacyRows;

    // Normalized Supabase shape: { FY: { groups: {...} }, Q1: ... }
    const period = yearData.FY || Object.values(yearData).find((record) => record?.groups);
    if (!period?.groups) return MONTHS.map((month, idx) => ({ monthIdx: idx, monthTh: month.th, monthEn: month.en, revenue: 0, expense: 0, cashIn: 0, cashOut: 0, loanBalance: 0, margin: 0, groups: {} }));
    const groups = period.groups || {};
    const metrics = deriveAnnualMetrics(groups);
    const annualRow = {
      monthIdx: 0,
      monthTh: "FY",
      monthEn: "FY",
      revenue: metrics.revenue,
      expense: metrics.expense,
      cashIn: metrics.cashIn,
      cashOut: metrics.cashOut,
      loanBalance: metrics.loan,
      margin: metrics.margin,
      groups,
      annualMetrics: metrics,
    };

    // Keep older monthly pages from crashing by returning 12 rows.
    // The first row carries annual/FY values; the rest are zero placeholders.
    return MONTHS.map((month, idx) => idx === 0
      ? annualRow
      : { monthIdx: idx, monthTh: month.th, monthEn: month.en, revenue: 0, expense: 0, cashIn: 0, cashOut: 0, loanBalance: 0, margin: 0, groups: {} }
    );
  },
  getAvailableYears(store, companyId) { return Object.keys(store?.[companyId]||{}).map(Number).filter(Boolean).sort(); },
  getDisplayYear(store, companyId, requestedYear) {
    const years = this.getAvailableYears(store, companyId);
    if (!years.length) return requestedYear;
    if (years.includes(Number(requestedYear))) return Number(requestedYear);
    return years[years.length - 1];
  },
  getAnnualPeriod(store, companyId, year) {
    const yearData = store?.[companyId]?.[year] || {};
    return yearData.FY || Object.values(yearData).find((record) => record?.groups) || null;
  },
  hasNormalizedAnnualData(store, companyId, year) {
    return Boolean(this.getAnnualPeriod(store, companyId, year)?.groups);
  },
  getAnnualMetrics(store, companyId, year) {
    const period = this.getAnnualPeriod(store, companyId, year);
    const groups = period?.groups || {};
    return { year, groups, ...deriveAnnualMetrics(groups) };
  },
  getAnnualRows(store, companyId) {
    return this.getAvailableYears(store, companyId)
      .filter((recordYear) => this.hasNormalizedAnnualData(store, companyId, recordYear))
      .sort((a, b) => b - a)
      .map((recordYear) => this.getAnnualMetrics(store, companyId, recordYear));
  },
  countMonths(store, companyId, year) {
    const yearData = store?.[companyId]?.[year] || {};
    const legacyCount = Object.values(yearData).filter((record) => Number.isInteger(record?.monthIdx)).length;
    if (legacyCount) return legacyCount;
    return Object.values(yearData).filter((record) => record?.groups).length;
  },
  yearTotal(store, companyId, year, metric) {
    return this.getYearData(store, companyId, year).reduce((sum, row) => sum + (Number(row?.[metric]) || 0), 0);
  },
};

const genSeed = (seed=1, trend=1) => {
  const obj = {};
  MONTHS.forEach((_, i) => {
    obj[i] = {
      monthIdx:i,
      cashIn:Math.round((4200+Math.sin(i*seed+1)*900+i*80*trend)*seed),
      cashOut:Math.round((3100+Math.cos(i*seed+2)*700+i*40*trend)*seed),
      revenue:Math.round((5100+Math.sin(i*seed+3)*800+i*100*trend)*seed),
      expense:Math.round((3400+Math.cos(i*seed+4)*600+i*50*trend)*seed),
      loanBalance:Math.round((15000-i*180*seed+500)*seed),
    };
  });
  return obj;
};

const INITIAL_STORE = {
  1:{2024:genSeed(1,1),2025:genSeed(1,1.15),2026:genSeed(1,1.28)},
  2:{2024:genSeed(0.6,0.9),2025:genSeed(0.6,1.05),2026:genSeed(0.6,1.2)},
  3:{2024:genSeed(1.4,1.1),2025:genSeed(1.4,1.2),2026:genSeed(1.4,1.35)},
  4:{2024:genSeed(0.9,1.05),2025:genSeed(0.9,1.18),2026:genSeed(0.9,1.3)},
  5:{2024:genSeed(1.2,0.95),2025:genSeed(1.2,1.1),2026:genSeed(1.2,1.22)},
};
const STORAGE_KEY = "finanalytics.store.v1";

const loadStoredData = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return INITIAL_STORE;
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : INITIAL_STORE;
  } catch (error) {
    console.warn("Could not load saved financial data:", error);
    return INITIAL_STORE;
  }
};

const DEFAULT_COMPANIES = [
  { id:1, nameTh:"บริษัท อัลฟา จำกัด", nameEn:"Alpha Co., Ltd.", currency:"THB", type:"parent", industry:"retail", groupId:"alpha", companyMode:"private", legalEntityType:"limited_company" },
  { id:2, nameTh:"บริษัท เบต้า จำกัด", nameEn:"Beta Co., Ltd.", currency:"USD", type:"subsidiary", industry:"retail", groupId:"alpha", companyMode:"private", legalEntityType:"limited_company" },
  { id:3, nameTh:"บริษัท แกมมา จำกัด", nameEn:"Gamma Co., Ltd.", currency:"THB", type:"subsidiary", industry:"manufacturing", groupId:"alpha", companyMode:"private", legalEntityType:"limited_company" },
  { id:4, nameTh:"บริษัท เดลต้า จำกัด", nameEn:"Delta Co., Ltd.", currency:"THB", type:"parent", industry:"tech", groupId:"delta", companyMode:"private", legalEntityType:"limited_company" },
  { id:5, nameTh:"บริษัท เอปไซลอน จำกัด", nameEn:"Epsilon Co., Ltd.", currency:"THB", type:"subsidiary", industry:"service", groupId:"delta", companyMode:"private", legalEntityType:"limited_company" },
];
let COMPANIES = DEFAULT_COMPANIES;
const GROUPS = { alpha:{th:"เครืออัลฟา",en:"Alpha Group"}, delta:{th:"เครือเดลต้า",en:"Delta Group"} };

// HELPERS
const fmt = (n, cur="THB", compact=true) => {
  if (n===null||n===undefined||isNaN(n)) return "N/A";
  const sym = cur==="THB"?"฿":cur==="USD"?"$":"€";
  if (compact) {
    if (Math.abs(n)>=1e6) return `${sym}${(n/1e6).toFixed(2)}M`;
    if (Math.abs(n)>=1e3) return `${sym}${(n/1e3).toFixed(1)}K`;
  }
  return `${sym}${Math.round(n).toLocaleString()}`;
};
const fmtPct = (n) => n===null||isNaN(n) ? "N/A" : `${n>=0?"+":""}${n.toFixed(1)}%`;

// ═══════════════════════════════════════════════════════════
// UI PRIMITIVES (theme-aware)
// ═══════════════════════════════════════════════════════════
function Card({children, style={}, ...props}) {
  const C = useC();
  return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:22,...style}} {...props}>{children}</div>;
}
function Badge({children, color}) {
  const C = useC();
  const c = color || C.accent;
  return <span style={{display:"inline-flex",alignItems:"center",padding:"3px 11px",borderRadius:20,fontSize:12,fontWeight:700,background:c+"22",color:c}}>{children}</span>;
}
function Tip({active,payload,label,currency="THB"}) {
  const C = useC();
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",fontSize:13,boxShadow:"0 8px 24px #00000040"}}>
      <div style={{fontWeight:700,marginBottom:6,color:C.text}}>{label}</div>
      {payload.map((p,i)=>(<div key={i} style={{color:p.color,marginBottom:2}}>{p.name}: <b>{fmt(p.value,currency)}</b></div>))}
    </div>
  );
}

function MetricPill({label, value, formula, forceColor}) {
  const C = useC();
  const [hover, setHover] = useState(false);
  const clr = forceColor || (value===null||isNaN(value)?C.muted:value>0?C.green:value===0?C.muted:C.red);
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} style={{position:"relative",display:"inline-block"}}>
      <div style={{padding:"6px 13px",borderRadius:8,background:clr+"18",border:`1px solid ${clr}40`,fontSize:13,fontWeight:700,color:clr,whiteSpace:"nowrap"}}>
        <span style={{color:C.muted,fontWeight:500,marginRight:4}}>{label}</span>{fmtPct(value)}
      </div>
      {hover && (
        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:99,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.muted,whiteSpace:"nowrap",boxShadow:"0 8px 24px #00000060"}}>
          <div style={{color:C.text,fontWeight:700,marginBottom:4}}>สูตร / Formula</div>
          <div style={{fontFamily:"monospace",color:C.amber}}>{formula}</div>
        </div>
      )}
    </div>
  );
}


function SegmentedToggle({ options, value, onChange, compact=false, style={} }) {
  const C = useC();
  return (
    <div style={{display:"inline-flex",alignItems:"center",gap:3,padding:3,borderRadius:999,background:C.surface,border:`1px solid ${C.border}`,...style}}>
      {options.map((option)=>{
        const active = value === option.value;
        return (
          <button key={option.value} type="button" onClick={()=>onChange(option.value)}
            style={{border:"none",borderRadius:999,padding:compact?"6px 10px":"8px 14px",background:active?C.accent:"transparent",color:active?"#fff":C.muted,fontSize:compact?12:13,fontWeight:800,cursor:"pointer",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:6,boxShadow:active?"0 8px 20px #00000022":"none"}}>
            {option.icon && <span>{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// PAGE HEADER (bigger, bolder)
function PageHeader({title, subtitle}) {
  const C = useC();
  return (
    <div style={{marginBottom:24}}>
      <div style={{fontSize:28,fontWeight:800,color:C.white,marginBottom:6,letterSpacing:"-0.01em"}}>{title}</div>
      {subtitle && <div style={{fontSize:15,color:C.muted,fontWeight:500}}>{subtitle}</div>}
    </div>
  );
}

const FILTERS = [
  {id:"MOM", label:"MOM", color:"accent", formula:"(M₁ - M₀) / |M₀| × 100"},
  {id:"QOQ", label:"QOQ", color:"accent", formula:"(Q₁ - Q₀) / |Q₀| × 100"},
  {id:"YOY", label:"YOY", color:"accent", formula:"(Y₁ - Y₀) / |Y₀| × 100"},
  {id:"MTD", label:"MTD", color:"green", formula:"Σ (1st → today)"},
  {id:"YTD", label:"YTD", color:"green", formula:"Σ (Jan → today)"},
  {id:"LTM", label:"LTM/TTM", color:"purple", formula:"Σ (last 12 months)"},
  {id:"CAGR",label:"CAGR", color:"purple", formula:"(End/Start)^(1/n) - 1"},
];

function FilterBar({active, onChange}) {
  const C = useC();
  return (
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20,alignItems:"center"}}>
      <span style={{fontSize:12,color:C.muted,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>Analysis</span>
      {FILTERS.map(f=>{
        const col = C[f.color];
        return (
          <button key={f.id} onClick={()=>onChange(f.id)} title={f.formula}
            style={{padding:"6px 16px",borderRadius:20,border:`1px solid ${active===f.id?col:C.border}`,
              background:active===f.id?col+"22":"transparent",color:active===f.id?col:C.muted,fontSize:13,fontWeight:700,cursor:"pointer"}}>{f.label}</button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// UPLOAD PAGE
// ═══════════════════════════════════════════════════════════
function UploadPage({store, onUpsert, lang, defaultCompany, defaultYear}) {
  const C = useC();
  const th = lang==="th";
  const [targetCompany, setTargetCompany] = useState(defaultCompany);
  const [targetYear, setTargetYear] = useState(defaultYear);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const inputRef = useRef();
  const company = COMPANIES.find(c=>c.id===targetCompany);
  const existingMonths = DataEngine.countMonths(store, targetCompany, targetYear);
  const canEdit = !isSupabaseConfigured || ["owner","admin","editor"].includes(company?.role);

  const handleFile = (file) => {
    if (!file) return;
    if (!canEdit) {
      setStatus({type:"error", msg:th?"บัญชีนี้มีสิทธิ์ดูข้อมูลเท่านั้น":"This account has view-only access"});
      return;
    }
    if (file.name.split(".").pop().toLowerCase()!=="csv") {
      setStatus({type:"error", msg:th?"กรุณาแปลงเป็น CSV ก่อน (Excel → Save as CSV)":"Please convert to CSV first"});
      return;
    }
    setStatus({type:"loading", msg:th?"กำลังอ่านไฟล์...":"Reading..."});
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const normalized = normalizeFinancialCSV(e.target.result, lang);
        if (!normalized.length) { setStatus({type:"error",msg:th?"ไฟล์ว่างเปล่า":"Empty file"}); return; }
        setPreview(normalized);
        const result = await onUpsert(targetCompany, targetYear, normalized);
        setStatus({type:"success", msg:`✓ ${th?"สำเร็จ":"Done"} — ${th?"เพิ่ม":"Added"} ${result.added}, ${th?"อัปเดต":"Updated"} ${result.updated} ${th?"เดือน":"mo"}`});
      } catch(err) { setStatus({type:"error", msg:err.message}); }
    };
    reader.readAsText(file);
  };

  const selStyle = {width:"100%",background:C.surface,border:`1px solid ${C.border}`,color:C.text,padding:"10px 12px",borderRadius:8,fontSize:14,cursor:"pointer",outline:"none"};

  return (
    <div>
      <PageHeader title={th?"อัปโหลดงบการเงิน":"Upload Financial Statements"} subtitle={th?"เลือกบริษัทและปีก่อน แล้วระบบจะรวมข้อมูลเข้ากับของเดิมอัตโนมัติ":"Select company & year — data merges automatically"}/>

      <Card style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:700,color:C.muted,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>{th?"ขั้นที่ 1 — เลือกปลายทางข้อมูล":"Step 1 — Select destination"}</div>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:12,color:C.muted,marginBottom:6,fontWeight:600}}>{th?"บริษัท":"Company"}</div>
            <select value={targetCompany} onChange={e=>setTargetCompany(Number(e.target.value))} style={selStyle}>
              {COMPANIES.map(c=>(<option key={c.id} value={c.id}>{th?c.nameTh:c.nameEn} ({c.currency})</option>))}
            </select>
          </div>
          <div style={{width:150}}>
            <div style={{fontSize:12,color:C.muted,marginBottom:6,fontWeight:600}}>{th?"ปี":"Year"}</div>
            <select value={targetYear} onChange={e=>setTargetYear(Number(e.target.value))} style={selStyle}>
              {[2023,2024,2025,2026].map(y=>(<option key={y} value={y}>{y} (พ.ศ.{y+543})</option>))}
            </select>
          </div>
        </div>
        <div style={{marginTop:14,padding:"10px 14px",borderRadius:8,background:existingMonths>0?C.amberLo:C.greenLo,border:`1px solid ${existingMonths>0?C.amber:C.green}40`,fontSize:13,fontWeight:600,color:existingMonths>0?C.amber:C.green}}>
          {existingMonths>0 ? (th?`⚠ มีข้อมูลอยู่แล้ว ${existingMonths} เดือน — เดือนที่ซ้ำจะถูกอัปเดตทับ`:`⚠ ${existingMonths} months exist — duplicates will update`) : (th?`✓ ยังไม่มีข้อมูล — พร้อมรับข้อมูลใหม่`:`✓ No existing data — ready`)}
        </div>
      </Card>

      <Card style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:700,color:C.muted,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>{th?"ขั้นที่ 2 — อัปโหลดไฟล์":"Step 2 — Upload file"}</div>
        <div style={{border:`2px dashed ${dragging?C.accent:C.border}`,borderRadius:12,padding:32,textAlign:"center",cursor:canEdit?"pointer":"not-allowed",background:dragging?C.accentLo:"transparent",opacity:canEdit?1:0.55}}
          onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
          onDrop={e=>{e.preventDefault();setDragging(false);handleFile(e.dataTransfer.files[0]);}} onClick={()=>inputRef.current.click()}>
          <input ref={inputRef} type="file" accept=".csv" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
          <div style={{fontSize:30,marginBottom:10}}>📊</div>
          <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>{th?`ลากไฟล์ CSV → ${company.nameTh} ปี ${targetYear}`:`Drop CSV → ${company.nameEn} ${targetYear}`}</div>
          <div style={{fontSize:13,color:C.muted}}>{th?"รองรับ CSV (Excel แปลงเป็น CSV ก่อน)":"CSV only"}</div>
        </div>
        {status && (
          <div style={{marginTop:12,padding:"11px 14px",borderRadius:8,fontSize:14,fontWeight:600,
            background:status.type==="error"?C.redLo:status.type==="success"?C.greenLo:C.accentLo,
            color:status.type==="error"?C.red:status.type==="success"?C.green:C.accent,
            border:`1px solid ${status.type==="error"?C.red:status.type==="success"?C.green:C.accent}40`}}>{status.msg}</div>
        )}
      </Card>

      <Card>
        <div style={{fontSize:13,fontWeight:700,color:C.muted,marginBottom:10}}>{th?"รูปแบบ CSV ที่รองรับ:":"Supported CSV format:"}</div>
        <code style={{fontSize:12,color:C.amber,fontFamily:"monospace",lineHeight:1.8,display:"block",background:C.surface,padding:"14px",borderRadius:8,border:`1px solid ${C.border}`}}>
          month,revenue,expense,cashin,cashout,loanbalance<br/>1,5100000,3400000,4200000,3100000,15000000<br/>2,5380000,3520000,4450000,3200000,14820000
        </code>
        <div style={{fontSize:12,color:C.muted,marginTop:10}}>{th?"※ month = เลขเดือน 1-12 · รองรับหัวคอลัมน์ภาษาไทย":"※ month = 1-12 · Thai headers supported"}</div>
        {preview && (
          <div style={{marginTop:14}}>
            <div style={{fontSize:12,color:C.muted,marginBottom:6,fontWeight:600}}>{th?"ข้อมูลที่อัปโหลด:":"Uploaded:"}</div>
            <div style={{maxHeight:140,overflowY:"auto"}}>
              {preview.map((r,i)=>(
                <div key={i} style={{fontSize:12,color:C.text,padding:"6px 10px",background:C.surface,borderRadius:6,marginBottom:3,display:"flex",gap:14,flexWrap:"wrap"}}>
                  <span style={{color:C.accent,fontWeight:700}}>{MONTHS[r.monthIdx][th?"th":"en"]}</span>
                  <span style={{color:C.green}}>Rev {fmt(r.revenue,company.currency)}</span>
                  <span style={{color:C.red}}>Exp {fmt(r.expense,company.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MOMENTUM DASHBOARD
// ═══════════════════════════════════════════════════════════
// MomentumDashboard is now imported from src/components/Dashboard.jsx

// ═══════════════════════════════════════════════════════════
// DATA TABLE
// ═══════════════════════════════════════════════════════════
function DataManagerPage({store, companyId, year, lang}) {
  const C = useC();
  const th = lang==="th";
  const company = COMPANIES.find(c=>c.id===companyId);
  const years = DataEngine.getAvailableYears(store, companyId);
  const displayYear = DataEngine.getDisplayYear(store, companyId, year);
  const data = DataEngine.getYearData(store, companyId, displayYear);
  const annualRows = DataEngine.getAnnualRows(store, companyId);
  const hasAnnualData = annualRows.length > 0;
  const isYearFallback = years.length > 0 && Number(year) !== Number(displayYear);
  const selectedMetrics = DataEngine.getAnnualMetrics(store, companyId, displayYear);

  const MetricCard = ({label, value, color}) => (
    <Card style={{padding:16}}>
      <div style={{fontSize:12,color:C.muted,fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.04em"}}>{label}</div>
      <div style={{fontSize:19,fontWeight:900,color:color||C.text}}>{fmt(value, company.currency, true)}</div>
    </Card>
  );

  if (hasAnnualData) {
    const annualColumns = [
      { key: 'year', th: 'ปี', en: 'Year', align: 'left' },
      { key: 'revenue', th: 'รายได้', en: 'Revenue', color: C.green },
      { key: 'expense', th: 'ค่าใช้จ่าย', en: 'Expense', color: C.red },
      { key: 'netProfit', th: 'กำไรสุทธิ', en: 'Net Profit', color: C.accent },
      { key: 'cash', th: 'เงินสด', en: 'Cash', color: C.text },
      { key: 'asset', th: 'สินทรัพย์', en: 'Assets', color: C.blue },
      { key: 'liability', th: 'หนี้สิน', en: 'Liabilities', color: C.amber },
      { key: 'equity', th: 'ส่วนทุน', en: 'Equity', color: C.purple },
      { key: 'operatingCashFlow', th: 'CFO', en: 'CFO', color: C.green },
      { key: 'investingCashFlow', th: 'CFI', en: 'CFI', color: C.text },
      { key: 'financingCashFlow', th: 'CFF', en: 'CFF', color: C.text },
    ];

    return (
      <div>
        <PageHeader
          title={th?"ตารางข้อมูล":"Data Table"}
          subtitle={`${th?company.nameTh:company.nameEn} · ${company.currency} · ${th?"ปีที่มีข้อมูล:":"Years:"} ${years.join(", ")||"-"}`}
        />

        {isYearFallback && (
          <div style={{marginBottom:14,padding:"11px 14px",borderRadius:8,background:C.amberLo,border:`1px solid ${C.amber}40`,color:C.amber,fontSize:13,fontWeight:700}}>
            {th
              ? `ปี ${year} ยังไม่มีข้อมูลงบการเงิน จึงแสดงปีล่าสุดที่มีข้อมูลคือ ${displayYear}`
              : `FY ${year} has no statement data, showing latest available year ${displayYear}.`}
          </div>
        )}

        <div className="responsive-grid-4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14}}>
          <MetricCard label={th?`รายได้ FY${displayYear}`:`Revenue FY${displayYear}`} value={selectedMetrics.revenue} color={C.green}/>
          <MetricCard label={th?`กำไรสุทธิ FY${displayYear}`:`Net Profit FY${displayYear}`} value={selectedMetrics.netProfit} color={selectedMetrics.netProfit >= 0 ? C.accent : C.red}/>
          <MetricCard label={th?`สินทรัพย์รวม FY${displayYear}`:`Total Assets FY${displayYear}`} value={selectedMetrics.asset}/>
          <MetricCard label={th?`CFO FY${displayYear}`:`CFO FY${displayYear}`} value={selectedMetrics.operatingCashFlow} color={selectedMetrics.operatingCashFlow >= 0 ? C.green : C.red}/>
        </div>

        <Card style={{padding:0,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
            <div style={{fontSize:15,fontWeight:900,color:C.text}}>{th?"งบการเงินรายปี":"Annual Financial Statement View"}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:4}}>
              {th
                ? "ข้อมูลนี้มาจาก normalized_financial_data ที่ import จาก Excel งบการเงินจริง ไม่ใช่ข้อมูลรายเดือน"
                : "This view is built from normalized_financial_data imported from annual financial statements, not monthly management accounts."}
            </div>
          </div>
          <div style={{overflowX:"auto"}}>
            <div style={{minWidth:1080}}>
              <div style={{display:"grid",gridTemplateColumns:"0.7fr repeat(10,1fr)",padding:"14px 18px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
                {annualColumns.map((col)=>(
                  <div key={col.key} style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:"0.04em",textAlign:col.align || 'right'}}>{th?col.th:col.en}</div>
                ))}
              </div>
              {annualRows.map((row,idx)=>(
                <div key={row.year} style={{display:"grid",gridTemplateColumns:"0.7fr repeat(10,1fr)",padding:"12px 18px",borderBottom:idx<annualRows.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:Number(row.year)===Number(displayYear)?C.accentLo:"transparent"}}>
                  {annualColumns.map((col)=> col.key === 'year' ? (
                    <div key={col.key} style={{fontSize:13,fontWeight:900,color:C.text,textAlign:'left'}}>FY {row.year}</div>
                  ) : (
                    <div key={col.key} style={{fontSize:13,color:col.color||C.text,textAlign:'right',fontWeight:700}}>{fmt(row[col.key], company.currency, true)}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
            <div style={{fontSize:15,fontWeight:900,color:C.text}}>{th?"มุมมองรายเดือน":"Monthly Operating View"}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:4}}>
              {th
                ? "งบการเงิน SET เป็นข้อมูลรายปี จึงแสดงค่าไว้ที่แถว FY เท่านั้น เดือน ม.ค.–ธ.ค. จะยังไม่มีตัวเลขจนกว่าจะอัปโหลด management account รายเดือน"
                : "SET financial statements are annual. Values are shown in the FY row only; monthly rows remain empty until monthly management accounts are uploaded."}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"0.8fr 1fr 1fr 1fr 1fr 1fr",padding:"14px 18px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
            {[th?"เดือน":"Month",th?"รายได้":"Revenue",th?"ค่าใช้จ่าย":"Expense",th?"เงินสดเข้า":"Cash In",th?"เงินสดออก":"Cash Out",th?"เงินกู้":"Loan"].map((h,i)=>(
              <div key={i} style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.04em"}}>{h}</div>
            ))}
          </div>
          {data.map((d,i)=>{
            const empty = d.revenue===0&&d.expense===0&&d.cashIn===0&&d.cashOut===0&&d.loanBalance===0;
            return (
              <div key={i} style={{display:"grid",gridTemplateColumns:"0.8fr 1fr 1fr 1fr 1fr 1fr",padding:"11px 18px",borderBottom:i<11?`1px solid ${C.border}`:"none",alignItems:"center",opacity:empty?0.35:1,background:i===0?C.overlay2:"transparent"}}>
                <div style={{fontSize:13,fontWeight:900,color:C.text}}>{d.monthTh || MONTHS[i]?.[th?"th":"en"] || d.monthEn || "-"}</div>
                <div style={{fontSize:13,color:C.green}}>{fmt(d.revenue,company.currency)}</div>
                <div style={{fontSize:13,color:C.red}}>{fmt(d.expense,company.currency)}</div>
                <div style={{fontSize:13,color:C.text}}>{fmt(d.cashIn,company.currency)}</div>
                <div style={{fontSize:13,color:C.text}}>{fmt(d.cashOut,company.currency)}</div>
                <div style={{fontSize:13,color:C.amber}}>{fmt(d.loanBalance,company.currency)}</div>
              </div>
            );
          })}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={th?"ตารางข้อมูล":"Data Table"} subtitle={`${th?company.nameTh:company.nameEn} · ${company.currency} · ${th?"ปีที่มีข้อมูล:":"Years:"} ${years.join(", ")||"-"}`}/>
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"0.8fr 1fr 1fr 1fr 1fr 1fr",padding:"14px 18px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
          {[th?"เดือน":"Month",th?"รายได้":"Revenue",th?"ค่าใช้จ่าย":"Expense",th?"เงินสดเข้า":"Cash In",th?"เงินสดออก":"Cash Out",th?"เงินกู้":"Loan"].map((h,i)=>(
            <div key={i} style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.04em"}}>{h}</div>
          ))}
        </div>
        {data.map((d,i)=>{
          const empty = d.revenue===0&&d.expense===0&&d.cashIn===0;
          return (
            <div key={i} style={{display:"grid",gridTemplateColumns:"0.8fr 1fr 1fr 1fr 1fr 1fr",padding:"11px 18px",borderBottom:i<11?`1px solid ${C.border}`:"none",alignItems:"center",opacity:empty?0.35:1}}>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{d.monthTh || MONTHS[i]?.[th?"th":"en"] || d.monthEn || "-"}</div>
              <div style={{fontSize:13,color:C.green}}>{fmt(d.revenue,company.currency)}</div>
              <div style={{fontSize:13,color:C.red}}>{fmt(d.expense,company.currency)}</div>
              <div style={{fontSize:13,color:C.text}}>{fmt(d.cashIn,company.currency)}</div>
              <div style={{fontSize:13,color:C.text}}>{fmt(d.cashOut,company.currency)}</div>
              <div style={{fontSize:13,color:C.amber}}>{fmt(d.loanBalance,company.currency)}</div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COMPANIES PAGE — group by industry + group structure + compare
// ═══════════════════════════════════════════════════════════
function CompaniesPage({store, year, lang, onSelect, onCompare}) {
  const C = useC();
  const th = lang==="th";
  const [groupBy, setGroupBy] = useState("industry"); // industry | group
  const [compareList, setCompareList] = useState([]);

  const toggleCompare = (id) => {
    setCompareList(prev => prev.includes(id) ? prev.filter(x=>x!==id) : prev.length<3 ? [...prev,id] : prev);
  };

  // Group companies
  const grouped = useMemo(()=>{
    const map = {};
    COMPANIES.forEach(c=>{
      const key = groupBy==="industry" ? c.industry : c.groupId;
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  },[groupBy]);

  const getMeta = (key) => groupBy==="industry"
    ? {...INDUSTRIES[key], color:INDUSTRIES[key].color}
    : {th:GROUPS[key].th, en:GROUPS[key].en, icon:"🔗", color:C.accent};

  const CompanyCard = ({c}) => {
    const years = DataEngine.getAvailableYears(store, c.id);
    const months = DataEngine.countMonths(store, c.id, year);
    const rev = DataEngine.yearTotal(store, c.id, year, "revenue");
    const inCompare = compareList.includes(c.id);
    const ind = INDUSTRIES[c.industry];
    return (
      <Card style={{borderTop:`3px solid ${c.type==="parent"?C.accent:C.green}`,position:"relative"}}>
        {/* compare checkbox */}
        <div onClick={(e)=>{e.stopPropagation();toggleCompare(c.id);}}
          style={{position:"absolute",top:14,right:14,width:24,height:24,borderRadius:6,cursor:"pointer",
            border:`2px solid ${inCompare?C.accent:C.border}`,background:inCompare?C.accent:"transparent",
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:C.white,fontWeight:700}}>
          {inCompare?"✓":""}
        </div>
        <div onClick={()=>onSelect(c.id)} style={{cursor:"pointer"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingRight:32}}>
            <div style={{width:38,height:38,borderRadius:10,background:c.type==="parent"?C.accent:C.green,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:"#fff"}}>{c.nameEn[0]}</div>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:C.white}}>{th?c.nameTh:c.nameEn}</div>
              <div style={{fontSize:12,color:C.muted}}>{th?c.nameEn:c.nameTh}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
            <Badge color={c.type==="parent"?C.accent:C.green}>{c.type==="parent"?(th?"บริษัทแม่":"Parent"):(th?"บริษัทย่อย":"Subsidiary")}</Badge>
            <Badge color={ind.color}>{ind.icon} {th?ind.th:ind.en}</Badge>
            <Badge color={C.amber}>{c.currency}</Badge>
          </div>
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:13,color:C.muted}}>{th?`รายได้ปี ${year}`:`${year} Revenue`}</span>
              <span style={{fontSize:13,color:C.text,fontWeight:700}}>{fmt(rev,c.currency)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:13,color:C.muted}}>{th?"ข้อมูล":"Coverage"}</span>
              <span style={{fontSize:13,fontWeight:700,color:months===12?C.green:months>0?C.amber:C.red}}>{months}/12 {th?"เดือน":"mo"}</span>
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const segBtn = (active) => ({padding:"8px 16px",borderRadius:8,border:"none",fontSize:13,fontWeight:700,cursor:"pointer",background:active?C.accent:C.card,color:active?"#fff":C.muted});

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,color:C.white,marginBottom:6}}>{th?"จัดการบริษัท":"Company Management"}</div>
          <div style={{fontSize:15,color:C.muted,fontWeight:500}}>{th?"แยกตามอุตสาหกรรมหรือเครือบริษัท เลือกได้สูงสุด 3 บริษัทเพื่อเปรียบเทียบ":"Group by industry or holding group · select up to 3 to compare"}</div>
        </div>
        {compareList.length>=2 && (
          <button onClick={()=>onCompare(compareList)} style={{padding:"10px 20px",borderRadius:8,background:C.accent,color:"#fff",border:"none",fontSize:14,fontWeight:700,cursor:"pointer"}}>
            ⚖ {th?`เปรียบเทียบ ${compareList.length} บริษัท`:`Compare ${compareList.length}`}
          </button>
        )}
      </div>

      {/* Group toggle */}
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        <button onClick={()=>setGroupBy("industry")} style={segBtn(groupBy==="industry")}>🏭 {th?"ตามอุตสาหกรรม":"By Industry"}</button>
        <button onClick={()=>setGroupBy("group")} style={segBtn(groupBy==="group")}>🔗 {th?"ตามเครือบริษัท":"By Group"}</button>
      </div>

      {Object.entries(grouped).map(([key, comps])=>{
        const meta = getMeta(key);
        const totalRev = comps.reduce((s,c)=>s+DataEngine.yearTotal(store,c.id,year,"revenue"),0);
        return (
          <div key={key} style={{marginBottom:28}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <span style={{fontSize:20}}>{meta.icon}</span>
              <span style={{fontSize:18,fontWeight:800,color:C.white}}>{th?meta.th:meta.en}</span>
              <Badge color={meta.color}>{comps.length} {th?"บริษัท":"cos"}</Badge>
              <span style={{marginLeft:"auto",fontSize:14,color:C.muted}}>{th?"รายได้รวม":"Total"}: <b style={{color:C.text}}>{fmt(totalRev,"THB")}</b></span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
              {comps.map(c=>(<CompanyCard key={c.id} c={c}/>))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COMPARE PAGE — เปรียบเทียบหลายบริษัท
// ═══════════════════════════════════════════════════════════
function ComparePage({store, companyIds, year, lang, onBack}) {
  const C = useC();
  const th = lang==="th";
  const comps = companyIds.map(id=>COMPANIES.find(c=>c.id===id)).filter(Boolean);
  const COLORS = [C.accent, C.green, C.amber];

  const chartData = MONTHS.map((m,i)=>{
    const row = {month:th?m.th:m.en};
    comps.forEach(c=>{ row[`c${c.id}`] = DataEngine.getYearData(store,c.id,year)[i].revenue; });
    return row;
  });

  const summary = comps.map(c=>{
    const d = DataEngine.getYearData(store,c.id,year);
    const p = DataEngine.getYearData(store,c.id,year-1);
    const ytd = FinanceMath.YTD(d,"revenue");
    return {
      company:c, ytdRev:ytd,
      ytdProfit:FinanceMath.YTD(d,"revenue")-FinanceMath.YTD(d,"expense"),
      margin:ytd?((FinanceMath.YTD(d,"revenue")-FinanceMath.YTD(d,"expense"))/ytd*100):0,
      cagr:FinanceMath.CAGR(FinanceMath.YTD(p,"revenue"),ytd,1),
      ltm:FinanceMath.LTM(d,"revenue"),
    };
  });

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
        <button onClick={onBack} style={{padding:"8px 14px",borderRadius:8,background:C.card,border:`1px solid ${C.border}`,color:C.text,fontSize:14,fontWeight:600,cursor:"pointer"}}>← {th?"กลับ":"Back"}</button>
        <div>
          <div style={{fontSize:28,fontWeight:800,color:C.white}}>{th?"เปรียบเทียบบริษัท":"Company Comparison"}</div>
          <div style={{fontSize:14,color:C.muted}}>{comps.map(c=>th?c.nameTh:c.nameEn).join(" · ")} · {th?"ปี":"FY"}{year}</div>
        </div>
      </div>

      {/* Revenue comparison chart */}
      <Card style={{marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:700,color:C.white,marginBottom:16}}>{th?"เปรียบเทียบรายได้รายเดือน":"Monthly Revenue Comparison"}</div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{top:4,right:4,left:0,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
            <XAxis dataKey="month" tick={{fontSize:11,fill:C.muted}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:11,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1e3).toFixed(0)}K`}/>
            <Tooltip content={<Tip currency="THB"/>}/>
            {comps.map((c,i)=>(<Line key={c.id} type="monotone" dataKey={`c${c.id}`} name={th?c.nameTh:c.nameEn} stroke={COLORS[i]} strokeWidth={2.5} dot={false}/>))}
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Comparison table */}
      <Card>
        <div style={{fontSize:15,fontWeight:700,color:C.white,marginBottom:16}}>{th?"ตารางเปรียบเทียบตัวชี้วัด":"Metrics Comparison"}</div>
        <div style={{overflowX:"auto"}}>
          <div style={{display:"grid",gridTemplateColumns:`1.4fr repeat(${comps.length},1fr)`,gap:12,minWidth:400}}>
            <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>{th?"ตัวชี้วัด":"Metric"}</div>
            {summary.map((s,i)=>(
              <div key={i} style={{fontSize:13,fontWeight:800,color:COLORS[i],paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>{th?s.company.nameTh:s.company.nameEn}</div>
            ))}
            {[
              {label:th?"รายได้ YTD":"YTD Revenue", get:s=>fmt(s.ytdRev,s.company.currency)},
              {label:th?"กำไร YTD":"YTD Profit", get:s=>fmt(s.ytdProfit,s.company.currency)},
              {label:th?"Margin %":"Margin %", get:s=>`${s.margin.toFixed(1)}%`},
              {label:"CAGR", get:s=>fmtPct(s.cagr)},
              {label:"LTM Revenue", get:s=>fmt(s.ltm,s.company.currency)},
            ].map((row,ri)=>(
              <Fragment key={ri}>
                <div style={{fontSize:13,color:C.muted,fontWeight:600,padding:"10px 0"}}>{row.label}</div>
                {summary.map((s,i)=>(<div key={i} style={{fontSize:14,fontWeight:700,color:C.text,padding:"10px 0"}}>{row.get(s)}</div>))}
              </Fragment>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CONSOLIDATION
// ═══════════════════════════════════════════════════════════
function ConsolidationPage({store, year, lang, exchangeRates, onSaveRate}) {
  const C = useC();
  const th = lang==="th";
  const [scope, setScope] = useState("all"); // all | group | industry key
  const [rateDraft, setRateDraft] = useState(exchangeRates.USD || "");
  const [rateStatus, setRateStatus] = useState("");

  const filteredCompanies = useMemo(()=>{
    if (scope==="all") return COMPANIES;
    if (scope.startsWith("grp:")) return COMPANIES.filter(c=>c.groupId===scope.slice(4));
    if (scope.startsWith("ind:")) return COMPANIES.filter(c=>c.industry===scope.slice(4));
    return COMPANIES;
  },[scope]);

  const consolidated = useMemo(()=>{
    return MONTHS.map((m,i)=>{
      let rev=0,exp=0,cin=0,cout=0;
      filteredCompanies.forEach(c=>{
        const d=DataEngine.getYearData(store,c.id,year)[i];
        const values = [d.revenue,d.expense,d.cashIn,d.cashOut].map(value=>convertToTHB(value,c.currency,exchangeRates));
        if (values.some(value=>value===null)) return;
        rev+=values[0];exp+=values[1];cin+=values[2];cout+=values[3];
      });
      return {month:th?m.th:m.en, revenue:rev, expense:exp, cashIn:cin, cashOut:cout};
    });
  },[store,year,th,filteredCompanies,exchangeRates]);

  const total = consolidated.reduce((a,d)=>({rev:a.rev+d.revenue,exp:a.exp+d.expense,cin:a.cin+d.cashIn}),{rev:0,exp:0,cin:0});
  const missingCurrencies = [...new Set(filteredCompanies.map(c=>c.currency).filter(currency=>currency!=="THB"&&!exchangeRates[currency]))];
  const selStyle = {background:C.card,border:`1px solid ${C.border}`,color:C.text,padding:"9px 14px",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",outline:"none"};
  const handleRateSave = async () => {
    try {
      const rate = Number(rateDraft);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error(th?"กรุณากรอกอัตราที่มากกว่า 0":"Enter a rate greater than 0");
      await onSaveRate("USD", rate);
      setRateStatus(th?"บันทึกอัตราแล้ว":"Rate saved");
    } catch (error) { setRateStatus(error.message); }
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,color:C.white,marginBottom:6}}>{th?"งบการเงินรวม":"Consolidated Financials"}</div>
          <div style={{fontSize:15,color:C.muted,fontWeight:500}}>{th?"เลือกขอบเขตการรวมงบ":"Choose consolidation scope"} · {th?"ปี":"FY"}{year}</div>
        </div>
        <select value={scope} onChange={e=>setScope(e.target.value)} style={selStyle}>
          <option value="all">{th?"ทุกบริษัท":"All Companies"}</option>
          <optgroup label={th?"ตามเครือ":"By Group"}>
            {Object.entries(GROUPS).map(([k,g])=>(<option key={k} value={`grp:${k}`}>{th?g.th:g.en}</option>))}
          </optgroup>
          <optgroup label={th?"ตามอุตสาหกรรม":"By Industry"}>
            {Object.entries(INDUSTRIES).filter(([k])=>COMPANIES.some(c=>c.industry===k)).map(([k,ind])=>(<option key={k} value={`ind:${k}`}>{ind.icon} {th?ind.th:ind.en}</option>))}
          </optgroup>
        </select>
      </div>
      <Card style={{marginBottom:16,padding:14}}>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <Badge color={missingCurrencies.length?C.red:C.green}>{missingCurrencies.length?(th?"ขาดอัตราแลกเปลี่ยน":"Missing FX"):(th?"แปลงเป็น THB แล้ว":"Converted to THB")}</Badge>
          <span style={{fontSize:13,color:C.muted}}>USD → THB</span>
          <input value={rateDraft} onChange={e=>setRateDraft(e.target.value)} inputMode="decimal" placeholder="36.50"
            style={{...selStyle,width:110}}/>
          <button onClick={handleRateSave} style={{padding:"9px 15px",borderRadius:8,border:"none",background:C.accent,color:"#fff",fontWeight:700,cursor:"pointer"}}>{th?"บันทึกอัตรา":"Save rate"}</button>
          {rateStatus&&<span style={{fontSize:12,color:rateStatus.includes("บันทึก")||rateStatus.includes("saved")?C.green:C.red}}>{rateStatus}</span>}
        </div>
        {missingCurrencies.length>0&&<div style={{fontSize:12,color:C.red,marginTop:8}}>{th?`ยังไม่รวมบริษัทสกุล ${missingCurrencies.join(", ")} จนกว่าจะกำหนดอัตรา`:`${missingCurrencies.join(", ")} companies are excluded until a rate is set.`}</div>}
      </Card>

      <div className="responsive-grid-4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:16}}>
        {[
          {label:th?"รายได้รวม":"Total Revenue",val:total.rev,c:C.accent},
          {label:th?"ค่าใช้จ่ายรวม":"Total Expense",val:total.exp,c:C.red},
          {label:th?"เงินสดรับรวม":"Total Cash In",val:total.cin,c:C.green},
          {label:th?"กำไรรวม":"Total Profit",val:total.rev-total.exp,c:C.purple},
        ].map((k,i)=>(
          <Card key={i} style={{borderLeft:`4px solid ${k.c}`}}>
            <div style={{fontSize:12,color:C.muted,fontWeight:700,marginBottom:6,textTransform:"uppercase"}}>{k.label}</div>
            <div style={{fontSize:22,fontWeight:800,color:C.white}}>{fmt(k.val,"THB")}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div style={{fontSize:15,fontWeight:700,color:C.white,marginBottom:16}}>{th?"รายได้รวมรายเดือน":"Monthly Consolidated Revenue"}</div>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={consolidated} margin={{top:4,right:4,left:0,bottom:0}}>
            <defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.accent} stopOpacity={0.4}/><stop offset="95%" stopColor={C.accent} stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
            <XAxis dataKey="month" tick={{fontSize:11,fill:C.muted}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:11,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1e6).toFixed(1)}M`}/>
            <Tooltip content={<Tip currency="THB"/>}/>
            <Area type="monotone" dataKey="revenue" name={th?"รายได้รวม":"Revenue"} stroke={C.accent} fill="url(#gc)" strokeWidth={2.5}/>
            <Line type="monotone" dataKey="expense" name={th?"ค่าใช้จ่ายรวม":"Expense"} stroke={C.red} strokeWidth={2} strokeDasharray="4 2" dot={false}/>
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// INDUSTRY ANALYSIS — วิเคราะห์รายอุตสาหกรรม
// ═══════════════════════════════════════════════════════════
function IndustryPage({store, year, lang}) {
  const C = useC();
  const th = lang==="th";

  const industryStats = useMemo(()=>{
    return Object.entries(INDUSTRIES).filter(([k])=>COMPANIES.some(c=>c.industry===k)).map(([key,ind])=>{
      const comps = COMPANIES.filter(c=>c.industry===key);
      let rev=0, exp=0;
      comps.forEach(c=>{ rev+=DataEngine.yearTotal(store,c.id,year,"revenue"); exp+=DataEngine.yearTotal(store,c.id,year,"expense"); });
      return { key, ind, count:comps.length, revenue:rev, expense:exp, profit:rev-exp, margin:rev?((rev-exp)/rev*100):0 };
    });
  },[store,year]);

  const totalRev = industryStats.reduce((s,i)=>s+i.revenue,0);
  const barData = industryStats.map(s=>({name:th?s.ind.th:s.ind.en, revenue:s.revenue, profit:s.profit, color:s.ind.color}));
  const radarData = industryStats.map(s=>({industry:th?s.ind.th:s.ind.en, margin:Math.round(s.margin)}));

  return (
    <div>
      <PageHeader title={th?"วิเคราะห์รายอุตสาหกรรม":"Industry Analysis"} subtitle={th?"เปรียบเทียบผลประกอบการแต่ละกลุ่มอุตสาหกรรม":"Compare performance across industry sectors"}/>

      {/* Industry KPI cards */}
      <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(industryStats.length,4)},1fr)`,gap:14,marginBottom:16}}>
        {industryStats.map((s,i)=>(
          <Card key={i} style={{borderTop:`3px solid ${s.ind.color}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{fontSize:20}}>{s.ind.icon}</span>
              <span style={{fontSize:14,fontWeight:800,color:C.white}}>{th?s.ind.th:s.ind.en}</span>
            </div>
            <div style={{fontSize:22,fontWeight:800,color:C.white,marginBottom:6}}>{fmt(s.revenue,"THB")}</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:8}}>{s.count} {th?"บริษัท":"companies"} · {th?"ส่วนแบ่ง":"share"} {totalRev?((s.revenue/totalRev)*100).toFixed(0):0}%</div>
            <div style={{display:"flex",gap:6}}>
              <Badge color={s.margin>0?C.green:C.red}>{th?"Margin":"Margin"} {s.margin.toFixed(1)}%</Badge>
            </div>
          </Card>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:16}}>
        <Card>
          <div style={{fontSize:15,fontWeight:700,color:C.white,marginBottom:16}}>{th?"รายได้ vs กำไร รายอุตสาหกรรม":"Revenue vs Profit by Industry"}</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{top:4,right:4,left:0,bottom:0}} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="name" tick={{fontSize:11,fill:C.muted}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1e6).toFixed(0)}M`}/>
              <Tooltip content={<Tip currency="THB"/>}/>
              <Bar dataKey="revenue" name={th?"รายได้":"Revenue"} radius={[4,4,0,0]}>{barData.map((d,i)=>(<Cell key={i} fill={d.color}/>))}</Bar>
              <Bar dataKey="profit" name={th?"กำไร":"Profit"} radius={[4,4,0,0]} fill={C.muted} fillOpacity={0.5}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div style={{fontSize:15,fontWeight:700,color:C.white,marginBottom:16}}>{th?"เปรียบเทียบ Margin %":"Margin % Comparison"}</div>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid stroke={C.border}/>
              <PolarAngleAxis dataKey="industry" tick={{fontSize:11,fill:C.muted}}/>
              <PolarRadiusAxis tick={{fontSize:10,fill:C.muted}} stroke={C.border}/>
              <Radar name="Margin %" dataKey="margin" stroke={C.accent} fill={C.accent} fillOpacity={0.35}/>
              <Tooltip content={({active,payload})=>active&&payload?.length?(<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:13}}><span style={{color:C.accent}}>Margin: {payload[0]?.value}%</span></div>):null}/>
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SLIDE TEMPLATE
// ═══════════════════════════════════════════════════════════
function SlideViewer({store, companyId, year, lang, onImportSuccess, onGoUpload, theme}) {
  const C = useC();
  const th = lang==="th";
  const company = COMPANIES.find(c=>c.id===companyId) || COMPANIES[0];
  const cur = company?.currency || "THB";
  const displayYear = DataEngine.getDisplayYear(store, companyId, year);
  const data = DataEngine.getYearData(store, companyId, displayYear);
  const prev = DataEngine.getYearData(store, companyId, displayYear-1);
  const hasAnnual = DataEngine.hasNormalizedAnnualData(store, companyId, displayYear);
  const annualRows = DataEngine.getAnnualRows(store, companyId);
  const selectedAnnual = DataEngine.getAnnualMetrics(store, companyId, displayYear);
  const previousAnnual = annualRows.find(row => Number(row.year) === Number(displayYear)-1) || null;
  const hasData = DataEngine.countMonths(store, companyId, displayYear) > 0 || annualRows.length > 0;
  const SD = "#0F1528", ST = "#E4E8FF", SM = "#6B7299", SB = "#252A42";
  const [workspaceMode, setWorkspaceMode] = useState("input");
  const [sourceMode, setSourceMode] = useState("upload");
  const [activeSlide, setActiveSlide] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const latestIdx = useMemo(()=>{
    let idx = 0;
    data.forEach((row, rowIdx)=>{
      const hasValue = ["revenue","expense","cashIn","cashOut","loanBalance"].some(key => Math.abs(Number(row?.[key]) || 0) > 0);
      if (hasValue) idx = rowIdx;
    });
    return idx;
  },[data]);

  const monthlyMetrics = useMemo(()=>{
    const latest = data[latestIdx] || {};
    const prevMon = latestIdx>0 ? data[latestIdx-1] : null;
    return {
      revenue:num(latest.revenue),
      expense:num(latest.expense),
      cashIn:num(latest.cashIn),
      cashOut:num(latest.cashOut),
      netProfit:FinanceMath.netProfit(latest),
      margin:FinanceMath.margin(latest),
      asset:num(latest.asset || latest.annualMetrics?.asset),
      liability:num(latest.liability || latest.annualMetrics?.liability),
      equity:num(latest.equity || latest.annualMetrics?.equity),
      loanBal:num(latest.loanBalance),
      operatingCashFlow:num(latest.operatingCashFlow || latest.annualMetrics?.operatingCashFlow || latest.cashIn - latest.cashOut),
      investingCashFlow:num(latest.investingCashFlow || latest.annualMetrics?.investingCashFlow),
      financingCashFlow:num(latest.financingCashFlow || latest.annualMetrics?.financingCashFlow),
      MOM_rev:prevMon ? FinanceMath.MOM(latest.revenue,prevMon.revenue) : null,
      YOY_rev:prev?.[latestIdx]?.revenue ? FinanceMath.YOY(latest.revenue,prev[latestIdx].revenue) : null,
      QOQ_rev:FinanceMath.QOQ(data,"revenue",Math.floor(latestIdx/3)),
      YTD_rev:FinanceMath.YTD(data.slice(0,latestIdx+1),"revenue"),
      LTM_rev:FinanceMath.LTM(data,"revenue"),
      CAGR_rev:FinanceMath.CAGR(FinanceMath.YTD(prev,"revenue"),FinanceMath.YTD(data,"revenue"),1),
    };
  },[data,prev,latestIdx]);

  const annualCagr = useMemo(()=>{
    if (annualRows.length < 2) return null;
    const sorted = [...annualRows].sort((a,b)=>a.year-b.year).filter(row => Number(row.revenue) > 0);
    if (sorted.length < 2) return null;
    const first = sorted[0];
    const last = sorted[sorted.length-1];
    const years = Math.max(1, Number(last.year) - Number(first.year));
    return FinanceMath.CAGR(first.revenue, last.revenue, years);
  },[annualRows]);

  const m = hasAnnual ? {
    revenue:selectedAnnual.revenue,
    expense:selectedAnnual.expense,
    cashIn:selectedAnnual.operatingCashFlow > 0 ? selectedAnnual.operatingCashFlow : 0,
    cashOut:selectedAnnual.operatingCashFlow < 0 ? Math.abs(selectedAnnual.operatingCashFlow) : 0,
    netProfit:selectedAnnual.netProfit,
    margin:selectedAnnual.margin,
    asset:selectedAnnual.asset,
    liability:selectedAnnual.liability,
    equity:selectedAnnual.equity,
    loanBal:selectedAnnual.loan,
    operatingCashFlow:selectedAnnual.operatingCashFlow,
    investingCashFlow:selectedAnnual.investingCashFlow,
    financingCashFlow:selectedAnnual.financingCashFlow,
    MOM_rev:null,
    QOQ_rev:null,
    YOY_rev:previousAnnual ? FinanceMath.YOY(selectedAnnual.revenue, previousAnnual.revenue) : null,
    YTD_rev:selectedAnnual.revenue,
    LTM_rev:selectedAnnual.revenue,
    CAGR_rev:annualCagr,
  } : monthlyMetrics;

  const periodLabel = hasAnnual ? `FY ${displayYear}` : `${MONTHS[latestIdx]?.[th?"th":"en"] || "FY"} ${displayYear}`;
  const ticker = company?.tickerSymbol || company?.ticker_symbol || company?.nameEn || company?.nameTh || "-";
  const debtToEquity = m.equity ? (m.liability / m.equity) : null;
  const cashQuality = m.netProfit ? (m.operatingCashFlow / m.netProfit) : null;
  const balanceGap = Math.abs(num(m.asset) - (num(m.liability) + num(m.equity)));
  const balanceGapPct = m.asset ? (balanceGap / Math.abs(m.asset)) * 100 : null;

  const SLIDES = [
    {id:1,type:"cover",th:"หน้าปก",en:"Cover",descTh:"ชื่อบริษัทและช่วงเวลาวิเคราะห์",descEn:"Company and reporting period"},
    {id:2,type:"executive",th:"สรุปผู้บริหาร",en:"Executive Summary",descTh:"ตัวเลขสำคัญและสาระหลัก",descEn:"Key metrics and headline insights"},
    {id:3,type:"momentum",th:"โมเมนตัม",en:"Momentum",descTh:"การเติบโต YoY / Margin / CAGR",descEn:"YoY growth, margin and CAGR"},
    {id:4,type:"cashflow",th:"กระแสเงินสด",en:"Cashflow",descTh:"คุณภาพกำไรและกระแสเงินสด",descEn:"Cash generation and cash quality"},
  ];
  const slide = SLIDES[activeSlide-1];

  const handleExport = async () => {
    setExporting(true); setExportError("");
    try {
      const { exportFinancialPptx } = await import("./lib/exportPptx.js");
      await exportFinancialPptx({ company, year:displayYear, data, previousData:prev, language:lang, financeMath:FinanceMath });
    } catch (error) {
      setExportError(error.message || "PPTX export failed");
    } finally {
      setExporting(false);
    }
  };

  const clrP = (n)=>n===null||isNaN(n)?SM:n>0?"#1FD9A4":n<0?"#F7637C":SM;
  const sbase = {width:"100%",aspectRatio:"16/9",background:SD,borderRadius:12,overflow:"hidden",position:"relative",fontFamily:F.sans};

  const renderSlide = () => {
    if (slide.type==="cover") return (
      <div style={{...sbase,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",background:"linear-gradient(135deg,#0F1528 0%,#1a1f40 100%)"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:"linear-gradient(90deg,#5B7CFA,#38BDF8,#1FD9A4)"}}/>
        <div style={{textAlign:"center",padding:40}}>
          <div style={{fontSize:11,color:"#38BDF8",letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:16,fontWeight:700}}>FINANCIAL PRESENTATION WORKSPACE</div>
          <div style={{fontSize:34,fontWeight:800,color:"#fff",marginBottom:8}}>{th?company.nameTh:company.nameEn}</div>
          <div style={{fontSize:17,color:SM,marginBottom:32}}>{periodLabel} · {company.currency}</div>
          <div style={{display:"flex",gap:20,justifyContent:"center",flexWrap:"wrap"}}>
            {[{l:th?"รายได้":"Revenue",v:fmt(m.revenue,cur)},{l:th?"กำไรสุทธิ":"Net Profit",v:fmt(m.netProfit,cur)},{l:th?"สินทรัพย์":"Assets",v:fmt(m.asset,cur)}].map((s,i)=>(
              <div key={i} style={{textAlign:"center",padding:"12px 20px",border:`1px solid ${SB}`,borderRadius:10,background:"#ffffff08"}}>
                <div style={{fontSize:11,color:SM,marginBottom:4}}>{s.l}</div><div style={{fontSize:19,fontWeight:800,color:"#fff"}}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{position:"absolute",bottom:18,left:0,right:0,textAlign:"center",fontSize:11,color:SM}}>CONFIDENTIAL · FinAnalytics</div>
      </div>
    );
    if (slide.type==="executive") return (
      <div style={{...sbase,padding:32}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,#5B7CFA,#38BDF8,#1FD9A4)"}}/>
        <div style={{fontSize:11,color:"#38BDF8",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8}}>EXECUTIVE SUMMARY</div>
        <div style={{fontSize:21,fontWeight:800,color:"#fff",marginBottom:18}}>{th?"สรุปผู้บริหาร":"Key Highlights"} · {periodLabel}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
          {[{l:th?"รายได้":"Revenue",v:fmt(m.revenue,cur),sub:`YoY ${fmtPct(m.YOY_rev)}`,c:"#5B7CFA"},{l:th?"กำไรสุทธิ":"Net Profit",v:fmt(m.netProfit,cur),sub:`Margin ${m.margin.toFixed(1)}%`,c:"#1FD9A4"},{l:th?"สินทรัพย์":"Assets",v:fmt(m.asset,cur),sub:`D/E ${debtToEquity==null?"N/A":debtToEquity.toFixed(2)}x`,c:"#38BDF8"}].map((k,i)=>(
            <div key={i} style={{background:"#ffffff06",border:`1px solid ${SB}`,borderRadius:10,padding:14,borderTop:`2px solid ${k.c}`}}>
              <div style={{fontSize:10,color:SM,marginBottom:4,textTransform:"uppercase"}}>{k.l}</div>
              <div style={{fontSize:17,fontWeight:800,color:"#fff",marginBottom:6}}>{k.v}</div>
              <div style={{fontSize:11,color:i===0?clrP(m.YOY_rev):SM}}>{k.sub}</div>
            </div>
          ))}
        </div>
        <div style={{background:"#ffffff06",border:`1px solid ${SB}`,borderRadius:10,padding:14}}>
          <div style={{fontSize:11,color:SM,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>{th?"ตัวชี้วัดสำคัญ":"Key Indicators"}</div>
          <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
            {[{l:"CFO",v:fmt(m.operatingCashFlow,cur),c:m.operatingCashFlow>=0?"#1FD9A4":"#F7637C"},{l:"CFI",v:fmt(m.investingCashFlow,cur),c:"#F7B84F"},{l:"CFF",v:fmt(m.financingCashFlow,cur),c:"#A78BFA"},{l:"CAGR",v:fmtPct(m.CAGR_rev),c:clrP(m.CAGR_rev)}].map((s,i)=>(
              <div key={i}><div style={{fontSize:10,color:SM}}>{s.l}</div><div style={{fontSize:15,fontWeight:800,color:s.c||ST}}>{s.v}</div></div>
            ))}
          </div>
        </div>
      </div>
    );
    if (slide.type==="momentum") return (
      <div style={{...sbase,padding:32}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,#A78BFA,#38BDF8,#F7B84F)"}}/>
        <div style={{fontSize:11,color:"#A78BFA",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8}}>MOMENTUM & TREND</div>
        <div style={{fontSize:21,fontWeight:800,color:"#fff",marginBottom:18}}>{th?"วิเคราะห์โมเมนตัม":"Momentum Dashboard"}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
          {[{id:"YOY",d:th?"เทียบปี":"vs Year",v:m.YOY_rev,f:"(Y₁-Y₀)/|Y₀|",c:"#1FD9A4"},{id:"MARGIN",d:th?"กำไรสุทธิ":"Net Margin",v:m.margin,f:"NP / Revenue",c:"#38BDF8"},{id:"CAGR",d:th?"เติบโตเฉลี่ย":"Growth",v:m.CAGR_rev,f:"(E/S)^⅟ₙ-1",c:"#A78BFA"},{id:"D/E",d:th?"หนี้สินต่อทุน":"Debt/Equity",v:debtToEquity,c:"#F7637C",suffix:"x",f:"Debt / Equity"}].map((k,i)=>(
            <div key={i} style={{background:"#ffffff06",border:`1px solid ${k.c}40`,borderRadius:10,padding:14,textAlign:"center"}}>
              <div style={{fontSize:11,fontWeight:800,color:k.c,marginBottom:2}}>{k.id}</div>
              <div style={{fontSize:10,color:SM,marginBottom:10}}>{k.d}</div>
              <div style={{fontSize:23,fontWeight:800,color:i===3?ST:clrP(k.v),marginBottom:6}}>{i===3?(k.v==null?"N/A":`${k.v.toFixed(2)}${k.suffix}`):fmtPct(k.v)}</div>
              <div style={{fontSize:9,color:SM,fontFamily:"monospace"}}>{k.f}</div>
            </div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          {[{id:"Revenue",d:th?"รายได้":"Revenue",v:m.revenue,c:"#1FD9A4"},{id:"Assets",d:th?"สินทรัพย์":"Assets",v:m.asset,c:"#38BDF8"},{id:"Equity",d:th?"ส่วนทุน":"Equity",v:m.equity,c:"#A78BFA"}].map((k,i)=>(
            <div key={i} style={{background:"#ffffff06",border:`1px solid ${k.c}40`,borderRadius:10,padding:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:11,fontWeight:800,color:k.c}}>{k.id}</div><div style={{fontSize:10,color:SM}}>{k.d}</div></div>
              <div style={{fontSize:15,fontWeight:800,color:ST}}>{fmt(k.v,cur)}</div>
            </div>
          ))}
        </div>
      </div>
    );
    return (
      <div style={{...sbase,padding:32}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,#1FD9A4,#38BDF8,#A78BFA)"}}/>
        <div style={{fontSize:11,color:"#1FD9A4",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8}}>CASHFLOW QUALITY</div>
        <div style={{fontSize:21,fontWeight:800,color:"#fff",marginBottom:18}}>{th?"คุณภาพกระแสเงินสด":"Cash Flow Quality"} · {periodLabel}</div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={[{name:"CFO",value:m.operatingCashFlow,color:"#1FD9A4"},{name:"CFI",value:m.investingCashFlow,color:"#F7B84F"},{name:"CFF",value:m.financingCashFlow,color:"#A78BFA"}]} barCategoryGap="40%">
            <CartesianGrid strokeDasharray="3 3" stroke={SB} vertical={false}/>
            <XAxis dataKey="name" tick={{fontSize:11,fill:SM}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:10,fill:SM}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1e6).toFixed(0)}M`}/>
            <Tooltip content={({active,payload})=>active&&payload?.length?(<div style={{background:SD,border:`1px solid ${SB}`,borderRadius:8,padding:"8px 12px",fontSize:13,color:ST}}>{payload[0].payload.name}: <b>{fmt(payload[0].value,cur)}</b></div>):null}/>
            <ReferenceLine y={0} stroke={SB}/>
            <Bar dataKey="value" name={th?"กระแสเงินสด":"Cash Flow"} radius={[5,5,0,0]}>{["#1FD9A4","#F7B84F","#A78BFA"].map((color,i)=><Cell key={i} fill={color}/>)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const InsightCard = ({title, value, note, color}) => (
    <div style={{padding:14,border:`1px solid ${color || C.border}40`,background:(color || C.accent)+"12",borderRadius:12}}>
      <div style={{fontSize:11,color:C.muted,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:5}}>{title}</div>
      <div style={{fontSize:20,fontWeight:900,color:color || C.text,marginBottom:4}}>{value}</div>
      <div style={{fontSize:12,color:C.muted,lineHeight:1.45}}>{note}</div>
    </div>
  );

  if (!hasData) {
    return (
      <div>
        <PageHeader title={th?"Slide Workspace":"Slide Workspace"} subtitle={th?"อัปโหลดหรือนำเข้าข้อมูลก่อนสร้างสไลด์":"Upload or select imported data before generating slides"}/>
        <div style={{display:"grid",gridTemplateColumns:"minmax(280px,0.95fr) minmax(360px,1.35fr)",gap:16}}>
          <Card>
            <SegmentedToggle value={sourceMode} onChange={setSourceMode} options={[{value:"upload",icon:"⬆",label:th?"อัปโหลด":"Upload"},{value:"official",icon:"🏛",label:th?"ทางการ":"Official"},{value:"saved",icon:"🗂",label:th?"ที่บันทึก":"Saved"}]} style={{width:"100%",justifyContent:"center",marginBottom:14}} compact/>
            <button onClick={onGoUpload} style={{width:"100%",padding:"18px",borderRadius:12,border:`2px dashed ${C.border}`,background:C.surface,color:C.text,cursor:"pointer",fontWeight:850}}>
              ⬆ {th?"ไปหน้าอัปโหลดข้อมูล":"Go to Upload Data"}
            </button>
          </Card>
          <Card style={{textAlign:"center",padding:42}}>
            <div style={{fontSize:34,marginBottom:12}}>🖥</div>
            <div style={{fontSize:18,fontWeight:800,color:C.text,marginBottom:6}}>{th?"ยังไม่มีข้อมูลสำหรับสร้างสไลด์":"No data to generate slides"}</div>
            <div style={{fontSize:14,color:C.muted}}>{th?"เลือกไฟล์งบจากฝั่งซ้าย หรือใช้ข้อมูลที่เคย Import แล้ว":"Use the left source panel to import or select saved data."}</div>
          </Card>
        </div>
      </div>
    );
  }

  const sourcePanel = (
    <Card style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:16,borderBottom:`1px solid ${C.border}`}}>
        <div style={{fontSize:13,fontWeight:900,color:C.muted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10}}>{th?"แหล่งข้อมูล":"Data Source"}</div>
        <SegmentedToggle value={sourceMode} onChange={setSourceMode} options={[{value:"upload",icon:"⬆",label:th?"อัปโหลด":"Upload"},{value:"official",icon:"🏛",label:th?"ทางการ":"Official"},{value:"saved",icon:"🗂",label:th?"ที่บันทึก":"Saved"}]} style={{width:"100%",justifyContent:"center"}} compact/>
      </div>
      <div style={{padding:16}}>
        {sourceMode === "upload" && (onImportSuccess ? (
          <div style={{maxHeight:540,overflowY:"auto",paddingRight:4}}>
            <ImportWizard companyId={companyId} company={company} onImportSuccess={onImportSuccess} lang={lang} theme={theme} C={C}/>
          </div>
        ) : (
          <button onClick={onGoUpload} style={{width:"100%",padding:24,borderRadius:12,border:`2px dashed ${C.border}`,background:C.surface,color:C.text,cursor:"pointer",fontWeight:850}}>⬆ {th?"ไปหน้าอัปโหลดข้อมูล":"Go to Upload Data"}</button>
        ))}
        {sourceMode === "official" && (
          <div style={{display:"grid",gap:12}}>
            <div style={{padding:16,borderRadius:12,background:C.accentLo,border:`1px solid ${C.accent}35`}}>
              <div style={{fontSize:22,marginBottom:8}}>🏛</div>
              <div style={{fontWeight:900,color:C.text,marginBottom:6}}>{th?"Official Data Connector":"Official Data Connector"}</div>
              <div style={{fontSize:13,color:C.muted,lineHeight:1.6}}>{th?"โครงสร้างนี้เตรียมไว้สำหรับ SET/DBD/API ทางการในอนาคต โดยไม่ใช้การ scrape เว็บเป็นฐานหลัก":"Prepared for official SET/DBD/API sources. Web scraping is intentionally not used as the main production source."}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={{padding:12,borderRadius:10,border:`1px solid ${C.border}`}}><div style={{fontSize:11,color:C.muted,fontWeight:800}}>Ticker</div><div style={{fontWeight:900,color:C.text}}>{ticker}</div></div>
              <div style={{padding:12,borderRadius:10,border:`1px solid ${C.border}`}}><div style={{fontSize:11,color:C.muted,fontWeight:800}}>Period</div><div style={{fontWeight:900,color:C.text}}>{periodLabel}</div></div>
            </div>
            <button disabled style={{padding:"11px 14px",borderRadius:10,border:`1px solid ${C.border}`,background:C.surface,color:C.muted,fontWeight:800,cursor:"not-allowed"}}>{th?"รอเชื่อม API ทางการ":"Official API pending"}</button>
          </div>
        )}
        {sourceMode === "saved" && (
          <div style={{display:"grid",gap:8}}>
            <div style={{fontSize:13,color:C.muted,lineHeight:1.6}}>{th?"ข้อมูลที่เคย import แล้วของบริษัทนี้":"Saved imports available for this company."}</div>
            {annualRows.length ? annualRows.map(row => (
              <div key={row.year} style={{padding:12,borderRadius:10,border:`1px solid ${Number(row.year)===Number(displayYear)?C.accent:C.border}`,background:Number(row.year)===Number(displayYear)?C.accentLo:C.surface}}>
                <div style={{fontWeight:900,color:C.text}}>FY {row.year}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:4}}>{th?"รายได้":"Revenue"}: {fmt(row.revenue,cur)} · {th?"กำไร":"Profit"}: {fmt(row.netProfit,cur)}</div>
              </div>
            )) : <div style={{padding:14,borderRadius:10,border:`1px solid ${C.border}`,color:C.muted}}>{th?"ยังไม่มี import history":"No saved import history"}</div>}
          </div>
        )}
      </div>
    </Card>
  );

  const presentationPanel = (
    <Card style={{height:"100%"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:16}}>
        <div>
          <div style={{fontSize:13,fontWeight:900,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{th?"พื้นที่นำเสนอ":"Presentation Side"}</div>
          <div style={{fontSize:19,fontWeight:950,color:C.text,marginTop:4}}>{th?company.nameTh:company.nameEn}</div>
          <div style={{fontSize:13,color:C.muted,marginTop:3}}>{periodLabel} · {company.currency}</div>
        </div>
        <button onClick={handleExport} disabled={exporting} style={{padding:"10px 16px",borderRadius:999,background:C.accent,color:"#fff",border:"none",fontSize:13,fontWeight:850,cursor:exporting?"wait":"pointer",opacity:exporting?0.65:1}}>⬇ {exporting?(th?"กำลังสร้าง":"Generating"):(th?"Export PPTX":"Export PPTX")}</button>
      </div>
      {exportError&&<div style={{fontSize:12,color:C.red,marginBottom:10}}>{exportError}</div>}
      <div className="responsive-grid-4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
        <InsightCard title={th?"รายได้":"Revenue"} value={fmt(m.revenue,cur)} note={`YoY ${fmtPct(m.YOY_rev)}`} color={C.green}/>
        <InsightCard title={th?"กำไรสุทธิ":"Net Profit"} value={fmt(m.netProfit,cur)} note={`Margin ${m.margin.toFixed(1)}%`} color={m.netProfit>=0?C.accent:C.red}/>
        <InsightCard title={th?"สินทรัพย์":"Assets"} value={fmt(m.asset,cur)} note={th?"สีฟ้าตามระบบใหม่":"Asset blue mapping"} color={C.blue}/>
        <InsightCard title="CFO" value={fmt(m.operatingCashFlow,cur)} note={`Cash quality ${cashQuality==null?"N/A":cashQuality.toFixed(2)+"x"}`} color={m.operatingCashFlow>=0?C.green:C.red}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <div style={{padding:14,borderRadius:12,border:`1px solid ${C.border}`,background:C.surface}}>
          <div style={{fontSize:12,fontWeight:900,color:C.muted,marginBottom:8}}>{th?"Key Insights":"Key Insights"}</div>
          <div style={{display:"grid",gap:7,fontSize:13,color:C.text,lineHeight:1.55}}>
            <div>• {th?"การเติบโต YoY":"YoY growth"}: <b style={{color:clrP(m.YOY_rev)}}>{fmtPct(m.YOY_rev)}</b></div>
            <div>• {th?"หนี้สินต่อทุน":"Debt to Equity"}: <b>{debtToEquity==null?"N/A":`${debtToEquity.toFixed(2)}x`}</b></div>
            <div>• {th?"สมการงบฐานะ":"Balance equation gap"}: <b style={{color:(balanceGapPct || 0) < 1 ? C.green : C.amber}}>{balanceGapPct==null?"N/A":`${balanceGapPct.toFixed(2)}%`}</b></div>
          </div>
        </div>
        <div style={{padding:14,borderRadius:12,border:`1px solid ${C.border}`,background:C.surface}}>
          <div style={{fontSize:12,fontWeight:900,color:C.muted,marginBottom:8}}>{th?"Slide Outline":"Slide Outline"}</div>
          <div style={{display:"grid",gap:7}}>
            {SLIDES.map(item=>(
              <button key={item.id} onClick={()=>{setActiveSlide(item.id);setWorkspaceMode("presentation");}} style={{textAlign:"left",padding:"8px 10px",borderRadius:9,border:`1px solid ${activeSlide===item.id?C.accent:C.border}`,background:activeSlide===item.id?C.accentLo:"transparent",color:activeSlide===item.id?C.accent:C.text,cursor:"pointer",fontWeight:800}}>{item.id}. {th?item.th:item.en}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginTop:10}}>{renderSlide()}</div>
    </Card>
  );

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:28,fontWeight:900,color:C.text,marginBottom:6}}>{th?"Slide Workspace":"Slide Workspace"}</div>
          <div style={{fontSize:15,color:C.muted,fontWeight:500}}>{th?"ซ้ายคือแหล่งข้อมูล ขวาคือพื้นที่นำเสนอและสไลด์พรีวิว":"Left side is the data source; right side is the presentation workspace."}</div>
        </div>
        <SegmentedToggle value={workspaceMode} onChange={setWorkspaceMode} options={[{value:"input",icon:"⬆",label:th?"ข้อมูลนำเข้า":"Data Input"},{value:"presentation",icon:"🖥",label:th?"นำเสนอ":"Presentation"}]}/>
      </div>

      {workspaceMode === "input" ? (
        <div style={{display:"grid",gridTemplateColumns:"minmax(330px,0.95fr) minmax(520px,1.45fr)",gap:16,alignItems:"start"}}>
          {sourcePanel}
          {presentationPanel}
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"300px minmax(520px,1fr)",gap:16,alignItems:"start"}}>
          <Card>
            <div style={{fontSize:13,fontWeight:900,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>{th?"ชุดสไลด์":"Slide Deck"}</div>
            <div style={{display:"grid",gap:10}}>
              {SLIDES.map(item=>(
                <div key={item.id} onClick={()=>setActiveSlide(item.id)} style={{cursor:"pointer",border:`2px solid ${activeSlide===item.id?C.accent:C.border}`,borderRadius:12,overflow:"hidden",background:activeSlide===item.id?C.accentLo:C.surface}}>
                  <div style={{background:SD,aspectRatio:"16/9",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:10}}>
                    <div style={{fontSize:8,color:"#38BDF8",letterSpacing:"0.1em",marginBottom:5}}>SLIDE {item.id}</div>
                    <div style={{fontSize:11,color:ST,textAlign:"center",fontWeight:800}}>{th?item.th:item.en}</div>
                  </div>
                  <div style={{padding:10,fontSize:12,color:C.muted,lineHeight:1.45}}>{th?item.descTh:item.descEn}</div>
                </div>
              ))}
            </div>
          </Card>
          <div>
            {presentationPanel}
            <Card style={{marginTop:12}}>
              <div style={{fontSize:12,color:C.muted,fontWeight:800,marginBottom:6}}>{th?"หมายเหตุสไลด์":"Slide Notes"}</div>
              <div style={{fontSize:13,color:C.text,lineHeight:1.7}}>{th?`สร้างจากข้อมูลจริงของ ${company.nameTh} ${periodLabel} — สีกราฟใช้ตามมาตรฐานใหม่ โดยสินทรัพย์เป็นสีฟ้าและไม่ใช้แท่งสีดำเป็นตัวนำ`:`Generated from live data of ${company.nameEn} ${periodLabel}. Chart colors follow the new standard: assets are blue and black is not used as a primary data bar.`}</div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function LoginPage({lang, theme, onTheme, onSession}) {
  const C = THEMES[theme];
  const th = lang==="th";
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [status, setStatus] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    
    // MOCKUP BYPASS
    if (email.trim().toLowerCase() === "account_test1" && password === "1234") {
      setStatus({type:"success",message:th?"เข้าสู่ระบบโหมดจำลองสำเร็จ":"Mockup login successful"});
      setTimeout(() => {
        onSession({ user: { id: "mockup-user" } });
      }, 500);
      return;
    }

    setStatus({type:"loading",message:th?"กำลังดำเนินการ...":"Please wait..."});
    try {
      if (mode==="signin") {
        const data = await signIn(email,password);
        onSession(data.session);
      }
      else if (mode==="signup") {
        await signUp(email,password,fullName);
        setStatus({type:"success",message:th?"สมัครสำเร็จ กรุณาตรวจอีเมลยืนยัน":"Account created. Check your email to confirm."});
      } else {
        await resetPassword(email);
        setStatus({type:"success",message:th?"ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว":"Password reset link sent."});
      }
    } catch (error) { setStatus({type:"error",message:error.message}); }
  };
  const inputStyle = {width:"100%",padding:"12px 14px",borderRadius:9,border:`1px solid ${C.border}`,background:C.surface,color:C.text,fontSize:14,outline:"none",marginTop:6};
  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:F.sans,display:"grid",placeItems:"center",padding:20}}>
      <Card style={{width:"min(440px,100%)",padding:30}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <div style={{display:"flex",alignItems:"center",gap:11}}>
            <div style={{width:40,height:40,borderRadius:10,background:`linear-gradient(135deg,${C.accent},${C.green})`,display:"grid",placeItems:"center",fontWeight:800,color:"#fff"}}>F</div>
            <div><div style={{fontSize:19,fontWeight:800}}>FinAnalytics</div><div style={{fontSize:12,color:C.muted}}>{th?"ระบบการเงินที่ปลอดภัย":"Secure financial workspace"}</div></div>
          </div>
          <button onClick={()=>onTheme(theme==="dark"?"light":"dark")} style={{border:"none",background:"transparent",fontSize:20,cursor:"pointer"}}>{theme==="dark"?"☀️":"🌙"}</button>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:20}}>
          {[["signin",th?"เข้าสู่ระบบ":"Sign in"],["signup",th?"สมัคร":"Sign up"],["reset",th?"ลืมรหัส":"Reset"]].map(([key,label])=>(
            <button key={key} onClick={()=>{setMode(key);setStatus(null);}} style={{flex:1,padding:"8px",borderRadius:8,border:`1px solid ${mode===key?C.accent:C.border}`,background:mode===key?C.accentLo:"transparent",color:mode===key?C.accent:C.muted,fontWeight:700,cursor:"pointer"}}>{label}</button>
          ))}
        </div>
        <form onSubmit={submit}>
          {mode==="signup"&&<label style={{fontSize:12,color:C.muted}}>{th?"ชื่อ":"Name"}<input value={fullName} onChange={e=>setFullName(e.target.value)} required style={inputStyle}/></label>}
          <label style={{display:"block",fontSize:12,color:C.muted,marginTop:14}}>{th?"อีเมล หรือ ID":"Email or ID"}<input type="text" value={email} onChange={e=>setEmail(e.target.value)} required style={inputStyle}/></label>
          {mode!=="reset"&&<label style={{display:"block",fontSize:12,color:C.muted,marginTop:14}}>{th?"รหัสผ่าน":"Password"}<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required style={inputStyle}/></label>}
          <button disabled={status?.type==="loading"} style={{width:"100%",marginTop:20,padding:"12px",borderRadius:9,border:"none",background:C.accent,color:"#fff",fontWeight:800,cursor:"pointer"}}>{mode==="signin"?(th?"เข้าสู่ระบบ":"Sign in"):mode==="signup"?(th?"สร้างบัญชี":"Create account"):(th?"ส่งลิงก์":"Send reset link")}</button>
        </form>
        {status&&<div style={{marginTop:14,padding:11,borderRadius:8,fontSize:13,background:status.type==="error"?C.redLo:status.type==="success"?C.greenLo:C.accentLo,color:status.type==="error"?C.red:status.type==="success"?C.green:C.accent}}>{status.message}</div>}
      </Card>
    </div>
  );
}

function CompanyOnboarding({lang,onCreated}) {
  const C = useC();
  const th = lang==="th";
  const [form,setForm] = useState({nameTh:"",nameEn:"",currency:"THB",type:"parent",industry:"retail",groupId:"",tickerSymbol:"",fiscalYearEnd:"12-31",companyMode:"private",legalEntityType:"limited_company"});
  const [error,setError] = useState("");
  const submit = async event => {
    event.preventDefault(); setError("");
    try { await createCompany(form); await onCreated(); }
    catch(err){ setError(err.message); }
  };
  const field = {width:"100%",marginTop:6,padding:10,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:C.text};
  return <div style={{minHeight:"100vh",background:C.bg,display:"grid",placeItems:"center",padding:20}}><Card style={{width:"min(560px,100%)"}}>
    <PageHeader title={th?"สร้างบริษัทแรก":"Create your first company"} subtitle={th?"บัญชีของคุณจะเป็น Owner โดยอัตโนมัติ":"You will automatically become the owner"}/>
    <form onSubmit={submit}>
      <label style={{fontSize:12,color:C.muted}}>{th?"ชื่อภาษาไทย":"Thai name"}<input value={form.nameTh} onChange={e=>setForm({...form,nameTh:e.target.value})} required style={field}/></label>
      <label style={{display:"block",fontSize:12,color:C.muted,marginTop:12}}>{th?"ชื่อภาษาอังกฤษ":"English name"}<input value={form.nameEn} onChange={e=>setForm({...form,nameEn:e.target.value})} required style={field}/></label>
      <label style={{display:"block",fontSize:12,color:C.muted,marginTop:12}}>{th?"ประเภทนิติบุคคล":"Legal entity type"}<select value={form.legalEntityType} onChange={e=>{const legalEntityType=e.target.value; const nextMode=legalModeFromType(legalEntityType); setForm({...form,legalEntityType,companyMode:nextMode,tickerSymbol:nextMode==='private'?'':form.tickerSymbol});}} style={field}>{Object.entries(LEGAL_ENTITY_TYPES).map(([key,item])=><option key={key} value={key}>{item.icon} {th?item.th:item.en}</option>)}</select></label>
      <div style={{marginTop:8,padding:"9px 12px",borderRadius:8,background:form.companyMode==='public'?C.accentLo:C.purpleLo,color:form.companyMode==='public'?C.accent:C.purple,fontSize:12,fontWeight:800}}>{form.companyMode==='public' ? (th?"โหมดบริษัทมหาชน: ใช้งบ SET / งบปี / งบไตรมาส":"Public mode: SET-style annual/quarterly statements") : (th?"โหมดนิติบุคคลทั่วไป: ใช้งบการเงิน งบทดลอง และรายงานรายเดือน":"Private mode: financial statements, trial balance and monthly reports")}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginTop:12}}>
        <label style={{fontSize:12,color:C.muted}}>{th?"สกุลเงิน":"Currency"}<select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})} style={field}><option>THB</option><option>USD</option><option>EUR</option></select></label>
        <label style={{fontSize:12,color:C.muted}}>{th?"อุตสาหกรรม":"Industry"}<select value={form.industry} onChange={e=>setForm({...form,industry:e.target.value})} style={field}>{Object.keys(INDUSTRIES).map(item=><option key={item}>{item}</option>)}</select></label>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginTop:12}}>
        <label style={{fontSize:12,color:C.muted}}>{th?"สัญลักษณ์ (Ticker)":"Ticker Symbol"}<input value={form.tickerSymbol} onChange={e=>setForm({...form,tickerSymbol:e.target.value})} placeholder="e.g. PTT" style={field}/></label>
        <label style={{fontSize:12,color:C.muted}}>{th?"สิ้นสุดงบการเงิน":"Fiscal Year End"}<select value={form.fiscalYearEnd} onChange={e=>setForm({...form,fiscalYearEnd:e.target.value})} style={field}><option value="12-31">31 ธ.ค. (Dec 31)</option><option value="03-31">31 มี.ค. (Mar 31)</option><option value="06-30">30 มิ.ย. (Jun 30)</option><option value="09-30">30 ก.ย. (Sep 30)</option></select></label>
      </div>
      <button style={{marginTop:18,width:"100%",padding:12,borderRadius:8,border:"none",background:C.accent,color:"#fff",fontWeight:800,cursor:"pointer"}}>{th?"สร้างบริษัท":"Create company"}</button>
      {error&&<div style={{color:C.red,marginTop:12}}>{error}</div>}
    </form>
  </Card></div>;
}

function AccessPage({companyId, lang}) {
  const C = useC();
  const th = lang==="th";
  const company = COMPANIES.find(c=>c.id===companyId);
  const canAdmin = ["owner","admin"].includes(company?.role);
  const [members,setMembers] = useState([]);
  const [email,setEmail] = useState("");
  const [role,setRole] = useState("viewer");
  const [status,setStatus] = useState({loading:true,message:""});
  const refresh = async () => {
    if (!isSupabaseConfigured) { setStatus({loading:false,message:th?"ใช้ได้เมื่อเชื่อม Supabase":"Available after Supabase is configured"}); return; }
    try { setStatus({loading:true,message:""}); setMembers(await loadCompanyMembers(companyId)); setStatus({loading:false,message:""}); }
    catch(error){ setStatus({loading:false,message:error.message}); }
  };
  useEffect(()=>{refresh();},[companyId]);
  const grant = async (event) => {
    event.preventDefault();
    try { setStatus({loading:true,message:""}); await grantCompanyAccess(companyId,email,role); setEmail(""); await refresh(); }
    catch(error){ setStatus({loading:false,message:error.message}); }
  };
  const revoke = async (userId) => {
    try { await revokeCompanyAccess(companyId,userId); await refresh(); }
    catch(error){ setStatus({loading:false,message:error.message}); }
  };
  return (
    <div>
      <PageHeader title={th?"สิทธิ์การเข้าถึง":"Access Control"} subtitle={`${th?company?.nameTh:company?.nameEn} · ${company?.role||"demo"}`}/>
      {canAdmin&&<Card style={{marginBottom:16}}>
        <form onSubmit={grant} style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
          <label style={{flex:1,minWidth:220,fontSize:12,color:C.muted}}>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required style={{width:"100%",marginTop:6,padding:10,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:C.text}}/></label>
          <select value={role} onChange={e=>setRole(e.target.value)} style={{padding:10,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:C.text}}>
            {["viewer","editor","admin",...(company?.role==="owner"?["owner"]:[])].map(item=><option key={item}>{item}</option>)}
          </select>
          <button style={{padding:"10px 16px",borderRadius:8,border:"none",background:C.accent,color:"#fff",fontWeight:700,cursor:"pointer"}}>{th?"ให้สิทธิ์":"Grant access"}</button>
        </form>
        <div style={{fontSize:12,color:C.muted,marginTop:10}}>{th?"ผู้ใช้ต้องสมัครบัญชีก่อนจึงจะให้สิทธิ์ด้วยอีเมลได้":"The user must sign up before access can be granted."}</div>
      </Card>}
      <Card>
        {status.loading?<div style={{color:C.muted}}>{th?"กำลังโหลด...":"Loading..."}</div>:status.message?<div style={{color:C.red}}>{status.message}</div>:members.map(member=>(
          <div key={member.user_id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
            <div style={{flex:1}}><div style={{fontWeight:700}}>{member.profiles?.full_name||member.profiles?.email}</div><div style={{fontSize:12,color:C.muted}}>{member.profiles?.email}</div></div>
            <Badge color={member.role==="owner"?C.amber:member.role==="admin"?C.purple:member.role==="editor"?C.green:C.muted}>{member.role}</Badge>
            {canAdmin&&member.role!=="owner"&&<button onClick={()=>revoke(member.user_id)} style={{border:"none",background:C.redLo,color:C.red,padding:"7px 10px",borderRadius:7,cursor:"pointer"}}>{th?"ถอนสิทธิ์":"Remove"}</button>}
          </div>
        ))}
      </Card>
    </div>
  );
}

function AuditPage({lang}) {
  const C = useC();
  const th = lang==="th";
  const [rows,setRows] = useState([]);
  const [status,setStatus] = useState({loading:true,error:""});
  useEffect(()=>{
    if (!isSupabaseConfigured) { setStatus({loading:false,error:th?"Audit log ใช้ได้เมื่อเชื่อม Supabase":"Audit log requires Supabase"}); return; }
    loadAuditLog().then(data=>{setRows(data);setStatus({loading:false,error:""});}).catch(error=>setStatus({loading:false,error:error.message}));
  },[lang]);
  return (
    <div>
      <PageHeader title={th?"ประวัติการแก้ไข":"Audit Log"} subtitle={th?"บันทึกโดย trigger ในฐานข้อมูล แก้ไขย้อนหลังจากหน้าเว็บไม่ได้":"Database-triggered and immutable from the client"}/>
      <Card style={{overflowX:"auto"}}>
        {status.loading?<div>{th?"กำลังโหลด...":"Loading..."}</div>:status.error?<div style={{color:C.red}}>{status.error}</div>:(
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:760}}>
            <thead><tr>{[th?"เวลา":"Time",th?"ผู้ใช้":"User",th?"ตาราง":"Table",th?"การทำงาน":"Action",th?"บริษัท":"Company"].map(h=><th key={h} style={{textAlign:"left",padding:10,color:C.muted,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(row=><tr key={row.id}><td style={{padding:10,borderBottom:`1px solid ${C.border}`}}>{new Date(row.created_at).toLocaleString(th?"th-TH":"en-GB")}</td><td style={{padding:10,borderBottom:`1px solid ${C.border}`}}>{row.changed_by_email||"-"}</td><td style={{padding:10,borderBottom:`1px solid ${C.border}`}}>{row.table_name}</td><td style={{padding:10,borderBottom:`1px solid ${C.border}`}}><Badge color={row.action==="DELETE"?C.red:row.action==="UPDATE"?C.amber:C.green}>{row.action}</Badge></td><td style={{padding:10,borderBottom:`1px solid ${C.border}`}}>{row.company_id||"-"}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function BackupPage({companies,store,exchangeRates,onImport,lang}) {
  const C = useC();
  const th = lang==="th";
  const inputRef = useRef();
  const [status,setStatus] = useState("");
  const handleImport = (file) => {
    const reader = new FileReader();
    reader.onload = async event => {
      try { const payload=parseBackup(event.target.result); await onImport(payload); setStatus(th?"นำเข้าข้อมูลสำเร็จ":"Backup imported"); }
      catch(error){ setStatus(error.message); }
    };
    reader.readAsText(file);
  };
  return (
    <div>
      <PageHeader title={th?"สำรองและส่งออกข้อมูล":"Backup & Export"} subtitle={th?"เก็บสำเนาก่อนแก้ไขข้อมูลจำนวนมากเสมอ":"Keep a backup before bulk changes"}/>
      <div className="responsive-grid-3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
        <Card><div style={{fontSize:24,marginBottom:10}}>💾</div><div style={{fontWeight:800,marginBottom:6}}>{th?"สำรอง JSON":"JSON Backup"}</div><div style={{fontSize:13,color:C.muted,marginBottom:16}}>{th?"รวมบริษัท ข้อมูล และอัตราแลกเปลี่ยน":"Companies, records, and exchange rates"}</div><button onClick={()=>exportBackup(companies,store,exchangeRates)} style={{padding:"9px 14px",border:"none",borderRadius:8,background:C.accent,color:"#fff",fontWeight:700,cursor:"pointer"}}>{th?"ดาวน์โหลด":"Download"}</button></Card>
        <Card><div style={{fontSize:24,marginBottom:10}}>📄</div><div style={{fontWeight:800,marginBottom:6}}>{th?"ส่งออก CSV":"CSV Export"}</div><div style={{fontSize:13,color:C.muted,marginBottom:16}}>{th?"ข้อมูลดิบทุกบริษัททุกเดือน":"All company monthly records"}</div><button onClick={()=>exportRecordsCSV(companies,store)} style={{padding:"9px 14px",border:"none",borderRadius:8,background:C.green,color:"#fff",fontWeight:700,cursor:"pointer"}}>{th?"ดาวน์โหลด":"Download"}</button></Card>
        <Card><div style={{fontSize:24,marginBottom:10}}>♻️</div><div style={{fontWeight:800,marginBottom:6}}>{th?"นำเข้าสำเนา":"Restore Backup"}</div><div style={{fontSize:13,color:C.muted,marginBottom:16}}>{th?"ตรวจรูปแบบก่อนนำเข้าทุกครั้ง":"Validated before import"}</div><input ref={inputRef} type="file" accept=".json" hidden onChange={e=>e.target.files[0]&&handleImport(e.target.files[0])}/><button onClick={()=>inputRef.current.click()} style={{padding:"9px 14px",border:"none",borderRadius:8,background:C.purple,color:"#fff",fontWeight:700,cursor:"pointer"}}>{th?"เลือกไฟล์":"Choose file"}</button></Card>
      </div>
      {status&&<div style={{marginTop:14,color:status.includes("สำเร็จ")||status.includes("imported")?C.green:C.red}}>{status}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════
const NAV = [
  {id:"momentum", icon:"⚡", th:"Momentum", en:"Momentum"},
  {id:"upload", icon:"⬆", th:"อัปโหลดงบ", en:"Upload Data"},
  {id:"data", icon:"▦", th:"ตารางข้อมูล", en:"Data Table"},
  {id:"companies", icon:"🏢", th:"บริษัท", en:"Companies"},
  {id:"industry", icon:"🏭", th:"รายอุตสาหกรรม", en:"Industry"},
  {id:"consolidation", icon:"⊞", th:"งบรวม", en:"Consolidation"},
  {id:"slides", icon:"🖥", th:"Slide Template", en:"Slide Template"},
  {id:"access", icon:"🔐", th:"สิทธิ์ผู้ใช้", en:"Access"},
  {id:"audit", icon:"🧾", th:"Audit Log", en:"Audit Log"},
  {id:"backup", icon:"💾", th:"สำรองข้อมูล", en:"Backup"},
];

export default function App() {
  const [page, setPage] = useState("momentum");
  const [lang, setLang] = useState("th");
  const [theme, setTheme] = useState("dark");
  const [companyId, setCompanyId] = useState(1);
  const [year, setYear] = useState(2026);
  const [store, setStore] = useState(loadStoredData);
  const [companies, setCompanies] = useState(DEFAULT_COMPANIES);
  const [exchangeRates, setExchangeRates] = useState({THB:1});
  const [compareIds, setCompareIds] = useState([]);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [dataLoading, setDataLoading] = useState(isSupabaseConfigured);
  const [appError, setAppError] = useState("");

  const C = THEMES[theme];
  const th = lang==="th";
  COMPANIES = companies;
  const company = COMPANIES.find(c=>c.id===companyId);

  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      console.warn("Could not save financial data:", error);
    }
  }, [store]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthLoading(false);});
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,nextSession)=>{
      setSession(nextSession); setAuthLoading(false);
    });
    return ()=>subscription.unsubscribe();
  }, []);

  const refreshRemoteData = async (activeSession = session) => {
    if (!activeSession) return;
    
    // MOCKUP DATA
    if (activeSession.user.id === "mockup-user") {
      setCompanies([
        { id:1, nameTh:"บริษัท โมดิฟาย ม็อคอัพ จำกัด", nameEn:"Mockup Modify Co., Ltd.", currency:"THB", type:"parent", industry:"tech", groupId:"mockup", tickerSymbol:"MOCKUP", fiscalYearEnd:"12-31", companyMode:"private", legalEntityType:"limited_company" }
      ]);
      setStore({
        1: {
          2024: { 'FY': { groups: { revenue: 15000000, cogs: 8000000, sga: 3000000, operating_cash_flow: 4000000, asset: 50000000, liability: 20000000, equity: 30000000, net_profit: 4000000 } } },
          2025: { 'FY': { groups: { revenue: 18000000, cogs: 9000000, sga: 3500000, operating_cash_flow: 5000000, asset: 55000000, liability: 22000000, equity: 33000000, net_profit: 5500000 } } },
          2026: { 'FY': { groups: { revenue: 22000000, cogs: 10000000, sga: 4000000, operating_cash_flow: 7000000, asset: 60000000, liability: 25000000, equity: 35000000, net_profit: 8000000 } } },
        }
      });
      setExchangeRates({THB:1});
      setCompanyId(1);
      setDataLoading(false);
      return;
    }

    if (!isSupabaseConfigured) return;
    setDataLoading(true); setAppError("");
    try {
      const [nextCompanies,nextStore,nextRates] = await Promise.all([
        loadCompanies(), loadAllFinancialData(), loadExchangeRates(year),
      ]);
      setCompanies(nextCompanies);
      setStore(nextStore);
      setExchangeRates(nextRates);
      if (nextCompanies.length && !nextCompanies.some(item=>item.id===companyId)) setCompanyId(nextCompanies[0].id);
    } catch (error) { setAppError(error.message); }
    finally { setDataLoading(false); }
  };

  useEffect(()=>{ refreshRemoteData(); },[session,year]);

  const handleUpsert = async (batchDetails, rowsOrPayload) => {
    if (isSupabaseConfigured) {
      const isPrivatePayload = batchDetails?.sourceType && String(batchDetails.sourceType).startsWith('private_');
      const result = isPrivatePayload
        ? await savePrivateImportBatch(companyId, batchDetails, rowsOrPayload)
        : await saveImportBatch(companyId, batchDetails, rowsOrPayload);
      if (batchDetails?.fiscalYear) setYear(Number(batchDetails.fiscalYear));
      await refreshRemoteData();
      return result;
    }
    // Fallback for local demo mode not supported in V1 for normalized data fully yet
    throw new Error("Local demo mode not fully supported for multi-year normalized data in V1.");
  };

  const handleSaveRate = async (currency,rate) => {
    if (isSupabaseConfigured) await saveExchangeRate(currency,rate,`${year}-12-31`);
    setExchangeRates(previous=>({...previous,[currency]:rate}));
  };

  const statementTypeForGroup = (group) => {
    if (["asset", "liability", "equity", "cash", "inventory", "receivable", "payable", "loan"].includes(group)) return "balance_sheet";
    if (String(group).includes("cash_flow")) return "cash_flow";
    return "income_statement";
  };

  const rowsFromBackupRecord = (record, fallbackYear, fallbackPeriod = "FY") => {
    if (!record || typeof record !== "object") return [];

    if (record.groups && typeof record.groups === "object") {
      return Object.entries(record.groups).map(([group, amount]) => ({
        fiscal_year: Number(fallbackYear),
        period_type: fallbackPeriod === "FY" ? "annual" : "period",
        period: fallbackPeriod,
        statement_scope: "consolidated",
        statement_type: statementTypeForGroup(group),
        account_name: group,
        account_group: group,
        account_subgroup: null,
        industry_metric: null,
        note: "Restored from FinAnalytics backup",
        original_amount: Number(amount) || 0,
        original_unit: "baht",
        amount: Number(amount) || 0,
        normalized_unit: "baht",
        raw_account_name: group,
        raw_amount: Number(amount) || 0,
        raw_unit: "baht",
        source_sheet: "backup",
        source_row: null,
        source_column: null,
        mapping_confidence: 1,
        needs_review: false,
      }));
    }

    if (Number.isInteger(record.monthIdx)) {
      const period = String(record.monthIdx + 1).padStart(2, "0");
      const pairs = [
        ["revenue", record.revenue, "income_statement"],
        ["expense", record.expense, "income_statement"],
        ["operating_cash_flow", (Number(record.cashIn) || 0) - (Number(record.cashOut) || 0), "cash_flow"],
        ["loan", record.loanBalance, "balance_sheet"],
      ];
      return pairs.map(([group, amount, statementType]) => ({
        fiscal_year: Number(fallbackYear),
        period_type: "monthly",
        period,
        statement_scope: "consolidated",
        statement_type: statementType,
        account_name: group,
        account_group: group,
        account_subgroup: null,
        industry_metric: null,
        note: "Restored from legacy FinAnalytics backup",
        original_amount: Number(amount) || 0,
        original_unit: "baht",
        amount: Number(amount) || 0,
        normalized_unit: "baht",
        raw_account_name: group,
        raw_amount: Number(amount) || 0,
        raw_unit: "baht",
        source_sheet: "backup",
        source_row: null,
        source_column: null,
        mapping_confidence: 1,
        needs_review: false,
      }));
    }

    return [];
  };

  const handleBackupImport = async (payload) => {
    if (!isSupabaseConfigured) {
      setStore(payload.store);
      setExchangeRates(payload.exchangeRates||{THB:1});
      return;
    }

    for (const [cid, years] of Object.entries(payload.store || {})) {
      const numericCompanyId = Number(cid);
      if (!companies.some(item => item.id === numericCompanyId)) continue;
      for (const [recordYear, periods] of Object.entries(years || {})) {
        for (const [periodKey, record] of Object.entries(periods || {})) {
          const rows = rowsFromBackupRecord(record, recordYear, record?.groups ? periodKey : String((record?.monthIdx ?? 0) + 1).padStart(2, "0"));
          if (!rows.length) continue;
          await saveImportBatch(numericCompanyId, {
            fileName: payload.fileName || `backup-${numericCompanyId}-${recordYear}-${periodKey}.json`,
            fiscalYear: Number(recordYear),
            periodType: rows[0].period_type,
            period: rows[0].period,
            statementScope: "consolidated",
          }, rows);
        }
      }
    }
    await refreshRemoteData();
  };

  const renderPage = () => {
    if (page==="momentum") return <MomentumDashboard store={store} companyId={companyId} lang={lang} C={C} COMPANIES={companies} INDUSTRIES={INDUSTRIES}/>;
    if (page==="upload") return <ImportWizard companyId={companyId} company={company} onImportSuccess={handleUpsert} lang={lang} theme={theme} C={C} />;
    if (page==="data") return <DataManagerPage store={store} companyId={companyId} year={year} lang={lang}/>;
    if (page==="companies") return <CompaniesPage store={store} year={year} lang={lang} onSelect={(id)=>{setCompanyId(id);setPage("momentum");}} onCompare={(ids)=>{setCompareIds(ids);setPage("compare");}}/>;
    if (page==="compare") return <ComparePage store={store} companyIds={compareIds} year={year} lang={lang} onBack={()=>setPage("companies")}/>;
    if (page==="industry") return <IndustryPage store={store} year={year} lang={lang}/>;
    if (page==="consolidation") return <ConsolidationPage store={store} year={year} lang={lang} exchangeRates={exchangeRates} onSaveRate={handleSaveRate}/>;
    if (page==="slides") return <SlideViewer store={store} companyId={companyId} year={year} lang={lang} theme={theme} onImportSuccess={handleUpsert} onGoUpload={()=>setPage("upload")}/>;
    if (page==="access") return <AccessPage companyId={companyId} lang={lang}/>;
    if (page==="audit") return <AuditPage lang={lang}/>;
    if (page==="backup") return <BackupPage companies={companies} store={store} exchangeRates={exchangeRates} onImport={handleBackupImport} lang={lang}/>;
  };

  const selStyle = {width:"100%",background:C.card,border:`1px solid ${C.border}`,color:C.text,padding:"8px 11px",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",outline:"none"};

  if (authLoading) return <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:C.bg,color:C.text,fontFamily:F.sans}}>{th?"กำลังตรวจสอบบัญชี...":"Checking session..."}</div>;
  if (isSupabaseConfigured && !session) return <LoginPage lang={lang} theme={theme} onTheme={setTheme} onSession={(s)=>{setSession(s);refreshRemoteData(s);}}/>;
  if (dataLoading) return <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:C.bg,color:C.text,fontFamily:F.sans}}>{th?"กำลังโหลดข้อมูลที่ได้รับอนุญาต...":"Loading authorized data..."}</div>;
  if (isSupabaseConfigured && !companies.length) return <ThemeCtx.Provider value={C}><CompanyOnboarding lang={lang} onCreated={refreshRemoteData}/></ThemeCtx.Provider>;

  return (
    <ThemeCtx.Provider value={C}>
    <div className="app-shell" style={{display:"flex",height:"100vh",background:C.bg,fontFamily:F.sans,color:C.text,overflow:"hidden",transition:"background 0.3s"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px;}
        button{transition:opacity 0.15s,background 0.2s;} button:hover{opacity:0.85;}
        select option{background:${C.surface};color:${C.text};}
        @media(max-width:900px){
          .app-shell{display:block!important;height:auto!important;min-height:100vh;overflow:visible!important}
          .app-sidebar{width:100%!important;height:auto;border-right:none!important;border-bottom:1px solid ${C.border};position:sticky;top:0;z-index:20}
          .app-brand{display:none}
          .app-nav{display:flex!important;overflow-x:auto!important;padding:8px!important}
          .app-nav>div{flex:0 0 auto;margin:0 3px!important;padding:9px 12px!important;border-left:none!important;border-bottom:3px solid transparent}
          .app-sidebar-controls{display:grid!important;grid-template-columns:1fr 1fr 1fr;gap:8px}
          .app-main{overflow:visible!important}
          .app-topbar{height:auto!important;min-height:54px;padding:10px 14px!important;align-items:flex-start!important;gap:8px;flex-wrap:wrap}
          .app-topbar-left{overflow-x:auto;width:100%;padding-bottom:4px}
          .app-content{padding:16px!important;overflow:visible!important}
          .responsive-grid-4,.responsive-grid-3{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        }
        @media(max-width:600px){
          .app-sidebar-controls{grid-template-columns:1fr!important}
          .responsive-grid-4,.responsive-grid-3{grid-template-columns:1fr!important}
          .app-content [style*="repeat(4,1fr)"],.app-content [style*="repeat(3,1fr)"],.app-content [style*="1.6fr 1fr"],.app-content [style*="1.4fr 1fr"],.app-content [style*="1fr 1fr"]{grid-template-columns:1fr!important}
          .app-content h1{font-size:24px!important}
        }
      `}</style>

      {/* SIDEBAR — bigger fonts, bolder */}
      <div className="app-sidebar" style={{width:248,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0,transition:"background 0.3s"}}>
        <div className="app-brand" style={{padding:"20px 20px 16px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:11}}>
            <div style={{width:34,height:34,borderRadius:9,background:`linear-gradient(135deg,${C.accent},${C.green})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:"#fff"}}>F</div>
            <div><div style={{fontSize:16,fontWeight:800,color:C.white}}>FinAnalytics</div><div style={{fontSize:11,color:C.muted}}>Financial Platform</div></div>
          </div>
        </div>

        <div className="app-nav" style={{padding:"12px 10px",flex:1,overflowY:"auto"}}>
          {NAV.map(n=>(
            <div key={n.id} onClick={()=>setPage(n.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:10,cursor:"pointer",marginBottom:3,
              fontSize:15,fontWeight:page===n.id?800:600,color:page===n.id?C.white:C.muted,
              background:page===n.id?C.accentLo:"transparent",borderLeft:page===n.id?`3px solid ${C.accent}`:"3px solid transparent"}}>
              <span style={{fontSize:17}}>{n.icon}</span><span>{th?n.th:n.en}</span>
            </div>
          ))}
        </div>

        <div className="app-sidebar-controls" style={{padding:"14px 14px",borderTop:`1px solid ${C.border}`}}>
          {/* Theme toggle */}
          <SegmentedToggle
            value={theme}
            onChange={setTheme}
            compact
            style={{width:"100%",justifyContent:"center",marginBottom:12}}
            options={[{value:"dark",icon:"🌙",label:th?"มืด":"Dark"},{value:"light",icon:"☀️",label:th?"สว่าง":"Light"}]}
          />
          <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6,fontWeight:700}}>{th?"บริษัท":"Company"}</div>
          <select value={companyId} onChange={e=>setCompanyId(Number(e.target.value))} style={{...selStyle,marginBottom:8}}>
            {COMPANIES.map(c=>(<option key={c.id} value={c.id}>{th?c.nameTh:c.nameEn}</option>))}
          </select>
          <select value={year} onChange={e=>setYear(Number(e.target.value))} style={selStyle}>
            {[2023,2024,2025,2026].map(y=>(<option key={y} value={y}>{y} (พ.ศ.{y+543})</option>))}
          </select>
          <SegmentedToggle
            value={lang}
            onChange={setLang}
            compact
            style={{width:"100%",justifyContent:"center",marginTop:10}}
            options={[{value:"th",label:"TH"},{value:"en",label:"EN"}]}
          />
        </div>
      </div>

      {/* MAIN */}
      <div className="app-main" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div className="app-topbar" style={{height:58,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",background:C.surface,flexShrink:0,transition:"background 0.3s"}}>
          <div className="app-topbar-left" style={{display:"flex",alignItems:"center",gap:10,whiteSpace:"nowrap"}}>
            <span style={{fontSize:14,color:C.muted}}>{th?"บริษัท:":"Company:"}</span>
            <span style={{fontSize:14,fontWeight:800,color:C.white}}>{th?company.nameTh:company.nameEn}</span>
            <Badge color={INDUSTRIES[company.industry].color}>{INDUSTRIES[company.industry].icon} {th?INDUSTRIES[company.industry].th:INDUSTRIES[company.industry].en}</Badge>
            <Badge color={C.amber}>{company.currency}</Badge>
            <Badge color={C.accent}>{th?"ปี":"FY"}{year}</Badge>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Badge color={C.green}>✓ {isSupabaseConfigured?(th?"ซิงก์ Supabase":"Supabase synced"):(th?"บันทึกในเครื่อง":"Saved locally")}</Badge>
            {isSupabaseConfigured&&<button onClick={signOut} style={{border:`1px solid ${C.border}`,background:"transparent",color:C.muted,padding:"6px 9px",borderRadius:7,cursor:"pointer"}}>{th?"ออกจากระบบ":"Sign out"}</button>}
            <div style={{fontSize:13,color:C.muted}}>{new Date().toLocaleDateString(th?"th-TH":"en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>
          </div>
        </div>
        <div className="app-content" style={{flex:1,overflowY:"auto",padding:26}}>
          {appError&&<div style={{padding:12,borderRadius:8,background:C.redLo,color:C.red,marginBottom:14}}>{appError} <button onClick={refreshRemoteData} style={{marginLeft:10,border:"none",background:"transparent",color:C.red,textDecoration:"underline",cursor:"pointer"}}>{th?"ลองใหม่":"Retry"}</button></div>}
          {!isSupabaseConfigured&&<div style={{padding:"9px 12px",borderRadius:8,background:C.amberLo,color:C.amber,marginBottom:14,fontSize:13}}>⚠ {th?"Demo Mode — ยังไม่เชื่อม Supabase ข้อมูลอยู่เฉพาะเครื่องนี้":"Demo Mode — Supabase is not configured; data stays on this device."}</div>}
          {renderPage()}
        </div>
      </div>
    </div>
    </ThemeCtx.Provider>
  );
}
