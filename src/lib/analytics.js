/**
 * Comparative Financial Analytics Engine
 * Provides functions for Growth Analysis, Margin Analysis, and Rule-based Insights.
 */

export function calculateGrowth(current, previous) {
  if (!previous || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function generateInsights(store, companyId, currentYear) {
  if (!store || !store[companyId]) return [];
  const insights = [];
  const curr = store[companyId][currentYear]?.FY?.groups || {};
  const prevYear = currentYear - 1;
  const prev = store[companyId][prevYear]?.FY?.groups || null;

  if (!prev) {
    insights.push({ type: 'info', title: 'ข้อมูลปีแรก', desc: `ยังไม่มีข้อมูลปีก่อนหน้า (${prevYear}) เพื่อนำมาเปรียบเทียบ` });
    return insights;
  }

  // Revenue & Profit Analysis
  const revGrowth = calculateGrowth(curr.revenue, prev.revenue);
  const profitGrowth = calculateGrowth(curr.net_profit, prev.net_profit);

  if (revGrowth !== null && profitGrowth !== null) {
    if (revGrowth > 0.05 && profitGrowth < 0) {
      insights.push({ 
        type: 'danger', 
        title: 'Margin Compression (อัตรากำไรถูกกดดัน)', 
        desc: `รายได้เติบโต ${(revGrowth*100).toFixed(1)}% แต่กำไรสุทธิลดลง ${(profitGrowth*100).toFixed(1)}% บ่งบอกถึงต้นทุนหรือค่าใช้จ่ายที่สูงขึ้นเร็วกว่ายอดขาย ควรตรวจสอบต้นทุนขาย (COGS) และค่าใช้จ่าย SG&A` 
      });
    } else if (revGrowth > 0 && profitGrowth > revGrowth * 1.2) {
      insights.push({
        type: 'success',
        title: 'Operating Leverage (ประสิทธิภาพการทำกำไรสูง)',
        desc: `กำไรเติบโต ${(profitGrowth*100).toFixed(1)}% ซึ่งสูงกว่าการเติบโตของรายได้ (${(revGrowth*100).toFixed(1)}%) บ่งบอกถึงการควบคุมต้นทุนคงที่ได้ดี`
      });
    }
  }

  // Cash Flow & Quality of Earnings
  if (curr.net_profit > 0 && curr.operating_cash_flow < 0) {
    insights.push({
      type: 'warning',
      title: 'Quality of Earnings เสี่ยง (กำไรเป็นบวก แต่กระแสเงินสดติดลบ)',
      desc: `บริษัทมีกำไรสุทธิ ${formatMoney(curr.net_profit)} แต่กระแสเงินสดจากการดำเนินงานติดลบ ${formatMoney(curr.operating_cash_flow)} อาจมีปัญหาการเก็บเงินลูกหนี้ หรือสต็อกสินค้าจม`
    });
  }

  // Cost Analysis
  if (prev.cogs && prev.revenue) {
    const prevCogsMargin = prev.cogs / prev.revenue;
    const currCogsMargin = curr.cogs / curr.revenue;
    if (currCogsMargin - prevCogsMargin > 0.03) {
      insights.push({
        type: 'warning',
        title: 'ต้นทุนขายพุ่งสูง (COGS increased)',
        desc: `สัดส่วนต้นทุนขายต่อรายได้เพิ่มขึ้นจาก ${(prevCogsMargin*100).toFixed(1)}% เป็น ${(currCogsMargin*100).toFixed(1)}% อาจเกิดจากราคาวัตถุดิบแพงขึ้น หรือการปรับลดราคาสินค้า`
      });
    }
  }

  // Leverage & Debt
  if (curr.liability && curr.equity) {
    const deRatio = curr.liability / curr.equity;
    if (deRatio > 2.0) {
      insights.push({
        type: 'danger',
        title: 'หนี้สินสูง (High Leverage)',
        desc: `อัตราส่วนหนี้สินต่อทุน (D/E Ratio) สูงถึง ${deRatio.toFixed(2)} เท่า บ่งบอกถึงความเสี่ยงทางการเงินที่สูงและภาระดอกเบี้ยจ่ายที่อาจกระทบกำไร`
      });
    }
  }

  if (insights.length === 0) {
    insights.push({ type: 'success', title: 'ฐานะการเงินและผลประกอบการปกติ', desc: 'ไม่พบความผิดปกติที่เป็นสาระสำคัญจากตัวเลขในงบการเงิน' });
  }

  return insights;
}

function formatMoney(num) {
  if (num === null || num === undefined) return '-';
  if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  return num.toLocaleString();
}
