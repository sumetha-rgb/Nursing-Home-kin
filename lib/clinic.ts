/** งานพยาบาลและกายภาพ: แบบฟอร์มประเมินแรกรับ ชนิดบันทึก และตัวช่วยเรียก /api/clinic (ใช้ได้ทั้งหน้าเว็บและ server) */

export const NOTE_KINDS = ["nurse", "problem", "insulin", "physio", "referral"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_LABEL: Record<NoteKind, string> = { nurse: "Nurse Note", problem: "Problem list", insulin: "ฉีดอินซูลิน", physio: "กายภาพ", referral: "ใบส่งต่อ" };

export type Note = { id: string; kind: NoteKind; title: string | null; body: string | null; data: Record<string, unknown>; status: string | null; author: string | null; at: string };
export type Course = { id: string; name: string; total: number; used: number; price: number; status: string; created_by: string | null; invoice_id: string | null; at: string };
export type SupplyIssue = { id: string; item_name: string; unit: string; qty: number; price: number; issued_by: string | null; invoice_id: string | null; at: string };
export type SupplyItem = { id: string; branch_name: string; name: string; unit: string; price: number; stock: number };
export type Clinic = { admission: { data: Record<string, string>; assessed_by: string | null; at: string } | null; notes: Note[]; courses: Course[]; supplies: SupplyIssue[] };

/** ช่องในแบบประวัติและประเมินแรกรับ (เก็บเป็น JSON ตาม key) */
export type AdmField = { key: string; label: string; options?: string[]; area?: boolean; placeholder?: string };
export const ADMISSION: { title: string; fields: AdmField[] }[] = [
  { title: "ประวัติการเจ็บป่วย", fields: [
    { key: "diagnosis", label: "การวินิจฉัยหลัก", placeholder: "เช่น Stroke (Rt. hemiparesis)" },
    { key: "admit_from", label: "รับมาจาก", options: ["บ้าน", "โรงพยาบาล", "สถานดูแลอื่น"] },
    { key: "hospital", label: "โรงพยาบาล / แพทย์เจ้าของไข้", placeholder: "เช่น รพ.ศิริราช · นพ.สมชาย" },
    { key: "blood_group", label: "หมู่เลือด", options: ["A", "B", "AB", "O", "ไม่ทราบ"] },
    { key: "history", label: "ประวัติการเจ็บป่วย / ผ่าตัด", area: true },
    { key: "allergy_drug", label: "แพ้ยา", placeholder: "ไม่แพ้ หรือระบุชื่อยาและอาการ" },
    { key: "allergy_food", label: "แพ้อาหาร", placeholder: "ไม่แพ้ หรือระบุ" },
  ] },
  { title: "ผู้ติดต่อฉุกเฉิน", fields: [
    { key: "emergency_name", label: "ชื่อผู้ติดต่อ" },
    { key: "emergency_relation", label: "ความเกี่ยวข้อง" },
    { key: "emergency_phone", label: "เบอร์โทร", placeholder: "08X-XXX-XXXX" },
  ] },
  { title: "ประเมินแรกรับ", fields: [
    { key: "consciousness", label: "ระดับความรู้สึกตัว", options: ["รู้สึกตัวดี", "สับสน", "ซึม", "ไม่รู้สึกตัว"] },
    { key: "mobility", label: "การเคลื่อนไหว", options: ["เดินได้เอง", "ใช้อุปกรณ์ช่วยเดิน", "รถเข็น", "ติดเตียง"] },
    { key: "adl", label: "ADL (Barthel 0–20)", placeholder: "เช่น 12" },
    { key: "fall_risk", label: "ความเสี่ยงหกล้ม", options: ["ต่ำ", "ปานกลาง", "สูง"] },
    { key: "braden", label: "Braden score (6–23)", placeholder: "ต่ำกว่า 13 = เสี่ยงแผลกดทับสูง" },
    { key: "pressure_sore", label: "แผลกดทับ", placeholder: "ไม่มี หรือระบุตำแหน่งและระดับ" },
    { key: "pain", label: "ระดับความปวด (0–10)", placeholder: "0" },
    { key: "devices", label: "อุปกรณ์ทางการแพทย์", placeholder: "เช่น NG tube, Foley cath, Tracheostomy" },
    { key: "cognition", label: "การรับรู้ / ความจำ", options: ["ปกติ", "หลงลืมเล็กน้อย", "สมองเสื่อม"] },
  ] },
  { title: "อาหาร", fields: [
    { key: "diet_type", label: "ประเภทอาหาร", options: ["อาหารธรรมดา", "อาหารอ่อน", "อาหารเหลว", "อาหารปั่นทางสาย", "อาหารเบาหวาน", "อาหารจำกัดเกลือ"] },
    { key: "feeding", label: "การรับประทาน", options: ["ทานเองได้", "ช่วยป้อน", "ทางสายให้อาหาร"] },
    { key: "diet_note", label: "ข้อจำกัด / สิ่งที่ห้าม", placeholder: "เช่น งดหวาน · น้ำไม่เกิน 1,500 มล./วัน" },
  ] },
  { title: "หมายเหตุ", fields: [{ key: "note", label: "หมายเหตุเพิ่มเติม", area: true }] },
];
export const ADMISSION_FIELDS = ADMISSION.flatMap((s) => s.fields);

export async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ทำรายการไม่สำเร็จ");
  return d as T;
}
export const fetchClinic = (id: string) => call<Clinic>(`/api/clinic?op=resident&id=${encodeURIComponent(id)}`);
export const clinic = (body: object) => call<{ ok: boolean; id?: string; used?: number; total?: number; stock?: number }>("/api/clinic", body);
export const fetchDocSettings = () => call<{ settings: Record<string, string> }>("/api/clinic?op=doc_settings").then((d) => d.settings);
