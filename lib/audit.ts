// ใช้ฝั่ง server เท่านั้น: บันทึกประวัติการแก้ไขลงตาราง audit_logs
import { NextRequest } from "next/server";
import { sql } from "./db";
import type { SessionUser } from "./roles";

export type AuditEntry = {
  area: string;
  action: string;
  recordId?: string | null;
  summary?: string | null;
  /** สาขาของข้อมูลที่ถูกแก้ ไม่ระบุ = สาขาของผู้ทำรายการ */
  branch?: string | null;
  before?: unknown;
  after?: unknown;
};

const ipOf = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || null;
const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

/**
 * บันทึกประวัติ ถ้าบันทึกไม่สำเร็จจะไม่ทำให้รายการหลักล้มเหลว (แค่เขียน log ฝั่ง server)
 * actor เป็น null ได้ เช่น ล็อกอินไม่สำเร็จ หรือสมัครสมาชิก (ใช้ actorName แทน)
 */
export async function audit(req: NextRequest, actor: SessionUser | null, entries: AuditEntry[], actorName?: string) {
  if (!entries.length) return;
  const ip = ipOf(req);
  try {
    await sql.transaction(entries.map((e) => sql`
      INSERT INTO audit_logs (actor_id, actor_name, actor_role, actor_branch, branch_name, area, action, record_id, summary, before, after, ip)
      VALUES (${actor?.id ?? null}, ${actor?.name ?? actorName ?? null}, ${actor?.role ?? null}, ${actor?.branch ?? null},
              ${e.branch === undefined ? actor?.branch ?? null : e.branch}, ${e.area}, ${e.action}, ${e.recordId ?? null},
              ${e.summary ?? null}, ${json(e.before)}::jsonb, ${json(e.after)}::jsonb, ${ip})`));
  } catch (err) {
    console.error("[audit] บันทึกประวัติไม่สำเร็จ", err);
  }
}
