/**
 * สิทธิ์การใช้งานรายบุคคล (หน้า "ทีมและสิทธิ์การใช้งาน" ติ๊กเลือกได้) ใช้ได้ทั้งหน้าเว็บและ server
 * staff_users.permissions = NULL → ใช้ค่าเริ่มต้นของตำแหน่ง (ROLE_PERMS) · ผู้บริหารองค์กรได้ทุกสิทธิ์เสมอ
 * ระดับ (role) ยังเป็นตัวกำหนดขอบเขตข้อมูล: ผู้บริหารเห็นทุกสาขา ระดับอื่นเห็นเฉพาะสาขาตัวเอง
 */
import type { ViewId } from "./nav";
import type { Role } from "./roles";

export type Perm = ViewId | "rooms.manage" | "rooms.move" | "contracts.delete" | "invoices.void" | "tasks.review" | "physio.record" | "physio.assign" | "app.staff" | "app.pharmacy";
type Item = { id: Perm; label: string; hint?: string };

export const PERM_GROUPS: { title: string; items: Item[] }[] = [
  { title: "เมนูงานดูแล", items: [
    { id: "careplan", label: "งานวันนี้" }, { id: "residents", label: "ผู้รับบริการ", hint: "ดู/แก้ทะเบียนและประวัติผู้รับบริการ" },
    { id: "rooms", label: "ห้องพักและเตียง", hint: "ดูห้องว่างและคนในห้อง" }, { id: "tasks", label: "มอบหมายและตรวจงาน" }, { id: "roster", label: "ตารางเวร" },
    { id: "physio", label: "ตารางกายภาพ", hint: "ดูเคสและตารางของนักกายภาพ" }, { id: "appointments", label: "ตารางนัดหมาย" }, { id: "health_logs", label: "บันทึกสุขภาพ" }, { id: "feedbacks", label: "เสียงจากครอบครัว" },
  ] },
  { title: "เมนูขายและการเงิน", items: [
    { id: "prices", label: "ราคาสินค้าและบริการ", hint: "ดูราคากลาง · ผู้จัดการสาขาและผู้บริหารแก้ราคาและรหัสได้" },
    { id: "quotations", label: "ใบเสนอราคา / แผนดูแล" },
    { id: "contracts", label: "สัญญาบริการ", hint: "เปิด/แก้/ต่อสัญญา D/C ยกเลิกสัญญา" }, { id: "billing", label: "ใบแจ้งหนี้และใบเสร็จ", hint: "ออกใบแจ้งหนี้ รับชำระ ใบเสร็จ ปิดยอดรายวัน" },
  ] },
  { title: "เมนูบริหาร", items: [
    { id: "dashboard", label: "ภาพรวมและรายงาน", hint: "แดชบอร์ดและส่งออก CSV" }, { id: "branches", label: "ข้อมูลสาขา" },
  ] },
  { title: "เมนูทีมงาน", items: [
    { id: "staff", label: "ทีมและสิทธิ์การใช้งาน", hint: "สร้างบัญชีและกำหนดสิทธิ์" }, { id: "kpi", label: "KPI พนักงาน" }, { id: "reviews", label: "รีวิวพนักงาน" },
  ] },
  { title: "เมนูเครื่องมือและระบบ", items: [
    { id: "tasks_table", label: "งานดูแลย้อนหลัง" }, { id: "facility_tasks", label: "งานส่วนกลางของสาขา" }, { id: "master_tasks", label: "แม่แบบงานมาตรฐาน" },
    { id: "official-docs", label: "เอกสารและระเบียบ" }, { id: "tutorials", label: "วิดีโอสอนใช้งาน" }, { id: "audit", label: "บันทึกการใช้งานระบบ" },
  ] },
  { title: "สิทธิ์การทำงาน", items: [
    { id: "rooms.move", label: "จัดคนเข้าห้อง / ย้ายห้อง", hint: "ห้องเต็มย้ายเข้าไม่ได้" },
    { id: "rooms.manage", label: "สร้าง/แก้/ลบห้อง และกำหนดจำนวนผู้ป่วยต่อห้อง" },
    { id: "tasks.review", label: "ตรวจงาน ให้ดาว และตั้งงานประจำ" },
    { id: "physio.record", label: "บันทึกกายภาพ (ตัดคอร์ส)", hint: "นักกายภาพ · คนที่ไม่มีสิทธิ์อ่านบันทึกได้อย่างเดียว" },
    { id: "physio.assign", label: "จ่ายเคสกายภาพ", hint: "ผู้จัดการสาขาและฝ่ายขาย · เลือกนักกายภาพ วัน และเวลาของแต่ละคอร์ส" },
    { id: "contracts.delete", label: "ลบสัญญา" },
    { id: "invoices.void", label: "ยกเลิกใบแจ้งหนี้ / ใบเสร็จ" },
  ] },
  { title: "แอปในมือถือ", items: [
    { id: "app.staff", label: "KinApp", hint: "งานวันนี้ จ่ายยา สัญญาณชีพ ส่งเวร" },
    { id: "app.pharmacy", label: "ห้องยา", hint: "จัดยา ตรวจยา คลังยา เวชภัณฑ์" },
  ] },
];

export const ALL_PERMS: Perm[] = PERM_GROUPS.flatMap((g) => g.items.map((i) => i.id));
export const PERM_LABEL = Object.fromEntries(PERM_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label]))) as Record<Perm, string>;

const CARE: Perm[] = ["careplan", "residents", "rooms", "tasks", "roster", "appointments", "health_logs", "quotations"];
const TOOLS: Perm[] = ["tasks_table", "facility_tasks", "master_tasks", "official-docs", "tutorials"];

/** ค่าเริ่มต้นของแต่ละตำแหน่ง (ติ๊กเพิ่ม/เอาออกรายคนได้) */
export const ROLE_PERMS: Record<Role, Perm[]> = {
  "Global Admin": ALL_PERMS,
  "Branch Admin": ALL_PERMS,
  "Head Nurse": [...CARE, "physio", "rooms.move", "rooms.manage", "tasks.review", ...TOOLS, "app.staff", "app.pharmacy"],
  // แคชเชียร์ = ฝ่ายขาย: ขายคอร์สกายภาพและจ่ายเคสให้นักกายภาพ (ร่วมกับผู้จัดการสาขา)
  Cashier: ["contracts", "billing", "rooms", "contracts.delete", "prices", "physio", "physio.assign"],
  Nurse: ["app.staff", "app.pharmacy"],
  Physio: ["app.staff", "physio.record"],
};

/** สิทธิ์จริงของบัญชี */
export function permsFor(role: Role, custom?: string[] | null): Perm[] {
  if (role === "Global Admin") return ALL_PERMS;
  if (!custom) return ROLE_PERMS[role];
  return ALL_PERMS.filter((p) => custom.includes(p));
}

export const can = (u: { role: Role; perms?: string[] } | null | undefined, p: Perm) =>
  !!u && (u.role === "Global Admin" || (u.perms ?? ROLE_PERMS[u.role]).includes(p));
/** เปิดระบบจัดการได้ = มีเมนูอย่างน้อย 1 เมนู */
export const MENU_PERMS = PERM_GROUPS.slice(0, 3).flatMap((g) => g.items.map((i) => i.id));
export const hasConsole = (u: { role: Role; perms?: string[] } | null | undefined) => MENU_PERMS.some((p) => can(u, p));
