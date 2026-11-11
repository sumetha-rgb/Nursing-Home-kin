/**
 * "มีอะไรใหม่" ของเวอร์ชันที่ deploy อยู่ · แก้ไฟล์นี้ทุกครั้งก่อน push
 *  /api/version ส่งไปพร้อมรหัสเวอร์ชัน → แถบอัปเดตบนหน้าที่เปิดค้าง (เวอร์ชันเก่า) แสดงสิ่งที่มากับเวอร์ชันใหม่
 *  where: app = KinApp (/staff) · console = ระบบจัดการ · ไม่ใส่ = ทุกแอป · ข้อความสั้น อ่านจบในบรรทัดเดียว
 */
export type ReleaseItem = { text: string; where?: "app" | "console" };
export type Release = { date: string; items: ReleaseItem[] };

export const RELEASE: Release = {
  date: "11 พ.ย. 2569",
  items: [
    { text: "ผู้รับบริการ 1 คน มีนักกายภาพหลายคน · ทำแทนรายวันได้" },
    { text: "เห็นเฉพาะนัดที่ตัวเองเป็นคนทำ", where: "app" },
    { text: "แก้ไขบันทึกกายภาพได้ภายใน 7 วัน" },
    { text: "บันทึกกายภาพแบบการ์ด อ่านง่ายทั้งคอมและมือถือ" },
    { text: "ยกเลิกนัดรายวัน · ปิดคอร์สที่ไม่ทำต่อ (เก็บผู้ปิด วันเวลา)", where: "console" },
    { text: "ซื้อคอร์สแล้วออกใบแจ้งหนี้ต่อได้ทันที", where: "console" },
    { text: "กดชื่อผู้รับบริการในตารางกายภาพ เปิดโปรไฟล์ได้เลย", where: "console" },
    { text: "กรองตามตำแหน่งในหน้าทีม · หน้าไม่กระโดดตอนโหลด", where: "console" },
  ],
};

/** รายการที่เกี่ยวกับแอปที่เปิดอยู่ (ดูจาก path ของหน้า) */
export function notesFor(r: Release | null | undefined, path: string) {
  if (!r) return [];
  const app = path.startsWith("/staff") ? "app" : path.startsWith("/pharmacy") ? null : "console";
  return r.items.filter((x) => !x.where || x.where === app).map((x) => x.text);
}
