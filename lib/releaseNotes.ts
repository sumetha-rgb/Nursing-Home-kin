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
    { text: "เข้าสู่ระบบที่เดียว แล้วระบบพาเข้าแอปที่ใช้ล่าสุดให้เอง (ครั้งแรกในเครื่องให้เลือกแอป)" },
    { text: "ปุ่ม \"แอป\" มุมขวาบน สลับไประบบจัดการ · KinApp · ห้องยา ได้ทุกหน้า" },
    { text: "ชื่อแอปชุดเดียวทั้งระบบ: ระบบจัดการ · KinApp · ห้องยา" },
    { text: "ยังไม่มีบัญชี กดปุ่ม \"สมัครใช้งาน\" ใต้ปุ่มเข้าสู่ระบบ · บอกขั้นตอนรออนุมัติ" },
    { text: "คนสมัครใหม่: ผู้จัดการได้แจ้งเตือน เห็นในแถบต้องจัดการ · กดอนุมัติแล้วเลือกตำแหน่งในหน้าต่างเดียว", where: "console" },
    { text: "เอกสารของสุขุมวิท 107 ราชพฤกษ์ พัทยา ออกในนามบริษัท คิน ออริจิ้น เฮลท์แคร์ · แถวสรุป VAT ในใบเสร็จอ่านบรรทัดเดียว", where: "console" },
  ],
};

/** รายการที่เกี่ยวกับแอปที่เปิดอยู่ (ดูจาก path ของหน้า) */
export function notesFor(r: Release | null | undefined, path: string) {
  if (!r) return [];
  const app = path.startsWith("/staff") ? "app" : path.startsWith("/pharmacy") ? null : "console";
  return r.items.filter((x) => !x.where || x.where === app).map((x) => x.text);
}
