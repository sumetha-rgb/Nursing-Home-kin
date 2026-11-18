/** ใครเห็นเมนู "ตั้งค่า" (components/views/Settings): แก้ได้อย่างน้อย 1 หมวด · แยกไฟล์ไว้ให้ app/page ไม่ต้องโหลดหน้าตั้งค่าทั้งหน้า */
import { can } from "./perms";
import { readOnlyRole, type SessionUser } from "./roles";
import { OPT_GROUPS, OPT_WRITE } from "./optionLists";

/** รายงานภาษีขาย: ผู้บริหาร ผู้จัดการสาขา และการเงิน (แคชเชียร์ไม่เห็น) */
export const canSalesTax = (u: { role: string; perms?: string[] } | null | undefined) => !!u && ["Global Admin", "Branch Admin", "Finance"].includes(u.role) && can(u as SessionUser, "billing");
export const canPriceSubs = (u: SessionUser | null) => !!u && (u.role === "Global Admin" || u.role === "Branch Admin") && can(u, "prices");
// การเงิน/บัญชี ดูอย่างเดียว: ไม่เห็นหน้าตั้งค่า
export const canSettings = (u: SessionUser | null) => !readOnlyRole(u?.role) && (can(u, "billing") || canPriceSubs(u) || OPT_GROUPS.some((g) => OPT_WRITE[g].some((p) => can(u, p))));
