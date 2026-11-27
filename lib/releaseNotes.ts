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
  date: "27 พ.ย. 2569",
  items: [
    { text: "ข้อความอธิบายหลายหน้าเขียนใหม่ให้อ่านง่ายขึ้น · ตารางว่างกายภาพและหน้าราคาใช้ป้ายสีแทนคำอธิบายยาว", where: "console" },
    { text: "เมนู รายได้ตาม BU เปลี่ยนชื่อเป็น รายได้ตามฝ่าย", for: MONEY, where: "console" },
    { text: "KPI พนักงาน: ปุ่ม ตั้งน้ำหนัก เปลี่ยนเป็น ตั้งสัดส่วนคะแนน", for: ["Global Admin"], where: "console" },
    { text: "อ้อมกอด: คอร์สกายภาพโดยนักกายภาพล็อกครั้งละ 60 นาที · กายภาพพื้นฐาน 30 นาที (เหมือนสาขาอื่น)", for: ["Physio", "Branch Admin", "Cashier"] },
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
