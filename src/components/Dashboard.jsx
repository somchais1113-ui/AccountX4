import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Line, ComposedChart, Cell, ReferenceLine
} from 'recharts';
import { generateInsights, calculateGrowth } from '../lib/analytics.js';

// Helpers
const fmt = (n, cur = "THB", compact = true) => {
  if (n === null || n === undefined || isNaN(n)) return "N/A";
  const sym = cur === "THB" ? "฿" : cur === "USD" ? "$" : "€";
  if (compact) {
    if (Math.abs(n) >= 1e9) return `${sym}${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `${sym}${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `${sym}${(n / 1e3).toFixed(1)}K`;
  }
  return `${sym}${Math.round(n).toLocaleString()}`;
};

const fmtPct = (n) => n === null || isNaN(n) ? "-" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const fmtRatioPct = (n) => n === null || n === undefined || isNaN(n) ? "-" : `${Number(n).toFixed(1)}%`;
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const pick = (groups = {}, keys = []) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(groups, key)) return n(groups[key]);
  }
  return 0;
};
const sum = (groups = {}, keys = []) => keys.reduce((acc, key) => acc + n(groups[key]), 0);

const REVENUE_KEYS = [
  'revenue', 'sales_revenue', 'healthcare_patient_revenue', 'product_sales_revenue',
  'real_estate_sales_revenue', 'bank_net_interest_income', 'bank_interest_income',
  'bank_net_fee_income', 'bank_fee_income', 'other_income'
];
const EXPENSE_KEYS = [
  'expense', 'cogs', 'sga', 'healthcare_service_cost', 'real_estate_cogs',
  'finance_cost', 'tax', 'bank_interest_expense', 'bank_expected_credit_loss',
  'bank_other_operating_expenses'
];
const COGS_KEYS = ['cogs', 'healthcare_service_cost', 'real_estate_cogs'];
const SGA_KEYS = ['sga', 'bank_other_operating_expenses'];
const CASH_KEYS = ['cash', 'cash_ending', 'cash_beginning'];
const LOAN_KEYS = ['loan', 'bank_borrowings', 'borrowings', 'bank_debt_issued_and_borrowings'];

const getMetrics = (groups = {}) => {
  const revenue = pick(groups, ['revenue']) || sum(groups, REVENUE_KEYS.filter(k => k !== 'revenue'));
  const cogs = sum(groups, COGS_KEYS);
  const sga = sum(groups, SGA_KEYS);
  const financeCost = pick(groups, ['finance_cost', 'bank_interest_expense']);
  const tax = pick(groups, ['tax']);
  const expense = pick(groups, ['expense']) || sum(groups, EXPENSE_KEYS.filter(k => k !== 'expense'));
  const grossProfit = revenue - cogs;
  const operatingProfit = pick(groups, ['operating_profit']) || (revenue ? grossProfit - sga : 0);
  const profitBeforeTax = pick(groups, ['profit_before_tax']) || (operatingProfit - financeCost);
  const netProfit = pick(groups, ['net_profit']) || (revenue ? revenue - expense : 0);
  const asset = pick(groups, ['asset']);
  const liability = pick(groups, ['liability']);
  const equity = pick(groups, ['equity']);
  const cash = pick(groups, CASH_KEYS);
  const currentAssets = pick(groups, ['total_current_assets', 'current_assets']);
  const nonCurrentAssets = pick(groups, ['total_non_current_assets', 'non_current_assets']);
  const currentLiabilities = pick(groups, ['total_current_liabilities', 'current_liabilities']);
  const nonCurrentLiabilities = pick(groups, ['total_non_current_liabilities', 'non_current_liabilities']);
  const loans = pick(groups, LOAN_KEYS);
  const cfo = pick(groups, ['operating_cash_flow']);
  const cfi = pick(groups, ['investing_cash_flow']);
  const cff = pick(groups, ['financing_cash_flow']);
  const dividendPaid = Math.abs(pick(groups, ['dividend_paid']));
  const fcf = cfo + cfi;

  return {
    revenue,
    cogs,
    sga,
    financeCost,
    tax,
    expense,
    grossProfit,
    operatingProfit,
    profitBeforeTax,
    netProfit,
    asset,
    liability,
    equity,
    cash,
    currentAssets,
    nonCurrentAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    loans,
    cfo,
    cfi,
    cff,
    dividendPaid,
    fcf,
    grossMargin: revenue ? (grossProfit / revenue) * 100 : 0,
    netMargin: revenue ? (netProfit / revenue) * 100 : 0,
    cogsRatio: revenue ? (cogs / revenue) * 100 : 0,
    sgaRatio: revenue ? (sga / revenue) * 100 : 0,
    payoutRatio: netProfit ? (dividendPaid / Math.abs(netProfit)) * 100 : 0,
    debtToEquity: equity ? (liability / equity) : 0,
  };
};

const chartTooltip = (C) => ({
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.text,
  boxShadow: '0 12px 32px rgba(0,0,0,0.20)',
});

function MetricCard({ title, value, sub, trend, color, C }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || C.text }}>{value}</div>
      {(sub || trend !== undefined) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>
          {trend !== null && trend !== undefined && <div style={{ fontSize: 13, fontWeight: 700, color: trend >= 0 ? C.green : C.red }}>{fmtPct(trend)}</div>}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, subtitle, children, C, actions = null, span = 1 }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: 20, border: `1px solid ${C.border}`, gridColumn: span === 2 ? '1 / -1' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Pill({ active, children, onClick, C }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? C.accent : C.border}`,
        background: active ? C.accent : C.surface,
        color: active ? '#fff' : C.text,
        borderRadius: 999,
        padding: '7px 12px',
        fontSize: 12,
        fontWeight: 800,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

const statementRows = (th) => ({
  income: [
    { label: th ? 'รายได้รวม' : 'Total revenue', key: 'revenue', color: 'blue' },
    { label: th ? 'ต้นทุนขาย' : 'COGS', key: 'cogs', color: 'red' },
    { label: th ? 'กำไรขั้นต้น' : 'Gross profit', key: 'grossProfit', color: 'green' },
    { label: th ? 'ค่าใช้จ่ายในการขายและบริหาร' : 'SG&A', key: 'sga', color: 'red' },
    { label: th ? 'กำไรจากการดำเนินงาน' : 'Operating profit', key: 'operatingProfit', color: 'green' },
    { label: th ? 'ต้นทุนทางการเงิน' : 'Finance cost', key: 'financeCost', color: 'red' },
    { label: th ? 'ภาษีเงินได้' : 'Income tax', key: 'tax', color: 'red' },
    { label: th ? 'กำไรสุทธิ' : 'Net profit', key: 'netProfit', color: 'accent' },
  ],
  balance: [
    { label: th ? 'เงินสดและรายการเทียบเท่าเงินสด' : 'Cash and equivalents', key: 'cash', color: 'blue' },
    { label: th ? 'สินทรัพย์หมุนเวียน' : 'Current assets', key: 'currentAssets', color: 'blue' },
    { label: th ? 'สินทรัพย์ไม่หมุนเวียน' : 'Non-current assets', key: 'nonCurrentAssets', color: 'blue' },
    { label: th ? 'สินทรัพย์รวม' : 'Total assets', key: 'asset', color: 'blue' },
    { label: th ? 'หนี้สินหมุนเวียน' : 'Current liabilities', key: 'currentLiabilities', color: 'red' },
    { label: th ? 'หนี้สินไม่หมุนเวียน' : 'Non-current liabilities', key: 'nonCurrentLiabilities', color: 'red' },
    { label: th ? 'หนี้สินรวม' : 'Total liabilities', key: 'liability', color: 'red' },
    { label: th ? 'ส่วนของเจ้าของ' : 'Equity', key: 'equity', color: 'green' },
  ],
  cashflow: [
    { label: th ? 'กระแสเงินสดจากการดำเนินงาน' : 'Operating cash flow', key: 'cfo', color: 'green' },
    { label: th ? 'กระแสเงินสดจากการลงทุน' : 'Investing cash flow', key: 'cfi', color: 'blue' },
    { label: th ? 'กระแสเงินสดจากการจัดหาเงิน' : 'Financing cash flow', key: 'cff', color: 'purple' },
    { label: th ? 'กระแสเงินสดอิสระ (CFO + CFI)' : 'Free cash flow (CFO + CFI)', key: 'fcf', color: 'accent' },
    { label: th ? 'เงินปันผลจ่าย' : 'Dividend paid', key: 'dividendPaid', color: 'amber' },
  ],
});

export default function MomentumDashboard({ store, companyId, lang, C, COMPANIES }) {
  const th = lang === "th";
  const company = COMPANIES.find(c => c.id === companyId) || COMPANIES[0];
  const cur = company?.currency || "THB";
  const [periodFilter, setPeriodFilter] = useState('FY');
  const [statementTab, setStatementTab] = useState('income');

  const compStore = store?.[companyId] || {};
  const yearsDesc = Object.keys(compStore).map(Number).sort((a, b) => b - a);
  const yearsAsc = [...yearsDesc].reverse();
  const currentYear = yearsDesc[0] || new Date().getFullYear();
  const displayYear = (y) => th ? y + 543 : y;

  const insights = useMemo(() => generateInsights(store, companyId, currentYear), [store, companyId, currentYear]);

  const chartData = useMemo(() => yearsAsc.map(y => {
    const groups = compStore[y]?.[periodFilter]?.groups || compStore[y]?.FY?.groups || {};
    const m = getMetrics(groups);
    return {
      year: String(displayYear(y)),
      rawYear: y,
      ...m,
      debt: m.liability,
      fcfPositive: m.fcf,
      liabilityShort: m.currentLiabilities,
      liabilityLong: m.nonCurrentLiabilities,
      assetShort: m.currentAssets,
      assetLong: m.nonCurrentAssets,
    };
  }), [compStore, yearsAsc, periodFilter, th]);

  if (!yearsDesc.length) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>{th ? "ไม่มีข้อมูลสำหรับบริษัทนี้ โปรดอัปโหลดงบการเงิน" : "No data available. Please upload financial statements."}</div>;
  }

  const currGroups = compStore[currentYear]?.[periodFilter]?.groups || compStore[currentYear]?.FY?.groups || {};
  const prevGroups = compStore[currentYear - 1]?.[periodFilter]?.groups || compStore[currentYear - 1]?.FY?.groups || {};
  const curr = getMetrics(currGroups);
  const prev = getMetrics(prevGroups);

  const revGrowth = calculateGrowth(curr.revenue, prev.revenue);
  const profitGrowth = calculateGrowth(curr.netProfit, prev.netProfit);
  const assetGrowth = calculateGrowth(curr.asset, prev.asset);
  const palette = {
    revenue: C.blue,
    asset: C.blue,
    netProfit: C.accent,
    green: C.green,
    red: C.red,
    amber: C.amber,
    purple: C.purple,
    cyan: C.green,
  };

  const latestBridge = [
    { name: th ? 'รายได้' : 'Revenue', value: curr.revenue, fill: C.green },
    { name: 'COGS', value: -Math.abs(curr.cogs), fill: C.red },
    { name: th ? 'กำไรขั้นต้น' : 'Gross profit', value: curr.grossProfit, fill: C.blue },
    { name: th ? 'SG&A' : 'SG&A', value: -Math.abs(curr.sga), fill: C.red },
    { name: th ? 'กำไรดำเนินงาน' : 'Operating profit', value: curr.operatingProfit, fill: C.blue },
    { name: th ? 'ดอกเบี้ย/ภาษี' : 'Finance & tax', value: -Math.abs(curr.financeCost + curr.tax), fill: C.amber },
    { name: th ? 'กำไรสุทธิ' : 'Net profit', value: curr.netProfit, fill: C.accent },
  ];

  const tableRows = statementRows(th)[statementTab];
  const tableYears = [...chartData].sort((a, b) => b.rawYear - a.rawYear).slice(0, 8);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{th ? "ระบบวิเคราะห์งบการเงิน" : "Financial Analytics Engine"}</div>
          <div style={{ fontSize: 14, color: C.muted }}>{company?.nameTh} ({company?.tickerSymbol})</div>
        </div>
        <select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, background: C.surface, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}>
          <option value="FY">Annual (FY)</option>
          <option value="Q1">Quarter 1 (Q1)</option>
          <option value="Q2">Quarter 2 (Q2)</option>
          <option value="Q3">Quarter 3 (Q3)</option>
          <option value="Q4">Quarter 4 (Q4)</option>
          <option value="6M">Half Year (6M)</option>
          <option value="9M">9 Months (9M)</option>
        </select>
      </div>

      <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{th ? "AI Insights & Anomalies" : "AI Insights & Anomalies"}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {insights.map((ins, i) => {
            const bg = ins.type === 'danger' ? C.redLo : ins.type === 'warning' ? C.amberLo : ins.type === 'success' ? C.greenLo : C.card;
            const fg = ins.type === 'danger' ? C.red : ins.type === 'warning' ? C.amber : ins.type === 'success' ? C.green : C.text;
            return (
              <div key={i} style={{ background: bg, border: `1px solid ${fg}`, padding: 16, borderRadius: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: fg, marginBottom: 4 }}>{ins.title}</div>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{ins.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <MetricCard C={C} title={th ? "รายได้รวม (Revenue)" : "Revenue"} value={fmt(curr.revenue, cur)} sub={th ? `เทียบปีก่อน (${displayYear(currentYear - 1)})` : "YoY"} trend={revGrowth} color={C.blue} />
        <MetricCard C={C} title={th ? "กำไรสุทธิ (Net Profit)" : "Net Profit"} value={fmt(curr.netProfit, cur)} sub={th ? `เทียบปีก่อน (${displayYear(currentYear - 1)})` : "YoY"} trend={profitGrowth} color={C.accent} />
        <MetricCard C={C} title={th ? "รวมสินทรัพย์ (Assets)" : "Total Assets"} value={fmt(curr.asset, cur)} sub={th ? `เทียบปีก่อน (${displayYear(currentYear - 1)})` : "YoY"} trend={assetGrowth} color={C.blue} />
        <MetricCard C={C} title={th ? "อัตรากำไรสุทธิ (Net Margin)" : "Net Margin"} value={fmtRatioPct(curr.netMargin)} sub={`${th ? 'ปี' : 'FY'} ${displayYear(currentYear)}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginBottom: 24 }}>
        <SectionCard C={C} title={th ? "ความเติบโตและการทำกำไร" : "Growth & Profitability"} subtitle={th ? "รายได้ กำไรสุทธิ และอัตรากำไรสุทธิย้อนหลัง" : "Revenue, net profit, and net margin trend"}>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="year" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => fmt(v, cur)} />
                <YAxis yAxisId="right" orientation="right" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={chartTooltip(C)} formatter={(value, name) => String(name).includes('%') ? `${Number(value).toFixed(1)}%` : fmt(value, cur)} />
                <Legend />
                <Bar yAxisId="left" dataKey="revenue" fill={C.blue} radius={[4, 4, 0, 0]} name={th ? "รายได้" : "Revenue"} />
                <Bar yAxisId="left" dataKey="netProfit" fill={C.green} radius={[4, 4, 0, 0]} name={th ? "กำไรสุทธิ" : "Net Profit"} />
                <Line yAxisId="right" type="monotone" dataKey="netMargin" stroke={C.amber} strokeWidth={3} dot={{ r: 3 }} name={th ? "อัตรากำไรสุทธิ %" : "Net Margin %"} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard C={C} title={th ? "อัตรารายได้ต่อกำไร" : "Profit Bridge"} subtitle={th ? "แสดงตัวขับเคลื่อนจากรายได้ไปสู่กำไรสุทธิของปีล่าสุด" : "Revenue-to-net-profit bridge for the latest FY"}>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latestBridge} margin={{ top: 10, right: 10, left: 0, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="name" stroke={C.muted} fontSize={11} tickLine={false} axisLine={false} interval={0} />
                <YAxis stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => fmt(v, cur)} />
                <ReferenceLine y={0} stroke={C.muted} />
                <Tooltip contentStyle={chartTooltip(C)} formatter={(value) => fmt(value, cur)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} name={th ? "จำนวนเงิน" : "Amount"}>
                  {latestBridge.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard C={C} title={th ? "ความมั่นคงทางการเงิน" : "Financial Stability"} subtitle={th ? "หนี้สิน กระแสเงินสดอิสระ และเงินสดย้อนหลัง" : "Debt, free cash flow, and cash trend"}>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="year" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => fmt(v, cur)} />
                <Tooltip contentStyle={chartTooltip(C)} formatter={(value) => fmt(value, cur)} />
                <Legend />
                <Bar dataKey="liability" fill={C.red} radius={[4, 4, 0, 0]} name={th ? "หนี้สิน" : "Liabilities"} />
                <Bar dataKey="fcf" fill={C.green} radius={[4, 4, 0, 0]} name={th ? "กระแสเงินสดอิสระ" : "Free Cash Flow"} />
                <Bar dataKey="cash" fill={C.blue} radius={[4, 4, 0, 0]} name={th ? "เงินสด" : "Cash"} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard C={C} title={th ? "การวิเคราะห์สถานะทางการเงิน" : "Financial Position Analysis"} subtitle={th ? "เปรียบเทียบสินทรัพย์และหนี้สิน แยกระยะสั้น/ระยะยาว" : "Short/long-term assets and liabilities"}>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { term: th ? 'ระยะสั้น' : 'Short-term', assets: curr.currentAssets || 0, liabilities: curr.currentLiabilities || 0 },
                { term: th ? 'ระยะยาว' : 'Long-term', assets: curr.nonCurrentAssets || 0, liabilities: curr.nonCurrentLiabilities || 0 },
              ]} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="term" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => fmt(v, cur)} />
                <Tooltip contentStyle={chartTooltip(C)} formatter={(value) => fmt(value, cur)} />
                <Legend />
                <Bar dataKey="assets" fill={C.blue} radius={[4, 4, 0, 0]} name={th ? "สินทรัพย์" : "Assets"} />
                <Bar dataKey="liabilities" fill={C.red} radius={[4, 4, 0, 0]} name={th ? "หนี้สิน" : "Liabilities"} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard C={C} title={th ? "ประวัติการจ่ายเงินปันผล" : "Dividend History"} subtitle={th ? "ใช้ข้อมูลเงินปันผลจ่ายจากงบกระแสเงินสด ถ้าไฟล์มีรายการนี้" : "Based on dividend paid in the cash-flow statement when available"} span={2}>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="year" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => fmt(v, cur)} />
                <YAxis yAxisId="right" orientation="right" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={chartTooltip(C)} formatter={(value, name) => String(name).includes('%') ? `${Number(value).toFixed(1)}%` : fmt(value, cur)} />
                <Legend />
                <Bar yAxisId="left" dataKey="dividendPaid" fill={C.green} radius={[4, 4, 0, 0]} name={th ? "เงินปันผลจ่าย" : "Dividend paid"} />
                <Line yAxisId="right" type="monotone" dataKey="payoutRatio" stroke={C.amber} strokeWidth={3} dot={{ r: 3 }} name={th ? "Payout Ratio %" : "Payout Ratio %"} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          C={C}
          title={th ? "งบการเงินแบบละเอียด" : "Detailed Financial Statement"}
          subtitle={th ? "ตารางแบบเลือกหมวดงบ เพื่อไล่ดูตัวเลขสำคัญย้อนหลัง คล้าย financial statement browser" : "Statement browser by section and fiscal year"}
          span={2}
          actions={(
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Pill C={C} active={statementTab === 'income'} onClick={() => setStatementTab('income')}>{th ? 'งบกำไรขาดทุน' : 'P&L'}</Pill>
              <Pill C={C} active={statementTab === 'balance'} onClick={() => setStatementTab('balance')}>{th ? 'งบฐานะการเงิน' : 'Balance'}</Pill>
              <Pill C={C} active={statementTab === 'cashflow'} onClick={() => setStatementTab('cashflow')}>{th ? 'กระแสเงินสด' : 'Cash Flow'}</Pill>
            </div>
          )}
        >
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: Math.max(760, 220 + tableYears.length * 130) }}>
              <div style={{ display: 'grid', gridTemplateColumns: `220px repeat(${tableYears.length}, 1fr)`, borderBottom: `1px solid ${C.border}`, background: C.surface }}>
                <div style={{ padding: '12px 14px', fontSize: 12, color: C.muted, fontWeight: 900 }}>{th ? 'ตัวชี้วัด' : 'Metric'}</div>
                {tableYears.map(row => (
                  <div key={row.rawYear} style={{ padding: '12px 14px', fontSize: 12, color: C.muted, fontWeight: 900, textAlign: 'right' }}>{displayYear(row.rawYear)}</div>
                ))}
              </div>
              {tableRows.map((row, idx) => {
                const color = row.color === 'blue' ? C.blue : row.color === 'red' ? C.red : row.color === 'green' ? C.green : row.color === 'amber' ? C.amber : row.color === 'purple' ? C.purple : C.accent;
                return (
                  <div key={row.key} style={{ display: 'grid', gridTemplateColumns: `220px repeat(${tableYears.length}, 1fr)`, borderBottom: idx < tableRows.length - 1 ? `1px solid ${C.border}` : 'none', background: idx % 2 === 0 ? C.overlay2 : 'transparent' }}>
                    <div style={{ padding: '12px 14px', fontSize: 13, color: C.text, fontWeight: 800, borderLeft: `4px solid ${color}` }}>{row.label}</div>
                    {tableYears.map(y => (
                      <div key={y.rawYear} style={{ padding: '12px 14px', fontSize: 13, color, fontWeight: 700, textAlign: 'right' }}>{fmt(y[row.key], cur)}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
