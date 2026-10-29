/**
 * ตารางนัดหมาย (ชุดข้อมูล "appointments") · แถว: [วันที่ วว/ดด/ปปปป พ.ศ., เวลา HH:MM, ผู้รับบริการ, รายการ, ผู้ดูแล]
 * ใช้ทั้งหน้าตารางนัดหมายและการ์ด "นัดหมายที่กำลังมาถึง" ในหน้าภาพรวม
 */
const pad = (n: number | string) => String(n).padStart(2, "0");
export const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "28/10/2569" หรือ "2026-10-28" → "2026-10-28" (อ่านไม่ได้ = "") */
export function apptIso(d: string) {
  const iso = (d ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const th = (d ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!th) return "";
  const y = Number(th[3]) > 2400 ? Number(th[3]) - 543 : Number(th[3]);
  return `${y}-${pad(th[2])}-${pad(th[1])}`;
}
/** "2026-10-28" → "28/10/2569" */
export const apptTh = (iso: string) => { const [y, m, d] = iso.split("-"); return y && m && d ? `${d}/${m}/${Number(y) + 543}` : iso; };
/** วันเวลาปัจจุบันตามเวลาไทย "2026-10-28 09:30" */
export const nowTh = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
/** คีย์เรียงลำดับ "2026-10-28 09:30" */
export const apptKey = (r: string[]) => `${apptIso(r[0])} ${(r[1] ?? "").slice(0, 5)}`;
/** นัดหมายที่ยังไม่ถึง (รวมวันนี้ที่ยังไม่ถึงเวลา) เรียงใกล้สุดก่อน */
export const upcomingAppts = (rows: string[][]) => {
  const now = nowTh();
  return rows.map((r, i) => ({ r, i })).filter(({ r }) => apptKey(r) >= now).sort((a, b) => apptKey(a.r).localeCompare(apptKey(b.r)));
};
