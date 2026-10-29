/** ระดับสิทธิ์และบัญชีทดลอง ใช้ได้ทั้งฝั่งหน้าเว็บและ server · สิทธิ์รายเมนู/รายการทำงานดู lib/perms */
export const ROLES = ["Nurse", "Cashier", "Head Nurse", "Branch Admin", "Global Admin"] as const;
export type Role = (typeof ROLES)[number];

/** branchCheck: ผลตรวจสาขาของบัญชีกับหน้า "สาขาของเรา" ตอนเข้าสู่ระบบ (Global Admin = all) */
export type BranchCheck = "all" | "ok" | "upcoming" | "closed" | "missing";
/** perms: สิทธิ์จริงของบัญชี (ค่าเริ่มต้นของตำแหน่ง หรือที่ติ๊กกำหนดรายคน) */
export type SessionUser = { id: string; name: string; email: string; role: Role; branch: string; branchCheck?: BranchCheck; perms?: string[] };

export const ROLE_INFO: Record<Role, { th: string; sees: string; app: string }> = {
  Nurse: { th: "พยาบาล", sees: "KinApp (แอปพนักงาน) และแอปจัดยาเท่านั้น เห็นเฉพาะข้อมูลสาขาตัวเอง", app: "/staff" },
  Cashier: { th: "แคชเชียร์", sees: "เปิดสัญญาใหม่ เลือกห้องให้ผู้รับบริการ ออกใบแจ้งหนี้/ใบเสร็จ และดูห้องว่างของสาขาตัวเอง", app: "/" },
  "Head Nurse": { th: "หัวหน้าพยาบาล", sees: "เมนูงานดูแล สร้างห้องและกำหนดจำนวนเตียง ย้ายห้อง ตรวจงาน และใช้ KinApp/แอปจัดยา เห็นเฉพาะข้อมูลสาขาตัวเอง", app: "/" },
  "Branch Admin": { th: "ผู้จัดการสาขา", sees: "ระบบจัดการ แต่เห็นเฉพาะข้อมูลสาขาตัวเอง สร้างบัญชีและกำหนดสิทธิ์พนักงานในสาขาได้", app: "/" },
  "Global Admin": { th: "ผู้บริหารองค์กร", sees: "ทุกเมนู ทุกสาขา จัดการสิทธิ์ของทุกคนได้", app: "/" },
};

/** บัญชีทดลอง สร้างโดย npm run db:setup (ลบออกก่อนใช้งานจริง ดู db/README.md) */
export const DEMO_PASSWORD = "demo1234";
export const DEMO_ACCOUNTS: { email: string; name: string; role: Role; branch: string }[] = [
  { email: "global@kin.test", name: "ผู้บริหาร (ทดลอง)", role: "Global Admin", branch: "ทุกสาขา" },
  { email: "branch@kin.test", name: "ผู้จัดการสาขา (ทดลอง)", role: "Branch Admin", branch: "สุขุมวิท 107" },
  { email: "nurse@kin.test", name: "หัวหน้าพยาบาล (ทดลอง)", role: "Head Nurse", branch: "สุขุมวิท 107" },
  { email: "cashier@kin.test", name: "แคชเชียร์ (ทดลอง)", role: "Cashier", branch: "สุขุมวิท 107" },
  { email: "staff@kin.test", name: "พนักงานดูแล (ทดลอง)", role: "Nurse", branch: "สุขุมวิท 107" },
];
export const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS !== "false";

/** ผู้จัดการสาขาและผู้บริหาร (ใช้กับงานที่ยังผูกกับตำแหน่ง เช่น จัดการบัญชีในสาขา) */
export const isAdmin = (r?: Role) => r === "Branch Admin" || r === "Global Admin";
/** ระดับที่ผู้จัดการสาขาสร้าง/แก้บัญชีให้คนในสาขาได้ */
export const BRANCH_ROLES: Role[] = ["Nurse", "Cashier", "Head Nurse"];
