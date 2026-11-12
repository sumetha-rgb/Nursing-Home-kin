/**
 * "มีอะไรใหม่" ของเวอร์ชันที่ deploy อยู่ · แก้ไฟล์นี้ทุกครั้งก่อน push
 *  /api/version ส่งไปพร้อมรหัสเวอร์ชัน → แถบอัปเดตบนหน้าที่เปิดค้าง (เวอร์ชันเก่า) แสดงสิ่งที่มากับเวอร์ชันใหม่
 *  where: app = KinApp (/staff) · console = ระบบจัดการ · ไม่ใส่ = ทุกแอป · ข้อความสั้น อ่านจบในบรรทัดเดียว
 */
export type ReleaseItem = { text: string; where?: "app" | "console" };
export type Release = { date: string; items: ReleaseItem[] };

export const RELEASE: Release = {
  date: "12 พ.ย. 2569",
  items: [
    { text: "เห็นและทำได้เฉพาะนัดที่ได้รับมอบหมาย", where: "app" },
    { text: "ปุ่ม \"ขอคนแทน\" เมื่อทำนัดของตัวเองไม่ได้", where: "app" },
    { text: "การ์ดบอกขั้นตอน เช็คอิน → บันทึก → เสร็จ", where: "app" },
    { text: "นัดเปลี่ยนแล้วหน้าจออัปเดตทันที พร้อมแจ้งว่าเปลี่ยนอะไร" },
    { text: "ทีมประจำเคส · ติ๊กหลายคน แบ่งวันให้สลับกันได้", where: "console" },
    { text: "ตารางกายภาพแบ่งแท็บ · เลื่อนดูสัปดาห์หน้าได้ · มีคำอธิบายสี", where: "console" },
    { text: "นักกายภาพขอคนแทน ขึ้นในแถบต้องจัดการและตาราง", where: "console" },
  ],
};

/** รายการที่เกี่ยวกับแอปที่เปิดอยู่ (ดูจาก path ของหน้า) */
export function notesFor(r: Release | null | undefined, path: string) {
  if (!r) return [];
  const app = path.startsWith("/staff") ? "app" : path.startsWith("/pharmacy") ? null : "console";
  return r.items.filter((x) => !x.where || x.where === app).map((x) => x.text);
}
