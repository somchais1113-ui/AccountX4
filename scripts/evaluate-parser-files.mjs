import XLSX from 'xlsx';
import { parseFinancialWorkbook } from '../src/lib/parser.js';
import path from 'node:path';

const files = process.argv.slice(2);

if (!files.length) {
  console.error('Usage: node scripts/evaluate-parser-files.mjs <financial-statement.xlsx|xls> [...]');
  process.exit(1);
}

for (const file of files) {
  const workbook = XLSX.readFile(file, { cellDates: false });
  const rows = parseFinancialWorkbook(workbook, path.basename(file), path.basename(file));
  const groups = Object.entries(rows.reduce((acc, row) => {
    const key = `${row.statement_type} / ${row.account_group}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

  console.log(`\n=== ${path.basename(file)} ===`);
  console.log(JSON.stringify(rows.summary, null, 2));
  console.log('Top mapped groups:');
  groups.slice(0, 30).forEach(([group, count]) => console.log(`- ${group}: ${count}`));

  const reviewRows = rows.filter((row) => row.needs_review);
  if (reviewRows.length) {
    console.log('Review sample:');
    reviewRows.slice(0, 20).forEach((row) => {
      console.log(`- ${row.source_sheet}!${row.source_cell} ${row.statement_type} | ${row.account_group} | ${row.raw_account_name}`);
    });
  }
}
