/**
 * รอบการวัดรายบุคคล (ใช้ได้ทั้งหน้าเว็บและ server)
 *  ตั้งรอบที่ตัวผู้ป่วยด้วยปุ่มภาษาคน (ประวัติผู้รับบริการ › สัญญาณชีพ) · ระบบนับรอบจาก "ครั้งล่าสุดที่บันทึกจริง"
 *  ถึงรอบ = วันที่บันทึกล่าสุด + รอบ · ยังไม่เคยวัด = ถึงรอบทันที · วัดนอกรอบก็นับเป็นรอบใหม่
 *  วันละ 2 ครั้ง = เวรเช้า (07:00–19:00) + เวรดึก (19:00–07:00) วัดเวรละครั้ง
 */
export type VitalKey = "vs" | "o2" | "dtx" | "wt" | "ht";
export type PresetKey = "2d" | "1d" | "3d" | "1w" | "2w" | "1m" | "off";
export type VitalPlan = Record<VitalKey, PresetKey>;

/** fields = ช่องในฟอร์มบันทึกสัญญาณชีพ (components/care/VitalsDialog) */
export const VITAL_ITEMS: { k: VitalKey; label: string; sub: string; fields: string[] }[] = [
  { k: "vs", label: "สัญญาณชีพ", sub: "BP · PR · RR · BT", fields: ["bp", "pr", "rr", "bt"] },
  { k: "o2", label: "ออกซิเจนในเลือด", sub: "O2 Sat", fields: ["o2"] },
  { k: "dtx", label: "น้ำตาลในเลือด (DTX)", sub: "mg/dL", fields: ["dtx"] },
  { k: "wt", label: "น้ำหนัก", sub: "กก.", fields: ["weight"] },
  { k: "ht", label: "ส่วนสูง", sub: "ซม.", fields: ["height"] },
];
export const VITAL_PRESETS: { k: PresetKey; label: string; days: number | null }[] = [
  { k: "2d", label: "วันละ 2 ครั้ง", days: 0.5 }, { k: "1d", label: "วันละครั้ง", days: 1 }, { k: "3d", label: "ทุก 3 วัน", days: 3 },
  { k: "1w", label: "สัปดาห์ละครั้ง", days: 7 }, { k: "2w", label: "ทุก 2 สัปดาห์", days: 14 }, { k: "1m", label: "เดือนละครั้ง", days: 30 },
  { k: "off", label: "ไม่ต้องวัด", days: null },
];
/** ค่าเริ่มต้นของผู้ป่วยที่ยังไม่ได้ตั้งรอบ */
export const DEFAULT_PLAN: VitalPlan = { vs: "2d", o2: "2d", dtx: "off", wt: "1w", ht: "1m" };
export const presetLabel = (k: PresetKey) => VITAL_PRESETS.find((p) => p.k === k)?.label ?? "-";

/** รวมรอบที่บันทึกไว้กับค่าเริ่มต้น (ค่าที่ไม่รู้จักใช้ค่าเริ่มต้น) */
export function planOf(raw: unknown): VitalPlan {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ok = (v: unknown): v is PresetKey => VITAL_PRESETS.some((p) => p.k === v);
  return Object.fromEntries(VITAL_ITEMS.map(({ k }) => [k, ok(o[k]) ? o[k] : DEFAULT_PLAN[k]])) as VitalPlan;
}

export type DueCls = "due" | "over" | "rest" | "off";
export type Due = { cls: DueCls; text: string; next: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
/** เวลาไทยตอนนี้ "YYYY-MM-DD HH:MM" */
export const nowBkk = (t = Date.now()) => { const d = new Date(t + 7 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const ms = (s: string) => Date.parse(`${s.slice(0, 10)}T${s.slice(11, 16) || "00:00"}:00Z`);
const fmt = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const H = 3600e3, D = 24 * H;
/** "2026-11-23" → "23/11/69" */
export const thShort = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${String(Number(s.slice(0, 4)) + 543).slice(2)}`;

/**
 * สถานะของรายการวัด 1 รายการ
 *  last = ครั้งล่าสุดที่บันทึก (เวลาไทย "YYYY-MM-DD HH:MM") หรือ null = ยังไม่เคยวัด
 */
export function dueOf(preset: PresetKey, last: string | null, now = nowBkk()): Due {
  const p = VITAL_PRESETS.find((x) => x.k === preset);
  if (!p || p.days === null) return { cls: "off", text: "ไม่ต้องวัด", next: null };
  const tNow = ms(now);
  if (p.days < 1) {
    // เวรตอนนี้เริ่มกี่โมง: 07:00 หรือ 19:00 (ก่อน 07:00 = เวรดึกที่เริ่ม 19:00 เมื่อวาน)
    const day = ms(now.slice(0, 10)), h = Number(now.slice(11, 13));
    const start = h >= 19 ? day + 19 * H : h >= 7 ? day + 7 * H : day - 5 * H;
    const shift = h >= 7 && h < 19 ? "เวรเช้า" : "เวรดึก";
    if (!last) return { cls: "due", text: "ยังไม่เคยวัด", next: fmt(start) };
    const tl = ms(last);
    if (tl >= start) return { cls: "rest", text: `วัดแล้ว${shift}`, next: fmt(start + 12 * H) };
    if (tl >= start - 12 * H) return { cls: "due", text: `ถึงรอบ${shift}`, next: fmt(start) };
    return { cls: "over", text: `ขาดวัด ${Math.floor((start - tl) / (12 * H))} เวร`, next: fmt(start) };
  }
  if (!last) return { cls: "due", text: "ยังไม่เคยวัด", next: now.slice(0, 10) };
  const next = fmt(ms(last.slice(0, 10)) + p.days * D).slice(0, 10);
  const diff = Math.round((ms(next) - ms(now.slice(0, 10))) / D);
  if (diff > 0) return { cls: "rest", text: last.slice(0, 10) === now.slice(0, 10) ? "วัดแล้ววันนี้" : `อีก ${diff} วัน`, next };
  if (diff === 0) return { cls: "due", text: "ถึงรอบวันนี้", next };
  return { cls: "over", text: `เลยกำหนด ${-diff} วัน`, next };
}

/** แถวจาก GET /api/care?op=vital_due */
export type VitalDueRow = { id: string; name: string; room: string | null; branch: string | null; plan: VitalPlan; custom: boolean; by: string | null; last: Record<VitalKey, string | null> };
export const dueAll = (r: VitalDueRow, now = nowBkk()) => VITAL_ITEMS.map((it) => ({ ...it, preset: r.plan[it.k], last: r.last[it.k], due: dueOf(r.plan[it.k], r.last[it.k], now) }));
/** รายการที่ต้องวัด (ถึงรอบ/เลยกำหนด) ของผู้ป่วยคนนี้ · เลยกำหนดขึ้นก่อน */
export const needOf = (r: VitalDueRow, now = nowBkk()) => dueAll(r, now).filter((x) => x.due.cls === "due" || x.due.cls === "over").sort((a, b) => Number(b.due.cls === "over") - Number(a.due.cls === "over"));

export const fetchVitalDue = (q: { id?: string; name?: string } = {}) =>
  fetch(`/api/care?op=vital_due${q.id ? `&id=${encodeURIComponent(q.id)}` : q.name ? `&name=${encodeURIComponent(q.name)}` : ""}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("โหลดรอบการวัดไม่สำเร็จ")))).then((d: { items: VitalDueRow[]; canEdit: boolean }) => d);
export const saveVitalPlan = async (residentId: string, plan: VitalPlan) => {
  const r = await fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "vital_plan", residentId, plan }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "บันทึกรอบการวัดไม่สำเร็จ");
};
/** บอกหน้าที่แสดงรอบการวัดให้ดึงใหม่ (หลังบันทึกสัญญาณชีพ/ตั้งรอบ) */
export const VITAL_DUE_EVENT = "kin-vital-due";
export const notifyVitalDue = () => setTimeout(() => window.dispatchEvent(new Event(VITAL_DUE_EVENT)), 1200);
