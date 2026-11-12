/**
 * เปิดหน้า "ทีมและสิทธิ์การใช้งาน" ที่ตัวกรองที่ต้องการ (เช่น "รออนุมัติ") จากที่อื่น
 *  ตั้งก่อน go("staff") · หน้าทีมอ่านครั้งเดียวตอนเปิดแล้วลบ
 */
const KEY = "kin-staff-filter";
export function wantStaffFilter(status: string) {
  try { sessionStorage.setItem(KEY, status); } catch { /* โหมดส่วนตัว */ }
}
export function takeStaffFilter(): string | null {
  try { const v = sessionStorage.getItem(KEY); if (v) sessionStorage.removeItem(KEY); return v; } catch { return null; }
}
/** แจ้งส่วนอื่นของหน้า (ตัวเลขที่เมนู) ว่าจำนวนรออนุมัติเปลี่ยน */
export const PENDING_EVENT = "kin-staff-pending";
