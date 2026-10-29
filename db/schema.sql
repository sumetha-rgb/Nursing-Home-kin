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
  access_level  text,           -- Nurse / Cashier / Head Nurse / Branch Admin / Global Admin
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
-- staff_users เป็นทั้งรายชื่อทีมและบัญชีล็อกอิน (access_level = Nurse / Branch Admin / Global Admin)
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

-- ---------------------------------------------------------------- รหัสผู้รับบริการ (foreign key)
-- ทุกตารางที่อ้างถึงผู้รับบริการเก็บ resident_id → residents.id (server ใส่ให้จากชื่อที่เลือก)
-- เปลี่ยนชื่อผู้รับบริการ = ระบบแก้ resident_name ในทุกตารางตาม resident_id · ลบผู้รับบริการ = ประวัติยังอยู่ (resident_id เป็น NULL)
-- UPDATE เติมรหัสให้ข้อมูลเดิม: จับคู่ชื่อ เลือกคนในสาขาเดียวกันก่อน (รันซ้ำได้)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE health_logs ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE care_assessments ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE caregiver_tasks ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE shift_handovers ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE resident_medications ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE medication_packs ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE medication_rounds ADD COLUMN IF NOT EXISTS resident_id text REFERENCES residents(id) ON DELETE SET NULL;
UPDATE contracts SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = contracts.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM contracts.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE task_logs SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = task_logs.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM task_logs.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE appointments SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = appointments.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM appointments.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE health_logs SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = health_logs.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM health_logs.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE care_assessments SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = care_assessments.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM care_assessments.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE daily_tasks SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = daily_tasks.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM daily_tasks.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE caregiver_tasks SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = caregiver_tasks.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM caregiver_tasks.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE shift_handovers SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = shift_handovers.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM shift_handovers.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE resident_medications SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = resident_medications.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM resident_medications.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE medication_packs SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = medication_packs.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM medication_packs.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
UPDATE medication_rounds SET resident_id = (SELECT r.id FROM residents r WHERE r.full_name = medication_rounds.resident_name ORDER BY (r.branch_name IS NOT DISTINCT FROM medication_rounds.branch_name) DESC, r.created_at LIMIT 1) WHERE resident_id IS NULL AND resident_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_resident ON contracts (resident_id);
CREATE INDEX IF NOT EXISTS task_logs_resident ON task_logs (resident_id);
CREATE INDEX IF NOT EXISTS appointments_resident ON appointments (resident_id);
CREATE INDEX IF NOT EXISTS health_logs_resident ON health_logs (resident_id);
CREATE INDEX IF NOT EXISTS care_assessments_resident ON care_assessments (resident_id);
CREATE INDEX IF NOT EXISTS daily_tasks_resident ON daily_tasks (resident_id);
CREATE INDEX IF NOT EXISTS caregiver_tasks_resident ON caregiver_tasks (resident_id);
CREATE INDEX IF NOT EXISTS shift_handovers_resident ON shift_handovers (resident_id);
CREATE INDEX IF NOT EXISTS resident_medications_resident ON resident_medications (resident_id);
CREATE INDEX IF NOT EXISTS medication_packs_resident ON medication_packs (resident_id);
CREATE INDEX IF NOT EXISTS medication_rounds_resident ON medication_rounds (resident_id);

-- ---------------------------------------------------------------- การให้ยา (เชื่อมแอปจัดยา → KinApp)
-- ซองยาที่ตรวจ QA ผ่านแล้ว = คิวจ่ายยาของพนักงานใน KinApp · กดจ่ายแล้วบันทึกผู้ให้ยาและเวลา (Medication Administration Record)
ALTER TABLE medication_packs ADD COLUMN IF NOT EXISTS given_by text;
ALTER TABLE medication_packs ADD COLUMN IF NOT EXISTS given_at timestamp;
ALTER TABLE medication_packs ADD COLUMN IF NOT EXISTS checked_by text;

-- ---------------------------------------------------------------- แจ้งเตือนสัญญาณชีพผิดปกติ
-- server สร้างให้เมื่อบันทึกสัญญาณชีพที่เกินเกณฑ์ (lib/vitals.ts) · 1 แถวต่อ 1 รายการบันทึก · status: open / acknowledged
CREATE TABLE IF NOT EXISTS care_alerts (
  id            text PRIMARY KEY,
  area          text NOT NULL,
  record_id     text,
  resident_id   text REFERENCES residents(id) ON DELETE SET NULL,
  resident_name text,
  branch_name   text,
  level         text NOT NULL,
  summary       text,
  items         jsonb,
  vital_text    text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'open',
  ack_by        text,
  ack_at        timestamptz,
  ack_note      text
);
CREATE INDEX IF NOT EXISTS care_alerts_open ON care_alerts (status, branch_name, created_at DESC);
CREATE INDEX IF NOT EXISTS care_alerts_resident ON care_alerts (resident_id, created_at DESC);
COMMENT ON TABLE care_alerts IS 'แจ้งเตือนสัญญาณชีพผิดปกติ รอพยาบาลรับทราบ';

-- ---------------------------------------------------------------- งานประจำวัน ↔ KinApp
-- ผู้จัดการมอบหมายงาน (จากคลังงานมาตรฐาน) → พนักงานส่งงานใน KinApp: บันทึกย่อ + ชื่อผู้ส่ง
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS done_by text;

-- ---------------------------------------------------------------- งานประจำ (ทำซ้ำทุกวัน)
-- ผู้จัดการสาขามอบหมายครั้งเดียว ระบบสร้างงานประจำวัน (daily_tasks) ให้เองทุกวันที่เปิดดูครั้งแรก
CREATE TABLE IF NOT EXISTS care_routines (
  id            text PRIMARY KEY,
  resident_id   text REFERENCES residents(id) ON DELETE CASCADE,
  resident_name text NOT NULL,
  branch_name   text,
  task_name     text NOT NULL,
  instruction   text,
  shift         text NOT NULL,
  sched_time    text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_routines_active ON care_routines (active, branch_name);
COMMENT ON TABLE care_routines IS 'งานประจำของผู้รับบริการ สร้างเป็นงานประจำวันอัตโนมัติ';

-- ---------------------------------------------------------------- ตารางเวรและการเช็คชื่อ
-- เวร: เช้า 07:00–19:00 · ดึก 19:00–07:00 (ตัดกะ 07:00) · 1 คนมีได้ 1 แถวต่อวันต่อเวร
CREATE TABLE IF NOT EXISTS staff_shifts (
  id          text PRIMARY KEY,
  branch_name text NOT NULL,
  staff_id    text NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  staff_name  text NOT NULL,
  shift_date  date NOT NULL,
  shift       text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, shift_date, shift)
);
CREATE INDEX IF NOT EXISTS staff_shifts_branch_date ON staff_shifts (branch_name, shift_date);
COMMENT ON TABLE staff_shifts IS 'ตารางเวรพนักงาน';

-- เช็คชื่อเข้า/ออกงาน: เวลา at มาจาก server · photo = รูปถ่ายสดย่อขนาด (JPEG data URL ประทับวันเวลาแล้ว)
CREATE TABLE IF NOT EXISTS attendance (
  id          text PRIMARY KEY,
  staff_id    text REFERENCES staff_users(id) ON DELETE SET NULL,
  staff_name  text NOT NULL,
  branch_name text,
  work_date   date NOT NULL,
  shift       text,
  kind        text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  late_min    integer,
  photo       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_branch_date ON attendance (branch_name, work_date);
CREATE INDEX IF NOT EXISTS attendance_staff_date ON attendance (staff_id, work_date);
COMMENT ON TABLE attendance IS 'การเช็คชื่อเข้า/ออกงานพร้อมรูปถ่าย';

-- รูปหลักฐานตอนพนักงานส่งงานจาก KinApp (โหลดแยกเฉพาะตอนเปิดตรวจงาน ไม่รวมในรายการงาน)
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS photo text;
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS photo_at timestamptz;

-- แบบประเมินความพึงพอใจจากครอบครัว/ญาติ (ส่งผ่านลิงก์หรือ QR ไม่ต้องเข้าสู่ระบบ)
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id            text PRIMARY KEY,
  branch_name   text NOT NULL,
  rater_name    text,
  relation      text,
  resident_name text,
  score_overall int NOT NULL CHECK (score_overall BETWEEN 1 AND 5),
  score_care    int CHECK (score_care BETWEEN 1 AND 5),
  score_staff   int CHECK (score_staff BETWEEN 1 AND 5),
  score_food    int CHECK (score_food BETWEEN 1 AND 5),
  score_clean   int CHECK (score_clean BETWEEN 1 AND 5),
  comment       text,
  contact_phone text,
  source_ip     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satisfaction_surveys_branch ON satisfaction_surveys (branch_name, created_at DESC);
COMMENT ON TABLE satisfaction_surveys IS 'แบบประเมินความพึงพอใจจากครอบครัว (ลิงก์/QR สาธารณะ)';
-- เรื่องร้องเรียนที่ส่งจาก QR: ผู้แจ้ง หมวด และ IP (กันส่งซ้ำรัว ๆ)
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS reporter text;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS source_ip text;

-- ลิงก์รีวิวพนักงานสำหรับครอบครัว: 1 ลิงก์ต่อผู้รับบริการ (รหัสสุ่ม เดาไม่ได้ ยกเลิกได้ หมดอายุได้)
CREATE TABLE IF NOT EXISTS review_links (
  id            text PRIMARY KEY,
  token         text NOT NULL UNIQUE,
  resident_id   text REFERENCES residents(id) ON DELETE CASCADE,
  resident_name text NOT NULL,
  branch_name   text NOT NULL,
  created_by    text,
  active        boolean NOT NULL DEFAULT true,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_links_resident ON review_links (resident_id);
COMMENT ON TABLE review_links IS 'ลิงก์รีวิวพนักงานที่ส่งให้ญาติของผู้รับบริการแต่ละคน';

-- รีวิวพนักงานจากครอบครัว (1 แถวต่อพนักงาน 1 คน · ส่งครั้งเดียวรีวิวได้หลายคน)
CREATE TABLE IF NOT EXISTS staff_reviews (
  id            text PRIMARY KEY,
  link_id       text REFERENCES review_links(id) ON DELETE SET NULL,
  submission_id text NOT NULL,
  branch_name   text NOT NULL,
  resident_id   text,
  resident_name text,
  staff_id      text NOT NULL,
  staff_name    text NOT NULL,
  rating        int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags          text[] NOT NULL DEFAULT '{}',
  comment       text,
  rater_name    text,
  relation      text,
  source_ip     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_reviews_staff ON staff_reviews (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_reviews_branch ON staff_reviews (branch_name, created_at DESC);
COMMENT ON TABLE staff_reviews IS 'รีวิวพนักงานจากครอบครัว ใช้คิดคะแนน/KPI ของพนักงาน';

-- สมุดภาพประจำวันของครอบครัว: รูปงานที่พนักงานเลือกแชร์ (ผู้จัดการซ่อนภายหลังได้)
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS share_family boolean NOT NULL DEFAULT true;

-- ดาวและความเห็นจากผู้จัดการตอนตรวจงาน (ใช้คิด KPI ส่วน "ดาวจากผู้จัดการ")
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS review_stars int CHECK (review_stars BETWEEN 1 AND 5);
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- น้ำหนัก KPI พนักงาน (แถวเดียว id = 'default' · ผู้บริหารแก้ได้ · รวมต้องเท่ากับ 100)
CREATE TABLE IF NOT EXISTS kpi_settings (
  id            text PRIMARY KEY,
  w_family      int NOT NULL DEFAULT 40,
  w_manager     int NOT NULL DEFAULT 30,
  w_tasks       int NOT NULL DEFAULT 20,
  w_punctual    int NOT NULL DEFAULT 10,
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (w_family + w_manager + w_tasks + w_punctual = 100)
);
INSERT INTO kpi_settings (id) VALUES ('default') ON CONFLICT DO NOTHING;
COMMENT ON TABLE kpi_settings IS 'น้ำหนักคะแนน KPI พนักงาน (ดาวครอบครัว/ดาวผู้จัดการ/งานที่ส่ง/มาตรงเวลา)';

-- ---------------------------------------------------------------- ห้องผู้ป่วยและรายละเอียดสัญญา
-- capacity = จำนวนผู้รับบริการที่พักในห้องได้ · คนในห้องนับจาก residents.room (สถานะที่ยังไม่ย้ายออก)
CREATE TABLE IF NOT EXISTS rooms (
  id            text PRIMARY KEY,
  room_no       text NOT NULL,
  branch_name   text,
  room_type     text,           -- ห้องเดี่ยว / ห้องคู่ / ห้องรวม / ห้องพิเศษ (VIP)
  capacity      integer NOT NULL DEFAULT 1,
  monthly_rate  numeric(12,2),
  status        text,           -- พร้อมใช้งาน / ปิดปรับปรุง
  note          text,
  sort_order    double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE rooms IS 'ห้องผู้ป่วยของแต่ละสาขา';

-- ข้อมูลจากฟอร์มเปิดสัญญา (ยังไม่เก็บรูปบัตรประชาชน)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS room               text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS start_date         date;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS employer_id_no     text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS employer_phone     text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS employer_address   text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS relationship       text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS resident_id_no     text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS resident_age       integer;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS included_services  text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS extra_services     text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS extra_fee          text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS extra_package      text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS prepaid            numeric(12,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deposit            numeric(12,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS note               text;

-- ---------------------------------------------------------------- HN (IPD) และการเงิน
-- HN ออกโดย server ตอนเพิ่มผู้รับบริการ: KN + ปี พ.ศ. 2 หลัก + เดือน + ลำดับ 5 หลัก (บรรทัด UPDATE เติมให้รายชื่อเดิม รันซ้ำได้)
CREATE SEQUENCE IF NOT EXISTS hn_seq;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS hn text;
UPDATE residents SET hn = 'KN' || lpad(((extract(year from created_at)::int + 543) % 100)::text, 2, '0') || to_char(created_at, 'MM') || lpad(nextval('hn_seq')::text, 5, '0') WHERE hn IS NULL OR hn = '';
CREATE UNIQUE INDEX IF NOT EXISTS residents_hn ON residents (hn);

-- ใบแจ้งหนี้ / ใบเสร็จรับเงิน (status ค้างชำระ = ใบแจ้งหนี้ · ชำระแล้ว = ใบเสร็จ · ยกเลิก)
-- doc_no ออกโดย server: KN-IV + ปีเดือนวัน + ลำดับของวัน · items_json = รายการ [{desc, qty, price, discount}]
-- slip = รูปหลักฐานการโอน (data URL) เก็บแยก ไม่ส่งไปกับรายการ (ดูผ่าน /api/billing)
CREATE TABLE IF NOT EXISTS invoices (
  id             text PRIMARY KEY,
  doc_no         text,
  doc_date       date,
  branch_name    text,
  resident_id    text REFERENCES residents(id) ON DELETE SET NULL,
  resident_name  text,
  hn             text,
  payer_name     text,
  payer_address  text,
  category       text,
  contract_no    text,
  items_json     text,
  total          numeric(12,2),
  discount       numeric(12,2),
  net            numeric(12,2),
  status         text,
  pay_cash       numeric(12,2),
  pay_credit     numeric(12,2),
  pay_transfer   numeric(12,2),
  paid_date      date,
  cashier        text,
  note           text,
  has_slip       boolean NOT NULL DEFAULT false,
  slip           text,
  slip_at        timestamptz,
  sort_order     double precision NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_doc_no ON invoices (doc_no);
COMMENT ON TABLE invoices IS 'ใบแจ้งหนี้และใบเสร็จรับเงิน';

-- ---------------------------------------------------------------- สิทธิ์รายบุคคล
-- permissions = รายการสิทธิ์ที่ติ๊กในหน้า "ทีมและสิทธิ์การใช้งาน" (lib/perms) · NULL = ใช้ค่าเริ่มต้นของตำแหน่ง
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS permissions text[];

-- รูปถ่ายบัตรประชาชนในสัญญา (data URL · เก็บแยก ไม่ส่งไปกับทะเบียนสัญญา · ดูผ่าน /api/idcards)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS employer_id_photo text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS resident_id_photo text;

-- เตียงรายเตียง: residents.bed = ป้ายเตียงในห้อง (A, B, C…) · rooms.floor = ชั้น/โซน ใช้จัดวางในแผนผังห้อง
ALTER TABLE residents ADD COLUMN IF NOT EXISTS bed text;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor text;

-- อัปเดตจากพยาบาลถึงครอบครัว (ข้อความ + รูป) แสดงในสมุดภาพประจำวันของญาติ
CREATE TABLE IF NOT EXISTS family_updates (
  id            text PRIMARY KEY,
  resident_id   text REFERENCES residents(id) ON DELETE CASCADE,
  resident_name text NOT NULL,
  branch_name   text NOT NULL,
  body          text,
  photo         text,
  posted_by     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_updates_resident ON family_updates (resident_id, created_at DESC);
COMMENT ON TABLE family_updates IS 'อัปเดตจากพยาบาลถึงครอบครัว ข้อความและรูป';

-- รับชำระเป็นงวด: ใบแจ้งหนี้ 1 ใบรับได้หลายครั้ง (ค้างชำระ → ชำระบางส่วน → ชำระแล้ว) · แต่ละครั้งมีใบรับเงินและสลิปของตัวเอง
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_total numeric(12,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS invoice_payments (
  id          text PRIMARY KEY,
  invoice_id  text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  pay_date    date,
  cash        numeric(12,2) NOT NULL DEFAULT 0,
  credit      numeric(12,2) NOT NULL DEFAULT 0,
  transfer    numeric(12,2) NOT NULL DEFAULT 0,
  amount      numeric(12,2) NOT NULL DEFAULT 0,
  cashier     text,
  note        text,
  slip        text,
  slip_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_payments_invoice ON invoice_payments (invoice_id, created_at);
COMMENT ON TABLE invoice_payments IS 'รายการรับชำระของใบแจ้งหนี้ (รับได้หลายงวด)';
-- ใบที่ชำระแล้วจากเดิม (รับครั้งเดียว) ย้ายเข้าเป็นงวดที่ 1
UPDATE invoices SET paid_total = net WHERE status = 'ชำระแล้ว' AND paid_total = 0;
INSERT INTO invoice_payments (id, invoice_id, pay_date, cash, credit, transfer, amount, cashier, slip, slip_at)
  SELECT 'p-' || i.id, i.id, i.paid_date, coalesce(i.pay_cash, 0), coalesce(i.pay_credit, 0), coalesce(i.pay_transfer, 0), i.net, i.cashier, i.slip, i.slip_at
  FROM invoices i WHERE i.status = 'ชำระแล้ว' AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id);

-- เปลี่ยนรหัสตำแหน่ง "พยาบาล" จาก Operation เป็น Nurse (ชื่อที่แสดงยังเป็น "พยาบาล") · รันซ้ำได้
UPDATE staff_users SET access_level = 'Nurse' WHERE access_level = 'Operation';
