/**
 * อ่านและประเมินสัญญาณชีพ ใช้ได้ทั้งหน้าเว็บและ server
 *
 * เกณฑ์ด้านล่างเป็น "ค่าเริ่มต้นสำหรับผู้สูงอายุในสถานดูแล" ไว้คัดกรองให้พยาบาลดูก่อน ไม่ใช่การวินิจฉัย
 * ทีมพยาบาล/แพทย์ควรทบทวนและปรับตัวเลขในตาราง LIMITS ให้ตรงกับแนวปฏิบัติของศูนย์
 */
export type Vitals = { sys?: number; dia?: number; pr?: number; rr?: number; bt?: number; o2?: number; dtx?: number };
export type Level = "normal" | "watch" | "critical";
export type Flag = { key: keyof Vitals; label: string; value: number; unit: string; level: Exclude<Level, "normal">; note: string };

type Limit = { label: string; unit: string; criticalLow?: number; watchLow?: number; watchHigh?: number; criticalHigh?: number };
/** ต่ำกว่า criticalLow / สูงกว่าหรือเท่ากับ criticalHigh = ผิดปกติ · ต่ำกว่า watchLow / สูงกว่าหรือเท่ากับ watchHigh = เฝ้าระวัง */
export const LIMITS: Record<keyof Vitals, Limit> = {
  sys: { label: "ความดันตัวบน (SBP)", unit: "mmHg", criticalLow: 90, watchLow: 100, watchHigh: 160, criticalHigh: 180 },
  dia: { label: "ความดันตัวล่าง (DBP)", unit: "mmHg", criticalLow: 50, watchHigh: 100, criticalHigh: 110 },
  pr: { label: "ชีพจร (PR)", unit: "ครั้ง/นาที", criticalLow: 50, watchLow: 60, watchHigh: 100, criticalHigh: 120 },
  rr: { label: "การหายใจ (RR)", unit: "ครั้ง/นาที", criticalLow: 10, watchLow: 12, watchHigh: 24, criticalHigh: 28 },
  bt: { label: "อุณหภูมิ (BT)", unit: "°C", criticalLow: 35, watchLow: 35.5, watchHigh: 37.5, criticalHigh: 38.5 },
  o2: { label: "ออกซิเจนในเลือด (O2 Sat)", unit: "%", criticalLow: 90, watchLow: 95 },
  dtx: { label: "น้ำตาลปลายนิ้ว (DTX)", unit: "mg/dL", criticalLow: 70, watchLow: 80, watchHigh: 250, criticalHigh: 300 },
};

const num = (s?: string | null) => { if (!s) return undefined; const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : undefined; };

/** อ่านจากข้อความ เช่น "BP 128/80, PR 76, RR 18, BT 36.6" + ช่อง O2 Sat ("98%") และ DTX ("112") */
export function parseVitals(text?: string | null, o2?: string | null, dtx?: string | null): Vitals {
  const t = String(text ?? "");
  const v: Vitals = {};
  const bp = t.match(/BP\s*:?\s*(\d{2,3})\s*\/\s*(\d{2,3})/i);
  if (bp) { v.sys = Number(bp[1]); v.dia = Number(bp[2]); }
  const pick = (re: RegExp) => { const m = t.match(re); return m ? Number(m[1]) : undefined; };
  v.pr = pick(/\b(?:PR|HR|P)\s*:?\s*(\d{2,3})\b(?!\s*\/)/i);
  v.rr = pick(/\bRR\s*:?\s*(\d{1,2})\b/i);
  v.bt = pick(/\b(?:BT|T)\s*:?\s*(\d{2}(?:\.\d+)?)\b/i);
  v.o2 = num(o2) ?? pick(/(?:O2\s*sat|SpO2|O2)\s*:?\s*(\d{2,3})/i);
  v.dtx = num(dtx) ?? pick(/DTX\s*:?\s*(\d{2,3})/i);
  (Object.keys(v) as (keyof Vitals)[]).forEach((k) => v[k] === undefined && delete v[k]);
  return v;
}

/** ค่าที่เกินเกณฑ์ (เรียงผิดปกติก่อนเฝ้าระวัง) */
export function evaluateVitals(v: Vitals): Flag[] {
  const flags: Flag[] = [];
  for (const k of Object.keys(LIMITS) as (keyof Vitals)[]) {
    const x = v[k];
    if (x === undefined || Number.isNaN(x)) continue;
    const l = LIMITS[k];
    let level: Flag["level"] | null = null; let note = "";
    if (l.criticalLow !== undefined && x < l.criticalLow) { level = "critical"; note = "ต่ำมาก"; }
    else if (l.criticalHigh !== undefined && x >= l.criticalHigh) { level = "critical"; note = "สูงมาก"; }
    else if (l.watchLow !== undefined && x < l.watchLow) { level = "watch"; note = "ต่ำกว่าเกณฑ์"; }
    else if (l.watchHigh !== undefined && x >= l.watchHigh) { level = "watch"; note = "สูงกว่าเกณฑ์"; }
    if (level) flags.push({ key: k, label: l.label, value: x, unit: l.unit, level, note });
  }
  return flags.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}

export const levelOf = (flags: Flag[]): Level => (flags.some((f) => f.level === "critical") ? "critical" : flags.length ? "watch" : "normal");
export const LEVEL_TH: Record<Level, string> = { normal: "ปกติ", watch: "เฝ้าระวัง", critical: "ผิดปกติ" };
export const flagText = (f: Flag) => `${f.label} ${f.value} ${f.unit} (${f.note})`;

/** ข้อความสัญญาณชีพมาตรฐานที่ใช้บันทึก เช่น "BP 128/80, PR 76, RR 18, BT 36.6" */
export function vitalText(v: { bp?: string; pr?: string; rr?: string; bt?: string }) {
  return [v.bp && `BP ${v.bp}`, v.pr && `PR ${v.pr}`, v.rr && `RR ${v.rr}`, v.bt && `BT ${v.bt}`].filter(Boolean).join(", ");
}
