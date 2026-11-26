/**
 * เวลากะของสาขา (25 พ.ย. 2569 · ปรับ 26 พ.ย. ให้ตั้งเองได้อิสระ) · ใช้ร่วมกันทั้งหน้าเว็บและ server
 *
 *  ทุกสาขามี 2 กะ ต่อกันครบ 24 ชั่วโมง · ผู้จัดการสาขาตั้ง "เวลาเริ่มกะเช้า" และ "เวลาเริ่มกะดึก" เอง (ชั่วโมงและนาที) ที่หน้าตารางเวร
 *  กะเช้า = เริ่มกะเช้า → เริ่มกะดึก (วันเดียวกัน) · กะดึก = เริ่มกะดึก → เริ่มกะเช้าของวันถัดไป · สองกะยาวไม่เท่ากันได้
 *  เงื่อนไข: กะเช้าเริ่มก่อนกะดึกในวันเดียวกัน (กะเช้าไม่ข้ามเที่ยงคืน · กะดึกข้ามเที่ยงคืนเสมอ) · แต่ละกะยาวอย่างน้อย 4 ชั่วโมง
 *  ไม่ได้ตั้ง = 07:00 / 19:00 (ค่าเดิมของระบบ) · เก็บที่ตาราง branch_shifts (นาทีนับจากเที่ยงคืน)
 *
 *  ShiftCfg = { d: เริ่มกะเช้า, n: เริ่มกะดึก } เป็นชั่วโมงทศนิยม (07:30 = 7.5)
 *  "วันทำงาน" (workday) ของเวลาใดก็ตาม = วันที่กะเช้าของวันนั้นเริ่ม เช่น เริ่ม 07:00 → 03:00 น. วันที่ 26 ยังเป็นกะดึกของวันที่ 25
 *  งานกะดึกที่ลงเวลาก่อนเวลาเริ่มกะเช้า (เช่น 02:00) = ทำหลังเที่ยงคืน คือวันถัดไปตามปฏิทิน
 */
export type ShiftCfg = { d: number; n: number };
export const DEFAULT_SHIFT: ShiftCfg = { d: 7, n: 19 };
/** กะละอย่างน้อยกี่ชั่วโมง */
export const MIN_SHIFT_HOURS = 4;

/** "07:30" → 7.5 · ไม่ใช่เวลา = NaN */
export const hourOf = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t ?? ""); return m ? Number(m[1]) + Number(m[2]) / 60 : NaN; };
/** 7.5 → "07:30" (เกิน 24 วนกลับ) */
export const hm = (h: number) => {
  const mins = ((Math.round(h * 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
};
/** ตรวจค่าที่ตั้ง: กะเช้าเริ่มก่อนกะดึก · แต่ละกะ ≥ MIN_SHIFT_HOURS · คืนข้อความผิด หรือ "" = ใช้ได้ */
export function shiftError(c: ShiftCfg): string {
  if (!Number.isFinite(c.d) || !Number.isFinite(c.n) || c.d < 0 || c.n >= 24) return "เวลาไม่ถูกต้อง";
  if (c.n <= c.d) return "กะดึกต้องเริ่มหลังกะเช้าในวันเดียวกัน";
  if (c.n - c.d < MIN_SHIFT_HOURS) return `กะเช้าต้องยาวอย่างน้อย ${MIN_SHIFT_HOURS} ชั่วโมง`;
  if (24 - (c.n - c.d) < MIN_SHIFT_HOURS) return `กะดึกต้องยาวอย่างน้อย ${MIN_SHIFT_HOURS} ชั่วโมง`;
  return "";
}
/** ค่าจากฐานข้อมูล (นาที) → ShiftCfg · ผิดเงื่อนไข = ค่าเริ่มต้น */
export const cfgOfMinutes = (dMin: unknown, nMin: unknown): ShiftCfg => {
  const c = { d: Number(dMin) / 60, n: Number(nMin) / 60 };
  return shiftError(c) ? DEFAULT_SHIFT : c;
};
/** เวลาเริ่มของกะ (ชั่วโมงทศนิยม) */
export const shiftStartHour = (c: ShiftCfg, night: boolean) => (night ? c.n : c.d);
/** ความยาวกะ (ชั่วโมง) */
export const shiftLength = (c: ShiftCfg, night: boolean) => (night ? 24 - (c.n - c.d) : c.n - c.d);
/** ข้อความช่วงเวลา เช่น "07:00–19:00" (night = กะดึก) */
export const shiftRange = (c: ShiftCfg, night: boolean) => (night ? `${hm(c.n)}–${hm(c.d)}` : `${hm(c.d)}–${hm(c.n)}`);
/** "9 ชม. 30 นาที" */
export const lenText = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} ชม.${m % 60 ? ` ${m % 60} นาที` : ""}`; };
/** ชั่วโมงในวัน (ทศนิยมได้) อยู่กะเช้าไหม */
export const isDayHour = (h: number, c: ShiftCfg) => h >= c.d && h < c.n;
export const shiftOfHour = (h: number, c: ShiftCfg): "กะเช้า" | "กะดึก" => (isDayHour(h, c) ? "กะเช้า" : "กะดึก");
/** งานกะดึกที่ลงเวลา t: ทำหลังเที่ยงคืน (วันถัดไปตามปฏิทิน) ไหม */
export const nightAfterMidnight = (t: string, c: ShiftCfg) => hourOf(t) < c.d;
/** วันทำงาน (YYYY-MM-DD) ของเวลา ms ตามเวลาไทย · ก่อนเวลาเริ่มกะเช้า = ยังเป็นวันก่อนหน้า */
export const workDayOf = (ms: number, c: ShiftCfg) => new Date(ms + 7 * 3600e3 - c.d * 3600e3).toISOString().slice(0, 10);
/** เวลาทำงานแนะนำตอนมอบหมาย: 1 ชั่วโมงหลังเริ่มกะ (07:00/19:00 → 08:00/20:00) */
export const suggestTimes = (c: ShiftCfg) => ({ กะเช้า: hm(c.d + 1), กะดึก: hm(c.n + 1) });
