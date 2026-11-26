/**
 * "มีอะไรใหม่" ของเวอร์ชันที่ deploy อยู่ · แก้ไฟล์นี้ทุกครั้งก่อน push
 *  /api/version ส่งไปพร้อมรหัสเวอร์ชัน → แถบอัปเดตบนหน้าที่เปิดค้าง (เวอร์ชันเก่า) แสดงรายการนี้
 *  กติกา (26 พ.ย. 2569):
 *   - เฉพาะรอบนี้: push ใหม่ = ลบรายการของรอบก่อนออก ใส่เฉพาะของใหม่
 *   - เรื่องละบรรทัด: บอกว่าทำอะไรได้ใหม่ ไม่อธิบายวิธีทำ ไม่ใช้รหัสภายใน
 *   - for = ตำแหน่งที่เห็น (ไม่ใส่ = ทุกตำแหน่ง · ผู้บริหารเห็นทุกเรื่อง) · ไม่มีเรื่องของตำแหน่งนี้ = ไม่ขึ้นแถบ
 *   - where: app = KinApp (/staff) · console = ระบบจัดการ · ไม่ใส่ = ทุกแอป
 *   - แถบแสดงไม่เกิน 5 เรื่อง ที่เหลือกด "ดูอีก N เรื่อง"
 */
import type { Role } from "./roles";

export type ReleaseItem = { text: string; where?: "app" | "console"; for?: Role[] };
export type Release = { date: string; items: ReleaseItem[] };

const CARE: Role[] = ["Nurse", "Nurse Aide", "Head Nurse"];
const NURSE: Role[] = ["Nurse", "Head Nurse"];
const BOSS: Role[] = ["Branch Admin", "Head Nurse"];
const MONEY: Role[] = ["Branch Admin", "Cashier", "Finance"];

export const RELEASE: Release = {
  date: "26 พ.ย. 2569",
  items: [
    { text: "ให้ยาต้องถ่ายรูปก่อนบันทึก (ไม่มีกล้อง อัปโหลดรูปได้)", for: CARE, where: "app" },
    { text: "งานมีช่วงเวลา เช่น 07:00–08:00 · เลยเวลาสิ้นสุดถึงนับว่าเลย", for: [...CARE, "Branch Admin"] },
    { text: "รับเข้าใหม่ ต้องบันทึกแรกรับก่อนเขียนบันทึก", for: NURSE },
    { text: "รับเข้าใหม่ รอพยาบาลบันทึกแรกรับก่อนเขียนบันทึก", for: ["Nurse Aide"] },
    { text: "แรกรับ/ประเมิน ย้ายไปอยู่กลุ่มการพยาบาลและดูแลรายวัน", for: NURSE, where: "console" },
    { text: "มอบหมายงานแบบใหม่: พิมพ์งานเอง เลือกเวลา เลือกวันทำซ้ำ ใช้บนมือถือได้", for: BOSS, where: "console" },
    { text: "ตั้งค่ารายการงาน มีงานแนะนำพร้อมเวลา · แก้งานส่วนกลางเป็นของสาขาได้", for: BOSS, where: "console" },
    { text: "ตั้งเวลากะของสาขาได้เอง ที่หน้าตารางเวร", for: ["Branch Admin"], where: "console" },
    { text: "ผู้จัดการสาขาแก้ราคา ปิด/เปิดใช้ และเพิ่มรายการเฉพาะสาขาตัวเองได้ ไม่กระทบสาขาอื่น", for: ["Branch Admin", "Finance"], where: "console" },
    { text: "งานส่วนกลาง: ฟอร์มใหม่ พิมพ์ชื่องานเอง กดเลือกความถี่", for: ["Branch Admin"], where: "console" },
    { text: "นัดหมายใส่สถานที่และการเดินทางได้", for: [...BOSS, "Nurse"], where: "console" },
    { text: "แพ็กเกจกายภาพในใบแจ้งหนี้ สร้างคอร์สให้อัตโนมัติ ใช้ได้ไม่หมดอายุ", for: [...MONEY, "Physio"] },
    { text: "เวลาต่อครั้งของกายภาพล็อกตามคอร์สที่ซื้อ", for: ["Physio", "Branch Admin"] },
    { text: "ตารางงานนักกายภาพ (ปฏิทิน): กดช่องว่างวางนัด · ลากนัดหรือกด ย้ายวัน / เวลา เพื่อย้ายเฉพาะนัดนั้น · นัดที่บันทึกแล้วมีลายขีด · กรองและพิมพ์ได้", for: ["Branch Admin", "Cashier", "Head Nurse"], where: "console" },
    { text: "ตารางว่างนักกายภาพ: ใครว่างวันไหน ดูทีละสัปดาห์หรือทั้งเดือน (ล่วงหน้าได้หลายเดือน) · ตั้งไม่ว่าง (ลา ป่วย ประชุม) ได้ทีเดียวทั้งช่วง เช่น ทั้งเดือน หรือทุกวันเสาร์ · ปุ่ม ตั้งเวลางาน ใต้ชื่อ · เลือกเคสแล้วเห็นเฉพาะคนที่ว่าง · ลงนัดทับระบบเตือนก่อน · แคชเชียร์ตั้งค่ากายภาพได้ครบ", for: ["Branch Admin", "Cashier", "Head Nurse"], where: "console" },
    { text: "บันทึกกายภาพ: ปุ่มคัดลอกข้างแก้ไข เปิดบันทึกใหม่ที่เติมค่าไว้ให้ตรวจก่อนบันทึก · หรือเลือกวันที่ที่จะคัดลอกในฟอร์ม", for: ["Physio", "Branch Admin", "Head Nurse"] },
    { text: "สัญญาแสดงราคารวม VAT เป็นยอดเดียว · ห้องระยะยาวบอกเป็นเดือน", for: MONEY, where: "console" },
    { text: "เปิดสัญญาใหม่ สาขาล็อกเป็นสาขาตัวเอง", for: ["Branch Admin", "Cashier"], where: "console" },
    { text: "ฟอร์มยาวเห็นครบในหน้าเดียว ไม่ต้องเลื่อน", for: MONEY, where: "console" },
    { text: "เพิ่มสาขาใหม่ กรอกได้ในหน้าเดียว", for: ["Global Admin"], where: "console" },
    { text: "ปุ่ม แอป บนมือถือ กดแล้วรายการขึ้นแล้ว", where: "app" },
    { text: "หน้าผู้รับบริการ: ตัวกรองเป็นการ์ด ข้อความเห็นครบ · ปุ่มห้อง เลือกห้องแล้วดูเฉพาะคนในห้องนั้น", for: CARE, where: "app" },
  ],
};

/** แสดงในแถบไม่เกินกี่เรื่อง (ที่เหลือกด ดูอีก N เรื่อง) */
export const NOTES_SHOWN = 5;

/** รายการที่เกี่ยวกับแอปที่เปิดอยู่ (ดูจาก path ของหน้า) และตำแหน่งของผู้ใช้ · ยังไม่เข้าสู่ระบบ = เฉพาะเรื่องของทุกตำแหน่ง */
export function notesFor(r: Release | null | undefined, path: string, role?: string | null) {
  if (!r) return [];
  const app = path.startsWith("/staff") ? "app" : path.startsWith("/pharmacy") ? null : "console";
  const mine = (x: ReleaseItem) => !x.for || role === "Global Admin" || (!!role && (x.for as string[]).includes(role));
  return r.items.filter((x) => (!x.where || x.where === app) && mine(x)).map((x) => x.text);
}
