/**
 * สิทธิ์การใช้งานรายบุคคล (หน้า "ทีมและสิทธิ์การใช้งาน" ติ๊กเลือกได้) ใช้ได้ทั้งหน้าเว็บและ server
 * staff_users.permissions = NULL → ใช้ค่าเริ่มต้นของตำแหน่ง (ROLE_PERMS) · ผู้บริหารองค์กรได้ทุกสิทธิ์เสมอ
 * ระดับ (role) ยังเป็นตัวกำหนดขอบเขตข้อมูล: ผู้บริหารเห็นทุกสาขา ระดับอื่นเห็นเฉพาะสาขาตัวเอง
 */
import type { ViewId } from "./nav";
import type { Role } from "./roles";

export type Perm = ViewId | "rooms.manage" | "rooms.move" | "contracts.delete" | "invoices.void" | "tasks.review" | "app.staff" | "app.pharmacy";
type Item = { id: Perm; label: string; hint?: string };

export const PERM_GROUPS: { title: string; items: Item[] }[] = [
  { title: "เมนูพื้นที่ดูแล", items: [
    { id: "careplan", label: "ภาพรวมการดูแล" }, { id: "residents", label: "ผู้รับบริการ", hint: "ดู/แก้ทะเบียนและประวัติผู้รับบริการ" },
    { id: "rooms", label: "ห้องผู้ป่วย", hint: "ดูห้องว่างและคนในห้อง" }, { id: "tasks", label: "มอบหมายและตรวจงาน" }, { id: "roster", label: "ตารางเวร" },
    { id: "appointments", label: "ตารางนัดหมาย" }, { id: "health_logs", label: "บันทึกสุขภาพ" }, { id: "quotations", label: "แผนดูแลและใบประเมิน" },
  ] },
  { title: "เมนูบริหารองค์กร", items: [
    { id: "contracts", label: "สัญญาบริการ", hint: "เปิด/แก้/ต่อสัญญา D/C ยกเลิกสัญญา" }, { id: "billing", label: "การเงิน", hint: "ออกใบแจ้งหนี้ รับชำระ ใบเสร็จ" },
    { id: "dashboard", label: "ผลการดำเนินงาน" }, { id: "branches", label: "สาขาของเรา" }, { id: "staff", label: "ทีมและสิทธิ์การใช้งาน", hint: "สร้างบัญชีและกำหนดสิทธิ์" },
    { id: "feedbacks", label: "เสียงจากครอบครัว" }, { id: "reviews", label: "รีวิวพนักงาน" }, { id: "kpi", label: "KPI พนักงาน" }, { id: "audit", label: "ประวัติการแก้ไข" },
  ] },
  { title: "เมนูเครื่องมือและระบบ", items: [
    { id: "tasks_table", label: "ทะเบียนงาน" }, { id: "facility_tasks", label: "งานทั่วไปของศูนย์" }, { id: "master_tasks", label: "คลังงานมาตรฐาน" },
    { id: "official-docs", label: "เอกสารและระเบียบ" }, { id: "tutorials", label: "วิดีโอสอนใช้งาน" },
  ] },
  { title: "สิทธิ์การทำงาน", items: [
    { id: "rooms.move", label: "จัดคนเข้าห้อง / ย้ายห้อง", hint: "ห้องเต็มย้ายเข้าไม่ได้" },
    { id: "rooms.manage", label: "สร้าง/แก้/ลบห้อง และกำหนดจำนวนผู้ป่วยต่อห้อง" },
    { id: "tasks.review", label: "ตรวจงาน ให้ดาว และตั้งงานประจำ" },
    { id: "contracts.delete", label: "ลบสัญญา" },
    { id: "invoices.void", label: "ยกเลิกใบแจ้งหนี้ / ใบเสร็จ" },
  ] },
  { title: "แอปในมือถือ", items: [
    { id: "app.staff", label: "KinApp (แอปพนักงาน)", hint: "งานวันนี้ จ่ายยา สัญญาณชีพ ส่งเวร" },
    { id: "app.pharmacy", label: "แอปจัดยา" },
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
  "Head Nurse": [...CARE, "rooms.move", "rooms.manage", "tasks.review", ...TOOLS, "app.staff", "app.pharmacy"],
  Cashier: ["contracts", "billing", "rooms", "contracts.delete"],
  Nurse: ["app.staff", "app.pharmacy"],
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
