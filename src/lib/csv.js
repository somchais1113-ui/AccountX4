export function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("(") && raw.endsWith(")");
  const parsed = Number(raw.replace(/[()฿$€,\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

export function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quote");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export function normalizeFinancialCSV(text, language = "th") {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[\s_-]/g, ""));
  const seenMonths = new Set();

  return rows.slice(1).map((values, index) => {
    const source = {};
    headers.forEach((header, column) => { source[header] = values[column]?.trim() ?? ""; });
    const month = Math.round(parseNumber(source.month || source["เดือน"]));
    if (month < 1 || month > 12) {
      throw new Error(language === "th" ? `เดือนในแถว ${index + 2} ต้องเป็น 1-12` : `Month on row ${index + 2} must be 1-12`);
    }
    if (seenMonths.has(month)) {
      throw new Error(language === "th" ? `เดือน ${month} ซ้ำในไฟล์` : `Duplicate month ${month} in file`);
    }
    seenMonths.add(month);
    return {
      monthIdx: month - 1,
      cashIn: parseNumber(source.cashin || source["รายรับ"]),
      cashOut: parseNumber(source.cashout || source["รายจ่าย"]),
      revenue: parseNumber(source.revenue || source.income || source["รายได้"]),
      expense: parseNumber(source.expense || source.cost || source["ค่าใช้จ่าย"]),
      loanBalance: parseNumber(source.loanbalance || source.loan || source["เงินกู้"]),
    };
  });
}
