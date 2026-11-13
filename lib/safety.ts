/** รายงานเหตุการณ์ไม่พึงประสงค์: ประเภทและความรุนแรง (ใช้ทั้งหน้าจอและ server) */
export const INCIDENT_KINDS = ["หกล้ม", "ให้ยาผิด", "แผลใหม่", "สำลัก", "อื่นๆ"] as const;
export const INCIDENT_LEVELS = ["ไม่บาดเจ็บ", "บาดเจ็บเล็กน้อย", "ต้องส่ง รพ."] as const;
export type Incident = {
  id: string; resident_id: string | null; resident_name: string; branch: string | null; kind: string; severity: string; detail: string; has_photo: boolean;
  occurred: string; reported_by: string | null; reported: string; ack_by: string | null; ack_at: string | null; action: string;
  family_at: string | null; family_by: string | null; age_min: number;
};
/** แผล: ตำแหน่งที่พบบ่อย และระดับแผลกดทับ */
export const WOUND_SITES = ["ก้นกบ", "สะโพกซ้าย", "สะโพกขวา", "ส้นเท้าซ้าย", "ส้นเท้าขวา", "ข้อศอก", "ท้ายทอย"];
export const WOUND_STAGES = ["ระดับ 1", "ระดับ 2", "ระดับ 3", "ระดับ 4", "ประเมินไม่ได้", "แผลอื่น (ไม่ใช่แผลกดทับ)"];
export type WoundLog = { id: string; site: string; stage: string; length: number | null; width: number | null; photo: string | null; note: string; author: string | null; at: string };
/** "2026-11-13 14:20" → "13/11 14:20" */
export const shortAt = (at: string | null | undefined) => { const m = String(at ?? "").match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})/); return m ? `${m[2]}/${m[1]} ${m[3]}` : at ?? ""; };
