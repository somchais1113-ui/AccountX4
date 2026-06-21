function downloadBlob(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportBackup(companies, store, exchangeRates) {
  const payload = {
    format: "finanalytics-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    companies,
    store,
    exchangeRates,
  };
  downloadBlob(JSON.stringify(payload, null, 2), `finanalytics-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
}

export function parseBackup(text) {
  const payload = JSON.parse(text);
  if (payload?.format !== "finanalytics-backup" || payload?.version !== 1 || typeof payload.store !== "object") {
    throw new Error("Invalid FinAnalytics backup file");
  }
  return payload;
}

export function exportRecordsCSV(companies, store) {
  const rows = [[
    "company_id", "company", "currency", "year", "period", "account_group",
    "revenue", "expense", "cash_in", "cash_out", "loan_balance", "amount"
  ]];

  companies.forEach((company) => {
    Object.entries(store?.[company.id] || {}).forEach(([year, periods]) => {
      Object.entries(periods || {}).forEach(([periodKey, record]) => {
        if (record?.groups && typeof record.groups === "object") {
          Object.entries(record.groups).forEach(([accountGroup, amount]) => rows.push([
            company.id, company.nameEn, company.currency, year, periodKey, accountGroup,
            accountGroup === "revenue" ? amount : "",
            accountGroup === "expense" ? amount : "",
            accountGroup === "operating_cash_flow" && Number(amount) > 0 ? amount : "",
            accountGroup === "operating_cash_flow" && Number(amount) < 0 ? Math.abs(Number(amount)) : "",
            accountGroup === "loan" ? amount : "",
            amount,
          ]));
          return;
        }

        rows.push([
          company.id, company.nameEn, company.currency, year, Number.isInteger(record?.monthIdx) ? record.monthIdx + 1 : periodKey, "legacy_monthly",
          record?.revenue, record?.expense, record?.cashIn, record?.cashOut, record?.loanBalance, "",
        ]);
      });
    });
  });

  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadBlob(csv, `finanalytics-records-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
}
