# Supabase Setup — FinAnalytics

โปรเจกต์เตรียม Supabase Auth, PostgreSQL, Row Level Security และ Audit Log ไว้แล้ว  
ถ้ายังไม่มี `.env` แอปจะทำงานใน Demo Mode และเก็บข้อมูลใน browser เท่านั้น

## 1. สร้าง Supabase Project

1. สร้างโปรเจกต์ที่ https://supabase.com
2. เปิด **SQL Editor**
3. รันไฟล์ `supabase/migrations/202606200001_initial_schema.sql` ทั้งไฟล์หนึ่งครั้ง

Migration จะสร้าง:

- `profiles`
- `companies`
- `company_members`
- `financial_records`
- `exchange_rates`
- `audit_log`
- RLS policies ทุกตาราง
- Audit triggers
- RPC สำหรับให้และถอนสิทธิ์บริษัท

## 2. ตั้งค่า Environment

คัดลอก `.env.example` เป็น `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

หา URL และ Publishable key ได้ใน **Project Settings → API Keys**

ใช้ Publishable/anon key เท่านั้น ห้ามนำ `service_role` key มาใส่ในเว็บ

หลังแก้ `.env` ให้ตรวจและเปิด development server ใหม่:

```bash
npm run doctor:supabase
npm run dev
```
### หมายเหตุสำคัญสำหรับ Vite + Vercel

- ตัวแปรที่ frontend อ่านได้ต้องขึ้นต้นด้วย `VITE_`
- ถ้า deploy ผ่าน Vercel ต้องเพิ่ม Environment Variables ใน Vercel ไม่ใช่อัปโหลด `.env` เข้า GitHub
- หลังเพิ่มหรือแก้ Environment Variables ต้อง Redeploy ใหม่
- ถ้ายังขึ้น Demo Mode ให้รัน `npm run doctor:supabase` ในเครื่องเพื่อตรวจชื่อ env ก่อน
- โค้ดรองรับทั้ง `VITE_SUPABASE_PUBLISHABLE_KEY` และ `VITE_SUPABASE_ANON_KEY`


## 3. Authentication

หน้าเว็บรองรับ:

- สมัครด้วย Email/Password
- Login
- Reset password
- Sign out

Supabase hosted projects เปิดการยืนยันอีเมลเป็นค่าเริ่มต้น ผู้ใช้จึงอาจต้องกดลิงก์ในอีเมลก่อน Login

สำหรับ production ควรตั้งค่า:

- Authentication → URL Configuration → Site URL
- Redirect URLs สำหรับ localhost และโดเมนจริง
- Custom SMTP เพราะบริการอีเมลเริ่มต้นเหมาะกับการทดลองเท่านั้น

## 4. บริษัทแรกและสิทธิ์

หลังผู้ใช้คนแรก Login:

1. แอปจะแสดงหน้าสร้างบริษัทแรก
2. ผู้สร้างจะเป็น `owner` อัตโนมัติ
3. ไปหน้า **สิทธิ์ผู้ใช้**
4. เพิ่มผู้ใช้ด้วยอีเมลและเลือกบทบาท

ผู้รับสิทธิ์ต้องสมัครบัญชีแล้วก่อน

บทบาท:

| Role | สิทธิ์ |
|---|---|
| owner | จัดการทุกอย่างและให้สิทธิ์ Owner |
| admin | จัดการสมาชิก, FX และข้อมูล |
| editor | เพิ่มและแก้ไขข้อมูลการเงิน |
| viewer | ดูข้อมูลเท่านั้น |

## 5. Row Level Security

RLS ถูกเปิดทุกตารางที่เปิดผ่าน API:

- ผู้ใช้เห็นเฉพาะบริษัทที่เป็นสมาชิก
- Editor ขึ้นไปจึงเขียนข้อมูลการเงินได้
- Admin/Owner จัดการสมาชิกและอัตราแลกเปลี่ยนได้
- Audit log เขียนได้เฉพาะ database trigger
- Publishable key เพียงอย่างเดียวไม่สามารถข้าม RLS

## 6. Audit Log

Database trigger บันทึก `INSERT`, `UPDATE`, `DELETE` ของ:

- companies
- company_members
- financial_records
- exchange_rates

บันทึกทั้งข้อมูลก่อน/หลัง ผู้ใช้ อีเมล เวลา และบริษัทที่เกี่ยวข้อง

## 7. ตรวจระบบ

```bash
npm run check
```

คำสั่งนี้รัน automated tests และ production build

## 8. Deployment

ตั้ง Environment Variables สองตัวเดียวกับ `.env` บน Vercel/Netlify แล้วเพิ่ม URL จริงใน Supabase Redirect URLs

ก่อนเปิด production:

- ทดลองบัญชี Viewer ว่าเขียนข้อมูลไม่ได้
- ทดลอง Editor ว่าแก้ข้อมูลได้ แต่จัดการสมาชิกไม่ได้
- ทดลอง Admin/Owner
- ตรวจ Audit Log
- ตั้ง Custom SMTP และ backup policy

## Parser v2 import behavior

For real financial statement Excel files, the app now saves source traceability fields such as source file, sheet, row, column, and cell. It also imports multiple years from one workbook, so a single annual financial-statement file can update both the current year and comparative year data.

After deploying this version, upload the original `.xlsx` file in the Upload page. The preview screen should show detected years, statement count, parsed rows, and review count before saving.

## Optional v1.5.3 legal entity type migration

หลังรัน `202606220001_private_company_pack.sql` แล้ว ให้รันไฟล์นี้เพิ่มถ้าต้องการเก็บประเภทนิติบุคคลแยกชัดเจน:

```sql
supabase/migrations/202606220002_legal_entity_type.sql
```

เพิ่ม field:

- `companies.legal_entity_type`
- `import_batches.legal_entity_type`

ค่าที่รองรับ:

- `public_limited` = บริษัทมหาชนจำกัด
- `limited_company` = บริษัทจำกัด
- `limited_partnership` = ห้างหุ้นส่วนจำกัด

Migration นี้ safe rerun ได้ และมี `notify pgrst, 'reload schema';` ให้แล้ว

## v1.6 Migration: Data Governance Pack

Run after v1.5.3 legal entity migration:

```sql
supabase/migrations/202606220003_data_governance_pack.sql
```

This adds:
- `import_batches.file_hash`, `file_size`, `storage_path`, `total_rows`, `review_count`, `validation_summary`
- import lifecycle statuses: `confirmed`, `superseded`, `rolled_back`
- Supabase Storage bucket `raw-financial-files`
- storage policies for company members

Recommended check:

```sql
select id, file_name, status, total_rows, review_count, storage_path, imported_at
from public.import_batches
order by imported_at desc;
```

## v1.7 Alert Engine Migration

Run this after the v1.6 Data Governance migration:

```sql
-- supabase/migrations/202606220004_alert_engine.sql
```

Then verify:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
and table_name in ('alert_events', 'line_alert_settings')
order by table_name;
```

Expected:

```text
alert_events
line_alert_settings
```

LINE Channel Access Tokens must not be stored in the frontend or public Supabase tables. Store them in server/edge function environment variables when the real LINE push sender is added.


## v1.7.1 LINE Edge Functions

This build adds Supabase Edge Functions for real LINE delivery. LINE secrets must stay on the server side only.

### Functions added

- `line-webhook` — receives LINE webhook events, verifies `x-line-signature`, replies with the user/group/room recipient ID, and can register a company with commands such as `register MOSHI`.
- `line-dispatch-alerts` — reads pending `alert_events` and pushes messages to LINE through the Messaging API.

### Required Supabase secrets

Set these in Supabase Dashboard > Project Settings > Edge Functions > Secrets, or through Supabase CLI:

```bash
supabase secrets set LINE_CHANNEL_ACCESS_TOKEN="YOUR_LINE_CHANNEL_ACCESS_TOKEN"
supabase secrets set LINE_CHANNEL_SECRET="YOUR_LINE_CHANNEL_SECRET"
supabase secrets set SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
supabase secrets set ALERT_DISPATCH_SECRET="make-a-long-random-secret"
```

Never put `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY` in `.env`, frontend code, Vercel public env vars, or chat messages.

### Deploy functions

```bash
supabase functions deploy line-webhook --no-verify-jwt
supabase functions deploy line-dispatch-alerts --no-verify-jwt
```

### LINE webhook URL

After deploy, set this URL in LINE Developers / LINE Official Account Messaging API webhook URL:

```text
https://YOUR_PROJECT_REF.functions.supabase.co/line-webhook
```

Then enable webhook and verify it.

### Get recipient ID

Add the LINE Official Account as a friend or invite it to a group. Send one of these messages:

```text
register
```

The bot replies with the recipient ID. Copy it into FinAnalytics > Alerts > LINE Settings.

Or register a company directly:

```text
register MOSHI
```

The bot will find the company by ticker/name and save `recipient_id` in `line_alert_settings`.

### Dispatch pending alerts manually

```bash
curl -X POST \
  -H "x-dispatch-secret: YOUR_ALERT_DISPATCH_SECRET" \
  "https://YOUR_PROJECT_REF.functions.supabase.co/line-dispatch-alerts?limit=20"
```

For production, schedule this function with Supabase Cron, Vercel Cron, GitHub Actions, or another secure scheduler.
