# ฐานข้อมูล

PostgreSQL (ตอนนี้ใช้ Neon) · โครงตารางทั้งหมดอยู่ใน [schema.sql](schema.sql)

## ตั้งค่า

1. คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ `DATABASE_URL`
2. `npm run db:setup` — สร้างตาราง (รันซ้ำได้ ไม่ลบข้อมูล)

เปิดหน้าเว็บครั้งแรก ระบบจะใส่ข้อมูลตัวอย่างให้แต่ละชุดข้อมูลหนึ่งครั้ง (บันทึกไว้ในตาราง `app_seed`)

## ตารางกับหน้าเว็บ

| ชุดข้อมูล (key) | ตาราง | หน้า |
|---|---|---|
| residents | residents | ผู้รับบริการ |
| contracts | contracts | สัญญาบริการ |
| assessments | care_assessments | แผนดูแลและใบประเมิน |
| daily-YYYY-MM-DD | daily_tasks (`work_date`) | งานประจำวัน |
| tasks_table | task_logs | ทะเบียนงาน |
| facility | facility_tasks | งานทั่วไปของศูนย์ |
| master | master_tasks | คลังงานมาตรฐาน |
| appointments | appointments | ตารางนัดหมาย |
| health | health_logs | บันทึกสุขภาพ |
| complaints | complaints | เสียงจากครอบครัว |
| docs | official_documents | เอกสารและระเบียบ |
| branches | branches | สาขาของเรา |
| staff | staff_users | ทีมและสิทธิ์การใช้งาน |
| pharmacy-master | drug_catalog | แอปจัดยา · ฐานข้อมูลยา |
| pharmacy-drugs | resident_medications | แอปจัดยา · คลังยา |
| pharmacy-packs | medication_packs | แอปจัดยา · ซองยา / QA / รายงาน |
| staff-tasks | caregiver_tasks | แอปพนักงาน · งานวันนี้ |
| staff-meds | medication_rounds | แอปพนักงาน · คิวจ่ายยา |
| staff-handover | shift_handovers | แอปพนักงาน · สมุดส่งเวร |

การจับคู่คอลัมน์กับหน้าเว็บอยู่ที่ `lib/schema.ts` · API อยู่ที่ `app/api/data/[key]/route.ts`

## ย้ายไปฐานข้อมูล PostgreSQL อื่น

```bash
# 1) สร้างตารางที่ปลายทาง
DATABASE_URL="postgresql://...ปลายทาง..." npm run db:setup

# 2) คัดลอกข้อมูล (ต้องมี pg_dump / psql)
pg_dump --data-only --no-owner "postgresql://...Neon..." | psql "postgresql://...ปลายทาง..."

# 3) เปลี่ยน DATABASE_URL ใน .env.local (และบนโฮสต์) ให้ชี้ปลายทาง
```

ถ้าปลายทางไม่ใช่ PostgreSQL (เช่น MySQL / SQL Server) ต้องแปลงคอลัมน์ชนิด `text[]`
(meals, schedule_days, warnings, items, medications) เป็น JSON และปรับ `lib/db.ts` ให้ใช้ไดรเวอร์ของฐานข้อมูลนั้น

## บัญชีผู้ใช้และสิทธิ์

- บัญชีอยู่ในตาราง `staff_users` (อีเมล + `password_hash` แบบ scrypt) · การล็อกอินอยู่ในตาราง `sessions` (cookie `kin_session` แบบ httpOnly อายุ 7 วัน)
- `access_level`: **Operation** ใช้ KinApp/แอปจัดยา · **Branch Admin** ระบบจัดการเฉพาะสาขาตัวเอง · **Global Admin** ทุกอย่าง
- สมัครเองจากหน้าเข้าสู่ระบบ ได้ระดับ Operation สถานะ `รออนุมัติ` จนกว่าผู้ดูแลจะกดอนุมัติในหน้า "ทีมและสิทธิ์การใช้งาน"
  (ตั้ง `AUTO_APPROVE_SIGNUP=true` เพื่อให้เข้าได้ทันที)

### การแยกข้อมูลตามสาขา

- ทุกระดับยกเว้น Global Admin เห็นและแก้ได้เฉพาะข้อมูลสาขาตัวเอง (ทั้งระบบจัดการ, KinApp และแอปจัดยา)
- ตารางที่หน้าเว็บมีช่องสาขาอยู่แล้ว (สัญญา ผู้รับบริการ ทะเบียนงาน เสียงจากครอบครัว สาขา คลังงาน) ใช้ช่องนั้น
- ตารางอื่นมีคอลัมน์ `branch_name` ที่ server ใส่ให้ตอนสร้างรายการ: สาขาของผู้บันทึก
  หรือถ้า Global Admin เป็นคนบันทึก ใช้สาขาของผู้รับบริการ (หาไม่เจอ = `ทุกสาขา`)
- `ทุกสาขา` / `ส่วนกลาง` = ข้อมูลส่วนกลาง ทุกสาขาเห็น แต่แก้หรือลบได้เฉพาะ Global Admin
- ตารางฐานข้อมูลยา (`drug_catalog`) ใช้ร่วมกันทุกสาขา

### รหัสผู้รับบริการ การให้ยา และแจ้งเตือน

- ทุกตารางที่มี `resident_name` มี `resident_id` → `residents.id` (server ใส่ให้เองจากชื่อที่เลือก · ชื่อซ้ำต่างสาขาเลือกคนในสาขาเดียวกัน)
  - ห้ามชื่อผู้รับบริการซ้ำในสาขาเดียวกัน (ตอบ 409)
  - เปลี่ยนชื่อผู้รับบริการ → `resident_name` ในทุกตารางเปลี่ยนตาม · ลบผู้รับบริการ → ประวัติยังอยู่ (`resident_id` = NULL)
- ซองยา (`medication_packs`) ที่ตรวจ QA ผ่าน = คิวจ่ายยาใน KinApp · บันทึก `checked_by` · `given_by` · `given_at` (MAR)
- บันทึกสัญญาณชีพที่เกินเกณฑ์ (`lib/vitals.ts` · ทีมพยาบาลควรทบทวนตัวเลขให้ตรงแนวปฏิบัติของศูนย์) → server สร้างแถวใน `care_alerts`
  แก้ค่าให้ปกติ = แจ้งเตือนปิดเอง · รับทราบผ่าน `/api/care` บันทึกชื่อ เวลา และบันทึกการดูแลลงประวัติการแก้ไข

### บัญชีทดลอง (สร้างโดย `npm run db:setup`)

| อีเมล | รหัสผ่าน | ระดับ |
|---|---|---|
| global@kin.test | demo1234 | Global Admin |
| branch@kin.test | demo1234 | Branch Admin (กรุงเทพมหานคร) |
| staff@kin.test | demo1234 | Operation (กรุงเทพมหานคร) |

ก่อนใช้งานจริง: สร้างบัญชี Global Admin จริงจากหน้า "ทีมและสิทธิ์การใช้งาน" แล้วลบบัญชีทดลอง

```sql
DELETE FROM staff_users WHERE email LIKE '%@kin.test';
```

และตั้ง `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false`, `SEED_DEMO=false` เพื่อซ่อนปุ่มบัญชีทดลองในหน้าเข้าสู่ระบบ
