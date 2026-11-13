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
    { text: "แก้: เลือกแพ็กเกจกายภาพ PT-12/PT-13 จำนวนครั้งขึ้นถูก (26 ครั้ง ไม่ใช่ 1)", where: "console" },
    { text: "ซื้อคอร์สในประวัติรายบุคคลเลือกจากใบราคาได้ · ตัวเลือก \"คอร์สอื่น (พิมพ์ชื่อและราคาเอง)\"", where: "console" },
    { text: "แถบเมนูซ้ายมีเงาบอกว่ายังมีเมนูด้านล่าง · มือถือชื่อหน้าไม่ถูกตัด", where: "console" },
    { text: "หัวหน้าจอบนมือถือ ปุ่มรายงานเหตุการณ์/ผลงานพิเศษไม่บีบคำทักทาย", where: "app" },
    { text: "เอาโปรแกรมออกกำลังกายที่บ้านออก (ไม่ใช้)", where: "console" },
  ],
};

/** รายการที่เกี่ยวกับแอปที่เปิดอยู่ (ดูจาก path ของหน้า) */
export function notesFor(r: Release | null | undefined, path: string) {
  if (!r) return [];
  const app = path.startsWith("/staff") ? "app" : path.startsWith("/pharmacy") ? null : "console";
  return r.items.filter((x) => !x.where || x.where === app).map((x) => x.text);
}
