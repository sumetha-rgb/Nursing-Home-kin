/**
 * ชุดตัวเลือกที่ผู้ใช้แก้เองได้ (ตาราง option_lists ผ่าน /api/data/opts-<group>) · ไฟล์นี้ไม่มีโค้ดฝั่งหน้าเว็บ ใช้ได้ทั้ง server และหน้าเว็บ
 *  group = หน้าที่เป็นเจ้าของ (สิทธิ์แก้ = สิทธิ์ของหน้านั้น) · list = ชื่อชุดตัวเลือก · defaults = ค่าตั้งต้นเดิมในโค้ด
 *  ใช้เฉพาะตัวเลือกที่แสดง/ให้เลือก ไม่ใช่ค่าที่ระบบใช้คำนวณ (สถานะ ประเภทใบ กะ ฯลฯ ยังตายตัว)
 */
import type { Perm } from "./perms";
import { ALLERGY_DRUGS, COMMON_MEDS, FOOD_ALLERGENS, HEALTH_RIGHTS, RELATIONS } from "./medicalLists";
import { ACTIVITIES, MOBILITY, TIME_SLOTS } from "./physio";

export const OPT_GROUPS = ["contracts", "billing", "tasks", "physio"] as const;
export type OptGroup = (typeof OPT_GROUPS)[number];
/** สิทธิ์ที่แก้ตัวเลือกของแต่ละหน้าได้ (อ่านได้ทุกคนที่เข้าระบบ) */
export const OPT_WRITE: Record<OptGroup, Perm[]> = {
  contracts: ["contracts"],
  billing: ["billing"],
  tasks: ["master_tasks", "tasks"],
  physio: ["physio.assign"],
};
export const OPT_GROUP_TH: Record<OptGroup, string> = { contracts: "สัญญาบริการ", billing: "ใบแจ้งหนี้และใบเสร็จ", tasks: "งานดูแล", physio: "กายภาพ" };

/** kind: text = ข้อความ · money = จำนวนเงิน · minutes = นาที · time = เวลา HH:MM */
export type OptKind = "text" | "money" | "minutes" | "time";
export type OptListDef = { group: OptGroup; label: string; hint: string; defaults: string[]; kind?: OptKind };
export const OPTION_LISTS = {
  relations: { group: "contracts", label: "ความสัมพันธ์กับผู้รับบริการ", hint: "ปุ่มเลือกช่อง เกี่ยวข้อง ในฟอร์มสัญญา", defaults: RELATIONS },
  health_rights: { group: "contracts", label: "สิทธิการรักษา", hint: "ปุ่มเลือกสิทธิ์การรักษาในฟอร์มสัญญา", defaults: HEALTH_RIGHTS },
  allergy_drugs: { group: "contracts", label: "ยาที่แพ้บ่อย", hint: "คำแนะนำตอนพิมพ์ประวัติแพ้ยา", defaults: ALLERGY_DRUGS },
  food_allergens: { group: "contracts", label: "อาหารที่แพ้", hint: "คำแนะนำตอนพิมพ์ประวัติแพ้อาหาร", defaults: FOOD_ALLERGENS },
  common_meds: { group: "contracts", label: "ยา / เวชภัณฑ์ที่ใช้ประจำ", hint: "คำแนะนำตอนพิมพ์ยาที่ใช้ประจำ", defaults: COMMON_MEDS },
  dc_reasons: { group: "contracts", label: "เหตุผลจำหน่าย (D/C)", hint: "ตัวเลือกตอนจำหน่ายออก · มี อื่น ๆ ต่อท้ายเสมอ", defaults: ["กลับบ้าน", "ส่งต่อโรงพยาบาล", "ย้ายไปสถานดูแลอื่น", "เสียชีวิต"] },
  booking_amounts: { group: "contracts", label: "ยอดมัดจำจองห้อง", hint: "ปุ่มยอดมัดจำตอนจองห้อง (บาท)", defaults: ["3000", "5000"], kind: "money" },
  cn_reasons: { group: "billing", label: "เหตุผลออกใบลดหนี้", hint: "ตัวเลือกตอนออกใบลดหนี้ · มี อื่น ๆ (พิมพ์เอง) ต่อท้ายเสมอ", defaults: ["คิดค่าบริการเกิน", "กลับบ้านก่อนกำหนด คืนค่าบริการส่วนที่ไม่ได้อยู่", "ให้ส่วนลดเพิ่มภายหลัง", "คิดรายการซ้ำ"] },
  task_categories: { group: "tasks", label: "หมวดหมู่งาน", hint: "หมวดของแม่แบบงานมาตรฐานและงานส่วนกลาง", defaults: ["กิจวัตรประจำวัน (ADL)", "งานพยาบาล", "กายภาพบำบัด", "ส่งเสริมสุขภาพ", "กิจกรรมกลุ่ม", "งานทั่วไป", "งานอื่นๆ"] },
  review_notes: { group: "tasks", label: "ข้อความตอนตรวจงาน", hint: "ปุ่มข้อความสั้นตอนหัวหน้าตรวจงาน", defaults: ["ทำครบตามคำสั่ง", "ส่งตรงเวลา", "รูปหลักฐานชัดเจน", "รูปไม่ชัด ครั้งหน้าถ่ายใหม่", "ส่งช้ากว่ากำหนด", "บันทึกไม่ครบ"] },
  physio_activities: { group: "physio", label: "กิจกรรมกายภาพ", hint: "ปุ่มเลือกกิจกรรมตอนบันทึกกายภาพ", defaults: ACTIVITIES },
  physio_mobility: { group: "physio", label: "ระดับการเคลื่อนไหว", hint: "ปุ่มเลือกระดับการเคลื่อนไหวตอนบันทึกกายภาพ", defaults: MOBILITY },
  physio_slots: { group: "physio", label: "ช่วงเวลานัด", hint: "ปุ่มเวลาตอนจ่ายเคส (เช่น 08:00) · เลือกเวลาอื่นเองได้เหมือนเดิม", defaults: TIME_SLOTS, kind: "time" },
  physio_minutes: { group: "physio", label: "ความยาวต่อครั้ง (นาที)", hint: "ปุ่มเลือกความยาวตอนจ่ายเคส", defaults: ["30", "45", "60", "90"], kind: "minutes" },
  physio_close_reasons: { group: "physio", label: "เหตุผลปิดคอร์ส", hint: "ปุ่มเหตุผลตอนปิดคอร์สก่อนครบ", defaults: ["ผู้รับบริการย้ายออก", "ญาติขอหยุดคอร์ส", "จบการรักษา อาการดีขึ้น", "เปลี่ยนเป็นคอร์สใหม่", "ส่งต่อโรงพยาบาล"] },
} satisfies Record<string, OptListDef>;
export type OptList = keyof typeof OPTION_LISTS;
export const listsOf = (g: OptGroup) => (Object.keys(OPTION_LISTS) as OptList[]).filter((k) => OPTION_LISTS[k].group === g);
/** ตัวเลือกที่ต่อท้ายเสมอ (ไม่ให้แก้/ปิด เพราะหน้าจอใช้เปิดช่องพิมพ์เอง) */
export const OTHER = "อื่น ๆ";
