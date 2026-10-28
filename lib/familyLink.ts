import { sql } from "./db";

/** ลิงก์ครอบครัวของผู้รับบริการ (ตาราง review_links) ใช้ทั้งสมุดภาพประจำวันและรีวิวพนักงาน */
export type FamilyLink = { id: string; resident_id: string | null; resident_name: string; branch_name: string };

/** ตรวจรหัสลิงก์: ต้องยังใช้งานได้และไม่หมดอายุ */
export async function familyLinkOf(token: string): Promise<FamilyLink | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [l] = (await sql`SELECT id, resident_id, resident_name, branch_name FROM review_links
    WHERE token = ${token} AND active AND (expires_at IS NULL OR expires_at > now())`) as FamilyLink[];
  return l ?? null;
}
