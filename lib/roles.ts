/** ระดับสิทธิ์และบัญชีทดลอง ใช้ได้ทั้งฝั่งหน้าเว็บและ server */
export const ROLES = ["Operation", "Branch Admin", "Global Admin"] as const;
export type Role = (typeof ROLES)[number];

/** branchCheck: ผลตรวจสาขาของบัญชีกับหน้า "สาขาของเรา" ตอนเข้าสู่ระบบ (Global Admin = all) */
export type BranchCheck = "all" | "ok" | "upcoming" | "closed" | "missing";
export type SessionUser = { id: string; name: string; email: string; role: Role; branch: string; branchCheck?: BranchCheck };

export const ROLE_INFO: Record<Role, { th: string; sees: string; app: string }> = {
  Operation: { th: "ระดับปฏิบัติงาน", sees: "KinApp (แอปพนักงาน) และแอปจัดยาเท่านั้น เห็นเฉพาะข้อมูลสาขาตัวเอง", app: "/staff" },
  "Branch Admin": { th: "ผู้จัดการสาขา", sees: "ระบบจัดการ แต่เห็นเฉพาะข้อมูลสาขาตัวเอง เพิ่มพนักงานระดับปฏิบัติงานในสาขาได้", app: "/" },
  "Global Admin": { th: "ผู้บริหารองค์กร", sees: "ทุกเมนู ทุกสาขา จัดการสิทธิ์ของทุกคนได้", app: "/" },
};

/** บัญชีทดลอง สร้างโดย npm run db:setup (ลบออกก่อนใช้งานจริง ดู db/README.md) */
export const DEMO_PASSWORD = "demo1234";
export const DEMO_ACCOUNTS: { email: string; name: string; role: Role; branch: string }[] = [
  { email: "global@kin.test", name: "ผู้บริหาร (ทดลอง)", role: "Global Admin", branch: "ทุกสาขา" },
  { email: "branch@kin.test", name: "ผู้จัดการสาขา (ทดลอง)", role: "Branch Admin", branch: "สุขุมวิท 107" },
  { email: "staff@kin.test", name: "พนักงานดูแล (ทดลอง)", role: "Operation", branch: "สุขุมวิท 107" },
];
export const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS !== "false";

export const isAdmin = (r?: Role) => r === "Branch Admin" || r === "Global Admin";
