## v1.5.3 Legal Entity Type Upload Options

- Adds explicit legal entity type options to company creation and upload workflows:
  - บริษัทมหาชนจำกัด / Public Limited Company
  - บริษัทจำกัด / Limited Company
  - ห้างหุ้นส่วนจำกัด / Limited Partnership
- Uses the selected legal entity type to switch upload behavior:
  - บริษัทมหาชนจำกัด → Public / SET-style financial statements
  - บริษัทจำกัด and ห้างหุ้นส่วนจำกัด → Private company financial statements, monthly reports, and trial balance
- Stores `legal_entity_type` on companies and import batches when the migration is installed.
- Keeps backward compatibility if the migration has not been run yet.

## v1.5.2 Slide Workspace + Toggle UI

- Built from `finanalytics-v1.5-private-company-pack-checked.zip`.
- Adds the new Slide Workspace layout: left-side Data Source and right-side Presentation Side.
- Adds segmented toggles for Data Input / Presentation and Upload / Official / Saved source modes.
- Embeds the existing Import Wizard into the Slide Workspace upload source so the slide page can import data without leaving the context.
- Adds Official Source placeholder UI for future SET/DBD/API connectors without relying on scraping.
- Adds saved import/history cards and slide outline controls.
- Updates slide visuals to avoid black primary bars and keeps Assets in blue.


## v3.1 Save UX Hotfix

- Moves import save/loading/error messages to the top of Mapping Preview so users can see what happens after clicking Confirm & Save.
- Disables the Confirm & Save button while saving to prevent duplicate imports.
- Shows a row count while saving and after success.
- Adds clearer Supabase error messages for missing normalized tables / migration / RLS permission issues.
- Inserts normalized rows in chunks for safer larger imports.

# FinAnalytics

แพลตฟอร์มวิเคราะห์การเงินหลายบริษัท รองรับ Supabase Auth/RLS, สิทธิ์รายบริษัท, Audit Log, CSV import, FX consolidation, backup และ PowerPoint export

## เริ่มใช้งาน

ต้องใช้ Node.js 20.19 ขึ้นไป

```bash
npm install
npm run dev
```

เปิด http://localhost:3000

## โหมดการทำงาน

- ไม่มี `.env`: Demo Mode เก็บข้อมูลใน `localStorage`
- มี Supabase URL/Publishable key: Login Mode ใช้ PostgreSQL และ RLS

ดูขั้นตอนเชื่อมฐานข้อมูลใน `SUPABASE-GUIDE.md`

## Environment

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

ห้ามใช้ Supabase `service_role` key ใน frontend

## คำสั่ง

| คำสั่ง | การทำงาน |
|---|---|
| `npm run dev` | เปิด development server |
| `npm run test` | รัน automated tests |
| `npm run build` | สร้าง production build |
| `npm run check` | รัน tests และ build |
| `npm run evaluate:parser -- <file.xlsx>` | ตรวจผล parser กับไฟล์งบจริง |
| `npm run preview` | เปิด production preview |

## ฟีเจอร์

- Momentum: MOM, QOQ, YOY, MTD, YTD, LTM และ CAGR
- Email/password Login, Signup, Reset password
- Row Level Security และบทบาท Owner/Admin/Editor/Viewer
- รายชื่อบริษัทและข้อมูลการเงินจาก Supabase
- CSV validation และตรวจเดือนซ้ำก่อน upsert
- Industry Parser Pack v1 สำหรับ Retail, Manufacturing, Real Estate, Healthcare และ Banking
- Audit Log จาก database trigger
- แปลง USD/EUR เป็น THB ก่อน Consolidation
- JSON backup/restore และ CSV export
- Editable PPTX export
- Dark/Light, ไทย/อังกฤษ และ responsive layout

## โครงสร้างสำคัญ

```text
src/App.jsx                         UI และ routing ภายในแอป
src/lib/supabase.js                Auth และ database API
src/lib/finance.js                 สูตรการเงินและ FX
src/lib/csv.js                     CSV parser/validation
src/lib/backup.js                  Backup และ CSV export
src/lib/exportPptx.js              PowerPoint generation
supabase/migrations/*.sql          Schema, RLS และ Audit triggers
src/lib/*.test.js                  Automated tests
```


## แก้ปัญหา Demo Mode / Supabase ไม่ติด

แอปนี้เป็น Vite/React ดังนั้นตัวแปร Supabase ต้องขึ้นต้นด้วย `VITE_` และจะถูกฝังเข้า bundle ตอน `npm run build`

### Local development

```bash
cp .env.example .env
npm run doctor:supabase
npm run dev
```

`.env` ต้องมีอย่างน้อย:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

ถ้าใช้ key รุ่นเก่า ใช้ `VITE_SUPABASE_ANON_KEY` ได้ด้วย โค้ดจะ fallback ให้อัตโนมัติ

### Vercel / Production

ห้ามหวังพึ่งไฟล์ `.env` ใน Git เพราะโปรเจกต์ ignore `.env` ไว้ถูกต้องแล้ว ให้ไปตั้งที่ Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` หรือ `VITE_SUPABASE_ANON_KEY`

หลังตั้งค่าแล้วต้องกด Redeploy ใหม่ ไม่อย่างนั้น production bundle เดิมจะยังเป็น Demo Mode

### GitHub

ไม่ควรอัปโหลด `node_modules`, `dist`, `.env`, `.DS_Store`, หรือ `__MACOSX` ขึ้น GitHub

## หมายเหตุ

PPTX generator ถูกโหลดเมื่อกด Export เท่านั้นเพื่อลดขนาดหน้าเว็บเริ่มต้น  
การ Restore บน Supabase จะนำเข้าเฉพาะบริษัทที่ผู้ใช้มีสิทธิ์และ ID ตรงกับไฟล์สำรอง

## Industry Parser Pack v1 notes

This build includes `IMPORT_PARSER_V3_INDUSTRY_PACK_V1`, a more flexible import engine for Thai public-company financial statements.

Supported baseline profiles:

| Profile | Master file used for testing | Key support |
|---|---|---|
| Retail / Consumer | MOSHI | SET-style Thai statements, multi-page sheets, retail revenue/COGS/SG&A/cash flow |
| Manufacturing | CPF | consolidated + separate columns, thousand-baht units, biological assets, related-party loans, internal DS sheets ignored |
| Real Estate | SPALI | legacy `.XLS`, development costs, land deposits, contract acquisition costs, property sales/revenue patterns |
| Hospital / Healthcare | BDMS | annual vs 3-month sheet separation, patient revenue, healthcare service cost, member-card liabilities, medical-operation format |
| Banking / Finance | KBANK | bank-specific balance sheet and income statement items such as deposits, loans, interbank items, ECL, net interest income, fee income, derivatives |

Important parser behavior:

- Accepts `.xlsx`, `.xls`, and `.csv`, but original Excel is preferred.
- Keeps original Excel layout; users do not need to force finance files into a rigid CSV template.
- Ignores `DS_INTERNAL_*`, recovered sheets, and BDMS-style quarterly/English 3-month analysis sheets when an annual sheet is present.
- Detects BE/CE years and filters false future-year detections caused by normal numeric amounts.
- Detects consolidated vs separate columns per value column instead of applying one scope to the entire sheet.
- Reads repeated headers, multi-page statements, indented labels, note columns, and multi-line account labels.
- Maps supporting industry-specific lines instead of forcing everything into `other`.
- Keeps source traceability through `source_file`, `source_sheet`, `source_cell`, `raw_account_name`, `raw_amount`, and unit fields.

Master fixture evaluation from the five uploaded industry samples:

| File | Rows parsed | Review rows |
|---|---:|---:|
| Retail / MOSHI | 220 | 0 |
| Manufacturing / CPF | 788 | 0 |
| Real Estate / SPALI | 616 | 0 |
| Healthcare / BDMS | 656 | 0 |
| Banking / KBANK | 727 | 0 |

Use this command locally to evaluate more files:

```bash
npm run evaluate:parser -- ./path/to/FINANCIAL_STATEMENTS.xlsx
```

When a workbook contains comparative years in one file, the import replaces existing rows for every year/period/scope found in the parsed data, not only the primary year.


## Parser v1.2 / Normalized Table Adapter

This build adds a normalized annual-statement adapter for the Data Table page. After importing SET-style Excel statements into `normalized_financial_data`, the Data Table now shows an Annual Financial Statement View with FY rows instead of showing all zeros in monthly columns.

Key changes:
- Derives dashboard/table metrics from `account_group` values stored in `normalized_financial_data`.
- Shows annual rows for imported years such as 2025 and 2024.
- Keeps the old Monthly Operating View, but clearly labels that annual financial statements only populate the FY row.
- If the selected sidebar year has no imported data, the Data Table falls back to the latest available year and displays a warning.
- After a successful import, the selected year is updated to the imported primary fiscal year.


## v1.4 Statement Insight UI

- เพิ่มชุดกราฟแนว Stock analysis: Growth & Profitability, Profit Bridge, Financial Stability, Financial Position Analysis, Dividend History
- เพิ่ม Detailed Financial Statement browser แยกงบกำไรขาดทุน / งบฐานะการเงิน / กระแสเงินสด
- ปรับสีกราฟไม่ให้มีแท่งสีดำเป็นตัวนำ โดยใช้ Asset = Blue, Liability = Red, Equity/Profit/Cash Flow = Green/Accent ตาม theme
- ยังอ่านข้อมูลจาก normalized_financial_data ผ่าน store เดิม ไม่ต้องรัน migration ใหม่

## v1.5 Private Company Import Pack

This version adds a separate import path for non-listed/private companies while keeping the public-company SET parser intact.

### New modes

Company records can now be classified by `company_mode`:

- `public` — listed/public companies using SET-style annual/quarterly financial statements.
- `private` — normal juristic persons/private companies using internal accounting files.

### New private-company upload types

The upload page now changes behavior based on company mode.

For private companies, the importer supports:

1. **Private financial statement** — annual financial statements from an accountant.
2. **Monthly management report** — monthly revenue, expense, cash-in, cash-out, and loan balance.
3. **Trial balance** — account code/name, debit, credit, ending balance.

### New Supabase migration

Run this migration after the previous normalized schema migration:

```sql
supabase/migrations/202606220001_private_company_pack.sql
```

It adds:

- `companies.company_mode`
- `import_batches.source_type`
- `import_batches.parser_profile`
- `monthly_operating_data`
- `trial_balance_data`

The migration is designed to be safe to re-run.

### Suggested private monthly file headers

```csv
month,year,revenue,expense,cash_in,cash_out,loan_balance
1,2025,1200000,800000,950000,700000,5000000
2,2025,1350000,850000,1200000,760000,4900000
```

Thai headers are also supported, for example:

```csv
เดือน,ปี,รายได้,ค่าใช้จ่าย,เงินสดเข้า,เงินสดออก,เงินกู้
1,2568,1200000,800000,950000,700000,5000000
```

### Suggested trial balance headers

```csv
account_code,account_name,debit,credit,ending_balance
4000,Sales revenue,0,12000000,12000000
5000,Cost of sales,7500000,0,7500000
```

Thai headers are also supported, for example:

```csv
รหัสบัญชี,ชื่อบัญชี,เดบิต,เครดิต,ยอดคงเหลือ
4000,รายได้จากการขาย,0,12000000,12000000
5000,ต้นทุนขาย,7500000,0,7500000
```

## v1.6 Data Governance Pack

Adds Import History / Data Lineage, rollback-safe import statuses, raw file metadata, Data Quality checks, and Account Mapping Center.

Run the new migration after v1.5 migrations:

```sql
supabase/migrations/202606220003_data_governance_pack.sql
```

New UI pages:
- Import History: trace imported files, batch status, source file metadata, parsed rows, and rollback an import.
- Data Quality: accounting checks such as Assets ≈ Liabilities + Equity.
- Mapping Center: review low-confidence mappings and persist corrected account groups.

If Supabase Storage bucket creation is restricted in your environment, imports still work; raw file download will be unavailable until the `raw-financial-files` bucket is created.

## v1.7 Alert Engine + LINE-ready Integration

Adds an actor-aware alert layer for auditability and future LINE Messaging API delivery.

### New features
- New sidebar page: Alerts / LINE Alert
- `alert_events` table for line-ready notification queue
- `line_alert_settings` table for company alert preferences
- Every alert stores actor info: user id, email, display name
- Import success / mapping review events
- Import parse/save failure events
- Rollback events
- Account mapping change events
- Permission change events
- LINE settings UI with recipient type/id, but Channel Access Token remains server-side only

### Required migration
Run `supabase/migrations/202606220004_alert_engine.sql` after v1.6 migrations.


## v1.7.1 LINE Edge Functions

This version includes server-side LINE Messaging API integration through Supabase Edge Functions.

- `supabase/functions/line-webhook`: LINE webhook receiver and recipient registration helper.
- `supabase/functions/line-dispatch-alerts`: pending alert dispatcher from `alert_events` to LINE.

Keep LINE tokens and the Supabase service role key in Supabase Edge Function Secrets only. Do not store them in browser code.

## v1.7.5 — Dashboard Data Finder & Historical Snapshot Viewer

This release adds a Dashboard Data Finder so users can search companies, switch fiscal years, and open a specific uploaded batch/file directly from the Dashboard.

Key behavior:
- Latest confirmed mode remains the default Dashboard data source.
- Historical Snapshot mode can open confirmed, superseded, or rolled-back batches for audit/backtracking.
- The Dashboard now shows current file name, batch ID, row count, review count, and status.
- Upload success resets the Dashboard back to Latest confirmed and refreshes Supabase data.
- Import History includes an “Open Dash” action to load a batch snapshot immediately.

Run this migration in Supabase SQL Editor after the previous migrations:

```sql
supabase/migrations/202606220008_dashboard_data_finder_indexes.sql
```

## v1.7.6 — Error Guardrails & Private Snapshot Reconcile

This release is a double-check patch after v1.7.5.

Key fixes:
- Locks private monthly Dashboard values to the latest active batch per company/year/month.
- Marks previous private monthly and trial-balance import batches as `superseded` when a replacement import is saved.
- Adds a reconcile migration for historical private-company snapshots.
- Removes duplicate object keys in frontend payload builders.

Run this migration in Supabase SQL Editor after v1.7.5:

```sql
supabase/migrations/202606220009_private_snapshot_reconcile.sql
```

Known audit note:
- `npm audit` reports a high-severity advisory from `xlsx`. There is no direct patched version available in the current `xlsx` package line. The app still builds and tests successfully. Long-term mitigation is to replace the workbook parser dependency; short-term mitigation is to keep parsing client-side and avoid uploading untrusted/oversized Excel files.
