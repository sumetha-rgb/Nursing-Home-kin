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
    { text: "ภาพรวมและรายงาน: ตัวเลขหลัก 5 กล่องด้านบน (เข้าพัก รับชำระ ค้างชำระ ผู้รับบริการ เรื่องด่วน)", where: "console" },
    { text: "แถบต้องจัดการย่อเหลือแถวเดียว กด \"ดูทั้งหมด\" เพื่อกาง", where: "console" },
    { text: "แท็บรายงานรวมเป็น 4 หมวด มีหัวข้อย่อย อ่านง่ายขึ้น", where: "console" },
    { text: "ตัวชี้วัด % บอกฐาน (เช่น 4 จาก 7 เตียง) กดแถวดูสรุปได้", where: "console" },
    { text: "ผู้บริหารเห็นตารางเทียบสาขา สีเขียว/ส้ม/แดงตามเป้า", where: "console" },
    { text: "งานวันนี้: สรุปเหลือกี่เรื่อง · ทำก่อนแบ่ง 2 ระดับ · ตัวเลขมีหน่วย", where: "console" },
  ],
};

/** รายการที่เกี่ยวกับแอปที่เปิดอยู่ (ดูจาก path ของหน้า) */
export function notesFor(r: Release | null | undefined, path: string) {
  if (!r) return [];
  const app = path.startsWith("/staff") ? "app" : path.startsWith("/pharmacy") ? null : "console";
  return r.items.filter((x) => !x.where || x.where === app).map((x) => x.text);
}
