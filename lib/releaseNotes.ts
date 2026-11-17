/**
 * "มีอะไรใหม่" ของเวอร์ชันที่ deploy อยู่ · แก้ไฟล์นี้ทุกครั้งก่อน push
 *  /api/version ส่งไปพร้อมรหัสเวอร์ชัน → แถบอัปเดตบนหน้าที่เปิดค้าง (เวอร์ชันเก่า) แสดงสิ่งที่มากับเวอร์ชันใหม่
 *  where: app = KinApp (/staff) · console = ระบบจัดการ · ไม่ใส่ = ทุกแอป · ข้อความสั้น อ่านจบในบรรทัดเดียว
 */
export type ReleaseItem = { text: string; where?: "app" | "console" };
export type Release = { date: string; items: ReleaseItem[] };

export const RELEASE: Release = {
  date: "13 พ.ย. 2569",
  items: [
    { text: "ฟอร์มสัญญา: วันเริ่ม/วันสิ้นสุดสัญญาย้ายมาหน้าค่าใช้จ่าย แสดงวันที่แบบไทย (วว/ดด/ปปปป) · กรอกจำนวนเดือนที่จะอยู่ได้ · ชำระค่าห้องล่วงหน้าอยู่ใต้ค่าห้อง เลือกจำนวนเดือนเองได้ (1–12) · เอาป้ายราคาโปรออกจากการ์ดห้อง", where: "console" },
    { text: "ชำระล่วงหน้า: คูณเฉพาะค่าห้อง + ค่าบริการทางการแพทย์ · บริการเพิ่มเติมเก็บเดือนแรก แล้วออกใบรายเดือนตามรอบ (สัญญาใหม่)", where: "console" },
    { text: "ตาราง \"ครบรอบบิล\" แสดงยอดของรอบนั้นจริง · D/C ก่อนครบช่วงล่วงหน้า คืนค่าห้องกับบริการเพิ่มเติมแยกใบ", where: "console" },
  ],
};

/** รายการที่เกี่ยวกับแอปที่เปิดอยู่ (ดูจาก path ของหน้า) */
export function notesFor(r: Release | null | undefined, path: string) {
  if (!r) return [];
  const app = path.startsWith("/staff") ? "app" : path.startsWith("/pharmacy") ? null : "console";
  return r.items.filter((x) => !x.where || x.where === app).map((x) => x.text);
}
