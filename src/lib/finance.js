export const FinanceMath = {
  MOM: (current, previous) => previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100,
  QOQ: (records, metric, quarterIndex) => {
    if (quarterIndex < 1) return null;
    const sum = (index) => records.slice(index * 3, index * 3 + 3).reduce((total, row) => total + (row?.[metric] || 0), 0);
    const current = sum(quarterIndex);
    const previous = sum(quarterIndex - 1);
    return previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
  },
  YOY: (current, previous) => previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100,
  MTD: (records, metric, monthIndex) => records.slice(0, monthIndex + 1).reduce((total, row) => total + (row?.[metric] || 0), 0),
  YTD: (records, metric) => records.reduce((total, row) => total + (row?.[metric] || 0), 0),
  LTM: (records, metric) => records.slice(-12).reduce((total, row) => total + (row?.[metric] || 0), 0),
  CAGR: (start, end, years) => (start <= 0 || end < 0 || years <= 0) ? null : (Math.pow(end / start, 1 / years) - 1) * 100,
  netProfit: (row) => (row?.revenue || 0) - (row?.expense || 0),
  margin: (row) => (!row || row.revenue === 0) ? 0 : ((row.revenue - row.expense) / row.revenue) * 100,
};

export function convertToTHB(amount, currency, rates = {}) {
  if (currency === "THB") return Number(amount) || 0;
  const rate = Number(rates[currency]);
  return Number.isFinite(rate) && rate > 0 ? (Number(amount) || 0) * rate : null;
}
