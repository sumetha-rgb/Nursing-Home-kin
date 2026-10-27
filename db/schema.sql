-- =============================================================================
-- KIN Care Management — โครงสร้างฐานข้อมูล (PostgreSQL 14+)
-- ใช้ SQL มาตรฐานของ PostgreSQL ไม่มีฟีเจอร์เฉพาะของ Neon ย้ายไปฐานข้อมูล PostgreSQL อื่นได้ทันที
--   รันซ้ำได้ (IF NOT EXISTS)  ·  สร้างด้วย: npm run db:setup
--
-- ทุกตารางมีคอลัมน์ร่วม:
--   id          รหัสรายการ (text; หน้าเว็บสร้างเป็น UUID หรือเลขรหัสเดิมของรายการ)
--   sort_order  ลำดับการแสดงผล (ค่ามากอยู่บน)
--   created_at / updated_at
-- ชื่อคน/สาขาเก็บเป็นข้อความ (snapshot) ตามที่หน้าเว็บใช้ในตอนนี้
-- ถ้าต้องการผูก foreign key ภายหลัง ให้เพิ่มคอลัมน์ resident_id / branch_id แล้วเติมค่าจากชื่อ
-- =============================================================================

-- ชุดข้อมูลที่เคยใส่ข้อมูลตั้งต้นแล้ว (ป้องกันการใส่ข้อมูลตัวอย่างซ้ำหลังผู้ใช้ลบจนว่าง)
CREATE TABLE IF NOT EXISTS app_seed (
  collection  text PRIMARY KEY,
  seeded_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- องค์กร
CREATE TABLE IF NOT EXISTS branches (
  id             text PRIMARY KEY,
  branch_code    text,
  name           text NOT NULL,
  legal_entity   text,
  phone          text,
  address        text,
  bed_count      integer,
  ownership_type text,          -- HQ / F (Franchise) / B (NJY GROUP)
  branch_type    text,          -- Nursing Home / Central Services / POS / HQ
  selling_point  text,
  email          text,
  status         text,          -- เปิด / ปิด / ภายใน
  lat_long       text,
  image_url      text,
  license_no     text,
  bank_name      text,
  main_account   text,
  sub_account    text,
  sort_order     double precision NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE branches IS 'สาขา';

CREATE TABLE IF NOT EXISTS staff_users (
  id            text PRIMARY KEY,
  full_name     text NOT NULL,
  contract_type text,           -- B / MF / F
  access_level  text,           -- Operation / Branch Admin / Global Admin
  branch_name   text,
  status        text,           -- ทำงาน / ลาออก / พักงาน
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE staff_users IS 'ผู้ใช้งานระบบและพนักงาน';

-- ---------------------------------------------------------------- ผู้รับบริการและสัญญา
CREATE TABLE IF NOT EXISTS residents (
  id               text PRIMARY KEY,
  full_name        text NOT NULL,
  age              integer,
  room             text,
  branch_name      text,
  chronic_diseases text,
  status           text,        -- เข้าอยู่ / แอดมิท รพ. / ย้ายออก
  sort_order       double precision NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE residents IS 'ผู้รับบริการ (ผู้สูงอายุ)';

CREATE TABLE IF NOT EXISTS contracts (
  id            text PRIMARY KEY,
  contract_no   text,
  branch_name   text,
  resident_name text,
  employer_name text,
  monthly_fee   numeric(12,2),
  status        text,           -- ใช้งานอยู่ / สิ้นสุดสัญญา / รอชำระเงินมัดจำ
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE contracts IS 'สัญญาบริการ';

CREATE TABLE IF NOT EXISTS care_assessments (
  id               text PRIMARY KEY,
  plan_name        text NOT NULL,
  resident_name    text,
  chronic_diseases text,
  relative_phone   text,
  estimated_price  numeric(12,2),
  note             text,
  sort_order       double precision NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE care_assessments IS 'ใบประเมินภาวะและแผนการดูแล (ใบเสนอราคา)';

-- ---------------------------------------------------------------- งานดูแล
CREATE TABLE IF NOT EXISTS master_tasks (
  id          text PRIMARY KEY,
  task_code   text,
  task_name   text NOT NULL,
  instruction text,
  category    text,
  shift       text,             -- กะเช้า / กะดึก / ทั้งสองกะ
  branch_name text,
  profession  text,
  sort_order  double precision NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE master_tasks IS 'คลังงานมาตรฐาน';

CREATE TABLE IF NOT EXISTS facility_tasks (
  id            text PRIMARY KEY,
  task_name     text NOT NULL,
  category      text,
  schedule      text,           -- เวลา / ความถี่
  dispatch_mode text,           -- จ่ายเอง (Manual) / สร้างอัตโนมัติ (Routine)
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE facility_tasks IS 'งานทั่วไปประจำสาขา';

CREATE TABLE IF NOT EXISTS daily_tasks (
  id             text PRIMARY KEY,
  work_date      date NOT NULL,
  resident_name  text,
  task_name      text NOT NULL,
  assignee       text,
  scheduled_time time,
  shift          text,          -- กะเช้า / กะดึก (ตัดกะ 07:00)
  status         text,          -- รอทำ / เสร็จแล้ว / ตรวจแล้ว
  instruction    text,
  vital_signs    text,
  submitted_time time,
  sort_order     double precision NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_tasks_date ON daily_tasks (work_date);
COMMENT ON TABLE daily_tasks IS 'งานประจำวันที่ต้องตรวจ แยกตามวันที่';

CREATE TABLE IF NOT EXISTS task_logs (
  id            text PRIMARY KEY,
  work_date     date,
  branch_name   text,
  resident_name text,
  category      text,
  task_name     text,
  performed_by  text,
  status        text,
  submitted_at  time,
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE task_logs IS 'ทะเบียนงานรายวัน (ข้อมูลงาน Table)';

CREATE TABLE IF NOT EXISTS caregiver_tasks (
  id             text PRIMARY KEY,
  resident_name  text,
  title          text NOT NULL,
  scheduled_time time,
  instruction    text,
  done_time      time,
  note           text,
  sort_order     double precision NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE caregiver_tasks IS 'งานของพนักงานในแอป CG2';

CREATE TABLE IF NOT EXISTS shift_handovers (
  id            text PRIMARY KEY,
  topic_type    text,           -- เฝ้าระวังอาการ / คำสั่งแพทย์ / ญาติฝากแจ้ง / งานค้าง
  resident_name text,
  detail        text,
  written_by    text,
  written_at    text,
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE shift_handovers IS 'สมุดส่งเวร';

-- ---------------------------------------------------------------- สุขภาพ นัดหมาย ร้องเรียน เอกสาร
CREATE TABLE IF NOT EXISTS health_logs (
  id            text PRIMARY KEY,
  recorded_at   timestamp,
  resident_name text,
  vital_signs   text,
  o2_sat        text,
  dtx           text,
  weight_height text,
  other_info    text,
  note          text,
  recorded_by   text,
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE health_logs IS 'บันทึกสัญญาณชีพและสุขภาพ';

CREATE TABLE IF NOT EXISTS appointments (
  id            text PRIMARY KEY,
  appt_date     date,
  appt_time     time,
  resident_name text,
  purpose       text,
  caregiver     text,
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE appointments IS 'นัดหมาย / พาทำธุระ';

CREATE TABLE IF NOT EXISTS complaints (
  id            text PRIMARY KEY,
  reported_at   timestamp,
  branch_name   text,
  issue         text,
  contact_phone text,
  status        text,           -- รอดำเนินการ / กำลังดำเนินการ / แก้ไขแล้ว
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE complaints IS 'เรื่องร้องเรียน';

CREATE TABLE IF NOT EXISTS official_documents (
  id         text PRIMARY KEY,
  title      text NOT NULL,
  doc_type   text,
  doc_date   date,
  status     text,
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE official_documents IS 'เอกสารและระเบียบราชการ';

-- ---------------------------------------------------------------- ยา
CREATE TABLE IF NOT EXISTS drug_catalog (
  id         text PRIMARY KEY,
  drug_name  text NOT NULL,
  properties text,
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE drug_catalog IS 'ฐานข้อมูลยา (Master Drugs)';

CREATE TABLE IF NOT EXISTS resident_medications (
  id             text PRIMARY KEY,
  resident_name  text NOT NULL,
  drug_name      text NOT NULL,
  indication     text,
  directions     text,          -- วิธีทานตามฉลาก
  storage        text,
  dosage_form    text,
  is_bulk        boolean NOT NULL DEFAULT false,   -- ยาขวด/ยาทา ไม่แพ็คซอง
  dose           numeric(8,2),
  timing         text,
  meals          text[] NOT NULL DEFAULT '{}',     -- เช้า / กลางวัน / เย็น / ก่อนนอน
  schedule_days  text[] NOT NULL DEFAULT '{}',     -- ว่าง = ทุกวัน
  warnings       text[] NOT NULL DEFAULT '{}',
  stock          numeric(10,2),
  unit           text,
  needs_fridge   boolean NOT NULL DEFAULT false,
  on_hold        boolean NOT NULL DEFAULT false,
  status         text,          -- ปกติ / ยาหมด / ยาหมดอายุ / ยางดใช้
  sort_order     double precision NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE resident_medications IS 'คลังยาของผู้รับบริการแต่ละคน';

CREATE TABLE IF NOT EXISTS medication_packs (
  id            text PRIMARY KEY,
  pack_date     date NOT NULL,
  resident_name text NOT NULL,
  meal          text NOT NULL,
  items         text[] NOT NULL DEFAULT '{}',
  qa_status     text NOT NULL DEFAULT 'รอตรวจ',   -- รอตรวจ / ตรวจผ่าน / แจ้งจัดยาผิด
  error_reason  text,                              -- สาเหตุตามหลัก 5R
  given         boolean NOT NULL DEFAULT false,
  packed_by     text,
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medication_packs_date ON medication_packs (pack_date, resident_name);
COMMENT ON TABLE medication_packs IS 'ซองยาที่จัดแล้ว (ตะกร้ายา / QA)';

CREATE TABLE IF NOT EXISTS medication_rounds (
  id            text PRIMARY KEY,
  resident_name text NOT NULL,
  meal          text,
  medications   text[] NOT NULL DEFAULT '{}',
  shortage      text,
  done          boolean NOT NULL DEFAULT false,
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE medication_rounds IS 'คิวจ่ายยาของพนักงาน (แอป CG2)';

-- ---------------------------------------------------------------- บัญชีผู้ใช้และการเข้าสู่ระบบ
-- staff_users เป็นทั้งรายชื่อทีมและบัญชีล็อกอิน (access_level = Operation / Branch Admin / Global Admin)
-- status: ทำงาน = เข้าสู่ระบบได้ · รออนุมัติ = สมัครเองรอผู้ดูแลอนุมัติ · พักงาน / ลาออก = เข้าไม่ได้
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS email         text;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS password_hash text;   -- scrypt$salt$hash (ไม่เก็บรหัสผ่านจริง)
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email ON staff_users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,                 -- sha256 ของ token ใน cookie
  user_id    text NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
COMMENT ON TABLE sessions IS 'การเข้าสู่ระบบที่ยังใช้งานอยู่';

-- ---------------------------------------------------------------- สาขาเจ้าของข้อมูล
-- server ใส่ให้อัตโนมัติ (หน้าเว็บไม่ต้องส่ง): สาขาของผู้บันทึก หรือสาขาของผู้รับบริการเมื่อผู้บริหารเป็นคนบันทึก
-- 'ทุกสาขา' = ข้อมูลส่วนกลาง ทุกสาขาเห็น แต่แก้ได้เฉพาะ Global Admin
-- บรรทัด UPDATE เติมสาขาให้ข้อมูลเดิมที่ยังว่าง (รันซ้ำได้)
ALTER TABLE care_assessments ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE health_logs ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE caregiver_tasks ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE shift_handovers ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE resident_medications ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE medication_packs ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE medication_rounds ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE facility_tasks ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE official_documents ADD COLUMN IF NOT EXISTS branch_name text;
UPDATE care_assessments SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = care_assessments.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE daily_tasks SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = daily_tasks.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE appointments SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = appointments.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE health_logs SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = health_logs.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE caregiver_tasks SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = caregiver_tasks.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE shift_handovers SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = shift_handovers.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE resident_medications SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = resident_medications.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE medication_packs SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = medication_packs.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE medication_rounds SET branch_name = COALESCE((SELECT r.branch_name FROM residents r WHERE r.full_name = medication_rounds.resident_name LIMIT 1), 'ทุกสาขา') WHERE branch_name IS NULL;
UPDATE facility_tasks SET branch_name = 'ทุกสาขา' WHERE branch_name IS NULL;
UPDATE official_documents SET branch_name = 'ทุกสาขา' WHERE branch_name IS NULL;
CREATE INDEX IF NOT EXISTS care_assessments_branch ON care_assessments (branch_name);
CREATE INDEX IF NOT EXISTS daily_tasks_branch ON daily_tasks (branch_name);
CREATE INDEX IF NOT EXISTS appointments_branch ON appointments (branch_name);
CREATE INDEX IF NOT EXISTS health_logs_branch ON health_logs (branch_name);
CREATE INDEX IF NOT EXISTS caregiver_tasks_branch ON caregiver_tasks (branch_name);
CREATE INDEX IF NOT EXISTS shift_handovers_branch ON shift_handovers (branch_name);
CREATE INDEX IF NOT EXISTS resident_medications_branch ON resident_medications (branch_name);
CREATE INDEX IF NOT EXISTS medication_packs_branch ON medication_packs (branch_name);
CREATE INDEX IF NOT EXISTS medication_rounds_branch ON medication_rounds (branch_name);
CREATE INDEX IF NOT EXISTS facility_tasks_branch ON facility_tasks (branch_name);
CREATE INDEX IF NOT EXISTS official_documents_branch ON official_documents (branch_name);

-- ---------------------------------------------------------------- ประวัติการแก้ไข (Audit log)
-- บันทึกทุกการเพิ่ม/แก้/ลบข้อมูล การจัดการบัญชี และการเข้าสู่ระบบ (เขียนอย่างเดียว ไม่มีหน้าจอแก้ไข)
-- branch_name = สาขาของข้อมูลที่ถูกแก้ ใช้กำหนดว่า Branch Admin เห็นรายการไหน
-- before / after = ค่าก่อนและหลังแก้ ตามชื่อคอลัมน์ในฐานข้อมูล (ไม่เก็บรหัสผ่าน)
CREATE TABLE IF NOT EXISTS audit_logs (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     text,
  actor_name   text,
  actor_role   text,
  actor_branch text,
  branch_name  text,
  area         text NOT NULL,
  action       text NOT NULL,
  record_id    text,
  summary      text,
  before       jsonb,
  after        jsonb,
  ip           text
);
CREATE INDEX IF NOT EXISTS audit_logs_at ON audit_logs (at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_branch ON audit_logs (branch_name, at DESC);
COMMENT ON TABLE audit_logs IS 'ประวัติการแก้ไขข้อมูลและการเข้าสู่ระบบ';
