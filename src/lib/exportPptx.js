const COLORS = { bg: "0F1528", text: "E4E8FF", muted: "8690B8", blue: "5B7CFA", green: "1FD9A4", red: "F7637C", purple: "A78BFA" };
const money = (value, currency) => `${currency} ${Math.round(value || 0).toLocaleString()}`;

export async function exportFinancialPptx({ company, year, data, previousData, language, financeMath }) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const th = language === "th";
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "FinAnalytics";
  pptx.subject = `${company.nameEn} financial report`;
  pptx.title = `${company.nameEn} ${year}`;
  pptx.company = company.nameEn;
  pptx.lang = th ? "th-TH" : "en-US";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: th ? "Noto Sans Thai" : "Aptos",
    lang: th ? "th-TH" : "en-US",
  };

  const latestIndex = Math.max(0, data.reduce((latest, row, index) => (
    row.revenue || row.expense || row.cashIn || row.cashOut ? index : latest
  ), 0));
  const latest = data[latestIndex];
  const ytdRevenue = financeMath.YTD(data.slice(0, latestIndex + 1), "revenue");
  const ytdExpense = financeMath.YTD(data.slice(0, latestIndex + 1), "expense");
  const netProfit = latest.revenue - latest.expense;
  const margin = latest.revenue ? netProfit / latest.revenue * 100 : 0;
  const mom = latestIndex ? financeMath.MOM(latest.revenue, data[latestIndex - 1].revenue) : null;
  const yoy = previousData[latestIndex]?.revenue ? financeMath.YOY(latest.revenue, previousData[latestIndex].revenue) : null;

  const base = (slide, section) => {
    slide.background = { color: COLORS.bg };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.06, fill: { color: COLORS.blue }, line: { color: COLORS.blue } });
    slide.addText(section, { x: 0.6, y: 0.35, w: 6, h: 0.25, fontSize: 10, bold: true, color: COLORS.blue, charSpacing: 2, margin: 0 });
    slide.addText("CONFIDENTIAL · FinAnalytics", { x: 9.5, y: 7.15, w: 3.2, h: 0.2, fontSize: 8, color: COLORS.muted, align: "right", margin: 0 });
  };
  const addMetric = (slide, x, title, value, color = COLORS.text, subtitle = "", y = 2.25) => {
    slide.addText(title, { x, y, w: 3.6, h: 0.3, fontSize: 14, color: COLORS.muted, margin: 0 });
    slide.addText(value, { x, y: y + 0.4, w: 3.6, h: 0.55, fontSize: 27, bold: true, color, margin: 0, fit: "shrink" });
    if (subtitle) slide.addText(subtitle, { x, y: y + 1, w: 3.6, h: 0.3, fontSize: 12, color: COLORS.muted, margin: 0 });
  };

  let slide = pptx.addSlide();
  base(slide, "MONTHLY FINANCIAL REPORT");
  slide.addText(th ? company.nameTh : company.nameEn, { x: 0.8, y: 1.65, w: 11.7, h: 0.7, fontSize: 38, bold: true, color: "FFFFFF", align: "center", margin: 0, fit: "shrink" });
  slide.addText(`${year} · ${company.currency}`, { x: 0.8, y: 2.55, w: 11.7, h: 0.4, fontSize: 20, color: COLORS.muted, align: "center", margin: 0 });
  addMetric(slide, 1.1, th ? "รายได้ YTD" : "YTD Revenue", money(ytdRevenue, company.currency), COLORS.blue, "", 3.45);
  addMetric(slide, 4.9, th ? "กำไร YTD" : "YTD Profit", money(ytdRevenue - ytdExpense, company.currency), COLORS.green, "", 3.45);
  addMetric(slide, 8.7, "Margin", `${margin.toFixed(1)}%`, margin >= 0 ? COLORS.green : COLORS.red, "", 3.45);

  slide = pptx.addSlide();
  base(slide, "EXECUTIVE SUMMARY");
  slide.addText(th ? "สรุปผู้บริหาร" : "Executive Summary", { x: 0.6, y: 0.85, w: 8, h: 0.55, fontSize: 30, bold: true, color: "FFFFFF", margin: 0 });
  addMetric(slide, 0.8, th ? "รายได้ล่าสุด" : "Latest Revenue", money(latest.revenue, company.currency), COLORS.blue, `MOM ${mom == null ? "N/A" : `${mom.toFixed(1)}%`}`);
  addMetric(slide, 4.8, th ? "กำไรสุทธิ" : "Net Profit", money(netProfit, company.currency), netProfit >= 0 ? COLORS.green : COLORS.red, `Margin ${margin.toFixed(1)}%`);
  addMetric(slide, 8.8, th ? "เติบโต YOY" : "YOY Growth", yoy == null ? "N/A" : `${yoy.toFixed(1)}%`, yoy >= 0 ? COLORS.green : COLORS.red);

  slide = pptx.addSlide();
  base(slide, "REVENUE & EXPENSE");
  slide.addText(th ? "แนวโน้มรายได้และค่าใช้จ่าย" : "Revenue and Expense Trend", { x: 0.6, y: 0.85, w: 9, h: 0.55, fontSize: 30, bold: true, color: "FFFFFF", margin: 0 });
  slide.addChart(pptx.ChartType.line, [
    { name: th ? "รายได้" : "Revenue", labels: data.map((row) => row.monthEn), values: data.map((row) => row.revenue) },
    { name: th ? "ค่าใช้จ่าย" : "Expense", labels: data.map((row) => row.monthEn), values: data.map((row) => row.expense) },
  ], {
    x: 0.7, y: 1.65, w: 11.9, h: 4.9,
    catAxisLabelColor: COLORS.muted, valAxisLabelColor: COLORS.muted,
    chartColors: [COLORS.blue, COLORS.red], showLegend: true, legendColor: COLORS.text,
    showTitle: false, showValue: false, showCatName: false,
    showBorder: false, showLine: true,
  });

  slide = pptx.addSlide();
  base(slide, "CASHFLOW");
  slide.addText(th ? "กระแสเงินสดรายเดือน" : "Monthly Cashflow", { x: 0.6, y: 0.85, w: 9, h: 0.55, fontSize: 30, bold: true, color: "FFFFFF", margin: 0 });
  slide.addChart(pptx.ChartType.bar, [
    { name: th ? "เงินสดเข้า" : "Cash In", labels: data.map((row) => row.monthEn), values: data.map((row) => row.cashIn) },
    { name: th ? "เงินสดออก" : "Cash Out", labels: data.map((row) => row.monthEn), values: data.map((row) => row.cashOut) },
  ], {
    x: 0.7, y: 1.65, w: 11.9, h: 4.9,
    catAxisLabelColor: COLORS.muted, valAxisLabelColor: COLORS.muted,
    chartColors: [COLORS.green, COLORS.red], showLegend: true, legendColor: COLORS.text,
    showTitle: false, showValue: false, showBorder: false,
  });

  await pptx.writeFile({ fileName: `FinAnalytics-${company.nameEn.replace(/[^a-z0-9]+/gi, "-")}-${year}.pptx` });
}
