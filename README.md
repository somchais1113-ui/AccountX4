
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
