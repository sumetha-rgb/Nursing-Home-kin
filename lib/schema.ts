/**
 * ตารางที่แต่ละชุดข้อมูล (key ที่หน้าเว็บใช้กับ useCrud / useRecords) ถูกบันทึกลงไป
 * ใช้ฝั่ง server เท่านั้น โครงตารางอยู่ที่ db/schema.sql
 *
 * kind "rows"   : ข้อมูลเป็น string[] ลำดับคอลัมน์ตรงกับ cols
 * kind "object" : ข้อมูลเป็น object ชื่อฟิลด์ตาม field และใช้ฟิลด์ id ของ object เป็นรหัสรายการ
 *
 * ชนิดข้อมูล:
 *  text · int · num · money (แสดงแบบมีจุลภาค) · bool · list (text[])
 *  date (YYYY-MM-DD) · date_th (วว/ดด/ปปปป พ.ศ.) · ts_th (วว/ดด/ปปปป HH:MM) · ts_bkk (เหมือน ts_th แต่เป็นคอลัมน์ timestamptz แปลงเป็นเวลาไทย) · time (HH:MM)
 */
import type { Role } from "./roles";
import { ALL_PERMS, can, Perm } from "./perms";

export type ColType = "text" | "int" | "num" | "money" | "bool" | "list" | "date" | "date_th" | "ts_th" | "ts_bkk" | "time";
/** ro: server เป็นคนใส่ค่า (เช่น HN เลขที่เอกสาร) หน้าเว็บอ่านได้อย่างเดียว */
export type Col = { col: string; t: ColType; field?: string; ro?: boolean };
/**
 * branchCol    : คอลัมน์สาขา ผู้ใช้ที่ไม่ใช่ Global Admin เห็น/แก้เฉพาะสาขาตัวเอง (และเห็นข้อมูลส่วนกลางแบบอ่านอย่างเดียว)
 * hiddenBranch : คอลัมน์สาขาไม่ได้อยู่ใน cols หน้าเว็บไม่เห็น server ใส่ค่าให้ตอนสร้างรายการ
 * globalWrite  : แก้ไข/เพิ่ม/ลบได้เฉพาะ Global Admin (ระดับอื่นอ่านอย่างเดียว)
 * residentLink : มีคอลัมน์ resident_name → server เก็บ resident_id (รหัสผู้รับบริการ) ให้เอง
 */
export type Spec = { table: string; kind: "rows" | "object"; cols: Col[]; numericId?: boolean; branchCol?: string; hiddenBranch?: boolean; residentLink?: boolean; globalWrite?: boolean; scope?: { col: string; value: string } };

/** ค่าสาขาของข้อมูลส่วนกลาง ทุกสาขาเห็นได้ */
export const SHARED_BRANCHES = ["ทุกสาขา", "ส่วนกลาง"];
const own = { branchCol: "branch_name", hiddenBranch: true };

const c = (col: string, t: ColType = "text", field?: string): Col => ({ col, t, field });
const ro = (col: string, field?: string, t: ColType = "text"): Col => ({ col, t, field, ro: true });

const SPECS: Record<string, Omit<Spec, "scope">> = {
  contracts: {
    table: "contracts", kind: "rows", branchCol: "branch_name",
    cols: [
      ro("contract_no"), c("branch_name"), c("resident_name"), c("employer_name"), c("monthly_fee", "money"), c("status"),
      c("room"), c("start_date", "date_th"), c("employer_id_no"), c("employer_phone"), c("employer_address"), c("relationship"),
      c("resident_id_no"), c("resident_age", "int"), c("included_services"), c("extra_services"), c("extra_fee"), c("extra_package"),
      c("prepaid", "money"), c("deposit", "money"), c("note"),
    ],
  },
  /** ใบแจ้งหนี้/ใบเสร็จ: items = JSON รายการ [{desc, qty, price, discount}] · สถานะ ค้างชำระ → ชำระแล้ว (เป็นใบเสร็จ) */
  invoices: {
    table: "invoices", kind: "object", ...own,
    cols: [
      ro("doc_no", "no"), c("doc_date", "date", "date"), c("resident_name", "text", "who"), c("hn", "text", "hn"), c("payer_name", "text", "payer"),
      c("payer_address", "text", "address"), c("category", "text", "kind"), c("contract_no", "text", "contract"), c("items_json", "text", "items"),
      c("total", "num", "total"), c("discount", "num", "discount"), c("net", "num", "net"), c("status", "text", "status"),
      ro("pay_cash", "cash", "num"), ro("pay_credit", "credit", "num"), ro("pay_transfer", "transfer", "num"), ro("paid_date", "paidDate", "date"),
      ro("cashier", "cashier"), c("note", "text", "note"), ro("has_slip", "slip", "bool"), ro("paid_total", "paid", "num"),
    ],
  },
  rooms: { table: "rooms", kind: "rows", branchCol: "branch_name", cols: [c("room_no"), c("branch_name"), c("room_type"), c("capacity", "int"), c("monthly_rate", "money"), c("status"), c("note"), c("floor")] },
  residents: { table: "residents", kind: "rows", branchCol: "branch_name", cols: [c("full_name"), c("age", "int"), c("room"), c("branch_name"), c("chronic_diseases"), c("status"), ro("hn"), c("bed")] },
  tasks_table: { table: "task_logs", kind: "rows", branchCol: "branch_name", cols: [c("work_date", "date_th"), c("branch_name"), c("resident_name"), c("category"), c("task_name"), c("performed_by"), c("status"), c("submitted_at", "time")] },
  appointments: { table: "appointments", kind: "rows", ...own, cols: [c("appt_date", "date_th"), c("appt_time", "time"), c("resident_name"), c("purpose"), c("caregiver"), c("prep")] },
  health: { table: "health_logs", kind: "rows", ...own, cols: [c("recorded_at", "ts_th"), c("resident_name"), c("vital_signs"), c("o2_sat"), c("dtx"), c("weight_height"), c("other_info"), c("note"), c("recorded_by")] },
  complaints: { table: "complaints", kind: "rows", branchCol: "branch_name", cols: [c("reported_at", "ts_th"), c("branch_name"), c("issue"), c("contact_phone"), c("status")] },
  docs: { table: "official_documents", kind: "rows", ...own, cols: [c("title"), c("doc_type"), c("doc_date", "date_th"), c("status"), c("note"), ro("file_name")] },
  branches: {
    table: "branches", kind: "rows", branchCol: "name", globalWrite: true,
    cols: [c("branch_code"), c("name"), c("legal_entity"), c("phone"), c("address"), c("bed_count", "int"), c("ownership_type"), c("branch_type"), c("selling_point"), c("email"), c("status"), c("lat_long"), c("image_url"), c("license_no"), c("bank_name"), c("main_account"), c("sub_account")],
  },
  facility: { table: "facility_tasks", kind: "rows", ...own, cols: [c("task_name"), c("category"), c("schedule"), c("dispatch_mode")] },
  master: { table: "master_tasks", kind: "rows", branchCol: "branch_name", cols: [c("task_code"), c("task_name"), c("instruction"), c("category"), c("shift"), c("branch_name"), c("profession")] },
  assessments: { table: "care_assessments", kind: "rows", ...own, cols: [c("plan_name"), c("resident_name"), c("chronic_diseases"), c("relative_phone"), c("estimated_price", "money"), c("note"),
    ro("doc_no"), c("quote_date", "date"), c("valid_days", "int"), c("payer_name"), c("care_level"), c("items_json"), c("contract_no")] },
  "pharmacy-master": { table: "drug_catalog", kind: "rows", cols: [c("drug_name"), c("properties")] },
  "pharmacy-drugs": {
    table: "resident_medications", kind: "object", numericId: true, ...own,
    cols: [
      c("resident_name", "text", "who"), c("drug_name", "text", "name"), c("indication", "text", "use"), c("directions", "text", "how"),
      c("storage", "text", "store"), c("dosage_form", "text", "form"), c("is_bulk", "bool", "bulk"), c("dose", "num", "dose"),
      c("timing", "text", "timing"), c("meals", "list", "meals"), c("schedule_days", "list", "days"), c("warnings", "list", "warn"),
      c("stock", "num", "stock"), c("unit", "text", "unit"), c("needs_fridge", "bool", "fridge"), c("on_hold", "bool", "hold"), c("status", "text", "status"), c("pack_size", "num", "pack"), c("received_total", "num", "received"),
      ro("source", "src"), ro("stock_drug_id", "sdid"),
    ],
  },
  "pharmacy-packs": {
    table: "medication_packs", kind: "object", numericId: true, ...own,
    cols: [c("pack_date", "date", "date"), c("resident_name", "text", "who"), c("meal", "text", "meal"), c("items", "list", "items"), c("qa_status", "text", "qa"), c("error_reason", "text", "reason"), c("given", "bool", "given"), c("packed_by", "text", "by"), c("given_by", "text", "gby"), c("given_at", "ts_th", "gat"), c("checked_by", "text", "qby")],
  },
  "staff-tasks": {
    table: "caregiver_tasks", kind: "object", numericId: true, ...own,
    cols: [c("resident_name", "text", "who"), c("title", "text", "title"), c("scheduled_time", "time", "time"), c("instruction", "text", "ins"), c("done_time", "time", "done"), c("note", "text", "note")],
  },
  "staff-meds": {
    table: "medication_rounds", kind: "object", numericId: true, ...own,
    cols: [c("resident_name", "text", "who"), c("meal", "text", "meal"), c("medications", "list", "meds"), c("shortage", "text", "short"), c("done", "bool", "done")],
  },
  "staff-handover": {
    table: "shift_handovers", kind: "object", numericId: true, ...own,
    cols: [c("topic_type", "text", "type"), c("resident_name", "text", "who"), c("detail", "text", "text"), c("written_by", "text", "by"), c("written_at", "text", "at")],
  },
};

const DAILY = { table: "daily_tasks", kind: "rows" as const, ...own, cols: [c("resident_name"), c("task_name"), c("assignee"), c("scheduled_time", "time"), c("shift"), c("status"), c("instruction"), c("vital_signs"), c("submitted_time", "time"), c("note"), c("done_by"), ro("created_at", undefined, "ts_bkk")] };

const linked = (cols: Col[]) => cols.some((c) => c.col === "resident_name");

/** แคชเชียร์: เปิดสัญญา (สร้างรายชื่อผู้รับบริการให้) ออกใบแจ้งหนี้/ใบเสร็จ · ดูห้องและสาขาได้อย่างเดียว */
/**
 * สิทธิ์ (lib/perms) ที่เปิดอ่าน/บันทึกแต่ละชุดข้อมูลได้ · มีข้อใดข้อหนึ่งก็พอ · write ไม่ระบุ = เหมือน read
 * ชุดข้อมูลที่หลายเมนูใช้ร่วมกัน (เช่น ผู้รับบริการ) เปิดอ่านให้ทุกเมนูที่ต้องใช้
 */
const ANY_CARE: Perm[] = ["careplan", "residents", "rooms", "tasks", "roster", "appointments", "health_logs", "quotations", "contracts", "billing", "dashboard", "app.staff", "app.pharmacy"];
const KEY_PERMS: Record<string, { read: Perm[]; write?: Perm[] }> = {
  contracts: { read: ["contracts", "billing", "careplan"], write: ["contracts"] },
  invoices: { read: ["billing", "contracts"] },
  residents: { read: ANY_CARE, write: ["residents", "contracts", "rooms.move"] },
  rooms: { read: ["rooms", "contracts", "residents", "rooms.move", "rooms.manage", "careplan", "dashboard", "branches"], write: ["rooms.manage"] },
  branches: { read: ALL_PERMS, write: ["branches"] },
  tasks_table: { read: ["tasks_table", "dashboard"] },
  appointments: { read: ["appointments", "careplan", "app.staff", "residents"], write: ["appointments"] },
  health: { read: ["health_logs", "app.staff", "residents"] },
  complaints: { read: ["feedbacks", "dashboard"] },
  docs: { read: ["official-docs"] },
  facility: { read: ["facility_tasks", "app.staff"], write: ["facility_tasks"] },
  master: { read: ["master_tasks", "tasks"], write: ["master_tasks", "tasks"] },
  assessments: { read: ["quotations", "residents"] },
  "pharmacy-master": { read: ["app.pharmacy", "app.staff"] },
  "pharmacy-drugs": { read: ["app.pharmacy", "app.staff"] },
  "pharmacy-packs": { read: ["app.pharmacy", "app.staff"] },
  "staff-tasks": { read: ["app.staff"] },
  "staff-meds": { read: ["app.staff"] },
  "staff-handover": { read: ["app.staff"] },
};
const DAILY_PERMS: Perm[] = ["tasks", "app.staff", "careplan", "dashboard", "tasks.review"];

/** สิทธิ์ของบัญชีต่อชุดข้อมูล */
export function accessOf(user: { role: Role; perms?: string[] }, key: string): "none" | "read" | "write" {
  const k = key.startsWith("daily-") ? { read: DAILY_PERMS } : KEY_PERMS[key];
  if (!k) return user.role === "Global Admin" ? "write" : "none";
  if ((k.write ?? k.read).some((p) => can(user, p))) return "write";
  return k.read.some((p) => can(user, p)) ? "read" : "none";
}

/** หา spec จากชื่อชุดข้อมูล เช่น "contracts" หรือ "daily-2026-10-27" */
export function specFor(key: string): Spec | null {
  if (SPECS[key]) return { ...SPECS[key], residentLink: linked(SPECS[key].cols) };
  const m = key.match(/^daily-(\d{4}-\d{2}-\d{2})$/);
  // งานประจำวัน: ผู้จัดการมอบหมาย พนักงานส่งงานจาก KinApp (เห็นเฉพาะสาขาตัวเอง)
  if (m) return { ...DAILY, residentLink: true, scope: { col: "work_date", value: m[1] } };
  return null;
}

/** ตารางที่อ้างถึงผู้รับบริการ (ใช้แก้ชื่อตามเมื่อเปลี่ยนชื่อผู้รับบริการ) */
export const RESIDENT_TABLES = [...new Set([...Object.values(SPECS), DAILY].filter((s) => linked(s.cols)).map((s) => s.table))];

/* ---------- แปลงค่าระหว่างหน้าเว็บกับฐานข้อมูล ---------- */
const blank = (v: unknown) => v === undefined || v === null || v === "" || v === "-";
const pad = (n: number) => String(n).padStart(2, "0");

/** "26/10/2569" หรือ "2026-10-26" → "2026-10-26" */
function parseDate(v: string): string | null {
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const th = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!th) return null;
  const y = Number(th[3]) > 2400 ? Number(th[3]) - 543 : Number(th[3]);
  return `${y}-${pad(Number(th[2]))}-${pad(Number(th[1]))}`;
}
const toThaiDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${pad(d)}/${pad(m)}/${y + 543}`; };

export function toDb(t: ColType, v: unknown): unknown {
  if (t === "bool") return !!v;
  if (t === "list") return Array.isArray(v) ? v.map(String) : [];
  if (t === "text") return v === undefined || v === null ? null : String(v);
  if (blank(v)) return null;
  const s = String(v).trim();
  switch (t) {
    case "int": { const n = parseInt(s.replace(/,/g, ""), 10); return Number.isFinite(n) ? n : null; }
    case "num": case "money": { const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
    case "date": case "date_th": return parseDate(s);
    case "ts_th": { const d = parseDate(s); const tm = s.match(/(\d{1,2}):(\d{2})/); return d ? `${d} ${tm ? `${pad(Number(tm[1]))}:${tm[2]}` : "00:00"}:00` : null; }
    case "time": { const tm = s.match(/^(\d{1,2}):(\d{2})/); return tm ? `${pad(Number(tm[1]))}:${tm[2]}` : null; }
    default: return s;
  }
}

/** ค่าจากฐานข้อมูล (date/time/timestamp ถูก cast เป็น text ใน SELECT) → ค่าที่หน้าเว็บใช้ */
export function fromDb(t: ColType, v: unknown, kind: Spec["kind"]): unknown {
  if (t === "bool") return !!v;
  if (t === "list") return Array.isArray(v) ? v : [];
  if (v === null || v === undefined) return kind === "rows" ? (t === "text" ? "" : "-") : undefined;
  const s = String(v);
  switch (t) {
    case "int": return kind === "rows" ? s : Number(s);
    case "num": { const n = Number(s); return kind === "rows" ? String(n) : n; }
    case "money": { const n = Number(s); return kind === "rows" ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n; }
    case "date": return s.slice(0, 10);
    case "date_th": return toThaiDate(s);
    case "ts_th": case "ts_bkk": return `${toThaiDate(s)} ${s.slice(11, 16)}`;
    case "time": return s.slice(0, 5);
    default: return s;
  }
}

/** คอลัมน์ที่ต้อง cast เป็น text ตอน SELECT เพื่อไม่ให้ driver แปลงเป็น Date */
export const selectExpr = (col: Col) =>
  col.t === "ts_bkk" ? `to_char(${col.col} AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS ${col.col}`
  : ["date", "date_th", "ts_th", "time"].includes(col.t) ? `${col.col}::text AS ${col.col}` : col.col;
