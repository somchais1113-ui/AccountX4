import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart, Cell } from 'recharts';
import { generateInsights, calculateGrowth } from '../lib/analytics.js';

// Helpers
const fmt = (n, cur="THB", compact=true) => {
  if (n===null||n===undefined||isNaN(n)) return "N/A";
  const sym = cur==="THB"?"฿":cur==="USD"?"$":"€";
  if (compact) {
    if (Math.abs(n)>=1e6) return `${sym}${(n/1e6).toFixed(2)}M`;
    if (Math.abs(n)>=1e3) return `${sym}${(n/1e3).toFixed(1)}K`;
  }
  return `${sym}${Math.round(n).toLocaleString()}`;
};

const fmtPct = (n) => n===null||isNaN(n) ? "-" : `${n>0?"+":""}${(n*100).toFixed(1)}%`;

function MetricCard({ title, value, sub, trend, color, C }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{value}</div>
      {(sub || trend !== undefined) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>
          {trend !== null && trend !== undefined && <div style={{ fontSize: 13, fontWeight: 700, color: trend >= 0 ? C.green : C.red }}>{fmtPct(trend)}</div>}
        </div>
      )}
    </div>
  );
}

export default function MomentumDashboard({ store, companyId, lang, C, COMPANIES, INDUSTRIES }) {
  const th = lang === "th";
  const company = COMPANIES.find(c => c.id === companyId) || COMPANIES[0];
  const cur = company?.currency || "THB";
  const [periodFilter, setPeriodFilter] = useState('FY');

  const compStore = store?.[companyId] || {};
  const yearsDesc = Object.keys(compStore).map(Number).sort((a,b)=>b-a);
  const yearsAsc = [...yearsDesc].reverse();
  const currentYear = yearsDesc[0] || new Date().getFullYear();
  const displayYear = (y) => th ? y + 543 : y;
  
  const insights = useMemo(() => generateInsights(store, companyId, currentYear), [store, companyId, currentYear]);

  // Extract metrics for charts
  const chartData = useMemo(() => {
    return yearsAsc.map(y => {
      const g = compStore[y]?.[periodFilter]?.groups || {};
      const rev = g.revenue || 0;
      const cogs = g.cogs || 0;
      const sga = g.sga || 0;
      const np = g.net_profit || 0;
      const ast = g.asset || 0;
      const lia = g.liability || 0;
      const eq = g.equity || 0;
      
      const grossProfit = rev - cogs;
      const grossMargin = rev > 0 ? (grossProfit / rev) * 100 : 0;
      const netMargin = rev > 0 ? (np / rev) * 100 : 0;
      const cogsRatio = rev > 0 ? (cogs / rev) * 100 : 0;
      const sgaRatio = rev > 0 ? (sga / rev) * 100 : 0;

      return {
        year: String(displayYear(y)),
        rawYear: y,
        revenue: rev,
        netProfit: np,
        grossMargin,
        netMargin,
        cogsRatio,
        sgaRatio,
        asset: ast,
        liability: lia,
        equity: eq,
        ocf: g.operating_cash_flow || 0
      };
    });
  }, [compStore, yearsAsc, periodFilter]);

  if (!yearsDesc.length) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>{th ? "ไม่มีข้อมูลสำหรับบริษัทนี้ โปรดอัปโหลดงบการเงิน" : "No data available. Please upload financial statements."}</div>;
  }

  const currGroups = compStore[currentYear]?.[periodFilter]?.groups || {};
  const prevGroups = compStore[currentYear - 1]?.[periodFilter]?.groups || {};

  const revGrowth = calculateGrowth(currGroups.revenue, prevGroups.revenue);
  const profitGrowth = calculateGrowth(currGroups.net_profit, prevGroups.net_profit);
  const assetGrowth = calculateGrowth(currGroups.asset, prevGroups.asset);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{th ? "ระบบวิเคราะห์งบการเงิน" : "Financial Analytics Engine"}</div>
          <div style={{ fontSize: 14, color: C.muted }}>{company?.nameTh} ({company?.tickerSymbol})</div>
        </div>
        <select value={periodFilter} onChange={e=>setPeriodFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, background: C.surface, color: C.text, border: `1px solid ${C.border}`, outline: 'none' }}>
          <option value="FY">Annual (FY)</option>
          <option value="Q1">Quarter 1 (Q1)</option>
          <option value="Q2">Quarter 2 (Q2)</option>
          <option value="Q3">Quarter 3 (Q3)</option>
          <option value="Q4">Quarter 4 (Q4)</option>
          <option value="6M">Half Year (6M)</option>
          <option value="9M">9 Months (9M)</option>
        </select>
      </div>

      {/* AI INSIGHTS */}
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
        <MetricCard C={C} title={th?"รายได้รวม (Revenue)":"Revenue"} value={fmt(currGroups.revenue, cur)} sub={th?`เทียบปีก่อน (${displayYear(currentYear-1)})`:"YoY"} trend={revGrowth} />
        <MetricCard C={C} title={th?"กำไรสุทธิ (Net Profit)":"Net Profit"} value={fmt(currGroups.net_profit, cur)} sub={th?`เทียบปีก่อน (${displayYear(currentYear-1)})`:"YoY"} trend={profitGrowth} />
        <MetricCard C={C} title={th?"รวมสินทรัพย์ (Assets)":"Total Assets"} value={fmt(currGroups.asset, cur)} sub={th?`เทียบปีก่อน (${displayYear(currentYear-1)})`:"YoY"} trend={assetGrowth} />
        <MetricCard C={C} title={th?"อัตรากำไรสุทธิ (Net Margin)":"Net Margin"} value={currGroups.revenue > 0 ? ((currGroups.net_profit/currGroups.revenue)*100).toFixed(1)+'%' : 'N/A'} sub={`${th?'ปี':'FY'} ${displayYear(currentYear)}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
        
        {/* REVENUE & PROFIT TREND */}
        <div style={{ background: C.card, borderRadius: 12, padding: 20, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>{th ? "แนวโน้มรายได้และกำไร" : "Revenue & Profit Trend"}</div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="year" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => fmt(v, cur)} />
                <YAxis yAxisId="right" orientation="right" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text }} />
                <Legend />
                <Bar yAxisId="left" dataKey="revenue" fill={C.accent} radius={[4, 4, 0, 0]} name={th ? "รายได้" : "Revenue"} />
                <Line yAxisId="left" type="monotone" dataKey="netProfit" stroke={C.green} strokeWidth={3} name={th ? "กำไรสุทธิ" : "Net Profit"} />
                <Line yAxisId="right" type="monotone" dataKey="netMargin" stroke={C.amber} strokeWidth={2} strokeDasharray="5 5" dot={false} name={th ? "Net Margin %" : "Net Margin %"} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* COST STRUCTURE */}
        <div style={{ background: C.card, borderRadius: 12, padding: 20, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>{th ? "โครงสร้างต้นทุน (Cost Structure %)" : "Cost Structure (%)"}</div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="year" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text }} />
                <Legend />
                <Bar dataKey="grossMargin" stackId="a" fill={C.green} name={th ? "Gross Margin" : "Gross Margin"} />
                <Bar dataKey="cogsRatio" stackId="a" fill={C.red} name={th ? "COGS %" : "COGS %"} />
                <Bar dataKey="sgaRatio" stackId="a" fill={C.amber} name={th ? "SG&A %" : "SG&A %"} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* FINANCIAL POSITION */}
        <div style={{ background: C.card, borderRadius: 12, padding: 20, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>{th ? "โครงสร้างทางการเงิน (งบฐานะการเงิน)" : "Financial Position"}</div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="year" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => fmt(v, cur)} />
                <Tooltip contentStyle={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text }} />
                <Legend />
                <Bar dataKey="asset" fill={C.blue} radius={[4, 4, 0, 0]} name={th ? "สินทรัพย์" : "Assets"} />
                <Bar dataKey="liability" fill={C.red} radius={[4, 4, 0, 0]} name={th ? "หนี้สิน" : "Liabilities"} />
                <Bar dataKey="equity" fill={C.green} radius={[4, 4, 0, 0]} name={th ? "ส่วนของเจ้าของ" : "Equity"} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CASH FLOW */}
        <div style={{ background: C.card, borderRadius: 12, padding: 20, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>{th ? "กระแสเงินสดจากการดำเนินงาน (CFO)" : "Operating Cash Flow"}</div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="year" stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={C.muted} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => fmt(v, cur)} />
                <Tooltip contentStyle={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text }} />
                <Legend />
                <Bar dataKey="ocf" fill={C.accent} radius={[4, 4, 0, 0]} name={th ? "Operating Cash Flow" : "OCF"}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.ocf >= 0 ? C.accent : C.red} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
      
    </div>
  );
}
