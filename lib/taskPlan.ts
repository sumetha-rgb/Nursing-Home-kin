/**
 * ตัวช่วยของงานที่มอบหมาย (26 พ.ย. 2569) · ใช้ทั้งหน้าตั้งค่ารายการงาน หน้ามอบหมายงาน และ server
 *  - เวลา: พิมพ์แบบไหนก็ได้ "7" "730" "7.30" "19:30" → "HH:MM"
 *  - ช่วงเวลาแนะนำของงาน: "7-8, 12-13, 17-18" → [{ s: "07:00", e: "08:00" }, …]
 *  - ทำเมื่อไร: "ทุกวัน" · "ครั้งเดียว" · "จ. พ. ศ." / "จ.–ศ." (วัน ISO 1 = จันทร์ … 7 = อาทิตย์)
 */
export type Win = { s: string; e: string };
export type Repeat = { rep: "once" | "daily" | "days"; days: number[] };

/** พิมพ์เวลาแบบไหนก็ได้ → "HH:MM" · ว่าง = "" · อ่านไม่ออก = null */
export function normTime(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/\s*น\.?$/, "").replace(/[.,]/g, ":").replace(/:+/g, ":").replace(/:$/, "");
  if (!s) return "";
  let h: number, m: number;
  if (s.includes(":")) { const [a, b] = s.split(":"); h = Number(a); m = !b ? 0 : Number(b.length === 1 ? `${b}0` : b.slice(0, 2)); }
  else if (/^\d{1,2}$/.test(s)) { h = Number(s); m = 0; }
  else if (/^\d{3,4}$/.test(s)) { h = Number(s.slice(0, s.length - 2)); m = Number(s.slice(-2)); }
  else return null;
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h < 24 && m >= 0 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null;
}

/** "7-8, 12-13" → ช่วงเวลา (ช่วงที่อ่านไม่ออกข้ามไป) */
export function parseWindows(text: unknown): Win[] {
  return String(text ?? "").split(/[,·;\n]+/).map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const [a, b] = p.split(/\s*(?:-|–|ถึง)\s*/);
    const s = normTime(a), e = b === undefined ? "" : normTime(b);
    return s ? [{ s, e: e ?? "" }] : [];
  });
}
export const windowsText = (w: Win[]) => w.map((x) => (x.e ? `${x.s}–${x.e}` : x.s)).join(", ");

/**
 * รายการงานที่สาขาใช้จริง: งานของสาขาที่แก้จากงานส่วนกลาง (r[9] = รหัสงานส่วนกลาง) หรือชื่อเดียวกัน แทนงานส่วนกลางนั้น
 *  แถว [รหัส, ชื่องาน, คำสั่งงาน, หมวด, กะ, สาขา, วิชาชีพ, เวลาแนะนำ, ทำเมื่อไร, แทนรหัส] · branch ว่าง (ผู้บริหาร) = งานของสาขามาก่อน ไม่ซ่อน
 */
export function effectiveTasks<T extends { r: string[] }>(list: T[], branch?: string): T[] {
  const own = list.filter((x) => x.r[5] && x.r[5] !== "ส่วนกลาง" && (!branch || x.r[5] === branch));
  const gone = new Set(own.flatMap((x) => [x.r[9] ? `c:${x.r[9]}` : "", `n:${x.r[1]}`]));
  return branch ? list.filter((x) => x.r[5] !== "ส่วนกลาง" || !(gone.has(`c:${x.r[0]}`) || gone.has(`n:${x.r[1]}`))) : [...own, ...list.filter((x) => !own.includes(x))];
}

/** วันในสัปดาห์ (ลำดับ 0 = จันทร์ … 6 = อาทิตย์ · วัน ISO = ลำดับ + 1) */
export const DAYS_TH = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
/** ISO ของวันที่ YYYY-MM-DD (1 = จันทร์ … 7 = อาทิตย์) */
export const isoDow = (ymd: string) => ((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** "ทุกวัน" / "ครั้งเดียว" / "จ. พ. ศ." / "จ.–ศ." / "ส. อา." → Repeat · ว่าง = ทุกวัน */
export function parseRepeat(text: unknown): Repeat {
  const t = String(text ?? "").trim();
  if (!t || /ทุกวัน/.test(t)) return { rep: "daily", days: [] };
  if (/ครั้งเดียว|วันนี้/.test(t)) return { rep: "once", days: [] };
  const tok = t.replace(/[.,]/g, " ").replace(/\s*(?:-|–|ถึง)\s*/g, " - ").split(/\s+/).filter(Boolean);
  const idx = (x: string) => DAYS_TH.indexOf(x);
  const days = new Set<number>();
  for (let k = 0; k < tok.length; k++) {
    const i = idx(tok[k]);
    if (i < 0) continue;
    if (tok[k + 1] === "-" && idx(tok[k + 2] ?? "") >= 0) { const j = idx(tok[k + 2]); for (let x = i; x <= j; x++) days.add(x + 1); k += 2; }
    else days.add(i + 1);
  }
  return days.size === 7 ? { rep: "daily", days: [] } : days.size ? { rep: "days", days: [...days].sort((a, b) => a - b) } : { rep: "daily", days: [] };
}
/** Repeat → ข้อความ ("ทุกวัน" / "ครั้งเดียว" / "ทุก จ. พ. ศ.") */
export const repeatText = (r: Repeat, withTook = true) =>
  r.rep === "once" ? "ครั้งเดียว" : r.rep === "daily" ? "ทุกวัน" : `${withTook ? "ทุก " : ""}${r.days.map((d) => `${DAYS_TH[d - 1]}.`).join(" ")}`;
