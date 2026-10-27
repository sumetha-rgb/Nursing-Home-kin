/**
 * ตารางที่แต่ละชุดข้อมูล (key ที่หน้าเว็บใช้กับ useCrud / useRecords) ถูกบันทึกลงไป
 * ใช้ฝั่ง server เท่านั้น โครงตารางอยู่ที่ db/schema.sql
 *
 * kind "rows"   : ข้อมูลเป็น string[] ลำดับคอลัมน์ตรงกับ cols
 * kind "object" : ข้อมูลเป็น object ชื่อฟิลด์ตาม field และใช้ฟิลด์ id ของ object เป็นรหัสรายการ
 *
 * ชนิดข้อมูล:
 *  text · int · num · money (แสดงแบบมีจุลภาค) · bool · list (text[])
 *  date (YYYY-MM-DD) · date_th (วว/ดด/ปปปป พ.ศ.) · ts_th (วว/ดด/ปปปป HH:MM) · time (HH:MM)
 */
export type ColType = "text" | "int" | "num" | "money" | "bool" | "list" | "date" | "date_th" | "ts_th" | "time";
export type Col = { col: string; t: ColType; field?: string };
/**
 * branchCol    : คอลัมน์สาขา ผู้ใช้ที่ไม่ใช่ Global Admin เห็น/แก้เฉพาะสาขาตัวเอง (และเห็นข้อมูลส่วนกลางแบบอ่านอย่างเดียว)
 * hiddenBranch : คอลัมน์สาขาไม่ได้อยู่ใน cols หน้าเว็บไม่เห็น server ใส่ค่าให้ตอนสร้างรายการ
 * adminOnly    : ระดับปฏิบัติงานเข้าไม่ได้
 */
export type Spec = { table: string; kind: "rows" | "object"; cols: Col[]; numericId?: boolean; branchCol?: string; hiddenBranch?: boolean; adminOnly?: boolean; scope?: { col: string; value: string } };

/** ค่าสาขาของข้อมูลส่วนกลาง ทุกสาขาเห็นได้ */
export const SHARED_BRANCHES = ["ทุกสาขา", "ส่วนกลาง"];
const own = { branchCol: "branch_name", hiddenBranch: true };

const c = (col: string, t: ColType = "text", field?: string): Col => ({ col, t, field });

const SPECS: Record<string, Omit<Spec, "scope">> = {
  contracts: { table: "contracts", kind: "rows", branchCol: "branch_name", cols: [c("contract_no"), c("branch_name"), c("resident_name"), c("employer_name"), c("monthly_fee", "money"), c("status")] },
  residents: { table: "residents", kind: "rows", branchCol: "branch_name", cols: [c("full_name"), c("age", "int"), c("room"), c("branch_name"), c("chronic_diseases"), c("status")] },
  tasks_table: { table: "task_logs", kind: "rows", branchCol: "branch_name", cols: [c("work_date", "date_th"), c("branch_name"), c("resident_name"), c("category"), c("task_name"), c("performed_by"), c("status"), c("submitted_at", "time")] },
  appointments: { table: "appointments", kind: "rows", ...own, cols: [c("appt_date", "date_th"), c("appt_time", "time"), c("resident_name"), c("purpose"), c("caregiver")] },
  health: { table: "health_logs", kind: "rows", ...own, cols: [c("recorded_at", "ts_th"), c("resident_name"), c("vital_signs"), c("o2_sat"), c("dtx"), c("weight_height"), c("other_info"), c("note"), c("recorded_by")] },
  complaints: { table: "complaints", kind: "rows", branchCol: "branch_name", cols: [c("reported_at", "ts_th"), c("branch_name"), c("issue"), c("contact_phone"), c("status")] },
  docs: { table: "official_documents", kind: "rows", ...own, cols: [c("title"), c("doc_type"), c("doc_date", "date_th"), c("status")] },
  branches: {
    table: "branches", kind: "rows", branchCol: "name",
    cols: [c("branch_code"), c("name"), c("legal_entity"), c("phone"), c("address"), c("bed_count", "int"), c("ownership_type"), c("branch_type"), c("selling_point"), c("email"), c("status"), c("lat_long"), c("image_url"), c("license_no"), c("bank_name"), c("main_account"), c("sub_account")],
  },
  facility: { table: "facility_tasks", kind: "rows", ...own, cols: [c("task_name"), c("category"), c("schedule"), c("dispatch_mode")] },
  master: { table: "master_tasks", kind: "rows", branchCol: "branch_name", cols: [c("task_code"), c("task_name"), c("instruction"), c("category"), c("shift"), c("branch_name"), c("profession")] },
  assessments: { table: "care_assessments", kind: "rows", ...own, cols: [c("plan_name"), c("resident_name"), c("chronic_diseases"), c("relative_phone"), c("estimated_price", "money"), c("note")] },
  "pharmacy-master": { table: "drug_catalog", kind: "rows", cols: [c("drug_name"), c("properties")] },
  "pharmacy-drugs": {
    table: "resident_medications", kind: "object", numericId: true, ...own,
    cols: [
      c("resident_name", "text", "who"), c("drug_name", "text", "name"), c("indication", "text", "use"), c("directions", "text", "how"),
      c("storage", "text", "store"), c("dosage_form", "text", "form"), c("is_bulk", "bool", "bulk"), c("dose", "num", "dose"),
      c("timing", "text", "timing"), c("meals", "list", "meals"), c("schedule_days", "list", "days"), c("warnings", "list", "warn"),
      c("stock", "num", "stock"), c("unit", "text", "unit"), c("needs_fridge", "bool", "fridge"), c("on_hold", "bool", "hold"), c("status", "text", "status"),
    ],
  },
  "pharmacy-packs": {
    table: "medication_packs", kind: "object", numericId: true, ...own,
    cols: [c("pack_date", "date", "date"), c("resident_name", "text", "who"), c("meal", "text", "meal"), c("items", "list", "items"), c("qa_status", "text", "qa"), c("error_reason", "text", "reason"), c("given", "bool", "given"), c("packed_by", "text", "by")],
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

const DAILY = { table: "daily_tasks", kind: "rows" as const, ...own, cols: [c("resident_name"), c("task_name"), c("assignee"), c("scheduled_time", "time"), c("shift"), c("status"), c("instruction"), c("vital_signs"), c("submitted_time", "time")] };

/** หา spec จากชื่อชุดข้อมูล เช่น "contracts" หรือ "daily-2026-10-27" */
export function specFor(key: string): Spec | null {
  if (SPECS[key]) return { ...SPECS[key], adminOnly: !/^(pharmacy|staff)-/.test(key) };
  const m = key.match(/^daily-(\d{4}-\d{2}-\d{2})$/);
  if (m) return { ...DAILY, adminOnly: true, scope: { col: "work_date", value: m[1] } };
  return null;
}

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
    case "ts_th": return `${toThaiDate(s)} ${s.slice(11, 16)}`;
    case "time": return s.slice(0, 5);
    default: return s;
  }
}

/** คอลัมน์ที่ต้อง cast เป็น text ตอน SELECT เพื่อไม่ให้ driver แปลงเป็น Date */
export const selectExpr = (col: Col) => (["date", "date_th", "ts_th", "time"].includes(col.t) ? `${col.col}::text AS ${col.col}` : col.col);
