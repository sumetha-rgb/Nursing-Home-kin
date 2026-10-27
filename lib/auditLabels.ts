/** ชื่อภาษาไทยที่ใช้แสดงประวัติการแก้ไข (ใช้ได้ทั้งหน้าเว็บและ server) */

export const ACTION_LABEL: Record<string, string> = {
  create: "เพิ่ม", update: "แก้ไข", delete: "ลบ", clear: "ล้างข้อมูล", replace: "แทนที่ทั้งหมด",
  login: "เข้าสู่ระบบ", login_failed: "เข้าสู่ระบบไม่สำเร็จ", change_password: "เปลี่ยนรหัสผ่าน",
  register: "สมัครสมาชิก", approve: "อนุมัติบัญชี", reset_password: "รีเซตรหัสผ่าน", acknowledge: "รับทราบแจ้งเตือน",
};

/** กลุ่มตัวกรอง → action ที่อยู่ในกลุ่ม */
export const ACTION_GROUPS: Record<string, string[]> = {
  "เพิ่ม": ["create", "register"],
  "แก้ไข": ["update", "approve", "replace", "acknowledge"],
  "ลบ": ["delete", "clear"],
  "บัญชีและการเข้าสู่ระบบ": ["login", "login_failed", "change_password", "reset_password"],
};

export const AREA_LABEL: Record<string, string> = {
  residents: "ผู้รับบริการ", contracts: "สัญญาบริการ", assessments: "แผนดูแลและใบประเมิน", tasks_table: "ทะเบียนงาน",
  facility: "งานทั่วไปของศูนย์", master: "คลังงานมาตรฐาน", appointments: "ตารางนัดหมาย", health: "บันทึกสุขภาพ",
  complaints: "เสียงจากครอบครัว", docs: "เอกสารและระเบียบ", branches: "สาขาของเรา", users: "ทีมและสิทธิ์การใช้งาน",
  auth: "การเข้าสู่ระบบ", "pharmacy-master": "แอปจัดยา · ฐานข้อมูลยา", "pharmacy-drugs": "แอปจัดยา · คลังยา",
  "pharmacy-packs": "แอปจัดยา · ซองยา", "staff-tasks": "KinApp · งานวันนี้", "staff-meds": "KinApp · คิวจ่ายยา",
  "staff-handover": "KinApp · สมุดส่งเวร", alerts: "แจ้งเตือนสัญญาณชีพ",
};
export function areaLabel(area: string) {
  const d = area.match(/^daily-(\d{4})-(\d{2})-(\d{2})$/);
  if (d) return `งานประจำวัน ${d[3]}/${d[2]}/${Number(d[1]) + 543}`;
  return AREA_LABEL[area] ?? area;
}

export const FIELD_LABEL: Record<string, string> = {
  full_name: "ชื่อ-นามสกุล", resident_name: "ผู้รับบริการ", age: "อายุ", room: "ห้อง/เตียง", branch_name: "สาขา",
  chronic_diseases: "โรคประจำตัว", status: "สถานะ", contract_no: "เลขที่สัญญา", employer_name: "ผู้ว่าจ้าง",
  monthly_fee: "ค่าบริการ/เดือน", work_date: "วันที่", category: "หมวด", task_name: "ชื่องาน", performed_by: "ผู้ปฏิบัติงาน",
  submitted_at: "เวลาที่ส่ง", appt_date: "วันที่นัด", appt_time: "เวลานัด", purpose: "วัตถุประสงค์", caregiver: "ผู้ดูแล",
  recorded_at: "วันเวลาที่บันทึก", vital_signs: "สัญญาณชีพ", o2_sat: "O2 Sat", dtx: "DTX", weight_height: "น้ำหนัก/ส่วนสูง",
  other_info: "ข้อมูลอื่น", note: "หมายเหตุ", recorded_by: "ผู้บันทึก", reported_at: "วันเวลาที่แจ้ง", issue: "ปัญหาที่ร้องเรียน",
  contact_phone: "เบอร์ติดต่อกลับ", title: "ชื่อ", doc_type: "ประเภทเอกสาร", doc_date: "วันที่เอกสาร", branch_code: "รหัสสาขา",
  name: "ชื่อ", legal_entity: "นิติบุคคล", phone: "โทรศัพท์", address: "ที่อยู่", bed_count: "จำนวนเตียง",
  ownership_type: "รูปแบบการถือครอง", branch_type: "ประเภทสาขา", selling_point: "จุดเด่น", email: "อีเมล", lat_long: "พิกัด",
  image_url: "รูปภาพ", license_no: "เลขที่ใบอนุญาต", bank_name: "ธนาคาร", main_account: "บัญชีหลัก", sub_account: "บัญชีย่อย",
  schedule: "รอบเวลา", dispatch_mode: "การจ่ายงาน", task_code: "รหัสงาน", instruction: "คำสั่งงาน", shift: "กะ",
  profession: "วิชาชีพ", plan_name: "ชื่อแผนการดูแล", relative_phone: "เบอร์โทรญาติ", estimated_price: "ราคาประเมิน",
  drug_name: "ชื่อยา", properties: "สรรพคุณ", indication: "ข้อบ่งใช้", directions: "วิธีใช้", storage: "การเก็บรักษา",
  dosage_form: "รูปแบบยา", is_bulk: "ยาแบ่งจ่าย", dose: "ขนาดยา", timing: "เวลาให้ยา", meals: "มื้อ", schedule_days: "วันที่ให้ยา",
  warnings: "ข้อควรระวัง", stock: "คงเหลือ", unit: "หน่วย", needs_fridge: "เก็บในตู้เย็น", on_hold: "งดยา",
  pack_date: "วันที่จัดยา", meal: "มื้อ", items: "รายการยา", qa_status: "ผลตรวจ QA", error_reason: "เหตุผลที่ผิด",
  given: "จ่ายแล้ว", packed_by: "ผู้จัดยา", scheduled_time: "เวลาที่กำหนด", done_time: "เวลาที่ทำเสร็จ",
  medications: "ยา", shortage: "ยาที่ขาด", done: "เสร็จแล้ว", topic_type: "หัวข้อ", detail: "รายละเอียด",
  written_by: "ผู้เขียน", written_at: "เวลาที่เขียน", assignee: "ผู้รับผิดชอบ", submitted_time: "เวลาที่ส่งจริง",
  contract_type: "ประเภทสัญญาจ้าง", access_level: "ระดับสิทธิ์", given_by: "ผู้ให้ยา", given_at: "เวลาที่ให้ยา", checked_by: "ผู้ตรวจ QA", ack_note: "บันทึกการรับทราบ",
};

/** เทียบค่าแบบหลวม: วันที่/ตัวเลขจากฐานข้อมูลกับจากหน้าเว็บอาจต่างรูปแบบเล็กน้อย */
export const normValue = (v: unknown) =>
  v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ")
    : String(v).replace(/(\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)[+-]\d{2}(?::\d{2})?$/, "$1").replace(/(\d{2}:\d{2}):00$/, "$1").replace(/^(-?\d+)\.0+$/, "$1").replace(/^(-?\d+\.\d*?)0+$/, "$1");

export function displayValue(v: unknown) {
  if (v === true) return "ใช่";
  if (v === false) return "ไม่";
  const s = normValue(v);
  return s === "" ? "-" : s;
}
