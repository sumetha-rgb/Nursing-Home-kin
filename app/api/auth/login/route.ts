import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { clearFailures, normEmail, recordFailure, startSession, tooManyAttempts, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = normEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "กรุณากรอกอีเมลและรหัสผ่าน" }, { status: 400 });
  if (tooManyAttempts(email)) return NextResponse.json({ error: "ลองผิดหลายครั้งเกินไป กรุณารอ 10 นาทีแล้วลองใหม่" }, { status: 429 });

  const [u] = await sql`
    SELECT id, password_hash, status, full_name AS name, email, access_level AS role, branch_name AS branch
    FROM staff_users WHERE lower(email) = ${email}`;
  if (!u || !(await verifyPassword(password, u.password_hash))) {
    recordFailure(email);
    await audit(req, null, [{ area: "auth", action: "login_failed", summary: email, branch: u?.branch ?? null }], u?.name ?? email);
    return NextResponse.json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }
  if (u.status === "รออนุมัติ") return NextResponse.json({ error: "บัญชีนี้รอผู้ดูแลอนุมัติ กรุณาติดต่อผู้จัดการสาขา" }, { status: 403 });
  if (u.status !== "ทำงาน") return NextResponse.json({ error: `บัญชีนี้ถูกระงับ (${u.status})` }, { status: 403 });

  clearFailures(email);
  const user = { id: u.id, name: u.name, email: u.email, role: u.role as Role, branch: u.branch ?? "" };
  await audit(req, user, [{ area: "auth", action: "login", recordId: u.id, summary: email }]);
  const res = NextResponse.json({ user });
  await startSession(res, u.id);
  return res;
}
